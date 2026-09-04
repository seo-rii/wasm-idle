import { resolveTypeScriptModuleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	AssetTooLargeError,
	BusyError,
	CancelledError,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	RuntimeConfigurationError,
	TimeoutError,
	resolveExecutionLimits,
	validateExecutionWorkspace,
	type ExecutionLimits,
	type WorkspaceLimits
} from '@wasm-idle/core';
import { type CompilerDiagnostic, type SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import {
	createWasmIdleSharedBuffer,
	type WasmIdleSharedBuffer
} from '$lib/playground/sharedBuffer';
import { WASM_TYPESCRIPT_MODULE_RECEIPT } from '$lib/playground/wasmTypeScriptVersion';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerInputReady, reportWorkerProgress } from '$lib/playground/workerProgress';

type TypeScriptSandboxLanguage = 'JAVASCRIPT' | 'TYPESCRIPT';

type TypeScriptOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
	explicitStdin: boolean;
	buffer?: WasmIdleSharedBuffer;
};

const OUTPUT_ENCODER = new TextEncoder();
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const EXECUTION_LIMIT_KEYS = [
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
] as const satisfies readonly (keyof ExecutionLimits)[];
const WORKSPACE_LIMIT_KEYS = [
	'maxFiles',
	'maxFileBytes',
	'maxTotalBytes',
	'maxPathBytes',
	'caseSensitive'
] as const satisfies readonly (keyof WorkspaceLimits)[];

