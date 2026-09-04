import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	AssetNotFoundError,
	AssetTooLargeError,
	BusyError,
	CancelledError,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	ProtocolError,
	RuntimeConfigurationError,
	RuntimeExecutionError,
	RuntimeProgressController,
	RuntimeWorkerLifetimeController,
	TimeoutError,
	WorkerStartupError,
	isWasmIdleError,
	resolveExecutionLimits,
	validateExecutionWorkspace,
	verifyRuntimeAssetIntegrity,
	type ExecutionLimits,
	type RuntimeAssetIntegrityEntry,
	type RuntimeStdinMode,
	type RuntimeWorkerLease,
	type RuntimeWorkerLifetimePolicy
} from '@wasm-idle/core';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { StaticStdinRingHost } from '$lib/playground/staticStdinRing';
import { inspectStaticRuntimePreflightBytes } from '$lib/playground/staticRuntimePreflightProtocol';
import { reportWorkerProgress, type WorkerProgressPayload } from '$lib/playground/workerProgress';

type StaticWorkerReceipt = Readonly<Required<Pick<RuntimeAssetIntegrityEntry, 'bytes' | 'sha256'>>>;

export interface StaticWorkerRuntimeUrls {
	baseUrl: string;
	workerUrl: string;
	manifestUrl?: string;
	manifestFingerprint?: string;
	preflightKey?: string;
	preflightProfile?: unknown;
	workerReceipt?: StaticWorkerReceipt;
}

export interface StaticWorkerRuntimePreflightContext {
	readonly limits: ExecutionLimits;
	readonly signal?: AbortSignal;
	readonly reportProgress: (value: number, stage?: string) => void;
	/**
	 * Relinquishes a verified payload to this one worker-start operation.
	 *
	 * The frozen payload must be a plain object whose binary fields are non-empty Uint8Arrays
	 * spanning distinct, exclusively owned ArrayBuffers. Every top-level Uint8Array is adopted;
	 * callers cannot select or omit transferables. The returned ticket is opaque, operation-bound,
	 * and may be returned only from this preflight callback.
	 */
	readonly createOwnedDelivery: (payload: unknown) => StaticWorkerRuntimeOwnedDelivery;
}

declare const staticWorkerRuntimeOwnedDeliveryBrand: unique symbol;

export interface StaticWorkerRuntimeOwnedDelivery {
	readonly [staticWorkerRuntimeOwnedDeliveryBrand]: true;
}

export type StaticWorkerRuntimeStdin =
	| {
			readonly mode: 'none';
	  }
	| {
			readonly mode: 'prebuffered';
			readonly sourceHintPattern: RegExp;
	  }
	| {
			readonly mode: 'streaming';
			readonly sourceHintPattern: RegExp;
	  };

export interface StaticWorkerRuntimeConfig {
	languageId: string;
	displayName: string;
	defaultActivePath: string;
	inlineVerifiedWorker?: boolean;
	requireExactWorkerResponseUrl?: boolean;
	moduleWorker?: boolean;
	stdin: StaticWorkerRuntimeStdin;
	workerLifetime?: RuntimeWorkerLifetimePolicy;
	resolveRuntimeAssets: (
		runtimeAssets: string | PlaygroundRuntimeAssets,
		currentUrl: string
	) => StaticWorkerRuntimeUrls;
	preflightRuntimeAssets?: (
		urls: StaticWorkerRuntimeUrls,
		context: StaticWorkerRuntimePreflightContext
	) => unknown | Promise<unknown>;
	runtimePreflightDelivery?:
		| 'structured-clone'
		| 'transfer-owned'
		| 'transfer-owned-worker-cache';
}

type OwnedDeliveryOperation = {
	active: boolean;
	claimedTicket: StaticWorkerRuntimeOwnedDelivery | null;
	generation: number;
	owner: StaticWorkerRuntimeSandbox;
	preflightKey: string;
	runtimeId: string;
};

type OwnedDeliveryState = {
	operation: OwnedDeliveryOperation;
	payload: Readonly<Record<string, unknown>> | null;
	status: 'available' | 'consumed' | 'retired';
	transferables: ArrayBuffer[] | null;
};

const ownedDeliveryStateByTicket = new WeakMap<
	StaticWorkerRuntimeOwnedDelivery,
	OwnedDeliveryState
>();

type StaticWorkerMessage = {
	__wasmIdleStaticWorkerReady?: boolean;
	type?: 'execution-ready' | 'stdin-request';
	runId?: string;
	output?: string;
	stream?: 'stdout' | 'stderr';
	results?: boolean | string;
	error?: string;
	diagnostic?: CompilerDiagnostic;
	progress?: WorkerProgressPayload;
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
	readyReported: boolean;
	resolve: (result: boolean | string) => void;
	reject: (reason: unknown) => void;
	settledReported: boolean;
	stdinRing?: StaticStdinRingHost;
};

type StaticWorkerExecutionControls = {
	limits: ExecutionLimits;
	signal?: AbortSignal;
};

type StaticWorkerCreationContext = {
	controls: StaticWorkerExecutionControls;
	generation: number;
	progress?: SandboxProgress;
};

type StdinWaiter = {
	reject: (reason: unknown) => void;
	resolve: () => void;
};

const WORKER_READY_MESSAGE = '__wasmIdleStaticWorkerReady';
const outputEncoder = new TextEncoder();

