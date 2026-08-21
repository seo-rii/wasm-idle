import {
	resolveRustCompilerUrl,
	resolveTinyGoModuleUrl,
	type PlaygroundRuntimeAssets,
	type TinyGoRuntimeAssetLoader,
	type TinyGoRuntimeAssetPackReference
} from '$lib/playground/assets';
import type {
	CompilerDiagnostic,
	SandboxExecutionOptions,
	TinyGoTarget
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import {
	BusyError,
	CancelledError,
	DEFAULT_EXECUTION_LIMITS,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	RuntimeConfigurationError,
	TimeoutError,
	WorkspaceValidationError,
	resolveExecutionLimits,
	validateExecutionWorkspace,
	type ExecutionLimits
} from '@wasm-idle/core';

type TinyGoRuntimeHooks = {
	boot(): Promise<void>;
	plan(): Promise<unknown>;
	execute(): Promise<void>;
	reset(): void;
	readActivityLog(): string;
	readBuildArtifact(): {
		path: string;
		bytes: Uint8Array;
		artifactKind?: 'probe' | 'bootstrap' | 'execution';
		runnable?: boolean;
		entrypoint?: '_start' | '_initialize' | 'main' | null;
		reason?: 'bootstrap-artifact' | 'missing-wasi-entrypoint';
	} | null;
	setBuildRequestOverrides?(overrides: { target?: TinyGoTarget } | null): void;
	setMaxAssetBytes?(maxAssetBytes: number): void;
	setMaxWasmMemoryBytes?(maxWasmMemoryBytes: number): void;
	setWorkspaceFiles(files: Record<string, string> | null): void;
	dispose?(): void;
};

type TinyGoRuntimeAssetProgress = {
	assetPath: string;
	assetUrl: string;
	label: string;
	loaded: number;
	total: number | null;
};

type TinyGoRuntimeLogEntry = {
	line: string;
};

type TinyGoRuntimeDiagnostic = {
	message: string;
	severity: 'error' | 'warning' | 'other';
	fileName?: string | null;
	lineNumber?: number;
	columnNumber?: number;
	endColumnNumber?: number;
};

type TinyGoRuntimeModule = {
	loadTinyGoUpstreamToolchainAssets?: (options: {
		assetBaseUrl: string;
		loader?: TinyGoRuntimeAssetLoader;
		onProgress?: (progress: TinyGoRuntimeAssetProgress) => void;
		signal?: AbortSignal;
		maxAssetBytes?: number;
	}) => Promise<unknown>;
	compileTinyGoInDisposableWorker?: (
		assets: unknown,
		request: { workspaceFiles: Record<string, string>; package?: string },
		options: {
			signal?: AbortSignal;
			maxWasmMemoryBytes?: number;
			onPhase?: (phase: string) => void;
		}
	) => Promise<{ wasm: Uint8Array }>;
	createBundledTinyGoRuntime?: (options?: {
		assetLoader?: TinyGoRuntimeAssetLoader;
		assetPacks?: TinyGoRuntimeAssetPackReference[];
		maxAssetBytes?: number;
		rustRuntimeBaseUrl?: string;
		onCompilerDiagnostic?: (diagnostic: TinyGoRuntimeDiagnostic) => void;
		onLogAppended?: (entry: TinyGoRuntimeLogEntry) => void;
		onProgress?: (progress: TinyGoRuntimeAssetProgress) => void;
	}) => TinyGoRuntimeHooks;
	createTinyGoRuntime?: (options: {
		assetBaseUrl: string;
		assetLoader?: TinyGoRuntimeAssetLoader;
		assetPacks?: TinyGoRuntimeAssetPackReference[];
		maxAssetBytes?: number;
		rustRuntimeBaseUrl?: string;
		onCompilerDiagnostic?: (diagnostic: TinyGoRuntimeDiagnostic) => void;
		onLogAppended?: (entry: TinyGoRuntimeLogEntry) => void;
		onProgress?: (progress: TinyGoRuntimeAssetProgress) => void;
	}) => TinyGoRuntimeHooks;
};

type TinyGoOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	buffer?: ArrayBufferLike;
	cancelled: boolean;
	diagnosticCount: number;
	outputBytes: number;
	limits?: ExecutionLimits;
	reason?: unknown;
	reject?: (reason: unknown) => void;
};

type TinyGoRuntimeProgressOwner = {
	operationToken: symbol;
	runtimeToken: symbol;
};

type TinyGoRunRequest = {
	buffer: ArrayBufferLike;
	programArgs: string[];
	stdin?: string;
	target: TinyGoTarget;
	workspaceFiles: Record<string, string>;
};

const ACTIVITY_PREFIX_PATTERN = /^\[\d{2}:\d{2}:\d{2}\]\s?/gm;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const EXECUTION_LIMIT_KEYS = Object.keys(DEFAULT_EXECUTION_LIMITS) as Array<keyof ExecutionLimits>;
const OUTPUT_ENCODER = new TextEncoder();
const TINYGO_TARGETS = new Set<TinyGoTarget>(['wasm', 'wasip1', 'wasip2', 'wasip3']);

const abortReason = (signal: AbortSignal, phase: TinyGoOperation['phase']) => {
	const reason = signal.reason;
	return reason !== undefined
		? reason
		: new DOMException(
				phase === 'startup' ? 'TinyGo startup aborted' : 'TinyGo execution aborted',
				'AbortError'
			);
};

