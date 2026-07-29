import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	AssetNotFoundError,
	AssetTooLargeError,
	BusyError,
	CancelledError,
	DiagnosticLimitError,
	OutputLimitError,
	RuntimeProgressController,
	TimeoutError,
	isWasmIdleError,
	resolveExecutionLimits,
	type ExecutionLimits
} from '@wasm-idle/core';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';

export interface StaticWorkerRuntimeUrls {
	baseUrl: string;
	workerUrl: string;
	manifestUrl?: string;
}

export interface StaticWorkerRuntimeConfig {
	languageId: string;
	displayName: string;
	defaultActivePath: string;
	moduleWorker?: boolean;
	readStdinPattern: RegExp;
	resolveRuntimeAssets: (
		runtimeAssets: string | PlaygroundRuntimeAssets,
		currentUrl: string
	) => StaticWorkerRuntimeUrls;
}

type StaticWorkerMessage = {
	__wasmIdleStaticWorkerReady?: boolean;
	runId?: string;
	output?: string;
	results?: boolean | string;
	error?: string;
	diagnostic?: CompilerDiagnostic;
	progress?: { percent?: number; stage?: string };
};

type BufferedStdin = {
	stdin?: string;
	stdinEof: boolean;
};

type ActiveRun = {
	cleanup: () => void;
	diagnosticCount: number;
	id: string;
	limits: ExecutionLimits;
	outputBytes: number;
	progress?: SandboxProgress;
	resolve: (result: boolean | string) => void;
	reject: (reason: unknown) => void;
};

type StaticWorkerExecutionControls = {
	limits: ExecutionLimits;
	signal?: AbortSignal;
};

type StdinWaiter = {
	reject: (reason: unknown) => void;
	resolve: () => void;
};

const WORKER_READY_MESSAGE = '__wasmIdleStaticWorkerReady';
const outputEncoder = new TextEncoder();