function cancelWorkerScriptResponse(response: Response, reason?: unknown) {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the boundary failure that caused cancellation.
	}
}

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
	manifestFingerprint = '';
	preflightKey = '';
	workerReceipt: StaticWorkerReceipt | null = null;
	activeReject: ((reason: unknown) => void) | null = null;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	pendingEof = false;
	stdinWaiters: StdinWaiter[] = [];

	private activeRun: ActiveRun | null = null;
	private bootstrapUrl = '';
	private disposed = false;
	private disposePromise: Promise<void> | null = null;
	private disposeReason: CancelledError | null = null;
	private lifecycleProgress?: SandboxProgress;
	private readonly progressController = new RuntimeProgressController();
	private progressUid = 0;
	private startingRunId: string | null = null;
	private startupReject: ((reason: unknown) => void) | null = null;
	private workerLease: RuntimeWorkerLease<Worker> | null = null;
	private readonly workerLifetimeController: RuntimeWorkerLifetimeController<
		Worker,
		StaticWorkerCreationContext
	>;
	private workerStartAbortController: AbortController | null = null;
	private workerGeneration = 0;
	private workerStartPromise: Promise<Worker> | null = null;
	private resolvedRuntimeUrls: StaticWorkerRuntimeUrls | null = null;
	private readonly workerRuntimePreflight = new WeakMap<Worker, unknown>();
	private readonly workerRuntimePreflightMaxAssetBytes = new WeakMap<Worker, number>();
	private readonly workersWithCachedRuntimePreflight = new WeakSet<Worker>();
	private workerStartMaxAssetBytes: number | null = null;

	constructor(private readonly config: StaticWorkerRuntimeConfig) {
		const workerLifetime = config.workerLifetime ?? { mode: 'per-run' as const };
		if (this.usesOwnedRuntimePreflight() && !config.preflightRuntimeAssets) {
			throw new RuntimeConfigurationError(
				`${config.displayName} transfer-owned runtime preflight requires a runtime preflight callback.`,
				{ phase: 'startup', runtimeId: config.languageId }
			);
		}
		if (
			config.runtimePreflightDelivery === 'transfer-owned' &&
			workerLifetime.mode !== 'per-run'
		) {
			throw new RuntimeConfigurationError(
				`${config.displayName} transfer-owned runtime preflight requires per-run workers.`,
				{ phase: 'startup', runtimeId: config.languageId }
			);
		}
		if (
			config.runtimePreflightDelivery === 'transfer-owned-worker-cache' &&
			workerLifetime.mode !== 'persistent'
		) {
			throw new RuntimeConfigurationError(
				`${config.displayName} transfer-owned worker-cache preflight requires persistent workers.`,
				{ phase: 'startup', runtimeId: config.languageId }
			);
		}
		this.workerLifetimeController = new RuntimeWorkerLifetimeController<
			Worker,
			StaticWorkerCreationContext
		>({
			policy: workerLifetime,
			runtimeId: config.languageId,
			createWorker: (context) => {
				context.generation = ++this.workerGeneration;
				return this.startWorker(context.generation, context.progress, context.controls);
			},
			disposeWorker: (worker) => this.retireManagedWorker(worker)
		});
	}

	private usesOwnedRuntimePreflight() {
		return (
			this.config.runtimePreflightDelivery === 'transfer-owned' ||
			this.config.runtimePreflightDelivery === 'transfer-owned-worker-cache'
		);
	}

	private usesWorkerCachedRuntimePreflight() {
		return this.config.runtimePreflightDelivery === 'transfer-owned-worker-cache';
	}

	private resetWorkerForLowerAssetLimit(maxAssetBytes: number) {
		if (!this.usesOwnedRuntimePreflight()) return;
		const currentLimit = this.worker
			? this.workerRuntimePreflightMaxAssetBytes.get(this.worker)
			: this.workerStartPromise
				? (this.workerStartMaxAssetBytes ?? undefined)
				: undefined;
		if (currentLimit !== undefined && maxAssetBytes < currentLimit) {
			this.disposeWorker(
				new CancelledError(
					`${this.config.displayName} worker reset for a lower runtime asset limit`,
					{ phase: 'asset', runtimeId: this.config.languageId }
				)
			);
		}
	}

	private getDisposeReason() {
		if (!this.disposeReason) {
			this.disposeReason = new CancelledError(
				`${this.config.displayName} runtime was disposed`,
				{
					phase: 'dispose',
					runtimeId: this.config.languageId
				}
			);
		}
		return this.disposeReason;
	}

	private assertNotDisposed() {
		if (!this.disposed) return;
		throw new RuntimeConfigurationError(`${this.config.displayName} runtime is disposed`, {
			phase: 'dispose',
			runtimeId: this.config.languageId
		});
	}

	private assertOperationNotDisposed() {
		if (this.disposed) throw this.getDisposeReason();
	}

	private preserveDisposeReason(error: unknown) {
		return this.disposed ? this.getDisposeReason() : error;
	}

	get stdinMode(): RuntimeStdinMode {
		if (this.config.stdin.mode !== 'streaming') return this.config.stdin.mode;
		const isolated = globalThis.crossOriginIsolated;
		return typeof SharedArrayBuffer === 'function' &&
			typeof Atomics === 'object' &&
			typeof Atomics.notify === 'function' &&
			(typeof isolated !== 'boolean' || isolated)
			? 'streaming'
			: 'prebuffered';
	}

	async load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		this.assertNotDisposed();
		try {
			const controls = this.resolveExecutionControls(options);
			this.assertOperationNotDisposed();
			if (controls.signal?.aborted) {
				throw new CancelledError(`${this.config.displayName} startup cancelled`, {
					cause: controls.signal.reason,
					phase: 'startup',
					runtimeId: this.config.languageId
				});
			}
			this.validateWorkspace(code, options, controls.limits);
			this.assertOperationNotDisposed();
			const progressSink = this.selectProgress(progress);
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const urls = this.config.resolveRuntimeAssets(runtimeAssets, currentUrl);
			this.assertOperationNotDisposed();
			const nextManifestUrl = urls.manifestUrl || '';
			const nextManifestFingerprint = urls.manifestFingerprint || '';
			const nextPreflightKey = urls.preflightKey || '';
			const nextWorkerReceipt = urls.workerReceipt
				? Object.freeze({
						bytes: urls.workerReceipt.bytes,
						sha256: urls.workerReceipt.sha256
					})
				: null;
			if (
				this.config.inlineVerifiedWorker &&
				(!nextWorkerReceipt ||
					!Number.isSafeInteger(nextWorkerReceipt.bytes) ||
					nextWorkerReceipt.bytes <= 0 ||
					!/^[a-f0-9]{64}$/u.test(nextWorkerReceipt.sha256))
			) {
				throw new RuntimeConfigurationError(
					`${this.config.displayName} requires a pinned worker receipt.`,
					{ runtimeId: this.config.languageId }
				);
			}
			const runtimeChanged =
				this.baseUrl !== urls.baseUrl ||
				this.workerUrl !== urls.workerUrl ||
				this.manifestUrl !== nextManifestUrl ||
				this.manifestFingerprint !== nextManifestFingerprint ||
				this.preflightKey !== nextPreflightKey ||
				this.workerReceipt?.bytes !== nextWorkerReceipt?.bytes ||
				this.workerReceipt?.sha256 !== nextWorkerReceipt?.sha256;

			if (
				runtimeChanged &&
				(this.worker ||
					this.workerStartPromise ||
					this.activeRun ||
					this.startingRunId ||
					this.workerLifetimeController.totalWorkers > 0)
			) {
				this.terminate();
			}
			this.baseUrl = urls.baseUrl;
			this.workerUrl = urls.workerUrl;
			this.manifestUrl = nextManifestUrl;
			this.manifestFingerprint = nextManifestFingerprint;
			this.preflightKey = nextPreflightKey;
			this.resolvedRuntimeUrls = urls;
			this.workerReceipt = nextWorkerReceipt;
			this.resetWorkerForLowerAssetLimit(controls.limits.maxAssetBytes);

			if (!this.baseUrl || !this.workerUrl) {
				throw new RuntimeConfigurationError(
					`${this.config.displayName} runtime is not configured.`,
					{ runtimeId: this.config.languageId }
				);
			}
			if (
				!runtimeChanged &&
				(this.workerStartPromise || this.workerLifetimeController.idleWorkers > 0)
			) {
				await this.workerStartPromise;
				this.assertOperationNotDisposed();
				return;
			}

			const lifecycle = this.beginProgressLifecycle(
				progressSink,
				`Resolving ${this.config.displayName} runtime`
			);
			try {
				this.assertOperationNotDisposed();
				this.reportProgress(
					lifecycle.progress,
					0.02,
					`Resolving ${this.config.displayName} runtime`
				);
				this.assertOperationNotDisposed();
				await this.ensureWorkerStarted(lifecycle.progress, controls);
				this.assertOperationNotDisposed();
				this.releasePreparedWorkerIfIdle();
			} finally {
				lifecycle.end();
			}
		} catch (error) {
			throw this.preserveDisposeReason(error);
		}
	}

	write(input: string) {
		if (this.disposed) return;
		const activeRun = this.activeRun;
		if (activeRun?.stdinRing) {
			try {
				activeRun.stdinRing.enqueue(input);
			} catch (error) {
				this.rejectRun(activeRun.id, error);
			}
			return;
		}
		this.pendingInput.push(input);
	}

	eof() {
		if (this.disposed) return;
		const activeRun = this.activeRun;
		if (activeRun?.stdinRing) {
			try {
				activeRun.stdinRing.close();
			} catch (error) {
				this.rejectRun(activeRun.id, error);
			}
			return;
		}
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

	private sourceMayReadStdin(code: string) {
		if (this.config.stdin.mode === 'none') return false;
		const pattern = this.config.stdin.sourceHintPattern;
		pattern.lastIndex = 0;
		return pattern.test(code);
	}

	private async collectStdinForRun(
		code: string,
		options: SandboxExecutionOptions,
		activeRun: ActiveRun
	): Promise<BufferedStdin> {
		if (this.stdinMode === 'none') {
			this.clearPendingStdin();
			return { stdin: undefined, stdinEof: false };
		}
		if (typeof options.stdin === 'string') {
			this.clearPendingStdin();
			return { stdin: options.stdin, stdinEof: true };
		}
		if (!this.sourceMayReadStdin(code) && this.pendingInput.length === 0 && !this.pendingEof) {
			return { stdin: undefined, stdinEof: false };
		}

		if (!this.pendingEof) {
			this.reportRunReady(
				activeRun,
				'waiting-input',
				'stdin-request',
				`${this.config.displayName} runtime ready for input`
			);
			if (this.activeRun !== activeRun) {
				throw new CancelledError(`${this.config.displayName} run terminated`, {
					phase: 'execute',
					runtimeId: this.config.languageId
				});
			}
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

	private validateWorkspace(
		code: string,
		options: SandboxExecutionOptions,
		limits: ExecutionLimits
	) {
		const workspaceLimits = {
			...options.workspaceLimits,
			maxFileBytes: Math.min(
				options.workspaceLimits?.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
				limits.maxWorkspaceBytes
			),
			maxTotalBytes: Math.min(
				options.workspaceLimits?.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
				limits.maxWorkspaceBytes
			)
		};
		return validateExecutionWorkspace(
			code,
			options.workspaceFiles ?? [],
			options.activePath ?? this.config.defaultActivePath,
			workspaceLimits
		);
	}

	private reportProgress(progress: SandboxProgress | undefined, value: number, stage?: string) {
		if (!progress) return;
		const clamped = Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0;
		progress.set?.(clamped, stage);
	}

	private reportRunReady(
		activeRun: ActiveRun,
		state: 'running' | 'waiting-input',
		reason: 'started' | 'stdout' | 'stderr' | 'stdin-request' | 'result',
		label: string
	) {
		if (activeRun.readyReported || activeRun.settledReported) return;
		reportWorkerProgress(activeRun.progress, { kind: 'ready', state, reason, label });
		activeRun.readyReported = true;
	}

	private reportRunSettled(
		activeRun: ActiveRun,
		outcome: 'completed' | 'failed' | 'cancelled' | 'timed-out',
		label: string
	) {
		if (activeRun.settledReported) return;
		activeRun.settledReported = true;
		reportWorkerProgress(activeRun.progress, { kind: 'settled', outcome, label });
	}

	private async verifyWorkerReceipt(
		bytes: Uint8Array,
		receipt: StaticWorkerReceipt,
		signal: AbortSignal
	) {
		const abortReason = () =>
			signal.reason ?? new DOMException('Worker script verification aborted', 'AbortError');
		let onAbort: (() => void) | undefined;
		const aborted = new Promise<never>((_resolve, reject) => {
			onAbort = () => reject(abortReason());
			signal.addEventListener('abort', onAbort, { once: true });
		});
		try {
			if (signal.aborted) throw abortReason();
			await Promise.race([
				verifyRuntimeAssetIntegrity({
					asset: this.workerUrl,
					bytes,
					expected: receipt,
					runtimeId: this.config.languageId
				}),
				aborted
			]);
			if (signal.aborted) throw abortReason();
		} finally {
			if (onAbort) signal.removeEventListener('abort', onAbort);
		}
	}

	private async preloadWorkerScript(
		progress: SandboxProgress | undefined,
		controls: StaticWorkerExecutionControls
	): Promise<Uint8Array<ArrayBuffer> | undefined> {
		const { limits, signal } = controls;
		const workerReceipt = this.config.inlineVerifiedWorker ? this.workerReceipt : null;
		const workerByteLimit = workerReceipt?.bytes ?? limits.maxAssetBytes;
		if (workerReceipt && workerReceipt.bytes > limits.maxAssetBytes) {
			throw new AssetTooLargeError(
				`${this.config.displayName} worker script exceeds ${limits.maxAssetBytes} bytes`,
				{
					actual: workerReceipt.bytes,
					limit: limits.maxAssetBytes,
					runtimeId: this.config.languageId
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
		let workerRequestUrl: URL;
		try {
			workerRequestUrl =
				typeof window === 'undefined'
					? new URL(this.workerUrl)
					: new URL(this.workerUrl, window.location.href);
		} catch {
			throw new RuntimeConfigurationError(
				`${this.config.displayName} worker script URL is invalid`,
				{ runtimeId: this.config.languageId }
			);
		}
		if (workerRequestUrl.protocol !== 'https:' && workerRequestUrl.protocol !== 'http:') {
			throw new RuntimeConfigurationError(
				`${this.config.displayName} worker script URL must use HTTP(S)`,
				{ runtimeId: this.config.languageId }
			);
		}
		if (workerRequestUrl.username || workerRequestUrl.password) {
			throw new RuntimeConfigurationError(
				`${this.config.displayName} worker script URL must not include credentials`,
				{ runtimeId: this.config.languageId }
			);
		}
		if (workerRequestUrl.hash) {
			throw new RuntimeConfigurationError(
				`${this.config.displayName} worker script URL must not include a fragment`,
				{ runtimeId: this.config.languageId }
			);
		}
		const phaseController = new AbortController();
		let timedOut = false;
		const onAbort = () => phaseController.abort(signal?.reason);
		signal?.addEventListener('abort', onAbort, { once: true });
		const timeout = setTimeout(() => {
			timedOut = true;
			phaseController.abort();
		}, limits.assetTimeoutMs);
		try {
			this.reportProgress(progress, 0.05, `Loading ${this.config.displayName} worker script`);
			if (phaseController.signal.aborted) {
				throw (
					phaseController.signal.reason ??
					new DOMException('Worker script fetch aborted', 'AbortError')
				);
			}
			const pendingResponse = Promise.resolve(
				fetch(workerRequestUrl.href, {
					cache: this.config.inlineVerifiedWorker ? 'no-store' : 'force-cache',
					credentials: 'omit',
					redirect: 'error',
					referrerPolicy: 'no-referrer',
					signal: phaseController.signal
				})
			);
			const response = await new Promise<Response>((resolve, reject) => {
				let settled = false;
				const onPhaseAbort = () => {
					if (settled) return;
					settled = true;
					phaseController.signal.removeEventListener('abort', onPhaseAbort);
					reject(
						phaseController.signal.reason ??
							new DOMException('Worker script fetch aborted', 'AbortError')
					);
				};
				phaseController.signal.addEventListener('abort', onPhaseAbort, { once: true });
				void pendingResponse.then(
					(candidate) => {
						if (settled) {
							const reason =
								phaseController.signal.reason ??
								new DOMException('Worker script fetch aborted', 'AbortError');
							cancelWorkerScriptResponse(candidate, reason);
							return;
						}
						settled = true;
						phaseController.signal.removeEventListener('abort', onPhaseAbort);
						resolve(candidate);
					},
					(error) => {
						if (settled) return;
						settled = true;
						phaseController.signal.removeEventListener('abort', onPhaseAbort);
						reject(error);
					}
				);
				if (phaseController.signal.aborted) onPhaseAbort();
			});
			if (!response.url && this.config.requireExactWorkerResponseUrl) {
				const error = new ProtocolError(
					`${this.config.displayName} worker script response did not expose an exact final URL`,
					{ phase: 'asset', runtimeId: this.config.languageId }
				);
				cancelWorkerScriptResponse(response, error);
				throw error;
			}
			if (response.url) {
				let finalResponseUrl: string;
				try {
					finalResponseUrl = new URL(response.url).href;
				} catch {
					const error = new ProtocolError(
						`${this.config.displayName} worker script returned an invalid final URL: ${response.url}`,
						{ phase: 'asset', runtimeId: this.config.languageId }
					);
					cancelWorkerScriptResponse(response, error);
					throw error;
				}
				if (finalResponseUrl !== workerRequestUrl.href) {
					const error = new ProtocolError(
						`${this.config.displayName} worker script response URL mismatch: expected ${workerRequestUrl.href}, received ${finalResponseUrl}`,
						{ phase: 'asset', runtimeId: this.config.languageId }
					);
					cancelWorkerScriptResponse(response, error);
					throw error;
				}
			}
			if (!response.ok) {
				const error = new AssetNotFoundError(
					`${this.config.displayName} worker script failed to load: HTTP ${response.status}`,
					{ runtimeId: this.config.languageId }
				);
				cancelWorkerScriptResponse(response, error);
				throw error;
			}

			const rawContentLength = response.headers.get('content-length');
			let total = 0;
			if (rawContentLength !== null) {
				const normalizedContentLength = rawContentLength.trim();
				const declaredLength = Number(normalizedContentLength);
				if (
					!/^\d+$/u.test(normalizedContentLength) ||
					!Number.isSafeInteger(declaredLength)
				) {
					const error = new ProtocolError(
						`${this.config.displayName} worker script has an invalid Content-Length: ${rawContentLength}`,
						{ phase: 'asset', runtimeId: this.config.languageId }
					);
					cancelWorkerScriptResponse(response, error);
					throw error;
				}
				total = declaredLength;
			}
			if (total > workerByteLimit) {
				const error = new AssetTooLargeError(
					`${this.config.displayName} worker script exceeds ${workerByteLimit} bytes`,
					{
						actual: total,
						limit: workerByteLimit,
						runtimeId: this.config.languageId
					}
				);
				cancelWorkerScriptResponse(response, error);
				throw error;
			}
			if (!response.body) {
				let cancelOnAbort: (() => void) | undefined;
				const aborted = new Promise<never>((_resolve, reject) => {
					cancelOnAbort = () =>
						reject(
							phaseController.signal.reason ??
								new DOMException('Worker script read aborted', 'AbortError')
						);
					phaseController.signal.addEventListener('abort', cancelOnAbort, {
						once: true
					});
				});
				try {
					if (phaseController.signal.aborted) {
						throw (
							phaseController.signal.reason ??
							new DOMException('Worker script read aborted', 'AbortError')
						);
					}
					const materialized = response.arrayBuffer();
					const buffer = await Promise.race([materialized, aborted]);
					if (phaseController.signal.aborted) {
						throw (
							phaseController.signal.reason ??
							new DOMException('Worker script read aborted', 'AbortError')
						);
					}
					if (buffer.byteLength > workerByteLimit) {
						throw new AssetTooLargeError(
							`${this.config.displayName} worker script exceeds ${workerByteLimit} bytes`,
							{
								actual: buffer.byteLength,
								limit: workerByteLimit,
								runtimeId: this.config.languageId
							}
						);
					}
					this.reportProgress(
						progress,
						0.2,
						`${this.config.displayName} worker downloaded`
					);
					const bytes = new Uint8Array(buffer);
					if (workerReceipt) {
						await this.verifyWorkerReceipt(
							bytes,
							workerReceipt,
							phaseController.signal
						);
						return bytes;
					}
					return undefined;
				} finally {
					if (cancelOnAbort) {
						phaseController.signal.removeEventListener('abort', cancelOnAbort);
					}
				}
			}

			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let readerCancelled = false;
			let cancelOnAbort: (() => void) | undefined;
			const aborted = new Promise<never>((_resolve, reject) => {
				cancelOnAbort = () => {
					const reason =
						phaseController.signal.reason ??
						new DOMException('Worker script read aborted', 'AbortError');
					if (!readerCancelled) {
						readerCancelled = true;
						try {
							void reader.cancel(reason).catch(() => undefined);
						} catch {}
					}
					reject(reason);
				};
				phaseController.signal.addEventListener('abort', cancelOnAbort, { once: true });
			});
			let loaded = 0;
			let releaseError: unknown;
			try {
				while (true) {
					if (phaseController.signal.aborted) {
						throw (
							phaseController.signal.reason ??
							new DOMException('Worker script read aborted', 'AbortError')
						);
					}
					const pendingRead = reader.read();
					const { done, value } = await Promise.race([pendingRead, aborted]);
					if (phaseController.signal.aborted) {
						throw (
							phaseController.signal.reason ??
							new DOMException('Worker script read aborted', 'AbortError')
						);
					}
					if (done) break;
					loaded += value.byteLength;
					if (loaded > workerByteLimit) {
						const error = new AssetTooLargeError(
							`${this.config.displayName} worker script exceeds ${workerByteLimit} bytes`,
							{
								actual: loaded,
								limit: workerByteLimit,
								runtimeId: this.config.languageId
							}
						);
						readerCancelled = true;
						try {
							void reader.cancel(error).catch(() => undefined);
						} catch {}
						throw error;
					}
					if (workerReceipt) chunks.push(value.slice());
					const ratio = total > 0 ? Math.min(loaded / total, 1) : 0.5;
					this.reportProgress(
						progress,
						0.05 + ratio * 0.15,
						`Loading ${this.config.displayName} worker script`
					);
				}
				this.reportProgress(progress, 0.2, `${this.config.displayName} worker downloaded`);
			} catch (error) {
				if (phaseController.signal.aborted) {
					const reason =
						phaseController.signal.reason ??
						new DOMException('Worker script read aborted', 'AbortError');
					if (!readerCancelled) {
						readerCancelled = true;
						try {
							void reader.cancel(reason).catch(() => undefined);
						} catch {}
					}
					throw reason;
				}
				if (!readerCancelled) {
					readerCancelled = true;
					try {
						void reader.cancel(error).catch(() => undefined);
					} catch {}
				}
				throw error;
			} finally {
				if (cancelOnAbort) {
					phaseController.signal.removeEventListener('abort', cancelOnAbort);
				}
				try {
					reader.releaseLock();
				} catch (error) {
					if (!phaseController.signal.aborted) releaseError = error;
				}
			}
			if (releaseError) throw releaseError;
			if (workerReceipt) {
				const bytes = new Uint8Array(loaded);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
				await this.verifyWorkerReceipt(bytes, workerReceipt, phaseController.signal);
				return bytes;
			}
			return undefined;
		} catch (error) {
			if (this.disposed) throw this.getDisposeReason();
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
			try {
				signal?.removeEventListener('abort', onAbort);
			} catch {
				// Caller-owned signal cleanup must not replace the download result.
			}
		}
	}

	private createBootstrapUrl(verifiedWorkerBytes?: Uint8Array<ArrayBuffer>) {
		if (
			typeof Blob !== 'function' ||
			typeof URL?.createObjectURL !== 'function' ||
			typeof URL?.revokeObjectURL !== 'function'
		) {
			throw new Error(`${this.config.displayName} worker bootstrap is unavailable.`);
		}
		let verifiedWorkerSource: Uint8Array<ArrayBuffer> | undefined;
		if (this.config.inlineVerifiedWorker) {
			if (!verifiedWorkerBytes) {
				throw new RuntimeConfigurationError(
					`${this.config.displayName} verified worker bytes are unavailable.`,
					{ runtimeId: this.config.languageId }
				);
			}
			try {
				new TextDecoder('utf-8', { fatal: true }).decode(verifiedWorkerBytes);
			} catch (error) {
				throw new ProtocolError(
					`${this.config.displayName} worker script is not valid UTF-8`,
					{
						cause: error,
						phase: 'asset',
						runtimeId: this.config.languageId
					}
				);
			}
			verifiedWorkerSource = verifiedWorkerBytes;
		}
		const prefix = `const __wasmIdleNativePostMessage = self.postMessage.bind(self);
let __wasmIdleRunId = null;
const __wasmIdleExecutionKeys = ['output', 'results', 'error', 'diagnostic', 'progress'];
self.addEventListener('message', (event) => {
  const message = event.data;
  const runId = message?.runId;
  if (message?.run !== true || typeof runId !== 'string') return;
  if (__wasmIdleRunId !== null) {
    event.stopImmediatePropagation();
    return;
  }
  __wasmIdleRunId = runId;
}, { capture: true });
self.postMessage = (message, transferOrOptions) => {
  const executionMessage = __wasmIdleRunId !== null &&
    message !== null && typeof message === 'object' &&
    (__wasmIdleExecutionKeys.some((key) => Object.prototype.hasOwnProperty.call(message, key)) ||
      message.type === 'stdin-request' || message.type === 'execution-ready');
  const correlated = executionMessage
    ? Object.assign({}, message, { runId: __wasmIdleRunId })
    : message;
  const terminalRunId = executionMessage &&
    (Object.prototype.hasOwnProperty.call(message, 'results') ||
      Object.prototype.hasOwnProperty.call(message, 'error'))
    ? __wasmIdleRunId
    : null;
  try {
    return transferOrOptions === undefined
      ? __wasmIdleNativePostMessage(correlated)
      : __wasmIdleNativePostMessage(correlated, transferOrOptions);
  } finally {
	    if (terminalRunId !== null && __wasmIdleRunId === terminalRunId) __wasmIdleRunId = null;
	  }
};
`;
		const suffix = `__wasmIdleNativePostMessage({ ${JSON.stringify(WORKER_READY_MESSAGE)}: true });\n`;
		const workerSource = this.config.moduleWorker
			? `await import(${JSON.stringify(this.workerUrl)});`
			: `importScripts(${JSON.stringify(this.workerUrl)});`;
		const parts: BlobPart[] = verifiedWorkerSource
			? [
					prefix,
					'\n/* wasm-idle verified worker source */\n',
					verifiedWorkerSource,
					'\n',
					suffix
				]
			: [prefix, workerSource, '\n', suffix];
		return URL.createObjectURL(new Blob(parts, { type: 'text/javascript' }));
	}

	private revokeBootstrapUrl() {
		if (!this.bootstrapUrl) return;
		const bootstrapUrl = this.bootstrapUrl;
		this.bootstrapUrl = '';
		try {
			URL.revokeObjectURL(bootstrapUrl);
		} catch {
			// The bootstrap is already detached; cleanup must not replace the lifecycle result.
		}
	}

	private ensureWorkerStarted(
		progress: SandboxProgress | undefined,
		controls: StaticWorkerExecutionControls
	) {
		this.assertOperationNotDisposed();
		if (this.workerStartPromise) return this.workerStartPromise;
		const startAbortController = new AbortController();
		let generation = this.workerGeneration;
		this.workerStartMaxAssetBytes = this.usesOwnedRuntimePreflight()
			? controls.limits.maxAssetBytes
			: null;
		this.workerStartAbortController = startAbortController;
		const callerSignal = controls.signal;
		let callerListenerAttempted = false;
		const ownsStartup = () =>
			!this.disposed &&
			this.workerGeneration === generation &&
			this.workerStartAbortController === startAbortController;
		const invalidatedReason = () => {
			if (this.disposed) return this.getDisposeReason();
			if (startAbortController.signal.aborted) {
				let cause: unknown;
				try {
					cause = startAbortController.signal.reason;
				} catch (error) {
					cause = error;
				}
				return new CancelledError(`${this.config.displayName} worker startup cancelled`, {
					cause,
					phase: 'startup',
					runtimeId: this.config.languageId
				});
			}
			return new CancelledError(`${this.config.displayName} worker startup terminated`, {
				phase: 'startup',
				runtimeId: this.config.languageId
			});
		};
		const abortStartup = (reason?: unknown) => {
			if (startAbortController.signal.aborted) return;
			try {
				startAbortController.abort(reason);
			} catch {
				// Reservation state is detached separately; abort is best effort.
			}
		};
		const forwardAbort = () => {
			if (startAbortController.signal.aborted) return;
			let reason: unknown;
			try {
				reason = callerSignal?.reason;
			} catch (error) {
				reason = error;
			}
			if (!ownsStartup() || startAbortController.signal.aborted) return;
			abortStartup(reason);
		};
		const cleanupStartSignal = () => {
			if (callerListenerAttempted) {
				try {
					callerSignal?.removeEventListener('abort', forwardAbort);
				} catch {
					// Caller-owned signal cleanup must not replace startup settlement.
				}
			}
			if (this.workerStartAbortController === startAbortController) {
				this.workerStartAbortController = null;
			}
		};
		let startPromise: Promise<Worker>;
		try {
			if (callerSignal) {
				callerListenerAttempted = true;
				callerSignal.addEventListener('abort', forwardAbort, { once: true });
				if (!ownsStartup()) throw invalidatedReason();
				const callerAborted = callerSignal.aborted;
				if (!ownsStartup()) throw invalidatedReason();
				if (callerAborted) forwardAbort();
				if (!ownsStartup() || startAbortController.signal.aborted) {
					throw invalidatedReason();
				}
			}
			const creationContext: StaticWorkerCreationContext = {
				generation,
				progress,
				controls: {
					limits: controls.limits,
					signal: startAbortController.signal
				}
			};
			const acquisition = this.workerLifetimeController.acquire(creationContext);
			generation = creationContext.generation;
			startPromise = acquisition.then((lease) => {
				if (!ownsStartup() || startAbortController.signal.aborted) {
					lease.release({ reusable: false });
					throw invalidatedReason();
				}
				if (this.worker && this.worker !== lease.worker) {
					lease.release({ reusable: false });
					throw new CancelledError(
						`${this.config.displayName} worker startup was superseded`,
						{ phase: 'startup', runtimeId: this.config.languageId }
					);
				}
				this.worker = lease.worker;
				this.workerLease = lease;
				return lease.worker;
			});
			if (!ownsStartup()) {
				void startPromise.catch(() => undefined);
				throw invalidatedReason();
			}
			this.workerStartPromise = startPromise;
		} catch (error) {
			const reason = ownsStartup() ? this.preserveDisposeReason(error) : invalidatedReason();
			abortStartup(reason);
			cleanupStartSignal();
			throw reason;
		}
		void startPromise.then(
			() => cleanupStartSignal(),
			(error) => {
				cleanupStartSignal();
				if (this.workerStartPromise === startPromise) this.disposeWorker(error);
			}
		);
		return startPromise;
	}

	private async startWorker(
		generation: number,
		progress: SandboxProgress | undefined,
		controls: StaticWorkerExecutionControls
	) {
		let runtimePreflight: unknown;
		if (this.config.preflightRuntimeAssets) {
			const urls = this.resolvedRuntimeUrls;
			if (!urls) {
				throw new RuntimeConfigurationError(
					`${this.config.displayName} runtime preflight configuration is unavailable.`,
					{ phase: 'asset', runtimeId: this.config.languageId }
				);
			}
			const preflightKey = urls.preflightKey || urls.manifestFingerprint || '';
			if (this.usesOwnedRuntimePreflight() && preflightKey.length === 0) {
				throw new RuntimeConfigurationError(
					`${this.config.displayName} transfer-owned runtime preflight requires a stable preflight key.`,
					{ phase: 'asset', runtimeId: this.config.languageId }
				);
			}
			const operation: OwnedDeliveryOperation = {
				active: true,
				claimedTicket: null,
				generation,
				owner: this,
				preflightKey,
				runtimeId: this.config.languageId
			};
			this.reportProgress(progress, 0.03, `Preflighting ${this.config.displayName} runtime`);
			try {
				runtimePreflight = await this.config.preflightRuntimeAssets(urls, {
					limits: controls.limits,
					signal: controls.signal,
					reportProgress: (value, stage) => this.reportProgress(progress, value, stage),
					createOwnedDelivery: (payload) => {
						const currentUrls = this.resolvedRuntimeUrls;
						const currentPreflightKey =
							currentUrls?.preflightKey || currentUrls?.manifestFingerprint || '';
						if (
							!operation.active ||
							this.disposed ||
							controls.signal?.aborted ||
							generation !== this.workerGeneration ||
							currentPreflightKey !== operation.preflightKey
						) {
							throw new RuntimeConfigurationError(
								`${this.config.displayName} runtime preflight delivery operation is stale.`,
								{ phase: 'asset', runtimeId: this.config.languageId }
							);
						}
						if (operation.claimedTicket) {
							this.retireRuntimePreflight(operation.claimedTicket);
							throw new RuntimeConfigurationError(
								`${this.config.displayName} runtime preflight may create only one owned delivery.`,
								{ phase: 'asset', runtimeId: this.config.languageId }
							);
						}
						const prototype =
							payload !== null && typeof payload === 'object'
								? Object.getPrototypeOf(payload)
								: undefined;
						if (
							payload === null ||
							typeof payload !== 'object' ||
							Array.isArray(payload) ||
							(prototype !== Object.prototype && prototype !== null) ||
							!Object.isFrozen(payload)
						) {
							throw new RuntimeConfigurationError(
								`${this.config.displayName} owned runtime preflight payload must be a frozen plain object.`,
								{ phase: 'asset', runtimeId: this.config.languageId }
							);
						}
						const transferables: ArrayBuffer[] = [];
						const seenBuffers = new Set<ArrayBuffer>();
						for (const key of Reflect.ownKeys(payload)) {
							if (typeof key !== 'string') {
								throw new RuntimeConfigurationError(
									`${this.config.displayName} owned runtime preflight payload cannot contain symbol keys.`,
									{ phase: 'asset', runtimeId: this.config.languageId }
								);
							}
							const descriptor = Object.getOwnPropertyDescriptor(payload, key);
							if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
								throw new RuntimeConfigurationError(
									`${this.config.displayName} owned runtime preflight payload properties must be enumerable data properties.`,
									{ phase: 'asset', runtimeId: this.config.languageId }
								);
							}
							const value = descriptor.value;
							const bytes = inspectStaticRuntimePreflightBytes(value);
							if (bytes) {
								if (
									bytes.byteLength === 0 ||
									bytes.byteOffset !== 0 ||
									bytes.byteLength !== bytes.bufferByteLength
								) {
									throw new RuntimeConfigurationError(
										`${this.config.displayName} owned runtime preflight bytes must span non-empty whole ArrayBuffers.`,
										{ phase: 'asset', runtimeId: this.config.languageId }
									);
								}
								if (seenBuffers.has(bytes.buffer)) {
									throw new RuntimeConfigurationError(
										`${this.config.displayName} owned runtime preflight ArrayBuffers must be unique.`,
										{ phase: 'asset', runtimeId: this.config.languageId }
									);
								}
								seenBuffers.add(bytes.buffer);
								transferables.push(bytes.buffer);
								continue;
							}
							if (
								value !== null &&
								(typeof value === 'object' ||
									typeof value === 'function' ||
									typeof value === 'symbol')
							) {
								throw new RuntimeConfigurationError(
									`${this.config.displayName} owned runtime preflight payload accepts only primitive scalars and Uint8Arrays.`,
									{ phase: 'asset', runtimeId: this.config.languageId }
								);
							}
						}
						if (transferables.length === 0) {
							throw new RuntimeConfigurationError(
								`${this.config.displayName} owned runtime preflight payload contains no transferable bytes.`,
								{ phase: 'asset', runtimeId: this.config.languageId }
							);
						}
						const ticket = Object.freeze({}) as StaticWorkerRuntimeOwnedDelivery;
						ownedDeliveryStateByTicket.set(ticket, {
							operation,
							payload: payload as Readonly<Record<string, unknown>>,
							status: 'available',
							transferables
						});
						operation.claimedTicket = ticket;
						return ticket;
					}
				});
			} catch (error) {
				operation.active = false;
				if (operation.claimedTicket) {
					this.retireRuntimePreflight(operation.claimedTicket);
				}
				throw error;
			}
			operation.active = false;
			const returnedDelivery =
				runtimePreflight !== null && typeof runtimePreflight === 'object'
					? ownedDeliveryStateByTicket.get(
							runtimePreflight as StaticWorkerRuntimeOwnedDelivery
						)
					: undefined;
			if (this.usesOwnedRuntimePreflight()) {
				const currentUrls = this.resolvedRuntimeUrls;
				const currentPreflightKey =
					currentUrls?.preflightKey || currentUrls?.manifestFingerprint || '';
				if (
					!returnedDelivery ||
					returnedDelivery.operation !== operation ||
					returnedDelivery.status !== 'available' ||
					operation.claimedTicket !== runtimePreflight ||
					generation !== this.workerGeneration ||
					currentPreflightKey !== operation.preflightKey
				) {
					if (operation.claimedTicket) {
						this.retireRuntimePreflight(operation.claimedTicket);
					}
					throw new RuntimeConfigurationError(
						`${this.config.displayName} transfer-owned runtime preflight must return this operation's owned delivery ticket.`,
						{ phase: 'asset', runtimeId: this.config.languageId }
					);
				}
			} else if (operation.claimedTicket || returnedDelivery) {
				if (operation.claimedTicket) {
					this.retireRuntimePreflight(operation.claimedTicket);
				}
				throw new RuntimeConfigurationError(
					`${this.config.displayName} structured-clone runtime preflight cannot return an owned delivery ticket.`,
					{ phase: 'asset', runtimeId: this.config.languageId }
				);
			}
			if (runtimePreflight === undefined || runtimePreflight === null) {
				throw new RuntimeConfigurationError(
					`${this.config.displayName} runtime preflight returned no verified assets.`,
					{ phase: 'asset', runtimeId: this.config.languageId }
				);
			}
			try {
				this.reportProgress(
					progress,
					0.18,
					`${this.config.displayName} runtime preflight complete`
				);
			} catch (error) {
				this.retireRuntimePreflight(runtimePreflight);
				throw error;
			}
		}
		let worker!: Worker;
		let workerCreated = false;
		try {
			if (this.disposed) throw this.getDisposeReason();
			if (generation !== this.workerGeneration) {
				throw new CancelledError(`${this.config.displayName} worker startup terminated`, {
					phase: 'startup',
					runtimeId: this.config.languageId
				});
			}
			const verifiedWorkerBytes = await this.preloadWorkerScript(progress, controls);
			if (this.disposed) throw this.getDisposeReason();
			if (generation !== this.workerGeneration) {
				throw new CancelledError(`${this.config.displayName} worker startup terminated`, {
					phase: 'startup',
					runtimeId: this.config.languageId
				});
			}

			try {
				this.reportProgress(progress, 0.22, `Starting ${this.config.displayName} worker`);
			} catch (error) {
				throw this.preserveDisposeReason(error);
			}
			if (this.disposed) throw this.getDisposeReason();
			if (generation !== this.workerGeneration) {
				throw new CancelledError(`${this.config.displayName} worker startup terminated`, {
					phase: 'startup',
					runtimeId: this.config.languageId
				});
			}
			this.bootstrapUrl = this.createBootstrapUrl(verifiedWorkerBytes);
			if (this.disposed || generation !== this.workerGeneration) {
				this.revokeBootstrapUrl();
				if (this.disposed) throw this.getDisposeReason();
				throw new CancelledError(`${this.config.displayName} worker startup terminated`, {
					phase: 'startup',
					runtimeId: this.config.languageId
				});
			}
			try {
				worker = this.config.moduleWorker
					? new Worker(this.bootstrapUrl, { type: 'module' })
					: new Worker(this.bootstrapUrl);
				workerCreated = true;
			} catch (error) {
				this.revokeBootstrapUrl();
				if (this.disposed) throw this.getDisposeReason();
				if (generation !== this.workerGeneration) {
					throw new CancelledError(
						`${this.config.displayName} worker startup terminated`,
						{
							phase: 'startup',
							runtimeId: this.config.languageId
						}
					);
				}
				throw new WorkerStartupError(
					`${this.config.displayName} worker failed to start: ${this.errorMessage(error)}`,
					{ cause: error, runtimeId: this.config.languageId }
				);
			}
			if (runtimePreflight !== undefined) {
				this.workerRuntimePreflight.set(worker, runtimePreflight);
			}
			if (this.usesOwnedRuntimePreflight()) {
				this.workerRuntimePreflightMaxAssetBytes.set(worker, controls.limits.maxAssetBytes);
			}
		} catch (error) {
			if (workerCreated) this.detachAndTerminateWorker(worker);
			this.retireRuntimePreflight(runtimePreflight);
			throw error;
		}
		if (this.disposed || generation !== this.workerGeneration) {
			this.detachAndTerminateWorker(worker);
			this.revokeBootstrapUrl();
			if (this.disposed) throw this.getDisposeReason();
			throw new CancelledError(`${this.config.displayName} worker startup terminated`, {
				phase: 'startup',
				runtimeId: this.config.languageId
			});
		}

		return await new Promise<Worker>((resolve, reject) => {
			let settled = false;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const cleanup = () => {
				if (timeout !== undefined) {
					try {
						clearTimeout(timeout);
					} catch {
						// Timer cleanup is best effort once startup has settled.
					}
				}
				try {
					controls.signal?.removeEventListener('abort', onAbort);
				} catch {
					// Caller-owned signal cleanup must not prevent startup settlement.
				}
			};
			const rejectStartup = (reason: unknown) => {
				if (settled) return false;
				settled = true;
				cleanup();
				if (this.startupReject === rejectStartup) this.startupReject = null;
				reject(reason);
				return true;
			};
			const retireStartedWorker = () => {
				if (generation === this.workerGeneration && this.worker === worker) {
					this.disposeWorker();
					return;
				}
				this.detachAndTerminateWorker(worker);
			};
			const failStartup = (reason: unknown) => {
				if (!rejectStartup(this.preserveDisposeReason(reason))) return;
				retireStartedWorker();
			};
			const onAbort = () => {
				let signalReason: unknown;
				try {
					signalReason = controls.signal?.reason;
				} catch (error) {
					signalReason = error;
				}
				failStartup(
					signalReason === this.disposeReason
						? this.getDisposeReason()
						: new CancelledError(
								`${this.config.displayName} worker startup cancelled`,
								{
									cause: signalReason,
									phase: 'startup',
									runtimeId: this.config.languageId
								}
							)
				);
			};

			this.worker = worker;
			this.startupReject = rejectStartup;
			try {
				timeout = setTimeout(() => {
					failStartup(
						new TimeoutError(
							`${this.config.displayName} worker startup timed out after ${controls.limits.startupTimeoutMs} ms`,
							{
								phase: 'startup',
								runtimeId: this.config.languageId,
								timeoutMs: controls.limits.startupTimeoutMs
							}
						)
					);
				}, controls.limits.startupTimeoutMs);
				worker.onmessage = (event: MessageEvent<StaticWorkerMessage>) => {
					if (generation !== this.workerGeneration || this.worker !== worker) return;
					if (event.data?.__wasmIdleStaticWorkerReady) {
						if (settled || this.startupReject !== rejectStartup) return;
						try {
							this.reportProgress(
								progress,
								0.25,
								`${this.config.displayName} worker ready`
							);
						} catch (error) {
							failStartup(error);
							return;
						}
						if (
							settled ||
							generation !== this.workerGeneration ||
							this.worker !== worker ||
							this.startupReject !== rejectStartup
						) {
							return;
						}
						settled = true;
						cleanup();
						this.startupReject = null;
						this.revokeBootstrapUrl();
						resolve(worker);
						return;
					}
					this.handleWorkerMessage(event);
				};
				worker.onerror = (event: ErrorEvent) => {
					if (generation !== this.workerGeneration || this.worker !== worker) return;
					event.preventDefault?.();
					const message = this.formatWorkerError(event);
					const options = {
						cause: event.error ?? event,
						runtimeId: this.config.languageId
					};
					this.handleWorkerFailure(
						this.startupReject
							? new WorkerStartupError(message, options)
							: new RuntimeExecutionError(message, options)
					);
				};
				worker.onmessageerror = (event) => {
					if (generation !== this.workerGeneration || this.worker !== worker) return;
					this.handleWorkerFailure(
						new ProtocolError(
							`${this.config.displayName} worker message deserialization failed`,
							{
								cause: event,
								phase: 'protocol',
								runtimeId: this.config.languageId
							}
						)
					);
				};
				controls.signal?.addEventListener('abort', onAbort, { once: true });
				if (controls.signal?.aborted) onAbort();
			} catch (error) {
				failStartup(error);
			}
		});
	}

	private handleWorkerMessage(event: MessageEvent<StaticWorkerMessage>) {
		const activeRun = this.activeRun;
		if (!activeRun) return;
		if (event.data?.runId !== activeRun.id) return;
		try {
			if (event.data?.type === 'execution-ready') {
				this.reportRunReady(
					activeRun,
					'running',
					'started',
					`${this.config.displayName} program started`
				);
				return;
			}
			if (event.data?.type === 'stdin-request') {
				activeRun.stdinRing?.consumerRequestedInput();
				if (this.activeRun === activeRun) {
					this.reportRunReady(
						activeRun,
						'waiting-input',
						'stdin-request',
						`${this.config.displayName} runtime ready for input`
					);
				}
				return;
			}
			const { output, stream, results, error, diagnostic, progress } = event.data || {};
			if (progress && typeof progress === 'object' && 'kind' in progress) {
				if (progress.kind !== 'settled') {
					const lifecycleEvent = reportWorkerProgress(activeRun.progress, progress);
					if (lifecycleEvent?.kind === 'ready') activeRun.readyReported = true;
					if (this.activeRun !== activeRun) return;
				}
			} else if (progress && typeof progress.percent === 'number') {
				const runtimeProgress = Math.max(0, Math.min(progress.percent / 100, 1));
				this.reportProgress(
					activeRun.progress,
					0.3 + runtimeProgress * 0.65,
					progress.stage || `Running ${this.config.displayName}`
				);
				if (this.activeRun !== activeRun) return;
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
				this.reportRunReady(
					activeRun,
					'running',
					stream === 'stderr' ? 'stderr' : 'stdout',
					`${this.config.displayName} program output received`
				);
				if (this.activeRun !== activeRun) return;
				activeRun.outputBytes = outputBytes;
				this.output?.(output);
				if (this.activeRun !== activeRun) return;
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
				if (this.activeRun !== activeRun) return;
			}
			if (typeof error === 'string') {
				this.rejectRun(activeRun.id, error);
				return;
			}
			if (results !== undefined) {
				this.resolveRun(activeRun.id, typeof results === 'string' ? results : results);
			}
		} catch (error) {
			if (this.activeRun === activeRun) this.rejectRun(activeRun.id, error);
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
		if (error instanceof Error) return error.message;
		if (
			error !== null &&
			typeof error === 'object' &&
			'message' in error &&
			typeof error.message === 'string'
		) {
			return error.message;
		}
		return String(error);
	}

	private handleWorkerFailure(reason: unknown) {
		this.startupReject?.(reason);
		this.startupReject = null;
		if (this.activeRun) this.rejectRun(this.activeRun.id, reason);
		else this.disposeWorker();
	}

	private resolveRun(id: string, result: boolean | string) {
		const activeRun = this.activeRun;
		if (!activeRun || activeRun.id !== id) return;
		try {
			if (!activeRun.readyReported && !activeRun.settledReported) {
				this.reportRunReady(
					activeRun,
					'running',
					'result',
					`${this.config.displayName} run complete`
				);
				if (this.activeRun !== activeRun) return;
			}
			this.reportRunSettled(
				activeRun,
				'completed',
				`${this.config.displayName} run complete`
			);
		} catch (error) {
			if (this.activeRun === activeRun) this.rejectRun(id, error);
			return;
		}
		if (this.activeRun !== activeRun) return;
		const claimedRun = this.claimRun(id);
		if (claimedRun !== activeRun) return;
		this.elapse = Date.now() - this.begin;
		this.exit = true;
		this.clearPendingStdin();
		this.releaseWorkerLease(true);
		this.cleanupRun(activeRun);
		activeRun.resolve(result);
	}

	private rejectRun(id: string, reason: unknown) {
		const activeRun = this.claimRun(id);
		if (!activeRun) return;
		try {
			this.reportRunSettled(
				activeRun,
				reason instanceof TimeoutError
					? 'timed-out'
					: reason instanceof CancelledError
						? 'cancelled'
						: 'failed',
				`${this.config.displayName} run ended`
			);
		} catch {
			// Progress observers must not prevent a failed run from releasing its worker.
		}
		this.elapse = Date.now() - this.begin;
		this.exit = true;
		this.clearPendingStdin();
		this.startupReject?.(reason);
		this.disposeWorker();
		this.cleanupRun(activeRun);
		activeRun.reject(reason);
	}

	private claimRun(id: string) {
		const activeRun = this.activeRun;
		if (!activeRun || activeRun.id !== id) return null;
		this.activeRun = null;
		this.activeReject = null;
		return activeRun;
	}

	private cleanupRun(activeRun: ActiveRun) {
		try {
			activeRun.cleanup();
		} catch {
			// Lifecycle cleanup is best effort and must not replace the run result.
		}
		try {
			activeRun.stdinRing?.cancel();
		} catch {
			// The stdin channel is already detached; preserve the run result.
		}
	}

	private releasePreparedWorkerIfIdle() {
		if (this.workerLifetimeController.policy.mode === 'per-run') return;
		if (this.activeRun || this.startingRunId) return;
		this.releaseWorkerLease(true);
	}

	private releaseWorkerLease(reusable: boolean) {
		const lease = this.workerLease;
		this.workerLease = null;
		this.workerStartPromise = null;
		this.workerStartMaxAssetBytes = null;
		if (!lease) return;
		try {
			lease.release({ reusable });
		} catch {
			// A hostile timer implementation must not replace a completed run.
			this.workerLifetimeController.evictIdle();
		}
	}

	handleMemoryPressure() {
		return this.workerLifetimeController.handleMemoryPressure();
	}

	private retireManagedWorker(worker: Worker) {
		if (this.worker === worker) {
			delete this.worker;
			this.workerStartPromise = null;
			this.workerStartMaxAssetBytes = null;
			this.workerGeneration += 1;
		}
		this.detachAndTerminateWorker(worker);
	}

	private retireRuntimePreflight(runtimePreflight: unknown) {
		if (runtimePreflight === null || typeof runtimePreflight !== 'object') return;
		const state = ownedDeliveryStateByTicket.get(
			runtimePreflight as StaticWorkerRuntimeOwnedDelivery
		);
		if (!state || state.operation.owner !== this || state.status === 'retired') return;
		state.status = 'retired';
		state.payload = null;
		state.transferables = null;
	}

	private detachAndTerminateWorker(worker: Worker) {
		this.retireRuntimePreflight(this.workerRuntimePreflight.get(worker));
		this.workerRuntimePreflight.delete(worker);
		this.workerRuntimePreflightMaxAssetBytes.delete(worker);
		this.workersWithCachedRuntimePreflight.delete(worker);
		try {
			worker.onmessage = null;
		} catch {
			// Continue detaching and terminating even if a custom worker setter fails.
		}
		try {
			worker.onerror = null;
		} catch {
			// Continue detaching and terminating even if a custom worker setter fails.
		}
		try {
			worker.onmessageerror = null;
		} catch {
			// Continue detaching and terminating even if a custom worker setter fails.
		}
		try {
			worker.terminate();
		} catch {
			// The worker is detached before cleanup, so a throwing terminate remains harmless.
		}
	}

	private disposeWorker(reason?: unknown) {
		const startAbortController = this.workerStartAbortController;
		this.workerStartAbortController = null;
		this.workerGeneration += 1;
		this.workerStartPromise = null;
		this.workerStartMaxAssetBytes = null;
		this.startupReject = null;
		const lease = this.workerLease;
		this.workerLease = null;
		const worker = this.worker;
		delete this.worker;
		this.revokeBootstrapUrl();
		if (startAbortController && !startAbortController.signal.aborted) {
			try {
				startAbortController.abort(reason);
			} catch {
				// Startup state is already detached; abort cleanup is best effort.
			}
		}
		if (lease) {
			lease.release({ reusable: false });
			if (worker && worker !== lease.worker) this.detachAndTerminateWorker(worker);
		} else if (worker && !this.workerLifetimeController.retireWorker(worker)) {
			this.detachAndTerminateWorker(worker);
		}
		this.workerLifetimeController.evictIdle();
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		try {
			this.assertNotDisposed();
		} catch (error) {
			return Promise.reject(error);
		}
		if (!this.baseUrl || !this.workerUrl) {
			return Promise.reject(
				new RuntimeConfigurationError(
					`${this.config.displayName} runtime is not configured.`,
					{ runtimeId: this.config.languageId }
				)
			);
		}
		if (this.activeRun || this.startingRunId) {
			return Promise.reject(
				new BusyError(`${this.config.displayName} runtime already has an active run`, {
					runtimeId: this.config.languageId
				})
			);
		}
		let controls: StaticWorkerExecutionControls;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		try {
			controls = this.resolveExecutionControls(options);
			this.assertOperationNotDisposed();
			workspace = this.validateWorkspace(code, options, controls.limits);
			this.assertOperationNotDisposed();
		} catch (error) {
			return Promise.reject(this.preserveDisposeReason(error));
		}
		try {
			if (controls.signal?.aborted) {
				return Promise.reject(
					new CancelledError(`${this.config.displayName} run cancelled`, {
						cause: controls.signal.reason,
						phase: 'execute',
						runtimeId: this.config.languageId
					})
				);
			}
		} catch (error) {
			return Promise.reject(this.preserveDisposeReason(error));
		}
		this.resetWorkerForLowerAssetLimit(controls.limits.maxAssetBytes);
		const id = `static-${++this.uid}`;
		this.startingRunId = id;
		const progressSink = this.selectProgress(_prog);
		let lifecycle: ReturnType<StaticWorkerRuntimeSandbox['beginProgressLifecycle']>;
		try {
			lifecycle = this.beginProgressLifecycle(
				progressSink,
				prepare
					? `Preparing ${this.config.displayName} runtime`
					: `Starting ${this.config.displayName} run`
			);
		} catch (error) {
			if (this.startingRunId === id) this.startingRunId = null;
			return Promise.reject(this.preserveDisposeReason(error));
		}
		if (this.startingRunId !== id) {
			lifecycle.end();
			return Promise.reject(
				this.disposed
					? this.getDisposeReason()
					: new CancelledError(
							prepare
								? `${this.config.displayName} worker startup terminated`
								: `${this.config.displayName} run terminated`,
							{
								phase: prepare ? 'startup' : 'execute',
								runtimeId: this.config.languageId
							}
						)
			);
		}
		const progress = lifecycle.progress;

		if (prepare) {
			let startup: Promise<Worker>;
			try {
				startup = this.ensureWorkerStarted(progress, controls);
			} catch (error) {
				startup = Promise.reject(error);
			}
			return startup
				.then(() => {
					if (this.startingRunId !== id) {
						throw new CancelledError(
							`${this.config.displayName} worker startup terminated`,
							{
								phase: 'startup',
								runtimeId: this.config.languageId
							}
						);
					}
					this.assertOperationNotDisposed();
					this.reportProgress(progress, 0.25, `${this.config.displayName} worker ready`);
					this.assertOperationNotDisposed();
					if (this.startingRunId !== id) {
						throw new CancelledError(
							`${this.config.displayName} worker startup terminated`,
							{
								phase: 'startup',
								runtimeId: this.config.languageId
							}
						);
					}
					return true;
				})
				.catch((error) => {
					throw this.preserveDisposeReason(error);
				})
				.finally(() => {
					if (this.startingRunId === id) this.startingRunId = null;
					this.releasePreparedWorkerIfIdle();
					lifecycle.end();
				});
		}

		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			let stdinRing: StaticStdinRingHost | undefined;
			if (this.stdinMode === 'streaming') {
				try {
					const maxBufferedBytes = Math.min(
						128 * 1024,
						controls.limits.maxWorkspaceBytes
					);
					stdinRing = new StaticStdinRingHost({
						capacity: Math.min(64 * 1024, maxBufferedBytes),
						maxBufferedBytes
					});
					const explicitStdin = typeof options.stdin === 'string';
					const initialInput = explicitStdin
						? (options.stdin ?? '')
						: this.pendingInput.join('');
					const initialEof = explicitStdin || this.pendingEof;
					this.assertOperationNotDisposed();
					this.clearPendingStdin();
					stdinRing.enqueue(initialInput);
					if (initialEof) stdinRing.close();
				} catch (error) {
					try {
						stdinRing?.cancel();
					} catch {
						// A local stdin channel must not outlive a rejected reservation.
					}
					if (this.startingRunId === id) this.startingRunId = null;
					this.exit = true;
					reject(this.preserveDisposeReason(error));
					return;
				}
			}
			let deadline: ReturnType<typeof setTimeout> | undefined;
			const onAbort = () => {
				if (this.activeRun?.id !== id) return;
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
				readyReported: false,
				resolve,
				reject,
				settledReported: false,
				...(stdinRing ? { stdinRing } : {})
			};
			this.activeReject = reject;
			this.startingRunId = null;
			this.begin = Date.now();
			try {
				controls.signal?.addEventListener('abort', onAbort, { once: true });
			} catch (error) {
				this.rejectRun(id, error);
				return;
			}
			if (controls.signal?.aborted) {
				onAbort();
				return;
			}

			void (async () => {
				try {
					const worker = await this.ensureWorkerStarted(progress, controls);
					const activeRun = this.activeRun;
					if (!activeRun || activeRun.id !== id) return;
					const { stdin, stdinEof } = activeRun.stdinRing
						? { stdin: undefined, stdinEof: false }
						: await this.collectStdinForRun(code, options, activeRun);
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
					if (this.disposed || this.activeRun !== activeRun || this.worker !== worker) {
						return;
					}
					try {
						const storedRuntimePreflight = this.workerRuntimePreflight.get(worker);
						let runtimePreflight = storedRuntimePreflight;
						let transferList: ArrayBuffer[] | undefined;
						let deliveredOwnedPreflight = false;
						try {
							if (this.usesOwnedRuntimePreflight()) {
								const state =
									storedRuntimePreflight !== null &&
									typeof storedRuntimePreflight === 'object'
										? ownedDeliveryStateByTicket.get(
												storedRuntimePreflight as StaticWorkerRuntimeOwnedDelivery
											)
										: undefined;
								const currentUrls = this.resolvedRuntimeUrls;
								const currentPreflightKey =
									currentUrls?.preflightKey ||
									currentUrls?.manifestFingerprint ||
									'';
								if (
									state &&
									state.operation.owner === this &&
									state.operation.runtimeId === this.config.languageId &&
									state.operation.generation === this.workerGeneration &&
									state.operation.preflightKey === currentPreflightKey &&
									state.status === 'available' &&
									state.payload &&
									state.transferables
								) {
									runtimePreflight = state.payload;
									transferList = state.transferables;
									state.status = 'consumed';
									state.payload = null;
									state.transferables = null;
									deliveredOwnedPreflight = true;
								} else if (
									this.usesWorkerCachedRuntimePreflight() &&
									storedRuntimePreflight === undefined &&
									this.workersWithCachedRuntimePreflight.has(worker)
								) {
									runtimePreflight = undefined;
								} else {
									throw new RuntimeConfigurationError(
										`${this.config.displayName} runtime preflight owned delivery is unavailable or stale.`,
										{ phase: 'protocol', runtimeId: this.config.languageId }
									);
								}
							} else if (
								storedRuntimePreflight !== null &&
								typeof storedRuntimePreflight === 'object' &&
								ownedDeliveryStateByTicket.has(
									storedRuntimePreflight as StaticWorkerRuntimeOwnedDelivery
								)
							) {
								throw new RuntimeConfigurationError(
									`${this.config.displayName} structured-clone runtime preflight cannot dispatch an owned delivery ticket.`,
									{ phase: 'protocol', runtimeId: this.config.languageId }
								);
							}
							const message = {
								run: true,
								runId: id,
								baseUrl: this.baseUrl,
								manifestUrl: this.manifestUrl,
								manifestFingerprint: this.manifestFingerprint,
								...(runtimePreflight === undefined ? {} : { runtimePreflight }),
								maxAssetBytes: controls.limits.maxAssetBytes,
								code,
								args: programArgs,
								stdin,
								stdinEof,
								...(activeRun.stdinRing
									? { stdinChannel: activeRun.stdinRing.descriptor }
									: {}),
								activePath: workspace.activePath,
								workspaceFiles: workspace.workspaceFiles,
								log: _log
							};
							if (transferList) worker.postMessage(message, transferList);
							else worker.postMessage(message);
							if (
								deliveredOwnedPreflight &&
								this.usesWorkerCachedRuntimePreflight()
							) {
								this.workersWithCachedRuntimePreflight.add(worker);
							}
						} finally {
							if (this.usesOwnedRuntimePreflight()) {
								this.workerRuntimePreflight.delete(worker);
								this.retireRuntimePreflight(storedRuntimePreflight);
							}
						}
					} catch (error) {
						throw new ProtocolError(
							`${this.config.displayName} worker run dispatch failed: ${this.errorMessage(error)}`,
							{
								cause: error,
								phase: 'protocol',
								runtimeId: this.config.languageId
							}
						);
					}
				} catch (error) {
					const reason = this.preserveDisposeReason(error);
					this.rejectRun(
						id,
						isWasmIdleError(reason) ? reason : this.errorMessage(reason)
					);
				}
			})();
		}).finally(() => lifecycle.end());
	}

	kill() {
		this.terminate();
	}

	private terminateLifecycle(startupReason: unknown, runReason: unknown) {
		const activeRun = this.activeRun;
		if (activeRun) {
			try {
				this.reportRunSettled(
					activeRun,
					'cancelled',
					`${this.config.displayName} run ended`
				);
			} catch {
				// Progress observers must not prevent explicit runtime termination.
			}
			if (this.activeRun !== activeRun) return;
		}
		const workerReason = this.activeRun ? runReason : startupReason;
		this.progressController.invalidate();
		this.uid += 1;
		this.startingRunId = null;
		this.startupReject?.(startupReason);
		this.startupReject = null;
		this.rejectStdinWaiters(runReason);
		if (this.activeRun) {
			const activeRun = this.claimRun(this.activeRun.id);
			if (activeRun) {
				this.cleanupRun(activeRun);
				activeRun.reject(runReason);
			}
		}
		this.activeReject = null;
		this.clearPendingStdin();
		this.exit = true;
		this.disposeWorker(workerReason);
	}

	terminate() {
		if (this.disposed) return;
		const startupReason = new CancelledError(
			`${this.config.displayName} worker startup terminated`,
			{
				phase: 'startup',
				runtimeId: this.config.languageId
			}
		);
		const runReason = new CancelledError(`${this.config.displayName} run terminated`, {
			phase: 'execute',
			runtimeId: this.config.languageId
		});
		this.terminateLifecycle(startupReason, runReason);
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.disposePromise = Promise.resolve();
		const reason = this.getDisposeReason();
		this.terminateLifecycle(reason, reason);
		this.workerLifetimeController.dispose();
		this.lifecycleProgress = undefined;
		this.output = null;
		this.oncompilerdiagnostic = undefined;
		this.baseUrl = '';
		this.workerUrl = '';
		this.manifestUrl = '';
		this.manifestFingerprint = '';
		this.preflightKey = '';
		this.resolvedRuntimeUrls = null;
		this.workerReceipt = null;
		return this.disposePromise;
	}

	async clear() {
		if (!this.disposed) this.terminate();
		this.lifecycleProgress = undefined;
	}
}
