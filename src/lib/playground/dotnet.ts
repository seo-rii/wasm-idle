import { resolveDotnetModuleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { type CompilerDiagnostic, type SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerInputReady, reportWorkerProgress } from '$lib/playground/workerProgress';
import {
	BusyError,
	CancelledError,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	RuntimeConfigurationError,
	TimeoutError,
	WorkspaceValidationError,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';

type DotnetSandboxLanguage = 'FSHARP' | 'CSHARP' | 'VBNET';
type DotnetCompileLanguage = 'fsharp' | 'csharp' | 'vbnet';
type DotnetOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	deferCompletion: boolean;
	abortReasonReading: boolean;
	sessionActive: boolean;
	signal?: AbortSignal;
	onAbort?: () => void;
	deferredReject?: (reason: unknown) => void;
	timeout?: ReturnType<typeof setTimeout>;
};
type DotnetRuntimeModule = {
	createDotnetCompiler: (options?: { loadReferences?: boolean }) => {
		compile(request: {
			code: string;
			language: DotnetCompileLanguage;
			target: 'browser-wasm';
			prepare?: boolean;
			log?: boolean;
			onProgress?: (progress: { percent?: number; stage?: string }) => void;
		}): Promise<{
			success: boolean;
			artifact?: unknown;
			stdout?: string;
			stderr?: string;
			diagnostics?: CompilerDiagnostic[];
			logs?: string[];
		}>;
	};
	executeBrowserDotnetArtifact: (
		artifact: unknown,
		options?: {
			args?: string[];
			env?: Record<string, string>;
			stdin?: string;
			stdout?: (chunk: string) => void;
			stderr?: (chunk: string) => void;
		}
	) => Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
	}>;
};

type DotnetCompiler = ReturnType<DotnetRuntimeModule['createDotnetCompiler']>;
type DotnetMainThreadBackend = {
	kind: 'main-thread';
	runtimeModule: DotnetRuntimeModule;
	compiler: DotnetCompiler;
	compile: DotnetCompiler['compile'];
	execute: DotnetRuntimeModule['executeBrowserDotnetArtifact'];
};
type DotnetRunBackend = DotnetMainThreadBackend | { kind: 'worker'; worker: Worker };
type DotnetRunRequest = {
	programArgs: string[];
	stdin: string | undefined;
	output: any;
	onDiagnostic: ((diagnostic: CompilerDiagnostic) => void) | undefined;
	meter: DotnetRunMeter;
	backend: DotnetRunBackend;
};

type DotnetRunMeter = {
	recordOutput: (output: unknown) => void;
	recordDiagnostic: () => void;
};

type DotnetExecutionLimits = ReturnType<typeof resolveExecutionLimits>;

const executionLimitKeys = [
	'assetTimeoutMs',
	'startupTimeoutMs',
	'compileTimeoutMs',
	'runTimeoutMs',
	'maxOutputBytes',
	'maxDiagnostics',
	'maxWorkspaceBytes',
	'maxAssetBytes',
	'maxWasmMemoryBytes',
	'maxWorkers',
	'maxThreads'
] as const satisfies readonly (keyof DotnetExecutionLimits)[];

const OUTPUT_ENCODER = new TextEncoder();

const readsConsoleStdin = (code: string) => /\b(?:System\.)?Console\.(?:ReadLine|In)\b/.test(code);