class TinyGo implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	rustRuntimeBaseUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	assetLoader: TinyGoRuntimeAssetLoader | undefined = undefined;
	assetPacks: TinyGoRuntimeAssetPackReference[] | undefined = undefined;
	runtime: TinyGoRuntimeHooks | null = null;
	runtimeToken: symbol | null = null;
	runtimePromise: Promise<TinyGoRuntimeHooks> | null = null;
	private runtimePromiseToken: symbol | null = null;
	loadPromise: Promise<void> | null = null;
	compiledArtifact: Uint8Array | null = null;
	compiledArtifactExecutionError = '';
	compiledCacheKey = '';
	waitingForInput = false;
	pendingEof = false;
	lastActivityLog = '';
	runtimeProgress: SandboxProgress | undefined = undefined;
	runtimeProgressStart = 0;
	runtimeProgressEnd = 0;
	runtimeProgressValue = 0;
	runtimeProgressAssets = new Map<string, { loaded: number; total: number }>();
	private runtimeProgressOwner: TinyGoRuntimeProgressOwner | null = null;
	private activeOperation: TinyGoOperation | null = null;
	private disposed = false;
	private disposePromise: Promise<void> | null = null;
	private readonly disposeCancellation = new CancelledError('TinyGo sandbox disposed', {
		phase: 'dispose',
		runtimeId: 'TINYGO',
		recoverable: false
	});
	private readonly workerSession = new WorkerSession({
		label: 'TinyGo',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.clearPendingStdin();
		}
	});

	private disposedConfigurationError() {
		return new RuntimeConfigurationError('TinyGo sandbox is disposed', {
			phase: 'dispose',
			runtimeId: 'TINYGO'
		});
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	): Promise<void> {
		return this.executeOperation('startup', options, async (operation) => {
			try {
				this.assertOperation(operation);
				this.clearPendingStdin();
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				this.assertOperation(operation);
				const nextModuleUrl = resolveTinyGoModuleUrl(runtimeAssets, currentUrl);
				this.assertOperation(operation);
				const nextRustCompilerUrl = resolveRustCompilerUrl(runtimeAssets, currentUrl);
				this.assertOperation(operation);
				const nextRustRuntimeBaseUrl = nextRustCompilerUrl
					? new URL('./runtime/', nextRustCompilerUrl).toString()
					: '';
				this.assertOperation(operation);
				let nextAssetLoader: TinyGoRuntimeAssetLoader | undefined;
				let nextAssetPacks: TinyGoRuntimeAssetPackReference[] | undefined;
				if (typeof runtimeAssets === 'object' && runtimeAssets !== null) {
					const tinyGoAssets = runtimeAssets.tinygo;
					this.assertOperation(operation);
					nextAssetLoader = tinyGoAssets?.assetLoader;
					this.assertOperation(operation);
					const assetPacks = tinyGoAssets?.assetPacks;
					this.assertOperation(operation);
					nextAssetPacks = assetPacks?.map((pack) => ({ ...pack }));
					this.assertOperation(operation);
				}
				if (!nextModuleUrl) {
					throw new Error(
						'TinyGo runtime is not configured. Set PUBLIC_WASM_TINYGO_MODULE_URL or runtimeAssets.tinygo.moduleUrl.'
					);
				}
				if (
					(this.moduleUrl && this.moduleUrl !== nextModuleUrl) ||
					this.rustRuntimeBaseUrl !== nextRustRuntimeBaseUrl
				) {
					this.disposeRuntime();
					this.assertOperation(operation);
					this.compiledArtifact = null;
					this.compiledArtifactExecutionError = '';
					this.compiledCacheKey = '';
				}
				this.assetLoader = nextAssetLoader;
				this.assetPacks = nextAssetPacks;
				this.moduleUrl = nextModuleUrl;
				this.rustRuntimeBaseUrl = nextRustRuntimeBaseUrl;
				progress?.set?.(0.25);
				this.assertOperation(operation);
				await this.ensureWorker(operation);
				this.assertOperation(operation);
				progress?.set?.(0.5);
				this.assertOperation(operation);
				await this.ensureRuntime(operation);
				this.assertOperation(operation);
				progress?.set?.(1);
				this.assertOperation(operation);
			} catch (error) {
				throw error instanceof Error ? error : new Error(String(error));
			}
		});
	}

	private beginOperation(phase: TinyGoOperation['phase']) {
		if (this.disposed) throw this.disposedConfigurationError();
		if (this.activeOperation) {
			throw new BusyError('TinyGo runtime already has an active operation', {
				runtimeId: 'TINYGO',
				phase: this.activeOperation.phase
			});
		}
		const operation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			diagnosticCount: 0,
			outputBytes: 0
		} satisfies TinyGoOperation;
		this.activeOperation = operation;
		return operation;
	}

	private completeOperation(operation: TinyGoOperation) {
		if (this.activeOperation?.token === operation.token) {
			this.activeOperation = null;
		}
	}

	private isOperationActive(operation: TinyGoOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private assertOperation(operation: TinyGoOperation) {
		if (!this.isOperationActive(operation)) {
			throw operation.reason ?? 'Process terminated';
		}
	}

	private snapshotExecutionLimits(
		operation: TinyGoOperation,
		configured: Partial<ExecutionLimits> | undefined
	) {
		const snapshot: Partial<ExecutionLimits> = {};
		if (configured) {
			for (const key of EXECUTION_LIMIT_KEYS) {
				this.assertOperation(operation);
				const enumerable = Object.prototype.propertyIsEnumerable.call(configured, key);
				this.assertOperation(operation);
				if (!enumerable) continue;
				const value = configured[key];
				this.assertOperation(operation);
				if (value !== undefined) snapshot[key] = value;
			}
		}
		const limits = resolveExecutionLimits(snapshot);
		this.assertOperation(operation);
		return limits;
	}

	private executeOperation<T, Request = undefined>(
		phase: TinyGoOperation['phase'],
		options: Pick<SandboxExecutionOptions, 'limits' | 'signal'>,
		execute: (operation: TinyGoOperation, request: Request) => Promise<T>,
		snapshot?: (operation: TinyGoOperation) => Request
	): Promise<T> {
		let operation: TinyGoOperation;
		try {
			operation = this.beginOperation(phase);
		} catch (error) {
			return Promise.reject(error);
		}

		return new Promise<T>((resolve, reject) => {
			let settled = false;
			let signal: AbortSignal | undefined;
			let onAbort: (() => void) | undefined;
			let deadline: ReturnType<typeof setTimeout> | undefined;
			const cleanup = () => {
				delete operation.reject;
				this.completeOperation(operation);
				if (deadline !== undefined) {
					const settledDeadline = deadline;
					deadline = undefined;
					try {
						clearTimeout(settledDeadline);
					} catch {
						// Timer cleanup must not replace the operation result.
					}
				}
				if (signal && onAbort) {
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Cleanup must not replace the operation result.
					}
				}
			};
			const resolveOperation = (value: T) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(value);
			};
			const rejectOperation = (reason: unknown) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(reason);
			};
			operation.reject = rejectOperation;
			try {
				signal = options.signal;
			} catch (error) {
				rejectOperation(operation.cancelled ? operation.reason : error);
				return;
			}
			if (settled) return;
			let preAborted = false;
			try {
				preAborted = signal?.aborted === true;
			} catch (error) {
				rejectOperation(error);
				return;
			}
			if (settled) return;
			if (preAborted && signal) {
				try {
					rejectOperation(abortReason(signal, phase));
				} catch (error) {
					rejectOperation(error);
				}
				return;
			}
			onAbort = signal
				? () => {
						if (!this.isOperationActive(operation)) return;
						let reason: unknown;
						try {
							reason = abortReason(signal, phase);
						} catch (error) {
							reason = error;
						}
						if (this.isOperationActive(operation)) {
							this.cancelOperation(operation, reason);
						}
					}
				: undefined;
			if (signal && onAbort) {
				try {
					signal.addEventListener('abort', onAbort, { once: true });
				} catch (error) {
					rejectOperation(error);
					return;
				}
				if (settled) return;
				try {
					if (signal.aborted) onAbort();
				} catch (error) {
					rejectOperation(error);
					return;
				}
			}
			if (settled) return;
			let limits: ExecutionLimits;
			try {
				const configuredLimits = options.limits;
				if (settled) return;
				limits = this.snapshotExecutionLimits(operation, configuredLimits);
			} catch (error) {
				rejectOperation(operation.cancelled ? operation.reason : error);
				return;
			}
			if (settled) return;
			operation.limits = limits;
			const timeoutMs = Math.min(
				MAX_TIMER_DELAY_MS,
				phase === 'startup'
					? limits.assetTimeoutMs + limits.startupTimeoutMs
					: limits.compileTimeoutMs + limits.runTimeoutMs
			);
			let scheduledDeadline: ReturnType<typeof setTimeout>;
			try {
				scheduledDeadline = setTimeout(() => {
					if (!this.isOperationActive(operation)) return;
					const label = phase === 'startup' ? 'runtime startup' : 'execution';
					this.cancelOperation(
						operation,
						new TimeoutError(`TinyGo ${label} timed out after ${timeoutMs} ms`, {
							phase,
							runtimeId: 'TINYGO',
							timeoutMs
						})
					);
				}, timeoutMs);
			} catch (error) {
				rejectOperation(error);
				return;
			}
			if (settled || !this.isOperationActive(operation)) {
				try {
					clearTimeout(scheduledDeadline);
				} catch {
					// A synchronously settled deadline is already detached.
				}
				return;
			}
			deadline = scheduledDeadline;
			let request: Request;
			try {
				this.assertOperation(operation);
				request = snapshot ? snapshot(operation) : (undefined as Request);
			} catch (error) {
				rejectOperation(operation.cancelled ? operation.reason : error);
				return;
			}
			if (settled || !this.isOperationActive(operation)) return;

			void Promise.resolve()
				.then(() => {
					this.assertOperation(operation);
					return execute(operation, request);
				})
				.then(
					(value) => {
						if (this.isOperationActive(operation)) resolveOperation(value);
					},
					(error) => {
						if (this.isOperationActive(operation)) rejectOperation(error);
					}
				);
		});
	}

	private emitOutput(operation: TinyGoOperation, data: string) {
		this.assertOperation(operation);
		const limit = operation.limits?.maxOutputBytes ?? DEFAULT_EXECUTION_LIMITS.maxOutputBytes;
		const actual = operation.outputBytes + OUTPUT_ENCODER.encode(data).byteLength;
		this.assertOperation(operation);
		if (actual > limit) {
			operation.outputBytes = actual;
			this.cancelOperation(
				operation,
				new OutputLimitError(`TinyGo output exceeded ${limit} bytes`, {
					actual,
					limit,
					phase: 'execute',
					runtimeId: 'TINYGO'
				})
			);
			return false;
		}
		operation.outputBytes = actual;
		try {
			const output = this.output;
			this.assertOperation(operation);
			if (output) Reflect.apply(output, this, [data]);
		} catch (error) {
			if (this.isOperationActive(operation)) this.cancelOperation(operation, error);
			return false;
		}
		return this.isOperationActive(operation);
	}

	private emitCompilerDiagnostic(
		operation: TinyGoOperation,
		diagnostic: TinyGoRuntimeDiagnostic
	) {
		this.assertOperation(operation);
		try {
			if (!diagnostic || typeof diagnostic !== 'object') {
				throw new RuntimeConfigurationError(
					'TinyGo runtime emitted an invalid compiler diagnostic',
					{ phase: operation.phase, runtimeId: 'TINYGO' }
				);
			}
			const message = diagnostic.message;
			this.assertOperation(operation);
			const rawSeverity = diagnostic.severity;
			this.assertOperation(operation);
			const rawFileName = diagnostic.fileName;
			this.assertOperation(operation);
			const rawLineNumber = diagnostic.lineNumber;
			this.assertOperation(operation);
			const rawColumnNumber = diagnostic.columnNumber;
			this.assertOperation(operation);
			const rawEndColumnNumber = diagnostic.endColumnNumber;
			this.assertOperation(operation);
			if (typeof message !== 'string' || message.length === 0) {
				throw new RuntimeConfigurationError(
					'TinyGo runtime emitted a compiler diagnostic without a message',
					{ phase: operation.phase, runtimeId: 'TINYGO' }
				);
			}
			const actual = operation.diagnosticCount + 1;
			const limit =
				operation.limits?.maxDiagnostics ?? DEFAULT_EXECUTION_LIMITS.maxDiagnostics;
			if (actual > limit) {
				operation.diagnosticCount = actual;
				this.cancelOperation(
					operation,
					new DiagnosticLimitError(`TinyGo diagnostics exceeded ${limit} messages`, {
						actual,
						limit,
						phase: operation.phase,
						runtimeId: 'TINYGO'
					})
				);
				this.assertOperation(operation);
			}
			operation.diagnosticCount = actual;
			const compilerDiagnostic: CompilerDiagnostic = {
				message,
				severity:
					rawSeverity === 'error' || rawSeverity === 'warning' ? rawSeverity : 'other',
				lineNumber:
					Number.isSafeInteger(rawLineNumber) && Number(rawLineNumber) >= 0
						? Number(rawLineNumber)
						: 1
			};
			if (rawFileName === null || typeof rawFileName === 'string') {
				compilerDiagnostic.fileName = rawFileName;
			}
			if (Number.isSafeInteger(rawColumnNumber) && Number(rawColumnNumber) >= 0) {
				compilerDiagnostic.columnNumber = Number(rawColumnNumber);
			}
			if (Number.isSafeInteger(rawEndColumnNumber) && Number(rawEndColumnNumber) >= 0) {
				compilerDiagnostic.endColumnNumber = Number(rawEndColumnNumber);
			}
			const callback = this.oncompilerdiagnostic;
			this.assertOperation(operation);
			if (callback) Reflect.apply(callback, this, [compilerDiagnostic]);
			this.assertOperation(operation);
		} catch (error) {
			if (this.isOperationActive(operation)) this.cancelOperation(operation, error);
			this.assertOperation(operation);
		}
	}

	private clearPendingStdin() {
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
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

	private async ensureWorker(operation: TinyGoOperation) {
		this.assertOperation(operation);
		if (this.worker) return;
		const pendingLoad = this.loadPromise;
		if (pendingLoad) {
			await pendingLoad;
			this.assertOperation(operation);
			return;
		}
		const loadPromise = (async () => {
			const WorkerConstructor = (await import('$lib/playground/worker/tinygo?worker'))
				.default;
			this.assertOperation(operation);
			const worker = new WorkerConstructor();
			if (!this.isOperationActive(operation)) {
				worker.terminate();
				this.assertOperation(operation);
			}
			this.worker = worker;
			const workerLoad = this.workerSession.waitForLoad(worker, (resolve, reject) => {
				if (!this.isOperationActive(operation) || this.worker !== worker) {
					return reject(operation.reason ?? 'Worker not loaded');
				}
				worker.onmessage = (event: MessageEvent<any>) => {
					if (!this.isOperationActive(operation) || this.worker !== worker) return;
					const message = event.data ?? {};
					if (message.load) {
						resolve();
						return;
					}
					if (Object.prototype.hasOwnProperty.call(message, 'error')) {
						reject(message.error);
					}
				};
				worker.postMessage({ load: true });
			});
			if (!this.isOperationActive(operation) || this.worker !== worker) {
				this.workerSession.terminate(operation.reason ?? 'Worker not loaded');
			}
			await workerLoad;
			this.assertOperation(operation);
			if (this.worker !== worker) throw operation.reason ?? 'Worker not loaded';
		})();
		this.loadPromise = loadPromise;
		try {
			await loadPromise;
		} finally {
			if (this.loadPromise === loadPromise) this.loadPromise = null;
		}
	}

	private detachRuntime() {
		const runtime = this.runtime;
		this.runtime = null;
		this.runtimeToken = null;
		this.runtimePromise = null;
		this.runtimePromiseToken = null;
		this.lastActivityLog = '';
		this.compiledArtifactExecutionError = '';
		this.runtimeProgress = undefined;
		this.runtimeProgressOwner = null;
		this.runtimeProgressAssets.clear();
		return runtime;
	}

	private disposeRuntimeHooks(runtime: TinyGoRuntimeHooks | null) {
		try {
			runtime?.dispose?.();
		} catch {
			// Runtime cleanup must not replace the lifecycle result.
		}
	}

	private disposeRuntime() {
		this.disposeRuntimeHooks(this.detachRuntime());
	}

	private reportRuntimeProgress(runtimeToken: symbol, progress: TinyGoRuntimeAssetProgress) {
		const owner = this.runtimeProgressOwner;
		if (
			!owner ||
			owner.runtimeToken !== runtimeToken ||
			this.activeOperation?.token !== owner.operationToken ||
			!this.runtimeProgress
		) {
			return;
		}
		const total = progress.total && progress.total > 0 ? progress.total : progress.loaded;
		const key = progress.assetUrl || progress.assetPath;
		this.runtimeProgressAssets.set(key, {
			loaded: Math.max(0, progress.loaded),
			total: Math.max(1, total)
		});
		let loaded = 0;
		let size = 0;
		for (const entry of this.runtimeProgressAssets.values()) {
			loaded += Math.min(entry.loaded, entry.total);
			size += entry.total;
		}
		if (size <= 0) return;
		const nextValue =
			this.runtimeProgressStart +
			((this.runtimeProgressEnd - this.runtimeProgressStart) * loaded) / size;
		if (nextValue <= this.runtimeProgressValue) return;
		this.runtimeProgressValue = nextValue;
		this.runtimeProgress.set?.(nextValue);
	}

	private requireRuntimeAssetLimitSetter(runtime: TinyGoRuntimeHooks) {
		const setMaxAssetBytes = runtime.setMaxAssetBytes;
		if (typeof setMaxAssetBytes !== 'function') {
			throw new RuntimeConfigurationError(
				'TinyGo runtime module must implement setMaxAssetBytes()',
				{ runtimeId: 'TINYGO' }
			);
		}
		return (maxAssetBytes: number) => setMaxAssetBytes.call(runtime, maxAssetBytes);
	}

	private async ensureRuntime(operation: TinyGoOperation) {
		this.assertOperation(operation);
		if (this.runtime) {
			return this.runtime;
		}
		const pendingRuntime = this.runtimePromise;
		if (pendingRuntime) {
			const runtime = await pendingRuntime;
			this.assertOperation(operation);
			return runtime;
		}
		const moduleUrl = this.moduleUrl;
		const runtimeToken = Symbol('runtime');
		const runtimePromiseToken = Symbol('runtime-startup');
		this.runtimePromiseToken = runtimePromiseToken;
		const assetLoader = this.assetLoader;
		const assetPacks = this.assetPacks;
		const rustRuntimeBaseUrl = this.rustRuntimeBaseUrl;
		const maxAssetBytes =
			operation.limits?.maxAssetBytes ?? DEFAULT_EXECUTION_LIMITS.maxAssetBytes;
		let nextRuntime: TinyGoRuntimeHooks | null = null;
		const runtimePromise = (async () => {
			try {
				const runtimeModule = (await import(
					/* @vite-ignore */ moduleUrl
				)) as TinyGoRuntimeModule;
				this.assertOperation(operation);
				const commonOptions = {
					assetLoader,
					assetPacks,
					maxAssetBytes,
					rustRuntimeBaseUrl: rustRuntimeBaseUrl || undefined,
					onCompilerDiagnostic: (diagnostic: TinyGoRuntimeDiagnostic) => {
						const owner = this.runtimeProgressOwner;
						const activeOperation = this.activeOperation;
						const runtime = this.runtime;
						if (
							!owner ||
							!activeOperation ||
							owner.operationToken !== activeOperation.token ||
							owner.runtimeToken !== runtimeToken ||
							this.runtimeToken !== runtimeToken ||
							!runtime ||
							!this.isOperationActive(activeOperation)
						) {
							return;
						}
						this.emitCompilerDiagnostic(activeOperation, diagnostic);
					},
					onLogAppended: (_entry?: TinyGoRuntimeLogEntry) => {
						const owner = this.runtimeProgressOwner;
						const activeOperation = this.activeOperation;
						const runtime = this.runtime;
						if (
							!owner ||
							!activeOperation ||
							owner.operationToken !== activeOperation.token ||
							owner.runtimeToken !== runtimeToken ||
							this.runtimeToken !== runtimeToken ||
							!runtime ||
							!this.isOperationActive(activeOperation)
						) {
							return;
						}
						this.emitActivityLog(runtime, activeOperation);
					},
					onProgress: (progress: TinyGoRuntimeAssetProgress) =>
						this.reportRuntimeProgress(runtimeToken, progress)
				};
				if (
					typeof runtimeModule.loadTinyGoUpstreamToolchainAssets === 'function' &&
					typeof runtimeModule.compileTinyGoInDisposableWorker === 'function'
				) {
					let activityLog = '';
					let artifact: ReturnType<TinyGoRuntimeHooks['readBuildArtifact']> = null;
					let workspaceFiles: Record<string, string> | null = null;
					let target: TinyGoTarget = 'wasip1';
					let assetLimit = maxAssetBytes;
					let wasmMemoryLimit = DEFAULT_EXECUTION_LIMITS.maxWasmMemoryBytes;
					let controller: AbortController | null = null;
					let assetsPromise: Promise<unknown> | null = null;
					const loadUpstreamAssets = runtimeModule.loadTinyGoUpstreamToolchainAssets;
					const compileUpstream = runtimeModule.compileTinyGoInDisposableWorker;
					const appendLog = (line: string) => {
						activityLog += `[${new Date().toTimeString().slice(0, 8)}] ${line}\n`;
						commonOptions.onLogAppended({ line });
					};
					nextRuntime = {
						async boot() {
							if (!assetsPromise) {
								controller = new AbortController();
								let assetBaseUrl: string;
								try {
									assetBaseUrl = new URL('./', moduleUrl).toString();
								} catch {
									assetBaseUrl = new URL('./', window.location.href).toString();
								}
								assetsPromise = loadUpstreamAssets({
									assetBaseUrl,
									...(assetLoader ? { loader: assetLoader } : {}),
									onProgress: commonOptions.onProgress,
									signal: controller.signal,
									maxAssetBytes: assetLimit
								});
							}
							const pendingAssets = assetsPromise;
							try {
								await pendingAssets;
							} catch (error) {
								if (assetsPromise === pendingAssets) assetsPromise = null;
								throw error;
							}
							appendLog('upstream TinyGo toolchain assets loaded');
						},
						async plan() {
							if (!assetsPromise) throw new Error('upstream TinyGo assets are not loaded');
							appendLog('upstream TinyGo receipt validation scheduled in compiler worker');
							return { target: 'wasip1', implementation: 'upstream-tinygo-0.40.1' };
						},
						async execute() {
							if (target !== 'wasip1') {
								throw new Error('The upstream TinyGo browser compiler supports only wasip1');
							}
							if (!workspaceFiles) throw new Error('TinyGo workspace is not configured');
							const assets = await assetsPromise;
							if (!assets) throw new Error('upstream TinyGo assets are not loaded');
							controller = new AbortController();
							const compileFiles = { ...workspaceFiles };
							if (!Object.prototype.hasOwnProperty.call(compileFiles, 'go.mod')) {
								compileFiles['go.mod'] = 'module wasm-idle.local/main\n\ngo 1.24.0\n';
							}
							const result = await compileUpstream(
								assets,
								{ workspaceFiles: compileFiles, package: '.' },
								{
									signal: controller.signal,
									maxWasmMemoryBytes: wasmMemoryLimit,
									onPhase: (phase) => appendLog(`upstream TinyGo phase: ${phase}`)
								}
							);
							artifact = {
								path: '/work/program.wasm',
								bytes: Uint8Array.from(result.wasm),
								artifactKind: 'execution',
								runnable: true,
								entrypoint: '_start'
							};
							appendLog(`upstream TinyGo artifact ready: ${artifact.path}`);
						},
						reset() {
							controller?.abort(new Error('TinyGo runtime reset'));
							controller = null;
							artifact = null;
							activityLog = '';
						},
						readActivityLog: () => activityLog,
						readBuildArtifact: () => artifact,
						setBuildRequestOverrides(overrides) {
							target = overrides?.target ?? 'wasip1';
						},
						setMaxAssetBytes(value) {
							if (assetLimit !== value) {
								controller?.abort(new Error('TinyGo asset quota changed'));
								controller = null;
								assetsPromise = null;
							}
							assetLimit = value;
						},
						setMaxWasmMemoryBytes(value) {
							wasmMemoryLimit = value;
						},
						setWorkspaceFiles(files) {
							workspaceFiles = files ? { ...files } : null;
						},
						dispose() {
							controller?.abort(new Error('TinyGo runtime disposed'));
							controller = null;
							workspaceFiles = null;
							artifact = null;
						}
					};
				} else if (typeof runtimeModule.createBundledTinyGoRuntime === 'function') {
					nextRuntime = runtimeModule.createBundledTinyGoRuntime(commonOptions);
				} else if (typeof runtimeModule.createTinyGoRuntime === 'function') {
					nextRuntime = runtimeModule.createTinyGoRuntime({
						assetBaseUrl: new URL('./', moduleUrl).toString(),
						...commonOptions
					});
				} else {
					throw new Error(
						'TinyGo runtime module must export createBundledTinyGoRuntime or createTinyGoRuntime'
					);
				}
				this.assertOperation(operation);
				this.requireRuntimeAssetLimitSetter(nextRuntime);
				this.assertOperation(operation);
				if (this.runtimePromiseToken !== runtimePromiseToken) {
					throw operation.reason ?? 'TinyGo runtime startup superseded';
				}
				const runtime = nextRuntime;
				nextRuntime = null;
				this.runtime = runtime;
				this.runtimeToken = runtimeToken;
				return runtime;
			} finally {
				try {
					nextRuntime?.dispose?.();
				} catch {
					// A stale runtime must not replace the active lifecycle result.
				}
			}
		})();
		this.runtimePromise = runtimePromise;
		try {
			return await runtimePromise;
		} finally {
			if (this.runtimePromise === runtimePromise) {
				this.runtimePromise = null;
				this.runtimePromiseToken = null;
			}
		}
	}

	private emitActivityLog(hooks: TinyGoRuntimeHooks, operation: TinyGoOperation) {
		this.assertOperation(operation);
		const nextActivityLog = hooks.readActivityLog();
		const delta = nextActivityLog.startsWith(this.lastActivityLog)
			? nextActivityLog.slice(this.lastActivityLog.length)
			: nextActivityLog;
		this.lastActivityLog = nextActivityLog;
		if (!delta) return;
		const sanitized = delta.replace(ACTIVITY_PREFIX_PATTERN, '');
		if (sanitized && !this.emitOutput(operation, sanitized)) {
			this.assertOperation(operation);
		}
		this.assertOperation(operation);
	}

	private extractCompileFailure() {
		const sanitized = this.lastActivityLog.replace(ACTIVITY_PREFIX_PATTERN, '');
		const lines = sanitized
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			if (/(failed|error)/i.test(lines[index] || '')) {
				return lines[index] as string;
			}
		}
		return 'TinyGo compilation failed';
	}

	private async compileArtifact(
		operation: TinyGoOperation,
		workspaceFiles: Record<string, string>,
		target: TinyGoTarget = 'wasm',
		log = true,
		prog?: SandboxProgress
	) {
		this.assertOperation(operation);
		const compileCacheKey = JSON.stringify({
			moduleUrl: this.moduleUrl,
			maxAssetBytes:
				operation.limits?.maxAssetBytes ?? DEFAULT_EXECUTION_LIMITS.maxAssetBytes,
			maxWasmMemoryBytes:
				operation.limits?.maxWasmMemoryBytes ?? DEFAULT_EXECUTION_LIMITS.maxWasmMemoryBytes,
			target,
			workspaceFiles
		});
		if (this.compiledArtifact && this.compiledCacheKey === compileCacheKey) {
			return;
		}
		const runtime = await this.ensureRuntime(operation);
		this.assertOperation(operation);
		const runtimeToken = this.runtimeToken;
		if (!runtimeToken || this.runtime !== runtime) {
			throw operation.reason ?? 'TinyGo compiler runtime is not available';
		}
		this.requireRuntimeAssetLimitSetter(runtime)(
			operation.limits?.maxAssetBytes ?? DEFAULT_EXECUTION_LIMITS.maxAssetBytes
		);
		runtime.setMaxWasmMemoryBytes?.(
			operation.limits?.maxWasmMemoryBytes ?? DEFAULT_EXECUTION_LIMITS.maxWasmMemoryBytes
		);
		this.assertOperation(operation);
		runtime.reset();
		this.assertOperation(operation);
		this.lastActivityLog = runtime.readActivityLog();
		this.assertOperation(operation);
		runtime.setWorkspaceFiles(workspaceFiles);
		this.assertOperation(operation);
		runtime.setBuildRequestOverrides?.({ target });
		this.assertOperation(operation);
		this.runtimeProgress = prog;
		this.runtimeProgressOwner = {
			operationToken: operation.token,
			runtimeToken
		};
		this.runtimeProgressAssets.clear();
		this.runtimeProgressStart = 0.05;
		this.runtimeProgressEnd = 0.35;
		this.runtimeProgressValue = 0.05;
		try {
			prog?.set?.(0.05);
			this.assertOperation(operation);
			await runtime.boot();
			this.assertOperation(operation);
			this.emitActivityLog(runtime, operation);
			this.runtimeProgressAssets.clear();
			this.runtimeProgressStart = 0.35;
			this.runtimeProgressEnd = 0.65;
			this.runtimeProgressValue = Math.max(this.runtimeProgressValue, 0.35);
			prog?.set?.(this.runtimeProgressValue);
			this.assertOperation(operation);
			await runtime.plan();
			this.assertOperation(operation);
			this.emitActivityLog(runtime, operation);
			this.runtimeProgressAssets.clear();
			this.runtimeProgressStart = 0.65;
			this.runtimeProgressEnd = 0.92;
			this.runtimeProgressValue = Math.max(this.runtimeProgressValue, 0.65);
			prog?.set?.(this.runtimeProgressValue);
			this.assertOperation(operation);
			await runtime.execute();
			this.assertOperation(operation);
			this.emitActivityLog(runtime, operation);
			prog?.set?.(0.95);
			this.assertOperation(operation);
		} finally {
			if (
				this.runtimeProgressOwner?.operationToken === operation.token &&
				this.runtimeProgressOwner.runtimeToken === runtimeToken
			) {
				this.runtimeProgress = undefined;
				this.runtimeProgressOwner = null;
				this.runtimeProgressAssets.clear();
			}
		}
		this.assertOperation(operation);
		const artifact = runtime.readBuildArtifact();
		this.assertOperation(operation);
		if (!artifact) {
			const compileFailure = this.extractCompileFailure();
			if (/(?:probe-only|supported WASI entrypoint)/i.test(compileFailure)) {
				throw new Error(
					`TinyGo browser runtime could not produce a runnable execution artifact: ${compileFailure}.`
				);
			}
			throw new Error(compileFailure);
		}
		const runtimeActivityLog = runtime.readActivityLog();
		this.assertOperation(operation);
		const runtimeLogLines = runtimeActivityLog
			.replace(ACTIVITY_PREFIX_PATTERN, '')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		let browserRuntimeFailure = '';
		for (let index = runtimeLogLines.length - 1; index >= 0; index -= 1) {
			const line = runtimeLogLines[index] || '';
			if (/^(?:build execution failed:|artifact probe failed:)/.test(line)) {
				browserRuntimeFailure = line.replace(
					/^(?:build execution failed:|artifact probe failed:)\s*/,
					''
				);
				break;
			}
		}
		const compiledArtifact = new Uint8Array(artifact.bytes);
		const compiledArtifactExecutionError =
			artifact.runnable === false
				? browserRuntimeFailure !== ''
					? `TinyGo browser runtime could not produce a runnable execution artifact: ${browserRuntimeFailure}.`
					: artifact.reason === 'bootstrap-artifact'
						? 'TinyGo browser runtime produced a bootstrap artifact and cannot execute it yet.'
						: artifact.artifactKind === 'probe'
							? 'TinyGo browser runtime produced a non-runnable probe artifact without a supported WASI entrypoint.'
							: 'TinyGo browser runtime produced a non-runnable artifact without a supported WASI entrypoint.'
				: '';
		this.assertOperation(operation);
		this.compiledArtifact = compiledArtifact;
		this.compiledArtifactExecutionError = compiledArtifactExecutionError;
		this.compiledCacheKey = compileCacheKey;
		if (log) {
			this.emitOutput(operation, `tinygo artifact ready: ${artifact.path}\n`);
			this.assertOperation(operation);
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
		return this.executeOperation(
			'execute',
			options,
			async (operation, request: TinyGoRunRequest) => {
				this.exit = false;
				try {
					this.begin = Date.now();
					await this.ensureWorker(operation);
					this.assertOperation(operation);
					await this.compileArtifact(
						operation,
						request.workspaceFiles,
						request.target,
						_log,
						prepare ? _prog : undefined
					);
					this.assertOperation(operation);
					if (prepare) {
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						return true;
					}
					if (this.compiledArtifactExecutionError) {
						throw new Error(this.compiledArtifactExecutionError);
					}
					if (!this.worker || !this.compiledArtifact) {
						throw new Error('TinyGo runtime did not prepare an artifact');
					}
					const worker = this.worker;
					const compiledArtifact = this.compiledArtifact;
					const buffer = request.buffer;
					const hasExplicitStdin = request.stdin !== undefined;
					if (hasExplicitStdin) {
						this.clearPendingStdin();
					}
					const runUid = ++this.uid;
					return await new Promise<boolean | string>((resolve, reject) => {
						const workerOperation = this.workerSession.beginRun(worker, reject);
						const handleMessage = (event: Event & { data: any }) => {
							if (
								!this.isOperationActive(operation) ||
								this.worker !== worker ||
								runUid !== this.uid
							) {
								if (worker.onmessage === handleMessage) worker.onmessage = null;
								return;
							}
							const message = event.data ?? {};
							const hasResults = Object.prototype.hasOwnProperty.call(
								message,
								'results'
							);
							const hasError = Object.prototype.hasOwnProperty.call(message, 'error');
							const { output, results, error, buffer } = message;
							if (buffer && !hasExplicitStdin) {
								this.waitingForInput = true;
								this.flushPendingInput();
							}
							if (output) {
								if (!this.emitOutput(operation, output)) return;
							}
							if (hasResults) {
								if (worker.onmessage === handleMessage) worker.onmessage = null;
								this.elapse = Date.now() - this.begin;
								this.exit = true;
								this.clearPendingStdin();
								this.workerSession.complete(workerOperation);
								resolve(results as boolean | string);
								return;
							}
							if (hasError) {
								if (worker.onmessage === handleMessage) worker.onmessage = null;
								this.elapse = Date.now() - this.begin;
								this.exit = true;
								this.clearPendingStdin();
								this.workerSession.complete(workerOperation);
								reject(error);
							}
						};
						worker.onmessage = handleMessage;
						try {
							worker.postMessage({
								artifact: new Uint8Array(compiledArtifact),
								buffer,
								args: request.programArgs,
								log: _log,
								stdin: request.stdin
							});
						} catch (error) {
							this.workerSession.terminate(error);
						}
					});
				} catch (error) {
					if (this.isOperationActive(operation)) {
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.clearPendingStdin();
						throw error instanceof Error ? error.message : String(error);
					}
					throw error;
				}
			},
			(operation) => {
				this.assertOperation(operation);
				if (typeof code !== 'string') {
					throw new TypeError('TinyGo source code must be a string');
				}
				const configuredTarget = options.tinygoTarget;
				this.assertOperation(operation);
				const target = configuredTarget ?? 'wasip1';
				if (!TINYGO_TARGETS.has(target)) {
					throw new TypeError('TinyGo target must be wasm, wasip1, wasip2, or wasip3');
				}

				const workspaceLimitsSource = options.workspaceLimits;
				this.assertOperation(operation);
				let workspaceLimits: NonNullable<SandboxExecutionOptions['workspaceLimits']> = {};
				if (workspaceLimitsSource !== undefined) {
					if (
						workspaceLimitsSource === null ||
						typeof workspaceLimitsSource !== 'object' ||
						Array.isArray(workspaceLimitsSource)
					) {
						throw new TypeError('TinyGo workspace limits must be an object');
					}
					const maxFiles = workspaceLimitsSource.maxFiles;
					this.assertOperation(operation);
					const maxFileBytes = workspaceLimitsSource.maxFileBytes;
					this.assertOperation(operation);
					const maxTotalBytes = workspaceLimitsSource.maxTotalBytes;
					this.assertOperation(operation);
					const maxPathBytes = workspaceLimitsSource.maxPathBytes;
					this.assertOperation(operation);
					const caseSensitive = workspaceLimitsSource.caseSensitive;
					this.assertOperation(operation);
					workspaceLimits = {
						maxFiles,
						maxFileBytes,
						maxTotalBytes,
						maxPathBytes,
						caseSensitive
					};
				}
				for (const name of [
					'maxFiles',
					'maxFileBytes',
					'maxTotalBytes',
					'maxPathBytes'
				] as const) {
					const value = workspaceLimits[name];
					if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
						throw new WorkspaceValidationError(
							'invalid-limit',
							`Workspace limit ${name} must be a non-negative safe integer`
						);
					}
				}
				if (
					workspaceLimits.caseSensitive !== undefined &&
					typeof workspaceLimits.caseSensitive !== 'boolean'
				) {
					throw new WorkspaceValidationError(
						'invalid-limit',
						'Workspace limit caseSensitive must be a boolean'
					);
				}

				const workspaceFilesSource = options.workspaceFiles;
				this.assertOperation(operation);
				const sourceFiles = workspaceFilesSource ?? [];
				if (!Array.isArray(sourceFiles)) {
					throw new TypeError('TinyGo workspace files must be an array');
				}
				const workspaceFileCount = sourceFiles.length;
				this.assertOperation(operation);
				const maxFiles = workspaceLimits.maxFiles ?? DEFAULT_WORKSPACE_LIMITS.maxFiles;
				if (workspaceFileCount > maxFiles) {
					throw new WorkspaceValidationError(
						'file-count-limit',
						`Workspace contains ${workspaceFileCount} files; limit is ${maxFiles}`,
						{ limit: maxFiles, actual: workspaceFileCount }
					);
				}
				const workspaceFiles: Array<{ path: string; content: string }> = [];
				for (let index = 0; index < workspaceFileCount; index += 1) {
					const file = sourceFiles[index];
					this.assertOperation(operation);
					if (file === null || typeof file !== 'object') {
						throw new TypeError('TinyGo workspace file must be an object');
					}
					const path = file.path;
					this.assertOperation(operation);
					const content = file.content;
					this.assertOperation(operation);
					if (typeof path !== 'string') {
						throw new TypeError('TinyGo workspace file path must be a string');
					}
					if (typeof content !== 'string') {
						throw new TypeError(`TinyGo workspace file ${path} must contain a string`);
					}
					workspaceFiles.push({ path, content });
				}

				const configuredActivePath = options.activePath;
				this.assertOperation(operation);
				const activePath = configuredActivePath ?? 'main.go';
				const maxWorkspaceBytes =
					operation.limits?.maxWorkspaceBytes ??
					DEFAULT_EXECUTION_LIMITS.maxWorkspaceBytes;
				const workspace = validateExecutionWorkspace(code, workspaceFiles, activePath, {
					...workspaceLimits,
					maxFileBytes: Math.min(
						workspaceLimits.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
						maxWorkspaceBytes
					),
					maxTotalBytes: Math.min(
						workspaceLimits.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
						maxWorkspaceBytes
					)
				});
				this.assertOperation(operation);
				if (workspace.activePath !== 'main.go') {
					throw new RuntimeConfigurationError(
						'TinyGo runtime currently requires activePath to be main.go',
						{ phase: 'execute', runtimeId: 'TINYGO' }
					);
				}
				const runtimeWorkspace = Object.fromEntries([
					['main.go', code],
					...workspace.workspaceFiles.map((file) => [file.path, file.content])
				]) as Record<string, string>;

				const configuredProgramArgs = options.programArgs;
				this.assertOperation(operation);
				const sourceArgs = configuredProgramArgs ?? args;
				if (!Array.isArray(sourceArgs)) {
					throw new TypeError('TinyGo program arguments must be an array');
				}
				const argCount = sourceArgs.length;
				this.assertOperation(operation);
				const programArgs: string[] = [];
				for (let index = 0; index < argCount; index += 1) {
					const argument = sourceArgs[index];
					this.assertOperation(operation);
					if (typeof argument !== 'string') {
						throw new TypeError(`TinyGo program argument ${index} must be a string`);
					}
					programArgs.push(argument);
				}

				const stdin = options.stdin;
				this.assertOperation(operation);
				if (stdin !== undefined && typeof stdin !== 'string') {
					throw new TypeError('TinyGo stdin must be a string');
				}
				const buffer = this.buffer;
				this.assertOperation(operation);
				operation.buffer = buffer;

				return { buffer, programArgs, stdin, target, workspaceFiles: runtimeWorkspace };
			}
		);
	}

	private resetOwnedBuffers(operationBuffer?: ArrayBufferLike) {
		const buffers = new Set<ArrayBufferLike>([this.buffer]);
		if (operationBuffer) buffers.add(operationBuffer);
		for (const buffer of buffers) {
			try {
				resetBufferedStdin(buffer);
			} catch {
				// Stdin cleanup must not replace the lifecycle result.
			}
		}
	}

	private cancelOperation(operation: TinyGoOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.reason = reason;
		const reject = operation.reject;
		this.completeOperation(operation);
		this.uid += 1;
		this.clearPendingStdin();
		this.exit = true;
		this.loadPromise = null;
		this.runtimeProgress = undefined;
		this.runtimeProgressOwner = null;
		this.runtimeProgressAssets.clear();
		this.compiledArtifact = null;
		this.compiledArtifactExecutionError = '';
		this.compiledCacheKey = '';
		this.resetOwnedBuffers(operation.buffer);
		this.workerSession.terminate(reason);
		this.disposeRuntime();
		reject?.(reason);
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		if (this.disposed) return;
		const operation = this.activeOperation;
		if (operation) {
			this.cancelOperation(operation, reason);
			return;
		}
		this.clearPendingStdin();
		this.uid += 1;
		this.resetOwnedBuffers();
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		if (this.disposed) return;
		this.terminate();
		this.loadPromise = null;
		this.disposeRuntime();
		this.compiledArtifact = null;
		this.compiledArtifactExecutionError = '';
		this.compiledCacheKey = '';
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.disposePromise = Promise.resolve();

		const operation = this.activeOperation;
		const runtime = this.detachRuntime();
		delete this.worker;
		this.moduleUrl = '';
		this.rustRuntimeBaseUrl = '';
		this.assetLoader = undefined;
		this.assetPacks = undefined;
		this.output = undefined;
		this.oncompilerdiagnostic = undefined;
		this.loadPromise = null;
		this.compiledArtifact = null;
		this.compiledArtifactExecutionError = '';
		this.compiledCacheKey = '';
		this.clearPendingStdin();
		this.resetOwnedBuffers(operation?.buffer);
		if (operation) {
			this.cancelOperation(operation, this.disposeCancellation);
		} else {
			this.uid += 1;
			this.workerSession.terminate(this.disposeCancellation);
			this.exit = true;
		}
		this.disposeRuntimeHooks(runtime);
		return this.disposePromise;
	}
}

export default TinyGo;