class TypeScriptSandbox implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeOperation: TypeScriptOperation | null = null;
	private disposed = false;
	private disposePromise: Promise<void> | null = null;
	private readonly disposeCancellation: CancelledError;
	private readonly workerSession = new WorkerSession({
		label: () => this.languageLabel,
		onDispose: (worker) => {
			if (this.worker !== worker) return;
			delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	constructor(private readonly language: TypeScriptSandboxLanguage = 'TYPESCRIPT') {
		this.disposeCancellation = new CancelledError(`${this.languageLabel} sandbox disposed`, {
			phase: 'dispose',
			runtimeId: this.language,
			recoverable: false
		});
	}

	private get compileLanguage() {
		return this.language === 'JAVASCRIPT' ? 'javascript' : 'typescript';
	}

	private get languageLabel() {
		return this.language === 'JAVASCRIPT' ? 'JavaScript' : 'TypeScript';
	}

	private disposedConfigurationError() {
		return new RuntimeConfigurationError(`${this.languageLabel} sandbox is disposed`, {
			phase: 'dispose',
			runtimeId: this.language
		});
	}

	private requireOperationIdle() {
		if (this.disposed) throw this.disposedConfigurationError();
		if (!this.activeOperation) return;
		throw new BusyError(`${this.languageLabel} runtime already has an active operation`, {
			runtimeId: this.language,
			phase: this.activeOperation.phase
		});
	}

	private beginOperation(phase: TypeScriptOperation['phase']) {
		this.requireOperationIdle();
		const operation: TypeScriptOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			cleanedUp: false,
			cleanups: [],
			explicitStdin: false
		};
		this.activeOperation = operation;
		return operation;
	}

	private isOperationActive(operation: TypeScriptOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: TypeScriptOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: TypeScriptOperation) {
		if (operation.cleanedUp) return;
		operation.cleanedUp = true;
		const cleanups = operation.cleanups.splice(0);
		for (const cleanup of cleanups) {
			try {
				cleanup();
			} catch {
				// Caller-owned lifecycle cleanup must not replace the operation result.
			}
		}
	}

	private releaseBeforeSession(operation: TypeScriptOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private requireOperationActive(operation: TypeScriptOperation) {
		if (this.isOperationActive(operation)) return;
		throw operation.cancelled
			? operation.cancellationReason
			: `${this.languageLabel} ${operation.phase === 'startup' ? 'runtime startup' : 'execution'} cancelled`;
	}

	private resolveOperationLimits(
		operation: TypeScriptOperation,
		configured: Partial<ExecutionLimits> | undefined
	) {
		if (configured === undefined || configured === null) return resolveExecutionLimits();
		if (typeof configured !== 'object' && typeof configured !== 'function') {
			throw new TypeError(`${this.languageLabel} execution limits must be an object`);
		}
		const snapshot: Partial<ExecutionLimits> = {};
		for (const key of EXECUTION_LIMIT_KEYS) {
			const enumerable = Object.prototype.propertyIsEnumerable.call(configured, key);
			this.requireOperationActive(operation);
			if (!enumerable) continue;
			const value = configured[key];
			this.requireOperationActive(operation);
			(snapshot as Record<string, unknown>)[key] = value;
		}
		return resolveExecutionLimits(snapshot);
	}

	private abortReason(signal: AbortSignal, phase: TypeScriptOperation['phase']) {
		const reason = signal.reason;
		return reason !== undefined
			? reason
			: new DOMException(
					phase === 'startup'
						? `${this.languageLabel} runtime startup aborted`
						: `${this.languageLabel} execution aborted`,
					'AbortError'
				);
	}

	private bindPreSessionAbort(operation: TypeScriptOperation, signal: AbortSignal | undefined) {
		if (!signal || !this.isOperationActive(operation)) return () => undefined;
		let registered = false;
		let unbound = false;
		const unbind = () => {
			if (unbound) return;
			unbound = true;
			if (registered) signal.removeEventListener('abort', onAbort);
		};
		const onAbort = () => {
			if (!this.isOperationActive(operation)) return;
			let reason: unknown;
			try {
				reason = this.abortReason(signal, operation.phase);
			} catch (error) {
				reason = error;
			}
			if (!this.isOperationActive(operation)) return;
			operation.cancelled = true;
			operation.cancellationReason = reason;
			this.releaseOperation(operation);
			this.cleanupOperation(operation);
		};
		operation.cleanups.push(unbind);
		try {
			registered = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		} catch (error) {
			if (this.isOperationActive(operation)) {
				operation.cancelled = true;
				operation.cancellationReason = error;
				this.releaseOperation(operation);
				this.cleanupOperation(operation);
			}
		}
		return unbind;
	}

	private bindAbortSignal(operation: TypeScriptOperation, signal: AbortSignal | undefined) {
		if (!signal || !this.isOperationActive(operation)) return;
		let registered = false;
		const onAbort = () => {
			if (!this.isOperationActive(operation)) return;
			let reason: unknown;
			try {
				reason = this.abortReason(signal, operation.phase);
			} catch (error) {
				reason = error;
			}
			this.cancelOperation(operation, reason);
		};
		operation.cleanups.push(() => {
			if (!registered) return;
			try {
				signal.removeEventListener('abort', onAbort);
			} catch {
				// Listener cleanup must not replace the operation result.
			}
		});
		try {
			registered = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private bindOperationTimeout(operation: TypeScriptOperation, timeoutMs: number) {
		if (!this.isOperationActive(operation)) return;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		operation.cleanups.push(() => {
			if (timeout !== undefined) clearTimeout(timeout);
		});
		try {
			timeout = setTimeout(() => {
				if (!this.isOperationActive(operation)) return;
				const label = operation.phase === 'startup' ? 'startup' : 'execution';
				this.cancelOperation(
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
			if (operation.cleanedUp) clearTimeout(timeout);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private resetExplicitStdinState(buffer: WasmIdleSharedBuffer = this.buffer) {
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
		try {
			resetBufferedStdin(buffer);
		} catch {
			// Explicit stdin never consumes the shared terminal buffer.
		}
	}

	private resetOwnedBuffers(operationBuffer?: WasmIdleSharedBuffer) {
		const buffers = new Set<WasmIdleSharedBuffer>([this.buffer]);
		if (operationBuffer) buffers.add(operationBuffer);
		for (const buffer of buffers) {
			try {
				resetBufferedStdin(buffer);
			} catch {
				// Stdin cleanup must not replace the lifecycle result.
			}
		}
	}

	private finishExplicitStdin(operation: TypeScriptOperation) {
		if (!operation.explicitStdin) return;
		operation.explicitStdin = false;
		this.resetExplicitStdinState(operation.buffer);
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let activeOperation: TypeScriptOperation;
		try {
			activeOperation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let nextModuleUrl: string;
		let progressTarget: SandboxProgress | undefined;
		let progressSet: SandboxProgress['set'] | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		try {
			signal = options.signal;
			this.requireOperationActive(activeOperation);
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			this.requireOperationActive(activeOperation);
			const configuredLimits = options.limits;
			this.requireOperationActive(activeOperation);
			limits = this.resolveOperationLimits(activeOperation, configuredLimits);
			this.requireOperationActive(activeOperation);
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			this.requireOperationActive(activeOperation);
			if (typeof runtimeAssets === 'object' && runtimeAssets !== null) {
				const configuredTypeScript = runtimeAssets.typescript;
				this.requireOperationActive(activeOperation);
				const configuredModuleUrl = configuredTypeScript?.moduleUrl;
				this.requireOperationActive(activeOperation);
				if (configuredModuleUrl !== undefined && typeof configuredModuleUrl !== 'string') {
					throw new TypeError(
						`${this.languageLabel} runtime module URL must be a string`
					);
				}
				nextModuleUrl = resolveTypeScriptModuleUrl(
					{ typescript: { moduleUrl: configuredModuleUrl } },
					currentUrl
				);
				this.requireOperationActive(activeOperation);
				if (!nextModuleUrl) {
					const rootUrl = runtimeAssets.rootUrl;
					this.requireOperationActive(activeOperation);
					if (rootUrl !== undefined && typeof rootUrl !== 'string') {
						throw new TypeError(
							`${this.languageLabel} runtime root URL must be a string`
						);
					}
					nextModuleUrl = resolveTypeScriptModuleUrl({ rootUrl }, currentUrl);
					this.requireOperationActive(activeOperation);
				}
			} else {
				nextModuleUrl = resolveTypeScriptModuleUrl(runtimeAssets, currentUrl);
				this.requireOperationActive(activeOperation);
			}
			if (WASM_TYPESCRIPT_MODULE_RECEIPT.bytes > limits.maxAssetBytes) {
				throw new AssetTooLargeError(
					`${this.languageLabel} runtime module exceeds the ${limits.maxAssetBytes} byte limit`,
					{
						runtimeId: this.language,
						limit: limits.maxAssetBytes,
						actual: WASM_TYPESCRIPT_MODULE_RECEIPT.bytes
					}
				);
			}
			progressTarget = progress;
			progressSet = progressTarget?.set;
			this.requireOperationActive(activeOperation);
			unbindPreSessionAbort();
			this.requireOperationActive(activeOperation);
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(
					activeOperation,
					`${this.languageLabel} runtime startup cancelled`
				)
			);
		}
		const loadPromise = this.workerSession.load(async (resolve, reject) => {
			const resolveLoad = () => {
				if (!this.releaseOperation(activeOperation)) return;
				resolve();
				this.cleanupOperation(activeOperation);
			};
			const rejectLoad = (reason?: unknown) => {
				if (!this.releaseOperation(activeOperation)) return;
				reject(reason);
				this.cleanupOperation(activeOperation);
			};
			try {
				if (!this.isOperationActive(activeOperation)) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				if (!nextModuleUrl) {
					return rejectLoad(
						'TypeScript runtime is not configured. Set PUBLIC_WASM_TYPESCRIPT_MODULE_URL or runtimeAssets.typescript.moduleUrl.'
					);
				}
				const needsWorkerReset = !this.worker || this.moduleUrl !== nextModuleUrl;
				this.moduleUrl = nextModuleUrl;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
					if (!this.isOperationActive(activeOperation)) return;
				}
				if (!this.worker) {
					const WorkerConstructor = (
						await import('$lib/playground/worker/typescript?worker')
					).default;
					if (!this.isOperationActive(activeOperation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(activeOperation)) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					if (!this.isOperationActive(activeOperation) || this.worker !== worker) {
						this.workerSession.terminate(
							activeOperation.cancelled
								? activeOperation.cancellationReason
								: `${this.languageLabel} runtime startup cancelled`
						);
						return;
					}
					let handler: (event: MessageEvent<any>) => void;
					const ownsLoad = () =>
						this.isOperationActive(activeOperation) &&
						this.worker === worker &&
						worker.onmessage === handler;
					const failLoad = (error: unknown) => {
						if (!ownsLoad()) return;
						rejectLoad(error);
					};
					handler = (event: MessageEvent<any>) => {
						if (!ownsLoad()) return;
						try {
							const message = event.data;
							if (!ownsLoad()) return;
							const loaded = message?.load;
							if (!ownsLoad()) return;
							if (loaded) {
								if (progressSet) Reflect.apply(progressSet, progressTarget, [1]);
								if (!ownsLoad()) return;
								resolveLoad();
								return;
							}
							const hasError = Object.prototype.hasOwnProperty.call(
								message ?? {},
								'error'
							);
							if (!ownsLoad()) return;
							if (hasError) {
								const error = message.error;
								if (!ownsLoad()) return;
								rejectLoad(error);
							}
						} catch (error) {
							failLoad(error);
						}
					};
					worker.onmessage = handler;
					if (!ownsLoad()) {
						this.workerSession.terminate(
							activeOperation.cancelled
								? activeOperation.cancellationReason
								: `${this.languageLabel} runtime startup cancelled`
						);
						return;
					}
					worker.postMessage({
						load: true,
						moduleUrl: nextModuleUrl,
						moduleReceipt: { ...WASM_TYPESCRIPT_MODULE_RECEIPT },
						maxAssetBytes: limits.maxAssetBytes
					});
				} else {
					const worker = this.worker;
					if (progressSet) Reflect.apply(progressSet, progressTarget, [1]);
					if (!this.isOperationActive(activeOperation) || this.worker !== worker) return;
					resolveLoad();
				}
			} catch (error) {
				rejectLoad(error);
			}
		});
		const timeoutMs = Math.min(
			MAX_TIMER_DELAY_MS,
			limits.assetTimeoutMs + limits.startupTimeoutMs
		);
		this.bindOperationTimeout(activeOperation, timeoutMs);
		this.bindAbortSignal(activeOperation, signal);
		return loadPromise.finally(() => {
			this.releaseOperation(activeOperation);
			this.cleanupOperation(activeOperation);
		});
	}

	write(input: string) {
		if (this.disposed) return;
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.flushPendingInput();
	}

	eof() {
		if (this.disposed) return;
		this.pendingEof = true;
		this.flushPendingInput();
	}

	private flushPendingInput() {
		if (!this.waitingForInput) return;
		const buffer = this.activeOperation?.buffer ?? this.buffer;
		if (flushQueuedStdin(this.pendingInput, buffer)) {
			this.waitingForInput = false;
			return;
		}
		if (this.pendingEof) {
			flushBufferedEof(buffer);
			this.pendingEof = false;
			this.waitingForInput = false;
		}
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		let activeOperation: TypeScriptOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		const worker = this.worker;
		if (!worker) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, 'Worker not loaded'));
		}
		let signal: AbortSignal | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		let executionArgs: { programArgs: string[] };
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		let stdin: SandboxExecutionOptions['stdin'];
		let buffer: WasmIdleSharedBuffer;
		let outputCallback: any;
		let diagnosticCallback: ((diagnostic: CompilerDiagnostic) => void) | undefined;
		let progressTarget: SandboxProgress | undefined;
		let progressSet: SandboxProgress['set'] | undefined;
		let progressReport: SandboxProgress['report'] | undefined;
		let progressSink: SandboxProgress | undefined;
		try {
			signal = options.signal;
			this.requireOperationActive(activeOperation);
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			this.requireOperationActive(activeOperation);
			const configuredProgramArgs = options.programArgs;
			this.requireOperationActive(activeOperation);
			const sourceProgramArgs = configuredProgramArgs ?? args;
			const programArgs: string[] = [];
			if (Array.isArray(sourceProgramArgs)) {
				const argumentCount = sourceProgramArgs.length;
				this.requireOperationActive(activeOperation);
				for (let index = 0; index < argumentCount; index += 1) {
					const argument = sourceProgramArgs[index];
					this.requireOperationActive(activeOperation);
					programArgs.push(argument);
				}
			}
			executionArgs = { programArgs };
			const configuredLimits = options.limits;
			this.requireOperationActive(activeOperation);
			limits = this.resolveOperationLimits(activeOperation, configuredLimits);
			this.requireOperationActive(activeOperation);
			const configuredWorkspaceFiles = options.workspaceFiles;
			this.requireOperationActive(activeOperation);
			const workspaceFiles: Array<{ path: string; content: string }> = [];
			if (configuredWorkspaceFiles !== undefined) {
				if (!Array.isArray(configuredWorkspaceFiles)) {
					throw new TypeError(`${this.languageLabel} workspace files must be an array`);
				}
				const fileCount = configuredWorkspaceFiles.length;
				this.requireOperationActive(activeOperation);
				for (let index = 0; index < fileCount; index += 1) {
					const file = configuredWorkspaceFiles[index];
					this.requireOperationActive(activeOperation);
					const path = file.path;
					this.requireOperationActive(activeOperation);
					const content = file.content;
					this.requireOperationActive(activeOperation);
					workspaceFiles.push({ path, content });
				}
			}
			const configuredActivePath = options.activePath;
			this.requireOperationActive(activeOperation);
			const activePath =
				configuredActivePath ?? (this.language === 'JAVASCRIPT' ? 'main.js' : 'main.ts');
			const configuredWorkspaceLimits = options.workspaceLimits;
			this.requireOperationActive(activeOperation);
			const workspaceLimits: Partial<WorkspaceLimits> = {};
			if (configuredWorkspaceLimits !== undefined && configuredWorkspaceLimits !== null) {
				if (
					typeof configuredWorkspaceLimits !== 'object' &&
					typeof configuredWorkspaceLimits !== 'function'
				) {
					throw new TypeError(`${this.languageLabel} workspace limits must be an object`);
				}
				for (const key of WORKSPACE_LIMIT_KEYS) {
					const enumerable = Object.prototype.propertyIsEnumerable.call(
						configuredWorkspaceLimits,
						key
					);
					this.requireOperationActive(activeOperation);
					if (!enumerable) continue;
					const value = configuredWorkspaceLimits[key];
					this.requireOperationActive(activeOperation);
					(workspaceLimits as Record<string, unknown>)[key] = value;
				}
			}
			const requestedMaxFileBytes = workspaceLimits.maxFileBytes;
			const requestedMaxTotalBytes = workspaceLimits.maxTotalBytes;
			const maxFileBytes =
				requestedMaxFileBytes === undefined
					? Math.min(DEFAULT_WORKSPACE_LIMITS.maxFileBytes, limits.maxWorkspaceBytes)
					: typeof requestedMaxFileBytes === 'number'
						? Math.min(requestedMaxFileBytes, limits.maxWorkspaceBytes)
						: requestedMaxFileBytes;
			const maxTotalBytes =
				requestedMaxTotalBytes === undefined
					? Math.min(DEFAULT_WORKSPACE_LIMITS.maxTotalBytes, limits.maxWorkspaceBytes)
					: typeof requestedMaxTotalBytes === 'number'
						? Math.min(requestedMaxTotalBytes, limits.maxWorkspaceBytes)
						: requestedMaxTotalBytes;
			workspace = validateExecutionWorkspace(code, workspaceFiles, activePath, {
				...workspaceLimits,
				maxFileBytes,
				maxTotalBytes
			});
			this.requireOperationActive(activeOperation);
			stdin = options.stdin;
			this.requireOperationActive(activeOperation);
			buffer = this.buffer;
			this.requireOperationActive(activeOperation);
			outputCallback = this.output;
			this.requireOperationActive(activeOperation);
			diagnosticCallback = this.oncompilerdiagnostic;
			this.requireOperationActive(activeOperation);
			progressTarget = _prog;
			progressSet = progressTarget?.set;
			this.requireOperationActive(activeOperation);
			progressReport = progressTarget?.report;
			this.requireOperationActive(activeOperation);
			progressSink = progressTarget
				? {
						...(progressSet
							? {
									set: (value: number, stage?: string) =>
										Reflect.apply(progressSet!, progressTarget!, [value, stage])
								}
							: {}),
						...(progressReport
							? {
									report: (
										event: Parameters<NonNullable<SandboxProgress['report']>>[0]
									) => Reflect.apply(progressReport!, progressTarget!, [event])
								}
							: {})
					}
				: undefined;
			this.requireOperationActive(activeOperation);
			unbindPreSessionAbort();
			this.requireOperationActive(activeOperation);
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation) || this.worker !== worker) {
			return Promise.reject(
				this.releaseBeforeSession(
					activeOperation,
					`${this.languageLabel} execution cancelled`
				)
			);
		}
		activeOperation.buffer = buffer;
		const hasExplicitStdin = stdin !== undefined;
		if (hasExplicitStdin) {
			activeOperation.explicitStdin = true;
			this.resetExplicitStdinState(buffer);
		}
		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			let diagnosticCount = 0;
			let outputBytes = 0;
			const operation = this.workerSession.beginRun(worker, reject);
			if (!this.isOperationActive(activeOperation) || this.worker !== worker) {
				this.workerSession.terminate(
					activeOperation.cancelled
						? activeOperation.cancellationReason
						: `${this.languageLabel} execution cancelled`
				);
				return;
			}
			const timeoutMs = Math.min(
				MAX_TIMER_DELAY_MS,
				limits.compileTimeoutMs + limits.runTimeoutMs
			);
			this.bindOperationTimeout(activeOperation, timeoutMs);
			this.bindAbortSignal(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) return;
			let handler: (event: Event & { data: any }) => void;
			const ownsRun = () =>
				this.isOperationActive(activeOperation) &&
				this.worker === worker &&
				worker.onmessage === handler &&
				_uid === this.uid;
			const claimRun = () => {
				if (!ownsRun()) return false;
				this.finishExplicitStdin(activeOperation);
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				this.workerSession.complete(operation);
				this.releaseOperation(activeOperation);
				this.cleanupOperation(activeOperation);
				try {
					if (worker.onmessage === handler) worker.onmessage = null;
				} catch {
					// Handler cleanup must not replace the operation result.
				}
				return true;
			};
			const failRun = (error: unknown, disposeWorker = false) => {
				if (!ownsRun()) return;
				if (disposeWorker) {
					this.cancelOperation(activeOperation, error);
					return;
				}
				if (!claimRun()) return;
				reject(error);
			};
			handler = (event: Event & { data: any }) => {
				if (!ownsRun()) return;
				try {
					const message = event.data ?? {};
					if (!ownsRun()) return;
					const requestedBuffer = message.buffer;
					if (!ownsRun()) return;
					if (requestedBuffer && !hasExplicitStdin) {
						this.waitingForInput = true;
						if (!prepare) {
							reportWorkerInputReady(
								progressSink,
								`${this.languageLabel} runtime ready for input`
							);
							if (!ownsRun()) return;
						}
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					const progress = message.progress;
					if (!ownsRun()) return;
					reportWorkerProgress(progressSink, progress);
					if (!ownsRun()) return;
					if (!ownsRun()) return;
					const output = message.output;
					if (!ownsRun()) return;
					if (output !== undefined && output !== null) {
						const outputText = String(output);
						if (!ownsRun()) return;
						if (outputText.length > 0) {
							const actual =
								outputBytes + OUTPUT_ENCODER.encode(outputText).byteLength;
							if (actual > limits.maxOutputBytes) {
								failRun(
									new OutputLimitError(
										`${this.languageLabel} output exceeded ${limits.maxOutputBytes} bytes`,
										{
											actual,
											limit: limits.maxOutputBytes,
											phase: 'execute',
											runtimeId: this.language
										}
									),
									true
								);
								return;
							}
							outputBytes = actual;
							if (outputCallback) Reflect.apply(outputCallback, this, [output]);
						}
					}
					if (!ownsRun()) return;
					const hasDiagnostic = Object.prototype.hasOwnProperty.call(
						message,
						'diagnostic'
					);
					if (!ownsRun()) return;
					if (hasDiagnostic) {
						const diagnostic = message.diagnostic;
						if (!ownsRun()) return;
						const actual = diagnosticCount + 1;
						if (actual > limits.maxDiagnostics) {
							failRun(
								new DiagnosticLimitError(
									`${this.languageLabel} diagnostics exceeded ${limits.maxDiagnostics} messages`,
									{
										actual,
										limit: limits.maxDiagnostics,
										phase: 'execute',
										runtimeId: this.language
									}
								),
								true
							);
							return;
						}
						diagnosticCount = actual;
						if (diagnosticCallback) {
							Reflect.apply(diagnosticCallback, this, [diagnostic]);
						}
					}
					if (!ownsRun()) return;
					const hasResults = Object.prototype.hasOwnProperty.call(message, 'results');
					if (!ownsRun()) return;
					if (hasResults) {
						const results = message.results;
						if (!ownsRun()) return;
						if (!claimRun()) return;
						resolve(results as boolean | string);
						return;
					}
					const hasError = Object.prototype.hasOwnProperty.call(message, 'error');
					if (!ownsRun()) return;
					if (hasError) {
						const error = message.error;
						if (!ownsRun()) return;
						failRun(error);
					}
				} catch (error) {
					failRun(error, true);
				}
			};
			worker.onmessage = handler;
			if (!ownsRun()) return;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer,
					args: executionArgs.programArgs,
					stdin,
					language: this.compileLanguage,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					log: _log
				});
			} catch (error) {
				failRun(error, true);
			}
		});
		return running.finally(() => {
			if (this.releaseOperation(activeOperation)) {
				this.finishExplicitStdin(activeOperation);
				this.exit = true;
			}
			this.cleanupOperation(activeOperation);
		});
	}

	private cancelOperation(operation: TypeScriptOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.activeOperation = null;
		this.uid += 1;
		this.finishExplicitStdin(operation);
		this.waitingForInput = false;
		this.pendingEof = false;
		this.exit = true;
		this.workerSession.terminate(reason);
		this.cleanupOperation(operation);
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		if (this.disposed) return;
		const activeOperation = this.activeOperation;
		if (activeOperation) {
			this.cancelOperation(activeOperation, reason);
			return;
		}
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.exit = true;
		this.workerSession.terminate(reason);
	}

	async clear() {
		if (this.disposed) return;
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) this.worker.onmessage = null;
		this.resetOwnedBuffers(this.activeOperation?.buffer);
		if (!this.exit || this.activeOperation) {
			this.terminate();
		}
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.disposePromise = Promise.resolve();

		const activeOperation = this.activeOperation;
		delete this.worker;
		this.moduleUrl = '';
		this.output = undefined;
		this.oncompilerdiagnostic = undefined;
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		this.resetOwnedBuffers(activeOperation?.buffer);
		if (activeOperation) {
			this.cancelOperation(activeOperation, this.disposeCancellation);
		} else {
			this.uid += 1;
			this.exit = true;
			this.workerSession.terminate(this.disposeCancellation);
		}
		return this.disposePromise;
	}
}

export default TypeScriptSandbox;