export class StaticWorkerRuntimeSandbox implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	baseUrl = '';
	workerUrl = '';
	manifestUrl = '';
	activeReject: ((reason: unknown) => void) | null = null;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	pendingEof = false;
	stdinWaiters: StdinWaiter[] = [];

	private activeRun: ActiveRun | null = null;
	private bootstrapUrl = '';
	private lifecycleProgress?: SandboxProgress;
	private readonly progressController = new RuntimeProgressController();
	private progressUid = 0;
	private startupReject: ((reason: Error) => void) | null = null;
	private workerGeneration = 0;
	private workerStartPromise: Promise<Worker> | null = null;

	constructor(private readonly config: StaticWorkerRuntimeConfig) {}

	async load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		const controls = this.resolveExecutionControls(options);
		if (controls.signal?.aborted) {
			throw new CancelledError(`${this.config.displayName} startup cancelled`, {
				cause: controls.signal.reason,
				phase: 'startup',
				runtimeId: this.config.languageId
			});
		}
		const progressSink = this.selectProgress(progress);
		const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
		const urls = this.config.resolveRuntimeAssets(runtimeAssets, currentUrl);
		const nextManifestUrl = urls.manifestUrl || '';
		const runtimeChanged =
			this.baseUrl !== urls.baseUrl ||
			this.workerUrl !== urls.workerUrl ||
			this.manifestUrl !== nextManifestUrl;

		if (runtimeChanged && (this.worker || this.workerStartPromise || this.activeRun)) {
			this.terminate();
		}
		this.baseUrl = urls.baseUrl;
		this.workerUrl = urls.workerUrl;
		this.manifestUrl = nextManifestUrl;

		if (!this.baseUrl || !this.workerUrl) {
			throw new Error(`${this.config.displayName} runtime is not configured.`);
		}
		if (!runtimeChanged && this.workerStartPromise) {
			await this.workerStartPromise;
			return;
		}

		const lifecycle = this.beginProgressLifecycle(
			progressSink,
			`Resolving ${this.config.displayName} runtime`
		);
		try {
			this.reportProgress(
				lifecycle.progress,
				0.02,
				`Resolving ${this.config.displayName} runtime`
			);
			await this.ensureWorkerStarted(lifecycle.progress, controls);
		} finally {
			lifecycle.end();
		}
	}

	write(input: string) {
		this.pendingInput.push(input);
	}

	eof() {
		this.pendingEof = true;
		this.resolveStdinWaiters();
	}

	private resolveStdinWaiters() {
		const waiters = this.stdinWaiters.splice(0);
		for (const waiter of waiters) waiter.resolve();
	}

	private rejectStdinWaiters(reason: unknown) {
		const waiters = this.stdinWaiters.splice(0);
		for (const waiter of waiters) waiter.reject(reason);
	}

	private clearPendingStdin() {
		this.pendingInput = [];
		this.pendingEof = false;
	}

	private readsStdin(code: string) {
		this.config.readStdinPattern.lastIndex = 0;
		return this.config.readStdinPattern.test(code);
	}

	private async collectStdinForRun(
		code: string,
		options: SandboxExecutionOptions
	): Promise<BufferedStdin> {
		if (typeof options.stdin === 'string') {
			this.clearPendingStdin();
			return { stdin: options.stdin, stdinEof: true };
		}
		if (!this.readsStdin(code) && this.pendingInput.length === 0 && !this.pendingEof) {
			return { stdin: undefined, stdinEof: false };
		}

		while (!this.pendingEof) {
			await new Promise<void>((resolve, reject) => {
				this.stdinWaiters.push({ resolve, reject });
			});
		}

		const stdin = this.pendingInput.join('');
		this.clearPendingStdin();
		return { stdin, stdinEof: true };
	}

	private selectProgress(progress?: SandboxProgress) {
		if (progress) this.lifecycleProgress = progress;
		return progress || this.lifecycleProgress;
	}

	private beginProgressLifecycle(progress: SandboxProgress | undefined, stage: string) {
		return this.progressController.begin(
			`${this.config.languageId.toLowerCase()}-${++this.progressUid}`,
			progress,
			stage
		);
	}

	private resolveExecutionControls(
		options: SandboxExecutionOptions
	): StaticWorkerExecutionControls {
		return {
			limits: resolveExecutionLimits(options.limits),
			...(options.signal ? { signal: options.signal } : {})
		};
	}

	private reportProgress(progress: SandboxProgress | undefined, value: number, stage?: string) {
		if (!progress) return;
		const clamped = Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0;
		progress.set?.(clamped, stage);
	}

	private async preloadWorkerScript(
		progress: SandboxProgress | undefined,
		controls: StaticWorkerExecutionControls
	) {
		const { limits, signal } = controls;
		if (signal?.aborted) {
			throw new CancelledError(`${this.config.displayName} worker download cancelled`, {
				cause: signal.reason,
				phase: 'asset',
				runtimeId: this.config.languageId
			});
		}
		const phaseController = new AbortController();
		let timedOut = false;
		const onAbort = () => phaseController.abort(signal?.reason);
		signal?.addEventListener('abort', onAbort, { once: true });
		const timeout = setTimeout(() => {
			timedOut = true;
			phaseController.abort();
		}, limits.assetTimeoutMs);
		this.reportProgress(progress, 0.05, `Loading ${this.config.displayName} worker script`);
		try {
			const response = await fetch(this.workerUrl, {
				cache: 'force-cache',
				signal: phaseController.signal
			});
			if (!response.ok) {
				throw new AssetNotFoundError(
					`${this.config.displayName} worker script failed to load: HTTP ${response.status}`,
					{ runtimeId: this.config.languageId }
				);
			}

			const declaredLength = Number(response.headers.get('content-length'));
			const total =
				Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : 0;
			if (total > limits.maxAssetBytes) {
				const error = new AssetTooLargeError(
					`${this.config.displayName} worker script exceeds ${limits.maxAssetBytes} bytes`,
					{
						actual: total,
						limit: limits.maxAssetBytes,
						runtimeId: this.config.languageId
					}
				);
				await response.body?.cancel(error).catch(() => undefined);
				throw error;
			}
			if (!response.body) {
				const bytes = await response.arrayBuffer();
				if (bytes.byteLength > limits.maxAssetBytes) {
					throw new AssetTooLargeError(
						`${this.config.displayName} worker script exceeds ${limits.maxAssetBytes} bytes`,
						{
							actual: bytes.byteLength,
							limit: limits.maxAssetBytes,
							runtimeId: this.config.languageId
						}
					);
				}
				this.reportProgress(progress, 0.2, `${this.config.displayName} worker downloaded`);
				return;
			}

			const reader = response.body.getReader();
			let loaded = 0;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				loaded += value.byteLength;
				if (loaded > limits.maxAssetBytes) {
					const error = new AssetTooLargeError(
						`${this.config.displayName} worker script exceeds ${limits.maxAssetBytes} bytes`,
						{
							actual: loaded,
							limit: limits.maxAssetBytes,
							runtimeId: this.config.languageId
						}
					);
					await reader.cancel(error).catch(() => undefined);
					throw error;
				}
				const ratio = total > 0 ? Math.min(loaded / total, 1) : 0.5;
				this.reportProgress(
					progress,
					0.05 + ratio * 0.15,
					`Loading ${this.config.displayName} worker script`
				);
			}
			this.reportProgress(progress, 0.2, `${this.config.displayName} worker downloaded`);
		} catch (error) {
			if (isWasmIdleError(error)) throw error;
			if (timedOut) {
				throw new TimeoutError(
					`${this.config.displayName} worker download timed out after ${limits.assetTimeoutMs} ms`,
					{
						phase: 'asset',
						runtimeId: this.config.languageId,
						timeoutMs: limits.assetTimeoutMs
					}
				);
			}
			if (signal?.aborted) {
				throw new CancelledError(`${this.config.displayName} worker download cancelled`, {
					cause: signal.reason,
					phase: 'asset',
					runtimeId: this.config.languageId
				});
			}
			throw new Error(
				`${this.config.displayName} worker script failed to load: ${this.errorMessage(error)}`
			);
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener('abort', onAbort);
		}
	}

	private createBootstrapUrl() {
		if (
			typeof Blob !== 'function' ||
			typeof URL?.createObjectURL !== 'function' ||
			typeof URL?.revokeObjectURL !== 'function'
		) {
			throw new Error(`${this.config.displayName} worker bootstrap is unavailable.`);
		}
		const importStatement = this.config.moduleWorker
			? `await import(${JSON.stringify(this.workerUrl)});`
			: `importScripts(${JSON.stringify(this.workerUrl)});`;
		const source = `const __wasmIdleNativePostMessage = self.postMessage.bind(self);
let __wasmIdleRunId = null;
const __wasmIdleExecutionKeys = ['output', 'results', 'error', 'diagnostic', 'progress'];
self.addEventListener('message', (event) => {
  const runId = event.data?.runId;
  if (typeof runId === 'string') __wasmIdleRunId = runId;
}, { capture: true });
self.postMessage = (message, transferOrOptions) => {
  const executionMessage = __wasmIdleRunId !== null &&
    message !== null && typeof message === 'object' &&
    __wasmIdleExecutionKeys.some((key) => Object.prototype.hasOwnProperty.call(message, key));
  const correlated = executionMessage
    ? Object.assign({}, message, { runId: __wasmIdleRunId })
    : message;
  return transferOrOptions === undefined
    ? __wasmIdleNativePostMessage(correlated)
    : __wasmIdleNativePostMessage(correlated, transferOrOptions);
};
${importStatement}
__wasmIdleNativePostMessage({ ${JSON.stringify(WORKER_READY_MESSAGE)}: true });
`;
		return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	}

	private revokeBootstrapUrl() {
		if (!this.bootstrapUrl) return;
		URL.revokeObjectURL(this.bootstrapUrl);
		this.bootstrapUrl = '';
	}

	private ensureWorkerStarted(
		progress: SandboxProgress | undefined,
		controls: StaticWorkerExecutionControls
	) {
		if (this.workerStartPromise) return this.workerStartPromise;
		const generation = ++this.workerGeneration;
		const startPromise = this.startWorker(generation, progress, controls);
		this.workerStartPromise = startPromise;
		void startPromise.catch(() => {
			if (this.workerStartPromise === startPromise) this.disposeWorker();
		});
		return startPromise;
	}

	private async startWorker(
		generation: number,
		progress: SandboxProgress | undefined,
		controls: StaticWorkerExecutionControls
	) {
		await this.preloadWorkerScript(progress, controls);
		if (generation !== this.workerGeneration) {
			throw new Error('Process terminated');
		}

		this.reportProgress(progress, 0.22, `Starting ${this.config.displayName} worker`);
		this.bootstrapUrl = this.createBootstrapUrl();
		let worker: Worker;
		try {
			worker = this.config.moduleWorker
				? new Worker(this.bootstrapUrl, { type: 'module' })
				: new Worker(this.bootstrapUrl);
		} catch (error) {
			this.revokeBootstrapUrl();
			throw new Error(
				`${this.config.displayName} worker failed to start: ${this.errorMessage(error)}`
			);
		}
		if (generation !== this.workerGeneration) {
			worker.terminate();
			this.revokeBootstrapUrl();
			throw new Error('Process terminated');
		}

		return await new Promise<Worker>((resolve, reject) => {
			let settled = false;
			const cleanup = () => {
				clearTimeout(timeout);
				controls.signal?.removeEventListener('abort', onAbort);
			};
			const rejectStartup = (reason: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (this.startupReject === rejectStartup) this.startupReject = null;
				reject(reason);
			};
			const onAbort = () => {
				rejectStartup(
					new CancelledError(`${this.config.displayName} worker startup cancelled`, {
						cause: controls.signal?.reason,
						phase: 'startup',
						runtimeId: this.config.languageId
					})
				);
				if (generation === this.workerGeneration && this.worker === worker) {
					this.disposeWorker();
				}
			};
			const timeout = setTimeout(() => {
				rejectStartup(
					new TimeoutError(
						`${this.config.displayName} worker startup timed out after ${controls.limits.startupTimeoutMs} ms`,
						{
							phase: 'startup',
							runtimeId: this.config.languageId,
							timeoutMs: controls.limits.startupTimeoutMs
						}
					)
				);
				if (generation === this.workerGeneration && this.worker === worker) {
					this.disposeWorker();
				}
			}, controls.limits.startupTimeoutMs);

			this.worker = worker;
			this.startupReject = rejectStartup;
			worker.onmessage = (event: MessageEvent<StaticWorkerMessage>) => {
				if (event.data?.__wasmIdleStaticWorkerReady) {
					if (settled) return;
					settled = true;
					cleanup();
					this.startupReject = null;
					this.revokeBootstrapUrl();
					this.reportProgress(progress, 0.25, `${this.config.displayName} worker ready`);
					resolve(worker);
					return;
				}
				this.handleWorkerMessage(event);
			};
			worker.onerror = (event: ErrorEvent) => {
				event.preventDefault?.();
				this.handleWorkerFailure(this.formatWorkerError(event));
			};
			worker.onmessageerror = () => {
				this.handleWorkerFailure(
					`${this.config.displayName} worker message deserialization failed`
				);
			};
			controls.signal?.addEventListener('abort', onAbort, { once: true });
			if (controls.signal?.aborted) onAbort();
		});
	}

	private handleWorkerMessage(event: MessageEvent<StaticWorkerMessage>) {
		const activeRun = this.activeRun;
		if (!activeRun) return;
		if (event.data?.runId !== activeRun.id) return;
		const { output, results, error, diagnostic, progress } = event.data || {};
		if (progress && typeof progress.percent === 'number') {
			const runtimeProgress = Math.max(0, Math.min(progress.percent / 100, 1));
			this.reportProgress(
				activeRun.progress,
				0.3 + runtimeProgress * 0.65,
				progress.stage || `Running ${this.config.displayName}`
			);
		}
		if (typeof output === 'string' && output.length > 0) {
			const outputBytes = activeRun.outputBytes + outputEncoder.encode(output).byteLength;
			if (outputBytes > activeRun.limits.maxOutputBytes) {
				this.rejectRun(
					activeRun.id,
					new OutputLimitError(
						`${this.config.displayName} output exceeded ${activeRun.limits.maxOutputBytes} bytes`,
						{
							actual: outputBytes,
							limit: activeRun.limits.maxOutputBytes,
							phase: 'execute',
							runtimeId: this.config.languageId
						}
					)
				);
				return;
			}
			activeRun.outputBytes = outputBytes;
			this.output?.(output);
		}
		if (diagnostic) {
			const diagnosticCount = activeRun.diagnosticCount + 1;
			if (diagnosticCount > activeRun.limits.maxDiagnostics) {
				this.rejectRun(
					activeRun.id,
					new DiagnosticLimitError(
						`${this.config.displayName} diagnostics exceeded ${activeRun.limits.maxDiagnostics} messages`,
						{
							actual: diagnosticCount,
							limit: activeRun.limits.maxDiagnostics,
							phase: 'execute',
							runtimeId: this.config.languageId
						}
					)
				);
				return;
			}
			activeRun.diagnosticCount = diagnosticCount;
			this.oncompilerdiagnostic?.(diagnostic);
		}
		if (typeof error === 'string') {
			this.rejectRun(activeRun.id, error);
			return;
		}
		if (results !== undefined) {
			this.resolveRun(activeRun.id, typeof results === 'string' ? results : results);
		}
	}

	private formatWorkerError(event: ErrorEvent) {
		const location =
			event.filename && event.lineno
				? ` (${event.filename}:${event.lineno}:${event.colno})`
				: '';
		return `${this.config.displayName} worker script error: ${
			event.message || 'unknown error'
		}${location}`;
	}

	private errorMessage(error: unknown) {
		return error instanceof Error ? error.message : String(error);
	}

	private handleWorkerFailure(reason: string) {
		this.startupReject?.(new Error(reason));
		this.startupReject = null;
		if (this.activeRun) this.rejectRun(this.activeRun.id, reason);
		else this.disposeWorker();
	}

	private resolveRun(id: string, result: boolean | string) {
		const activeRun = this.activeRun;
		if (!activeRun || activeRun.id !== id) return;
		activeRun.cleanup();
		this.elapse = Date.now() - this.begin;
		this.exit = true;
		this.activeRun = null;
		this.activeReject = null;
		this.clearPendingStdin();
		this.reportProgress(activeRun.progress, 1, `${this.config.displayName} run complete`);
		this.disposeWorker();
		activeRun.resolve(result);
	}

	private rejectRun(id: string, reason: unknown) {
		const activeRun = this.activeRun;
		if (!activeRun || activeRun.id !== id) return;
		activeRun.cleanup();
		this.elapse = Date.now() - this.begin;
		this.exit = true;
		this.activeRun = null;
		this.activeReject = null;
		this.clearPendingStdin();
		this.disposeWorker();
		activeRun.reject(reason);
	}

	private disposeWorker() {
		this.revokeBootstrapUrl();
		this.workerGeneration += 1;
		this.workerStartPromise = null;
		this.startupReject = null;
		if (this.worker) {
			this.worker.onmessage = null;
			this.worker.onerror = null;
			this.worker.onmessageerror = null;
			this.worker.terminate();
		}
		delete this.worker;
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (!this.baseUrl || !this.workerUrl) {
			return Promise.reject(`${this.config.displayName} runtime is not configured.`);
		}
		if (this.activeRun) {
			return Promise.reject(
				new BusyError(`${this.config.displayName} runtime already has an active run`, {
					runtimeId: this.config.languageId
				})
			);
		}
		let controls: StaticWorkerExecutionControls;
		try {
			controls = this.resolveExecutionControls(options);
		} catch (error) {
			return Promise.reject(error);
		}
		if (controls.signal?.aborted) {
			return Promise.reject(
				new CancelledError(`${this.config.displayName} run cancelled`, {
					cause: controls.signal.reason,
					phase: 'execute',
					runtimeId: this.config.languageId
				})
			);
		}
		const progressSink = this.selectProgress(_prog);
		const lifecycle = this.beginProgressLifecycle(
			progressSink,
			prepare
				? `Preparing ${this.config.displayName} runtime`
				: `Starting ${this.config.displayName} run`
		);
		const progress = lifecycle.progress;

		if (prepare) {
			return this.ensureWorkerStarted(progress, controls)
				.then(() => {
					this.reportProgress(progress, 0.25, `${this.config.displayName} worker ready`);
					return true;
				})
				.finally(() => lifecycle.end());
		}

		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const id = `static-${++this.uid}`;
			let deadline: ReturnType<typeof setTimeout> | undefined;
			const onAbort = () => {
				const error = new CancelledError(`${this.config.displayName} run cancelled`, {
					cause: controls.signal?.reason,
					phase: 'execute',
					runtimeId: this.config.languageId
				});
				this.rejectStdinWaiters(error);
				this.rejectRun(id, error);
			};
			const cleanup = () => {
				if (deadline !== undefined) clearTimeout(deadline);
				controls.signal?.removeEventListener('abort', onAbort);
			};
			this.activeRun = {
				cleanup,
				diagnosticCount: 0,
				id,
				limits: controls.limits,
				outputBytes: 0,
				progress,
				resolve,
				reject
			};
			this.activeReject = reject;
			this.begin = Date.now();
			controls.signal?.addEventListener('abort', onAbort, { once: true });
			if (controls.signal?.aborted) {
				onAbort();
				return;
			}

			void (async () => {
				try {
					const worker = await this.ensureWorkerStarted(progress, controls);
					const { stdin, stdinEof } = await this.collectStdinForRun(code, options);
					if (this.activeRun?.id !== id) return;
					const executionTimeoutMs = Math.min(
						2_147_483_647,
						controls.limits.compileTimeoutMs + controls.limits.runTimeoutMs
					);
					deadline = setTimeout(() => {
						this.rejectRun(
							id,
							new TimeoutError(
								`${this.config.displayName} execution timed out after ${executionTimeoutMs} ms`,
								{
									phase: 'execute',
									runtimeId: this.config.languageId,
									timeoutMs: executionTimeoutMs
								}
							)
						);
					}, executionTimeoutMs);
					const { programArgs } = resolveSandboxExecutionArgs(
						this.config.languageId,
						args,
						options
					);
					this.reportProgress(
						progress,
						0.3,
						`Loading ${this.config.displayName} runtime`
					);
					worker.postMessage({
						run: true,
						runId: id,
						baseUrl: this.baseUrl,
						manifestUrl: this.manifestUrl,
						code,
						args: programArgs,
						stdin,
						stdinEof,
						activePath: options.activePath || this.config.defaultActivePath,
						workspaceFiles: options.workspaceFiles || [],
						log: _log
					});
				} catch (error) {
					this.rejectRun(id, isWasmIdleError(error) ? error : this.errorMessage(error));
				}
			})();
		}).finally(() => lifecycle.end());
	}

	kill() {
		this.terminate();
	}

	terminate() {
		const reason = 'Process terminated';
		this.progressController.invalidate();
		this.uid += 1;
		this.startupReject?.(new Error(reason));
		this.startupReject = null;
		this.rejectStdinWaiters(reason);
		if (this.activeRun) {
			const activeRun = this.activeRun;
			activeRun.cleanup();
			this.activeRun = null;
			this.activeReject = null;
			activeRun.reject(reason);
		}
		this.clearPendingStdin();
		this.disposeWorker();
		this.exit = true;
	}

	async clear() {
		this.terminate();
		this.lifecycleProgress = undefined;
	}
}