class Dotnet implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	runtimeModule: DotnetRuntimeModule | null = null;
	compiler: DotnetCompiler | null = null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	pendingInput: string[] = [];
	pendingEof = false;
	stdinWaiters: Array<() => void> = [];
	compiledArtifact: unknown = null;
	compiledCacheKey = '';
	compiledRuntimeModule: DotnetRuntimeModule | null = null;
	compiledCompiler: DotnetCompiler | null = null;
	compiledCompile: DotnetCompiler['compile'] | null = null;
	compiledExecute: DotnetRuntimeModule['executeBrowserDotnetArtifact'] | null = null;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	private activeExplicitStdinCleanup: (() => void) | null = null;
	private activeOperation: DotnetOperation | null = null;
	private disposed = false;
	private disposePromise: Promise<void> | null = null;
	private readonly disposeCancellation: CancelledError;
	private readonly workerSession = new WorkerSession({
		label: () => this.languageLabel,
		onDispose: (worker) => {
			this.activeExplicitStdinCleanup?.();
			if (this.worker === worker) delete this.worker;
			this.exit = true;
		}
	});

	constructor(private readonly language: DotnetSandboxLanguage = 'FSHARP') {
		this.disposeCancellation = new CancelledError(`${this.languageLabel} sandbox disposed`, {
			phase: 'dispose',
			runtimeId: this.language,
			recoverable: false
		});
	}

	private get compileLanguage(): DotnetCompileLanguage {
		return this.language === 'CSHARP'
			? 'csharp'
			: this.language === 'VBNET'
				? 'vbnet'
				: 'fsharp';
	}

	private get languageLabel() {
		return this.language === 'CSHARP' ? 'C#' : this.language === 'VBNET' ? 'VB.NET' : 'F#';
	}

	private beginOperation(phase: DotnetOperation['phase']) {
		if (this.disposed) {
			throw new RuntimeConfigurationError(`${this.languageLabel} sandbox is disposed`, {
				phase: 'dispose',
				runtimeId: this.language
			});
		}
		if (this.activeOperation) {
			throw new BusyError(`${this.languageLabel} runtime already has an active operation`, {
				runtimeId: this.language,
				phase: this.activeOperation.phase
			});
		}
		const operation: DotnetOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			deferCompletion: false,
			abortReasonReading: false,
			sessionActive: false
		};
		this.activeOperation = operation;
		return operation;
	}

	private completeOperation(operation: DotnetOperation) {
		operation.deferredReject = undefined;
		this.releaseOperationTimeout(operation);
		if (this.activeOperation?.token === operation.token) this.activeOperation = null;
		this.releaseAbortSignal(operation);
	}

	private isOperationActive(operation: DotnetOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseBeforeSession(operation: DotnetOperation, fallback: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : fallback;
		this.completeOperation(operation);
		return outcome;
	}

	private releaseAbortSignal(operation: DotnetOperation) {
		const { signal, onAbort } = operation;
		operation.signal = undefined;
		operation.onAbort = undefined;
		if (signal && onAbort) {
			try {
				signal.removeEventListener('abort', onAbort);
			} catch {
				// Listener cleanup must not replace the operation result.
			}
		}
	}

	private releaseOperationTimeout(operation: DotnetOperation) {
		const timeout = operation.timeout;
		operation.timeout = undefined;
		if (timeout === undefined) return;
		try {
			clearTimeout(timeout);
		} catch {
			// Timer cleanup must not replace the operation result.
		}
	}

	private abortReason(signal: AbortSignal, phase: DotnetOperation['phase']) {
		const reason = signal.reason;
		if (reason !== undefined) return reason;
		return new DOMException(
			phase === 'startup'
				? `${this.languageLabel} runtime startup aborted`
				: `${this.languageLabel} execution aborted`,
			'AbortError'
		);
	}

	private abortOperation(operation: DotnetOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) {
			this.releaseAbortSignal(operation);
			return;
		}
		const rejectDeferred = operation.deferredReject;
		operation.deferredReject = undefined;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.activeExplicitStdinCleanup?.();
		this.uid += 1;
		this.resolveStdinWaiters();
		this.workerSession.terminate(reason);
		this.exit = true;
		rejectDeferred?.(reason);
		if (operation.deferCompletion) {
			this.releaseOperationTimeout(operation);
			this.releaseAbortSignal(operation);
		} else this.completeOperation(operation);
	}

	private cancelBeforeSession(operation: DotnetOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.completeOperation(operation);
	}

	private bindAbortSignal(operation: DotnetOperation, signal?: AbortSignal) {
		if (!signal || !this.isOperationActive(operation)) return;
		const onAbort = () => {
			if (!this.isOperationActive(operation) || operation.abortReasonReading) return;
			operation.abortReasonReading = true;
			let reason: unknown;
			try {
				reason = this.abortReason(signal, operation.phase);
			} catch (error) {
				reason = error;
			} finally {
				operation.abortReasonReading = false;
			}
			if (!this.isOperationActive(operation)) return;
			if (operation.sessionActive) this.abortOperation(operation, reason);
			else this.cancelBeforeSession(operation, reason);
		};
		operation.signal = signal;
		operation.onAbort = onAbort;
		try {
			signal.addEventListener('abort', onAbort, { once: true });
		} catch (error) {
			if (!this.isOperationActive(operation)) return;
			let signalAborted = false;
			try {
				signalAborted = signal.aborted;
			} catch {
				if (!this.isOperationActive(operation)) return;
			}
			if (signalAborted) onAbort();
			else this.cancelBeforeSession(operation, error);
			return;
		}
		if (!this.isOperationActive(operation)) return;
		try {
			if (signal.aborted) onAbort();
		} catch (error) {
			if (this.isOperationActive(operation)) this.cancelBeforeSession(operation, error);
		}
	}

	private bindOperationTimeout(operation: DotnetOperation, timeoutMs: number) {
		if (!this.isOperationActive(operation)) return;
		let timeout: ReturnType<typeof setTimeout>;
		try {
			timeout = setTimeout(() => {
				if (operation.timeout === timeout) operation.timeout = undefined;
				if (!this.isOperationActive(operation)) return;
				const label = operation.phase === 'startup' ? 'runtime startup' : 'execution';
				this.abortOperation(
					operation,
					new TimeoutError(
						`${this.languageLabel} ${label} timed out after ${timeoutMs} ms`,
						{
							phase: operation.phase,
							runtimeId: this.language,
							timeoutMs
						}
					)
				);
			}, timeoutMs);
		} catch (error) {
			this.abortOperation(operation, error);
			return;
		}
		if (!this.isOperationActive(operation)) {
			if (this.activeOperation?.token === operation.token) operation.timeout = timeout;
			return;
		}
		operation.timeout = timeout;
	}

	private resolveOperationLimits(
		operation: DotnetOperation,
		configured: Partial<DotnetExecutionLimits> | undefined
	) {
		if (!configured) return resolveExecutionLimits();
		const snapshot: Partial<DotnetExecutionLimits> = {};
		for (const key of executionLimitKeys) {
			const enumerable = Object.prototype.propertyIsEnumerable.call(configured, key);
			if (!this.isOperationActive(operation)) throw operation.cancellationReason;
			if (!enumerable) continue;
			snapshot[key] = configured[key];
			if (!this.isOperationActive(operation)) throw operation.cancellationReason;
		}
		return resolveExecutionLimits(snapshot);
	}

	private clearCompiledArtifact() {
		this.compiledArtifact = null;
		this.compiledCacheKey = '';
		this.compiledRuntimeModule = null;
		this.compiledCompiler = null;
		this.compiledCompile = null;
		this.compiledExecute = null;
	}

	private shouldRunOnMainThread() {
		// Compiler and user-program execution must remain physically cancellable.
		// Keep the legacy backend implementation below until its state machinery can
		// be removed independently, but never select it through the public runtime.
		return false;
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let operation: DotnetOperation;
		try {
			operation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let limits: DotnetExecutionLimits;
		let nextModuleUrl: string;
		let runOnMainThread: boolean;
		try {
			signal = options.signal;
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(
						operation,
						`${this.languageLabel} runtime startup cancelled`
					)
				);
			}
			this.bindAbortSignal(operation, signal);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(
						operation,
						`${this.languageLabel} runtime startup cancelled`
					)
				);
			}
			const configuredLimits = options.limits;
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(
						operation,
						`${this.languageLabel} runtime startup cancelled`
					)
				);
			}
			limits = this.resolveOperationLimits(operation, configuredLimits);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(
						operation,
						`${this.languageLabel} runtime startup cancelled`
					)
				);
			}
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(
						operation,
						`${this.languageLabel} runtime startup cancelled`
					)
				);
			}
			if (typeof runtimeAssets === 'string') {
				nextModuleUrl = resolveDotnetModuleUrl(runtimeAssets, currentUrl);
			} else {
				const dotnetAssets = runtimeAssets?.dotnet;
				if (!this.isOperationActive(operation)) {
					return Promise.reject(
						this.releaseBeforeSession(
							operation,
							`${this.languageLabel} runtime startup cancelled`
						)
					);
				}
				const configuredModuleUrl = dotnetAssets?.moduleUrl;
				if (!this.isOperationActive(operation)) {
					return Promise.reject(
						this.releaseBeforeSession(
							operation,
							`${this.languageLabel} runtime startup cancelled`
						)
					);
				}
				nextModuleUrl = resolveDotnetModuleUrl(
					configuredModuleUrl === undefined
						? {}
						: { dotnet: { moduleUrl: configuredModuleUrl } },
					currentUrl
				);
				if (!nextModuleUrl) {
					const rootUrl = runtimeAssets?.rootUrl;
					if (!this.isOperationActive(operation)) {
						return Promise.reject(
							this.releaseBeforeSession(
								operation,
								`${this.languageLabel} runtime startup cancelled`
							)
						);
					}
					nextModuleUrl = resolveDotnetModuleUrl({ rootUrl }, currentUrl);
				}
			}
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(
						operation,
						`${this.languageLabel} runtime startup cancelled`
					)
				);
			}
			if (!nextModuleUrl) {
				return Promise.reject(
					this.releaseBeforeSession(
						operation,
						`${this.languageLabel} runtime is not configured. Set runtimeAssets.dotnet.moduleUrl or PUBLIC_WASM_DOTNET_MODULE_URL.`
					)
				);
			}
			runOnMainThread = this.shouldRunOnMainThread();
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(
						operation,
						`${this.languageLabel} runtime startup cancelled`
					)
				);
			}
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(operation, error));
		}
		operation.sessionActive = true;
		const loading = this.workerSession.load(async (resolve, reject) => {
			try {
				if (!this.isOperationActive(operation)) return;
				const needsWorkerReset = !this.worker || this.moduleUrl !== nextModuleUrl;
				const needsRuntimeReset =
					!this.runtimeModule || !this.compiler || this.moduleUrl !== nextModuleUrl;
				if (runOnMainThread) {
					let runtimeModule = this.runtimeModule;
					let compiler = this.compiler;
					if (needsRuntimeReset) {
						runtimeModule = (await import(
							/* @vite-ignore */ nextModuleUrl
						)) as DotnetRuntimeModule;
						if (!this.isOperationActive(operation)) return;
						if (typeof runtimeModule.createDotnetCompiler !== 'function') {
							return reject('wasm-dotnet module must export createDotnetCompiler');
						}
						if (typeof runtimeModule.executeBrowserDotnetArtifact !== 'function') {
							return reject(
								'wasm-dotnet module must export executeBrowserDotnetArtifact'
							);
						}
						compiler = runtimeModule.createDotnetCompiler();
						if (!this.isOperationActive(operation)) return;
					}
					if (!this.isOperationActive(operation)) return;
					progress?.set?.(1);
					if (!this.isOperationActive(operation)) return;
					if (this.worker) this.workerSession.reset();
					if (!this.isOperationActive(operation)) return;
					this.moduleUrl = nextModuleUrl;
					this.runtimeModule = runtimeModule;
					this.compiler = compiler;
					if (needsRuntimeReset) {
						this.clearCompiledArtifact();
					}
					resolve();
					this.completeOperation(operation);
					return;
				}
				if (needsWorkerReset) {
					const WorkerConstructor = (await import('$lib/playground/worker/dotnet?worker'))
						.default;
					if (!this.isOperationActive(operation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(operation)) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					if (!this.isOperationActive(operation) || this.worker !== worker) {
						this.workerSession.release(worker);
						return;
					}
					worker.onmessage = (event: MessageEvent<any>) => {
						if (!this.isOperationActive(operation) || this.worker !== worker) return;
						try {
							if (event.data?.load) {
								progress?.set?.(1);
								if (!this.isOperationActive(operation) || this.worker !== worker)
									return;
								this.moduleUrl = nextModuleUrl;
								this.runtimeModule = null;
								this.compiler = null;
								this.clearCompiledArtifact();
								resolve();
								this.completeOperation(operation);
								return;
							}
							if (event.data?.error) reject(event.data.error);
						} catch (error) {
							reject(error);
						}
					};
					worker.postMessage({
						load: true,
						moduleUrl: nextModuleUrl
					});
				} else {
					if (!this.isOperationActive(operation)) return;
					progress?.set?.(1);
					if (!this.isOperationActive(operation)) return;
					this.moduleUrl = nextModuleUrl;
					this.runtimeModule = null;
					this.compiler = null;
					this.clearCompiledArtifact();
					resolve();
					this.completeOperation(operation);
				}
			} catch (error: any) {
				reject(error?.message || String(error));
			}
		});
		this.bindOperationTimeout(
			operation,
			Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs)
		);
		return loading.finally(() => this.completeOperation(operation));
	}

	write(input: string) {
		if (this.disposed) return;
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.resolveStdinWaiters();
	}

	eof() {
		if (this.disposed) return;
		this.pendingEof = true;
		this.resolveStdinWaiters();
	}

	private resolveStdinWaiters() {
		const waiters = this.stdinWaiters.splice(0);
		for (const resolve of waiters) resolve();
	}

	private resetStdinState() {
		this.pendingInput = [];
		this.pendingEof = false;
		this.resolveStdinWaiters();
	}

	private async collectStdinForRun(
		code: string,
		prepare: boolean,
		explicitStdin: string | undefined,
		runUid: number,
		progress?: SandboxProgress
	) {
		const hasExplicitStdin = !prepare && explicitStdin !== undefined;
		if (runUid !== this.uid) return '';
		if (
			!prepare &&
			!hasExplicitStdin &&
			this.pendingInput.length === 0 &&
			!this.pendingEof &&
			readsConsoleStdin(code)
		) {
			reportWorkerInputReady(progress, `${this.languageLabel} runtime ready for input`);
			if (runUid !== this.uid) return '';
			await new Promise<void>((resolve) => this.stdinWaiters.push(resolve));
		}
		if (runUid !== this.uid) return '';
		if (hasExplicitStdin) return explicitStdin;
		const stdin = `${explicitStdin ?? ''}${this.pendingInput.join('')}`;
		if (!prepare) {
			this.pendingInput = [];
			this.pendingEof = false;
		}
		return stdin;
	}

	async run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const operation = this.beginOperation('execute');
		let signal: AbortSignal | undefined;
		let limits: DotnetExecutionLimits;
		let request: DotnetRunRequest;
		try {
			signal = options.signal;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			this.bindAbortSignal(operation, signal);
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			const configuredLimits = options.limits;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			limits = this.resolveOperationLimits(operation, configuredLimits);
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			const configuredWorkspaceFiles = options.workspaceFiles;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			const workspaceFilesSource =
				configuredWorkspaceFiles === undefined ? [] : configuredWorkspaceFiles;
			if (!Array.isArray(workspaceFilesSource)) {
				throw new TypeError(`${this.languageLabel} workspace files must be an array`);
			}
			const workspaceLimitsSource = options.workspaceLimits;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			let workspaceLimits: SandboxExecutionOptions['workspaceLimits'] = {};
			if (workspaceLimitsSource !== undefined) {
				if (
					workspaceLimitsSource === null ||
					typeof workspaceLimitsSource !== 'object' ||
					Array.isArray(workspaceLimitsSource)
				) {
					throw new TypeError(`${this.languageLabel} workspace limits must be an object`);
				}
				const maxFiles = workspaceLimitsSource.maxFiles;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				if (maxFiles !== undefined && (!Number.isSafeInteger(maxFiles) || maxFiles < 0)) {
					throw new WorkspaceValidationError(
						'invalid-limit',
						'Workspace limit maxFiles must be a non-negative safe integer'
					);
				}
				const maxFileBytes = workspaceLimitsSource.maxFileBytes;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				if (
					maxFileBytes !== undefined &&
					(!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 0)
				) {
					throw new WorkspaceValidationError(
						'invalid-limit',
						'Workspace limit maxFileBytes must be a non-negative safe integer'
					);
				}
				const maxTotalBytes = workspaceLimitsSource.maxTotalBytes;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				if (
					maxTotalBytes !== undefined &&
					(!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0)
				) {
					throw new WorkspaceValidationError(
						'invalid-limit',
						'Workspace limit maxTotalBytes must be a non-negative safe integer'
					);
				}
				const maxPathBytes = workspaceLimitsSource.maxPathBytes;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				if (
					maxPathBytes !== undefined &&
					(!Number.isSafeInteger(maxPathBytes) || maxPathBytes < 0)
				) {
					throw new WorkspaceValidationError(
						'invalid-limit',
						'Workspace limit maxPathBytes must be a non-negative safe integer'
					);
				}
				const caseSensitive = workspaceLimitsSource.caseSensitive;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				if (caseSensitive !== undefined && typeof caseSensitive !== 'boolean') {
					throw new WorkspaceValidationError(
						'invalid-limit',
						'Workspace limit caseSensitive must be a boolean'
					);
				}
				workspaceLimits = {
					maxFiles,
					maxFileBytes,
					maxTotalBytes,
					maxPathBytes,
					caseSensitive
				};
			}
			const maxFiles = workspaceLimits.maxFiles ?? DEFAULT_WORKSPACE_LIMITS.maxFiles;
			const workspaceFileCount = workspaceFilesSource.length;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			if (!Number.isSafeInteger(workspaceFileCount) || workspaceFileCount < 0) {
				throw new WorkspaceValidationError(
					'file-count-limit',
					'.NET workspace file count must be a non-negative safe integer',
					{ limit: maxFiles }
				);
			}
			if (workspaceFileCount > maxFiles) {
				throw new WorkspaceValidationError(
					'file-count-limit',
					`Workspace contains ${workspaceFileCount} files; limit is ${maxFiles}`,
					{ limit: maxFiles, actual: workspaceFileCount }
				);
			}
			const workspaceFiles: Array<{ path: string; content: string }> = [];
			for (let index = 0; index < workspaceFileCount; index += 1) {
				const file = workspaceFilesSource[index];
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				if (file === null || typeof file !== 'object') {
					throw new TypeError(`${this.languageLabel} workspace file must be an object`);
				}
				const path = file.path;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				const content = file.content;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				workspaceFiles.push({ path, content });
			}
			const configuredActivePath = options.activePath;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			const activePath =
				configuredActivePath === undefined
					? this.language === 'CSHARP'
						? 'Program.cs'
						: this.language === 'VBNET'
							? 'Program.vb'
							: 'Program.fs'
					: configuredActivePath;
			const maxFileBytes = Math.min(
				workspaceLimits.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
				limits.maxWorkspaceBytes
			);
			const maxTotalBytes = Math.min(
				workspaceLimits.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
				limits.maxWorkspaceBytes
			);
			const workspace = validateExecutionWorkspace(code, workspaceFiles, activePath, {
				...workspaceLimits,
				maxFileBytes,
				maxTotalBytes
			});
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			if (workspace.workspaceFiles.length > 0) {
				throw new RuntimeConfigurationError(
					`${this.languageLabel} runtime does not support auxiliary workspace files`,
					{ phase: 'execute', runtimeId: this.language }
				);
			}
			const stdin = options.stdin;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			if (stdin !== undefined && typeof stdin !== 'string') {
				throw new TypeError(`${this.languageLabel} stdin must be a string`);
			}
			const configuredProgramArgs = options.programArgs;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			const sourceArgs = configuredProgramArgs ?? args;
			const programArgs: string[] = [];
			if (Array.isArray(sourceArgs)) {
				const length = sourceArgs.length;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				for (let index = 0; index < length; index += 1) {
					programArgs.push(sourceArgs[index]);
					if (!this.isOperationActive(operation)) {
						throw this.releaseBeforeSession(
							operation,
							`${this.languageLabel} execution cancelled`
						);
					}
				}
			}
			const output = this.output;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			const onDiagnostic = this.oncompilerdiagnostic;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			let backend: DotnetRunBackend | undefined;
			const runtimeModule = this.runtimeModule;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(
					operation,
					`${this.languageLabel} execution cancelled`
				);
			}
			if (runtimeModule) {
				const compiler = this.compiler;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				if (compiler) {
					const compile = compiler.compile;
					if (!this.isOperationActive(operation)) {
						throw this.releaseBeforeSession(
							operation,
							`${this.languageLabel} execution cancelled`
						);
					}
					const execute = runtimeModule.executeBrowserDotnetArtifact;
					if (!this.isOperationActive(operation)) {
						throw this.releaseBeforeSession(
							operation,
							`${this.languageLabel} execution cancelled`
						);
					}
					if (typeof compile !== 'function' || typeof execute !== 'function') {
						throw new TypeError(`${this.languageLabel} runtime backend is invalid`);
					}
					backend = { kind: 'main-thread', runtimeModule, compiler, compile, execute };
				}
			}
			if (!backend) {
				const worker = this.worker;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(
						operation,
						`${this.languageLabel} execution cancelled`
					);
				}
				if (!worker) throw 'Worker not loaded';
				backend = { kind: 'worker', worker };
			}
			let outputBytes = 0;
			let diagnosticCount = 0;
			const meter: DotnetRunMeter = {
				recordOutput: (value) => {
					const actual = outputBytes + OUTPUT_ENCODER.encode(String(value)).byteLength;
					if (actual > limits.maxOutputBytes) {
						throw new OutputLimitError(
							`${this.languageLabel} output exceeded ${limits.maxOutputBytes} bytes`,
							{
								actual,
								limit: limits.maxOutputBytes,
								phase: 'execute',
								runtimeId: this.language
							}
						);
					}
					outputBytes = actual;
				},
				recordDiagnostic: () => {
					const actual = diagnosticCount + 1;
					if (actual > limits.maxDiagnostics) {
						throw new DiagnosticLimitError(
							`${this.languageLabel} diagnostics exceeded ${limits.maxDiagnostics} messages`,
							{
								actual,
								limit: limits.maxDiagnostics,
								phase: 'execute',
								runtimeId: this.language
							}
						);
					}
					diagnosticCount = actual;
				}
			};
			request = { programArgs, stdin, output, onDiagnostic, meter, backend };
		} catch (error) {
			throw this.releaseBeforeSession(operation, error);
		}
		let completionDeferred = false;
		const timeoutMs = Math.min(2_147_483_647, limits.compileTimeoutMs + limits.runTimeoutMs);
		try {
			if (request.backend.kind === 'main-thread') {
				operation.deferCompletion = true;
				const cancellation = new Promise<never>((_resolve, reject) => {
					operation.deferredReject = reject;
				});
				operation.sessionActive = true;
				this.bindOperationTimeout(operation, timeoutMs);
				if (!this.isOperationActive(operation)) {
					return await Promise.race<boolean | string>([
						cancellation,
						Promise.reject(operation.cancellationReason)
					]);
				}
				const execution = this.runOnMainThread(
					operation,
					code,
					prepare,
					_log,
					_prog,
					request,
					request.backend
				).finally(() => this.completeOperation(operation));
				completionDeferred = true;
				return await Promise.race<boolean | string>([cancellation, execution]);
			}
			const worker = request.backend.worker;
			this.exit = false;
			operation.sessionActive = true;
			return await new Promise<boolean | string>((resolve, reject) => {
				const _uid = ++this.uid;
				const workerOperation = this.workerSession.beginRun(worker, reject);
				this.bindOperationTimeout(operation, timeoutMs);
				if (!this.isOperationActive(operation)) return;
				const hasExplicitStdin = !prepare && request.stdin !== undefined;
				this.activeExplicitStdinCleanup?.();
				let explicitStdinCleaned = false;
				const cleanupExplicitStdin = () => {
					if (!hasExplicitStdin || explicitStdinCleaned) return;
					explicitStdinCleaned = true;
					if (this.activeExplicitStdinCleanup !== cleanupExplicitStdin) return;
					this.activeExplicitStdinCleanup = null;
					this.resetStdinState();
				};
				if (hasExplicitStdin) {
					this.resetStdinState();
					this.activeExplicitStdinCleanup = cleanupExplicitStdin;
				}
				let handler: (event: Event & { data: any }) => void;
				const ownsRun = () =>
					this.isOperationActive(operation) &&
					this.worker === worker &&
					worker.onmessage === handler &&
					_uid === this.uid;
				const failRun = (error: unknown, disposeWorker = false) => {
					if (!ownsRun()) return;
					cleanupExplicitStdin();
					if (worker.onmessage === handler) worker.onmessage = null;
					this.workerSession.complete(workerOperation);
					if (disposeWorker && this.worker === worker) this.workerSession.reset();
					this.exit = true;
					this.completeOperation(operation);
					reject(error);
				};
				handler = (event: Event & { data: any }) => {
					if (!ownsRun()) return;
					try {
						const message = event.data;
						const hasResults = Object.prototype.hasOwnProperty.call(
							message ?? {},
							'results'
						);
						const hasError = Object.prototype.hasOwnProperty.call(
							message ?? {},
							'error'
						);
						const { output, results, error, diagnostic, progress } = message;
						reportWorkerProgress(_prog, progress);
						if (!ownsRun()) return;
						if (output) {
							request.meter.recordOutput(output);
							if (!ownsRun()) return;
							if (request.output != null) {
								Reflect.apply(request.output, this, [output]);
							}
						}
						if (!ownsRun()) return;
						if (diagnostic) {
							request.meter.recordDiagnostic();
							if (!ownsRun()) return;
							if (request.onDiagnostic != null) {
								Reflect.apply(request.onDiagnostic, this, [diagnostic]);
							}
						}
						if (!ownsRun()) return;
						if (hasResults) {
							cleanupExplicitStdin();
							if (worker.onmessage === handler) worker.onmessage = null;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.workerSession.complete(workerOperation);
							this.completeOperation(operation);
							resolve(results as boolean | string);
							return;
						}
						if (hasError) {
							this.elapse = Date.now() - this.begin;
							failRun(error, message.fatal === true);
						}
					} catch (error) {
						failRun(error, true);
					}
				};
				worker.onmessage = handler;
				if (!ownsRun()) return;
				this.begin = Date.now();
				this.collectStdinForRun(code, prepare, request.stdin, _uid, _prog)
					.then((stdin) => {
						if (!ownsRun()) return;
						worker.postMessage({
							code,
							language: this.compileLanguage,
							prepare,
							args: request.programArgs,
							stdin,
							log: _log
						});
					})
					.catch((error) => {
						failRun(error);
					});
			});
		} finally {
			if (!completionDeferred) this.completeOperation(operation);
		}
	}

	private async runOnMainThread(
		operation: DotnetOperation,
		code: string,
		prepare: boolean,
		_log: boolean,
		_prog: SandboxProgress | undefined,
		request: DotnetRunRequest,
		backend: DotnetMainThreadBackend
	): Promise<boolean | string> {
		this.exit = false;
		this.begin = Date.now();
		const _uid = ++this.uid;
		const hasExplicitStdin = !prepare && request.stdin !== undefined;
		this.activeExplicitStdinCleanup?.();
		let explicitStdinCleaned = false;
		const cleanupExplicitStdin = () => {
			if (!hasExplicitStdin || explicitStdinCleaned) return;
			explicitStdinCleaned = true;
			if (this.activeExplicitStdinCleanup !== cleanupExplicitStdin) return;
			this.activeExplicitStdinCleanup = null;
			this.resetStdinState();
		};
		if (hasExplicitStdin) {
			this.resetStdinState();
			this.activeExplicitStdinCleanup = cleanupExplicitStdin;
		}
		try {
			const emitExecutionOutput = (output: string) => {
				if (!output || !this.isOperationActive(operation) || _uid !== this.uid) return;
				try {
					request.meter.recordOutput(output);
				} catch (error) {
					if (this.isOperationActive(operation) && _uid === this.uid) {
						this.abortOperation(operation, error);
					}
					throw error;
				}
				if (
					request.output != null &&
					this.isOperationActive(operation) &&
					_uid === this.uid
				) {
					Reflect.apply(request.output, this, [output]);
				}
			};
			const compileCacheKey = `${this.compileLanguage}\n${code}`;
			let compiledArtifact =
				this.compiledArtifact &&
				this.compiledCacheKey === compileCacheKey &&
				this.compiledRuntimeModule === backend.runtimeModule &&
				this.compiledCompiler === backend.compiler &&
				this.compiledCompile === backend.compile &&
				this.compiledExecute === backend.execute
					? this.compiledArtifact
					: null;
			if (!compiledArtifact) {
				const result = await Reflect.apply(backend.compile, backend.compiler, [
					{
						code,
						language: this.compileLanguage,
						target: 'browser-wasm',
						prepare,
						log: _log,
						onProgress: (progress: { percent?: number; stage?: string }) => {
							if (this.isOperationActive(operation) && _uid === this.uid) {
								reportWorkerProgress(_prog, progress);
							}
						}
					}
				]);
				if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
				for (const diagnostic of result.diagnostics || []) {
					if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
					request.meter.recordDiagnostic();
					if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
					if (request.onDiagnostic != null) {
						Reflect.apply(request.onDiagnostic, this, [diagnostic]);
					}
				}
				for (const line of result.logs || []) {
					if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
					const output = line.endsWith('\n') ? line : `${line}\n`;
					request.meter.recordOutput(output);
					if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
					if (request.output != null) {
						Reflect.apply(request.output, this, [output]);
					}
				}
				if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
				if (result.stdout) {
					request.meter.recordOutput(result.stdout);
					if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
					if (request.output != null) {
						Reflect.apply(request.output, this, [result.stdout]);
					}
				}
				if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
				if (!result.success || !result.artifact) {
					throw new Error(
						result.stderr ||
							result.diagnostics
								?.map((diagnostic) => diagnostic.message)
								.join('\n') ||
							`${this.languageLabel} compilation failed`
					);
				}
				if (result.stderr) {
					request.meter.recordOutput(result.stderr);
					if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
					if (request.output != null) {
						Reflect.apply(request.output, this, [result.stderr]);
					}
				}
				if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
				compiledArtifact = result.artifact;
				this.compiledArtifact = compiledArtifact;
				this.compiledCacheKey = compileCacheKey;
				this.compiledRuntimeModule = backend.runtimeModule;
				this.compiledCompiler = backend.compiler;
				this.compiledCompile = backend.compile;
				this.compiledExecute = backend.execute;
			}
			if (prepare) return true;

			const stdin = await this.collectStdinForRun(code, prepare, request.stdin, _uid, _prog);
			if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
			const execution = await Reflect.apply(backend.execute, backend.runtimeModule, [
				compiledArtifact,
				{
					args: request.programArgs,
					env: {
						USER: 'jungol'
					},
					stdin,
					stdout: (output: string) => emitExecutionOutput(output),
					stderr: (output: string) => emitExecutionOutput(output)
				}
			]);
			if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
			if (execution.exitCode !== 0) {
				throw new Error(
					`${this.languageLabel} program exited with code ${execution.exitCode}`
				);
			}
			return true;
		} finally {
			cleanupExplicitStdin();
			if (this.isOperationActive(operation) && _uid === this.uid) {
				this.elapse = Date.now() - this.begin;
				this.exit = true;
			}
		}
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		if (this.disposed) return;
		const operation = this.activeOperation;
		const rejectDeferred = operation?.signal ? operation.deferredReject : undefined;
		if (operation) {
			operation.cancelled = true;
			operation.cancellationReason = reason;
			operation.deferredReject = undefined;
		}
		this.activeExplicitStdinCleanup?.();
		this.uid += 1;
		this.resolveStdinWaiters();
		this.workerSession.terminate(reason);
		this.exit = true;
		rejectDeferred?.(reason);
		if (operation) {
			if (operation.deferCompletion) {
				this.releaseOperationTimeout(operation);
				this.releaseAbortSignal(operation);
			} else this.completeOperation(operation);
		}
	}

	async clear() {
		if (this.disposed) return;
		if (this.worker) this.worker.onmessage = null;
		this.resetStdinState();
		if (this.activeOperation) {
			this.terminate();
		}
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.disposePromise = Promise.resolve();

		const activeOperation = this.activeOperation;
		const stdinWaiters = this.stdinWaiters.splice(0);
		delete this.worker;
		this.runtimeModule = null;
		this.compiler = null;
		this.moduleUrl = '';
		this.clearCompiledArtifact();
		this.output = null;
		this.oncompilerdiagnostic = undefined;
		this.activeExplicitStdinCleanup = null;
		this.pendingInput = [];
		this.pendingEof = false;
		this.exit = true;
		for (const resolve of stdinWaiters) {
			try {
				resolve();
			} catch {
				// Waiter cleanup is best effort after host state becomes unreachable.
			}
		}
		if (activeOperation) {
			this.abortOperation(activeOperation, this.disposeCancellation);
			this.completeOperation(activeOperation);
		} else {
			this.uid += 1;
			this.workerSession.terminate(this.disposeCancellation);
		}
		return this.disposePromise;
	}
}

export default Dotnet;
