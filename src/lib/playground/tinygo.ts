import {
	resolveRustCompilerUrl,
	resolveTinyGoModuleUrl,
	type PlaygroundRuntimeAssets,
	type TinyGoRuntimeAssetLoader,
	type TinyGoRuntimeAssetPackReference
} from '$lib/playground/assets';
import type { SandboxExecutionOptions, TinyGoTarget } from '$lib/playground/options';
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
	DEFAULT_EXECUTION_LIMITS,
	DEFAULT_WORKSPACE_LIMITS,
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

type TinyGoRuntimeModule = {
	createBundledTinyGoRuntime?: (options?: {
		assetLoader?: TinyGoRuntimeAssetLoader;
		assetPacks?: TinyGoRuntimeAssetPackReference[];
		rustRuntimeBaseUrl?: string;
		onProgress?: (progress: TinyGoRuntimeAssetProgress) => void;
	}) => TinyGoRuntimeHooks;
	createTinyGoRuntime?: (options: {
		assetBaseUrl: string;
		assetLoader?: TinyGoRuntimeAssetLoader;
		assetPacks?: TinyGoRuntimeAssetPackReference[];
		rustRuntimeBaseUrl?: string;
		onProgress?: (progress: TinyGoRuntimeAssetProgress) => void;
	}) => TinyGoRuntimeHooks;
};

type TinyGoOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
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
	private readonly workerSession = new WorkerSession({
		label: 'TinyGo',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.clearPendingStdin();
		}
	});

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
				this.clearPendingStdin();
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextModuleUrl = resolveTinyGoModuleUrl(runtimeAssets, currentUrl);
				const nextRustCompilerUrl = resolveRustCompilerUrl(runtimeAssets, currentUrl);
				const nextRustRuntimeBaseUrl = nextRustCompilerUrl
					? new URL('./runtime/', nextRustCompilerUrl).toString()
					: '';
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
					this.compiledArtifact = null;
					this.compiledArtifactExecutionError = '';
					this.compiledCacheKey = '';
				}
				this.assetLoader =
					typeof runtimeAssets === 'object'
						? runtimeAssets?.tinygo?.assetLoader
						: undefined;
				this.assetPacks =
					typeof runtimeAssets === 'object'
						? runtimeAssets?.tinygo?.assetPacks
						: undefined;
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
				throw new Error(error instanceof Error ? error.message : String(error));
			}
		});
	}

	private beginOperation(phase: TinyGoOperation['phase']) {
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
		const output = this.output;
		this.assertOperation(operation);
		if (output) Reflect.apply(output, this, [data]);
		return this.isOperationActive(operation);
	}

	private clearPendingStdin() {
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.flushPendingInput();
	}

	eof() {
		this.pendingEof = true;
		this.flushPendingInput();
	}

	private flushPendingInput() {
		if (!this.waitingForInput) return;
		if (flushQueuedStdin(this.pendingInput, this.buffer)) {
			this.waitingForInput = false;
			return;
		}
		if (this.pendingEof) {
			flushBufferedEof(this.buffer);
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
			await this.workerSession.waitForLoad(worker, (resolve, reject) => {
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

	private disposeRuntime() {
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
		try {
			runtime?.dispose?.();
		} catch {
			// Runtime cleanup must not replace the lifecycle result.
		}
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
					rustRuntimeBaseUrl: rustRuntimeBaseUrl || undefined,
					onProgress: (progress: TinyGoRuntimeAssetProgress) =>
						this.reportRuntimeProgress(runtimeToken, progress)
				};
				if (typeof runtimeModule.createBundledTinyGoRuntime === 'function') {
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
								buffer: this.buffer,
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
				const target = configuredTarget ?? 'wasm';
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

				return { programArgs, stdin, target, workspaceFiles: runtimeWorkspace };
			}
		);
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
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Stdin cleanup must not replace the cancellation reason.
		}
		this.workerSession.terminate(reason);
		this.disposeRuntime();
		reject?.(reason);
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const operation = this.activeOperation;
		if (operation) {
			this.cancelOperation(operation, reason);
			return;
		}
		this.clearPendingStdin();
		this.uid += 1;
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Idle cleanup remains best effort for a caller-replaced buffer.
		}
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		this.terminate();
		this.loadPromise = null;
		this.disposeRuntime();
		this.compiledArtifact = null;
		this.compiledArtifactExecutionError = '';
		this.compiledCacheKey = '';
	}
}

export default TinyGo;
