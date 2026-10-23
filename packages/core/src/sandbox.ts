import { createRuntimePrewarmer } from './prewarm.js';
import {
	resolveRuntimeAssetCacheOptions,
	type RuntimeAssetCacheOptions
} from './persistent-asset-cache.js';
import { createRuntimeAssetsKey } from './runtime-assets.js';
import type {
	DebugCommand,
	DebugEvaluateOptions,
	DebugEvaluateResult,
	DebugSourceBreakpoint,
	DebugSteppingOptions,
	DebugDataBreakpoint,
	DebugDataBreakpointInfo,
	DebugDataBreakpointInfoArguments,
	DebugMemory,
	DebugResolvedDataBreakpoint,
	DebugScope,
	DebugSessionEvent,
	DebugSourceBreakpoints,
	DebugVariable,
	DebugWriteMemoryResult
} from './debug.js';
import {
	defineRuntimeTrustProfile,
	enforceRuntimeTrustProfile,
	type RuntimeTrustProfile
} from './capabilities.js';
import {
	BusyError,
	CancelledError,
	DiagnosticLimitError,
	OutputLimitError,
	RuntimeConfigurationError,
	TimeoutError,
	UnsupportedLanguageError,
	type RuntimePhase
} from './errors.js';
import { normalizeLanguageId } from './languages.js';
import {
	resolveExecutionLimits,
	validateExecutionResult,
	type ExecutionDebugOptions,
	type ExecutionLimits,
	type ExecutionRequest,
	type ExecutionResult,
	type ExecutionRuntimeRequirements
} from './execution.js';
import type { ProgressLike } from './progress.js';
import type { RuntimeRunId } from './protocol.js';
import type { RuntimeAssetKeySource } from './runtime-assets.js';
import {
	DEFAULT_WORKSPACE_LIMITS,
	validateExecutionWorkspace,
	type WorkspaceFile,
	type WorkspaceLimits
} from './workspace.js';

export type SandboxRuntimeAssets = string | RuntimeAssetKeySource;
export type SandboxProgress = ProgressLike;

export interface SandboxExecutionOptions {
	persistentCache?: import('./persistent-asset-cache.js').RuntimeAssetCacheOptions;
	[key: string]: unknown;
	activePath?: string;
	env?: Record<string, string>;
	/**
	 * Keep the final `run(..., prepare = false)` operation alive until the host stops it.
	 * Loading and prepare operations remain bounded by their configured deadlines.
	 */
	interactive?: boolean;
	limits?: Partial<ExecutionLimits>;
	runtimeRequirements?: ExecutionRuntimeRequirements;
	signal?: AbortSignal;
	sourceBreakpoints?: DebugSourceBreakpoints[];
	debugSteppingOptions?: DebugSteppingOptions;
	stdin?: string | AsyncIterable<Uint8Array>;
	workspaceFiles?: WorkspaceFile[];
	workspaceLimits?: Partial<WorkspaceLimits>;
}

interface ValidatedSandboxExecutionOptions extends SandboxExecutionOptions {
	limits: ExecutionLimits;
}

interface SandboxOperationState {
	active: boolean;
	acceptOutput: boolean;
	generation: number;
	outputBytes: number;
	diagnosticCount: number;
	maxOutputBytes: number;
	maxDiagnostics: number;
	phase: RuntimePhase;
	limitExceeded: boolean;
	onLimit?: (error: OutputLimitError | DiagnosticLimitError) => void;
	onCancel?: (cancel: () => void | Promise<void>) => Promise<void>;
	onDispose?: () => void;
}

export interface SandboxLifecycle {
	/** Stop the current generation and settle all its pending operations before resolving. */
	cancel: (runId?: RuntimeRunId) => void | Promise<void>;
	reset: () => void | Promise<void>;
	restart: () => void | Promise<void>;
	clearOutput: () => void | Promise<void>;
	/** Permanently stop event producers and settle every pending operation before resolving. */
	dispose: () => void | Promise<void>;
}

export interface Sandbox {
	constructor: unknown;
	/** Profile defaults, snapshotted by a binding; explicit caller limits always take precedence. */
	readonly defaultExecutionLimits?: Readonly<Partial<ExecutionLimits>>;
	eof: () => void;
	load: (
		runtimeAssets?: SandboxRuntimeAssets,
		code?: string,
		log?: boolean,
		args?: string[],
		options?: SandboxExecutionOptions,
		progress?: SandboxProgress
	) => Promise<void>;
	run: (
		code: string,
		prepare: boolean,
		log?: boolean,
		prog?: SandboxProgress,
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean | string>;
	execute?: (request: ExecutionRequest) => Promise<ExecutionResult>;
	terminate: () => void | Promise<void>;
	clear: () => Promise<void>;
	kill?: () => void | Promise<void>;
	cancel?: SandboxLifecycle['cancel'];
	reset?: SandboxLifecycle['reset'];
	restart?: SandboxLifecycle['restart'];
	clearOutput?: SandboxLifecycle['clearOutput'];
	dispose?: SandboxLifecycle['dispose'];
	write?: (data: string) => void;
	output?: (data: string) => void;
	ondebug?: (event: DebugSessionEvent) => void;
	oncompilerdiagnostic?: (diagnostic: unknown) => void;
	debugCommand?: (command: DebugCommand) => void | Promise<void>;
	debugPause?: () => void | Promise<void>;
	setBreakpoints?: (lines: number[], sourcePath?: string) => void | Promise<void>;
	debugEvaluate?: (expression: string) => Promise<string>;
	debugEvaluateValue?: (
		expression: string,
		options?: DebugEvaluateOptions
	) => Promise<DebugEvaluateResult>;
	setSourceBreakpoints?: (
		breakpoints: DebugSourceBreakpoint[],
		sourcePath?: string
	) => Promise<void>;
	debugSetSteppingOptions?: (options: DebugSteppingOptions) => Promise<void>;
	debugVariables?: (
		variablesReference: number,
		start?: number,
		count?: number
	) => Promise<DebugVariable[]>;
	debugScopes?: (frameId: number) => Promise<DebugScope[]>;
	/** Read-only counterpart to debugScopes, which selects the evaluation frame. */
	debugFrameScopes?: (frameId: number) => Promise<DebugScope[]>;
	debugFrameName?: (frameId: number) => Promise<string | null>;
	debugReadMemory?: (
		memoryReference: string,
		offset: number,
		count: number
	) => Promise<DebugMemory | null>;
	debugWriteMemory?: (
		memoryReference: string,
		offset: number,
		data: Uint8Array,
		allowPartial?: boolean
	) => Promise<DebugWriteMemoryResult | null>;
	debugDataBreakpointInfo?: (
		arguments_: DebugDataBreakpointInfoArguments
	) => Promise<DebugDataBreakpointInfo | null>;
	debugSetDataBreakpoints?: (
		breakpoints: DebugDataBreakpoint[]
	) => Promise<DebugResolvedDataBreakpoint[]>;
	image?: (data: { mime: string; b64: string; ts?: number }) => void;
	elapse?: number;
}

export interface BoundSandbox extends Omit<Sandbox, 'load' | 'dispose'> {
	load: (
		code?: string,
		log?: boolean,
		args?: string[],
		options?: SandboxExecutionOptions,
		progress?: SandboxProgress
	) => Promise<void>;
	dispose?: () => Promise<void>;
	runtimeAssets: SandboxRuntimeAssets;
	trustProfile?: RuntimeTrustProfile;
}

export interface PlaygroundTerminalProps {
	playground: PlaygroundBinding;
	runtimeAssets: SandboxRuntimeAssets;
	trustProfile?: RuntimeTrustProfile;
}

export interface PlaygroundBinding {
	runtimeAssets: SandboxRuntimeAssets;
	trustProfile?: RuntimeTrustProfile;
	terminalProps: PlaygroundTerminalProps;
	load: (language: string) => Promise<BoundSandbox>;
	/** Disabled by default. Only loads the runtime, never user source. */
	prewarm?: (language: string) => Promise<boolean>;
	setPrewarmEnabled?: (enabled: boolean) => Promise<void>;
	cancelPrewarm?: () => Promise<void>;
	dispose: () => Promise<void>;
}

export type SandboxLoader = (language: string) => Promise<Sandbox>;

export interface PlaygroundBindingOptions {
	persistentCache?: RuntimeAssetCacheOptions;
	/** Allow explicit prewarm(language) requests; no language is warmed automatically. */
	prewarm?: boolean;
	trustProfile?: RuntimeTrustProfile;
}

const workspaceTextEncoder = new TextEncoder();
// A broken adapter must never keep an otherwise usable binding permanently busy.
const cancellationGraceMs = 1_000;

function snapshotExecutionInputs<T extends SandboxExecutionOptions | ExecutionRequest>(
	options: T
): T {
	const snapshot = { ...options };
	const values = snapshot as SandboxExecutionOptions;
	for (const name of ['args', 'compileArgs', 'programArgs', 'breakpoints']) {
		const value = values[name];
		if (Array.isArray(value)) values[name] = value.slice();
	}
	if (values.debugSteppingOptions)
		values.debugSteppingOptions = { ...values.debugSteppingOptions };
	if (values.env && typeof values.env === 'object' && !Array.isArray(values.env)) {
		values.env = { ...values.env };
	}
	if (values.sourceBreakpoints) {
		values.sourceBreakpoints = values.sourceBreakpoints.map((source) => ({
			...source,
			lines: source.lines.slice(),
			...(source.breakpoints
				? { breakpoints: source.breakpoints.map((value) => ({ ...value })) }
				: {})
		}));
	}
	if (values.debug && typeof values.debug === 'object' && !Array.isArray(values.debug)) {
		const debug = values.debug as ExecutionDebugOptions;
		values.debug = {
			...debug,
			...(debug.steppingOptions ? { steppingOptions: { ...debug.steppingOptions } } : {}),
			sourceBreakpoints: debug.sourceBreakpoints?.map((source) => ({
				...source,
				lines: source.lines.slice(),
				...(source.breakpoints
					? { breakpoints: source.breakpoints.map((value) => ({ ...value })) }
					: {})
			}))
		};
	}
	return snapshot;
}

function validateSandboxExecutionOptions(
	code: string,
	options: SandboxExecutionOptions,
	phase: RuntimePhase = 'execute',
	trustProfile?: RuntimeTrustProfile,
	defaultExecutionLimits?: Readonly<Partial<ExecutionLimits>>
): ValidatedSandboxExecutionOptions {
	if (options.signal?.aborted) {
		throw new CancelledError('Runtime operation was cancelled before it started', {
			cause: options.signal.reason,
			phase
		});
	}
	if (options.interactive !== undefined && typeof options.interactive !== 'boolean') {
		throw new RuntimeConfigurationError('Interactive execution must be a boolean', { phase });
	}
	const limits = resolveExecutionLimits({ ...defaultExecutionLimits, ...options.limits });
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
	const { activePath, workspaceFiles } = validateExecutionWorkspace(
		code,
		options.workspaceFiles ?? [],
		options.activePath,
		workspaceLimits
	);

	const requestedRequirements = options.runtimeRequirements;
	if (requestedRequirements !== undefined && !trustProfile) {
		throw new RuntimeConfigurationError(
			'Runtime requirements cannot be admitted without a trust profile',
			{ phase }
		);
	}
	const wasmMemoryBytes = requestedRequirements?.wasmMemoryBytes ?? 0;
	if (!Number.isSafeInteger(wasmMemoryBytes) || wasmMemoryBytes < 0) {
		throw new RuntimeConfigurationError(
			'Runtime Wasm memory request must be a non-negative safe integer',
			{ phase }
		);
	}
	if (wasmMemoryBytes > limits.maxWasmMemoryBytes) {
		throw new RuntimeConfigurationError(
			`Runtime requested ${wasmMemoryBytes} Wasm memory bytes; execution limit is ${limits.maxWasmMemoryBytes}`,
			{ phase }
		);
	}
	const trustGrant = trustProfile
		? enforceRuntimeTrustProfile(trustProfile, {
				environment: options.env,
				networkUrls: requestedRequirements?.networkUrls,
				pageOrigin: requestedRequirements?.pageOrigin,
				storage: requestedRequirements?.storage,
				threads: requestedRequirements?.threads,
				nestedWorkers: requestedRequirements?.nestedWorkers,
				sharedArrayBuffer: requestedRequirements?.sharedArrayBuffer,
				dynamicCode: requestedRequirements?.dynamicCode,
				sameOriginAccess: requestedRequirements?.sameOriginAccess
			})
		: undefined;
	if (trustGrant && trustGrant.threads > limits.maxThreads) {
		throw new RuntimeConfigurationError(
			`Runtime requested ${trustGrant.threads} threads; execution limit is ${limits.maxThreads}`,
			{ phase }
		);
	}
	if (trustGrant && trustGrant.nestedWorkers > limits.maxWorkers) {
		throw new RuntimeConfigurationError(
			`Runtime requested ${trustGrant.nestedWorkers} nested workers; execution limit is ${limits.maxWorkers}`,
			{ phase }
		);
	}
	const runtimeRequirements =
		requestedRequirements && trustGrant
			? Object.freeze({
					wasmMemoryBytes,
					networkUrls: trustGrant.networkUrls,
					...(trustGrant.pageOrigin === undefined
						? {}
						: { pageOrigin: trustGrant.pageOrigin }),
					storage: trustGrant.storage,
					threads: trustGrant.threads,
					nestedWorkers: trustGrant.nestedWorkers,
					sharedArrayBuffer: trustGrant.sharedArrayBuffer,
					dynamicCode: trustGrant.dynamicCode,
					sameOriginAccess: trustGrant.sameOriginAccess
				})
			: undefined;
	const environment = trustGrant?.environment ?? options.env;
	return {
		...options,
		limits,
		...(options.workspaceLimits === undefined && options.limits?.maxWorkspaceBytes === undefined
			? {}
			: { workspaceLimits }),
		...(options.activePath === undefined ? {} : { activePath }),
		...(options.workspaceFiles === undefined ? {} : { workspaceFiles }),
		...(options.env === undefined ? {} : { env: environment }),
		...(runtimeRequirements === undefined ? {} : { runtimeRequirements })
	};
}

function runSandboxOperation<T>(
	sandbox: Sandbox,
	operationState: SandboxOperationState,
	operation: () => Promise<T>,
	signal: AbortSignal | undefined,
	timeoutMs: number | null,
	limits: ExecutionLimits,
	phase: RuntimePhase,
	retire: () => void,
	installSinks: (generation: number) => void
): Promise<T> {
	if (operationState.active) {
		return Promise.reject(
			new BusyError('A sandbox operation is already active', {
				phase
			})
		);
	}
	operationState.active = true;
	operationState.acceptOutput = true;
	const generation = ++operationState.generation;
	installSinks(generation);
	operationState.outputBytes = 0;
	operationState.diagnosticCount = 0;
	operationState.maxOutputBytes = limits.maxOutputBytes;
	operationState.maxDiagnostics = limits.maxDiagnostics;
	operationState.phase = phase;
	operationState.limitExceeded = false;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let operationStarted = false;
		let cancellationRequested = false;
		let cancellationPromise: Promise<void> | undefined;
		let cancellationCompletion: Promise<void> | undefined;
		let finishCancellation: (() => void) | undefined;
		let failCancellation: ((error: unknown) => void) | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let cancellationTimeout: ReturnType<typeof setTimeout> | undefined;

		const cleanup = () => {
			if (timeout !== undefined) clearTimeout(timeout);
			signal?.removeEventListener('abort', onAbort);
			operationState.onLimit = undefined;
			operationState.onDispose = undefined;
		};
		const requestCancellation = (cancel?: () => void | Promise<void>) => {
			if (cancellationRequested) return cancellationCompletion!;
			cancellationRequested = true;
			cancellationCompletion = new Promise<void>((yes, no) => {
				finishCancellation = yes;
				failCancellation = no;
			});
			// Automatic aborts report the original boundary error; explicit cancel callers can
			// additionally observe whether the adapter actually completed its cleanup.
			void cancellationCompletion.catch(() => undefined);
			cancellationTimeout = setTimeout(() => {
				retire();
				failCancellation?.(
					new TimeoutError('Sandbox cancellation did not settle within 1000 ms', {
						phase: 'dispose',
						timeoutMs: cancellationGraceMs
					})
				);
			}, cancellationGraceMs);
			try {
				const cancellation = cancel
					? cancel()
					: sandbox.cancel
						? sandbox.cancel()
						: sandbox.kill
							? sandbox.kill()
							: sandbox.terminate();
				cancellationPromise = Promise.resolve(cancellation).then(
					() => undefined,
					(error: unknown) => {
						retire();
						failCancellation?.(error);
					}
				);
			} catch (error) {
				// The boundary error remains authoritative even if runtime cleanup fails.
				retire();
				failCancellation?.(error);
				cancellationPromise = Promise.resolve();
			}
			return cancellationCompletion;
		};
		const releaseOperation = () => {
			if (cancellationTimeout !== undefined) clearTimeout(cancellationTimeout);
			finishCancellation?.();
			if (operationState.generation !== generation) return;
			operationState.active = false;
			operationState.acceptOutput = false;
			operationState.outputBytes = 0;
			operationState.diagnosticCount = 0;
			operationState.limitExceeded = false;
			operationState.onLimit = undefined;
			operationState.onDispose = undefined;
			operationState.onCancel = undefined;
		};
		const settle = (callback: () => void) => {
			if (settled) return;
			settled = true;
			operationState.acceptOutput = false;
			cleanup();
			callback();
		};
		const onAbort = () => {
			settle(() =>
				reject(
					new CancelledError('Runtime operation cancelled', {
						cause: signal?.reason,
						phase
					})
				)
			);
			if (operationStarted) requestCancellation();
			else releaseOperation();
		};
		operationState.onLimit = (error) => {
			settle(() => reject(error));
			if (operationStarted) requestCancellation();
			else releaseOperation();
		};
		operationState.onCancel = (cancel) => {
			settle(() => reject(new CancelledError('Runtime operation cancelled', { phase })));
			const completion = requestCancellation(cancel);
			if (!operationStarted) void cancellationPromise!.then(releaseOperation);
			return completion;
		};
		operationState.onDispose = () => {
			if (!operationStarted) releaseOperation();
			settle(() =>
				reject(
					new CancelledError(
						'Runtime operation cancelled because its sandbox was disposed',
						{
							phase: 'dispose'
						}
					)
				)
			);
		};

		signal?.addEventListener('abort', onAbort, { once: true });
		if (signal?.aborted) {
			onAbort();
			return;
		}
		if (timeoutMs !== null) {
			timeout = setTimeout(() => {
				settle(() =>
					reject(
						new TimeoutError(`Runtime ${phase} exceeded ${timeoutMs} ms`, {
							phase,
							timeoutMs
						})
					)
				);
				if (operationStarted) requestCancellation();
				else releaseOperation();
			}, timeoutMs);
		}
		void Promise.resolve().then(async () => {
			if (settled) {
				if (!cancellationRequested) releaseOperation();
				return;
			}
			operationStarted = true;
			try {
				const value = await operation();
				if (cancellationPromise) await cancellationPromise;
				releaseOperation();
				settle(() => resolve(value));
			} catch (error) {
				if (cancellationPromise) await cancellationPromise;
				releaseOperation();
				settle(() => reject(error));
			}
		});
	});
}

function combinedPhaseTimeoutMs(...phaseTimeoutsMs: number[]): number {
	return phaseTimeoutsMs.reduce(
		(total, timeoutMs) => Math.min(2_147_483_647, total + timeoutMs),
		0
	);
}

function bindRuntimeAssets(
	sandbox: Sandbox,
	runtimeAssets: SandboxRuntimeAssets,
	trustProfile?: RuntimeTrustProfile,
	persistentCache?: RuntimeAssetCacheOptions,
	onDispose?: () => void
): BoundSandbox {
	const cacheOptions = (
		call?: RuntimeAssetCacheOptions
	): RuntimeAssetCacheOptions | undefined => {
		if (persistentCache === undefined && call === undefined) return undefined;
		const overrides: Exclude<RuntimeAssetCacheOptions, false> = {};
		for (const layer of [persistentCache, call]) {
			if (layer === false) overrides.enabled = false;
			else if (layer) {
				Object.assign(
					overrides,
					Object.fromEntries(
						Object.entries(layer).filter(([, value]) => value !== undefined)
					)
				);
			}
		}
		// Validate explicit overrides, but never forward materialized global defaults as a
		// call-level policy: each runtime must first merge its own nested configuration.
		resolveRuntimeAssetCacheOptions(overrides);
		return overrides;
	};
	const defaultExecutionLimits = Object.freeze({ ...sandbox.defaultExecutionLimits });
	let disposePromise: Promise<void> | undefined;
	let disposed = false;
	const operationState: SandboxOperationState = {
		active: false,
		acceptOutput: false,
		generation: 0,
		outputBytes: 0,
		diagnosticCount: 0,
		maxOutputBytes: 0,
		maxDiagnostics: 0,
		phase: 'execute',
		limitExceeded: false
	};
	let outputSink = sandbox.output;
	let diagnosticSink = sandbox.oncompilerdiagnostic;
	const emitOutput = (generation: number, data: string) => {
		if (disposed || !operationState.acceptOutput || operationState.generation !== generation)
			return;
		if (operationState.limitExceeded) return;
		const actual = operationState.outputBytes + workspaceTextEncoder.encode(data).byteLength;
		if (actual > operationState.maxOutputBytes) {
			operationState.outputBytes = actual;
			operationState.limitExceeded = true;
			operationState.onLimit?.(
				new OutputLimitError(
					`Runtime output exceeded ${operationState.maxOutputBytes} bytes`,
					{
						limit: operationState.maxOutputBytes,
						actual,
						phase: operationState.phase
					}
				)
			);
			return;
		}
		operationState.outputBytes = actual;
		outputSink?.(data);
	};
	const emitDiagnostic = (generation: number, diagnostic: unknown) => {
		if (disposed || !operationState.acceptOutput || operationState.generation !== generation)
			return;
		if (operationState.limitExceeded) return;
		const actual = operationState.diagnosticCount + 1;
		if (actual > operationState.maxDiagnostics) {
			operationState.diagnosticCount = actual;
			operationState.limitExceeded = true;
			operationState.onLimit?.(
				new DiagnosticLimitError(
					`Runtime diagnostics exceeded ${operationState.maxDiagnostics} entries`,
					{
						limit: operationState.maxDiagnostics,
						actual,
						phase: operationState.phase === 'execute' ? 'compile' : operationState.phase
					}
				)
			);
			return;
		}
		operationState.diagnosticCount = actual;
		diagnosticSink?.(diagnostic);
	};
	const installBoundarySinks = (generation = operationState.generation) => {
		sandbox.output = (data) => emitOutput(generation, data);
		sandbox.oncompilerdiagnostic = (diagnostic) => emitDiagnostic(generation, diagnostic);
	};
	const dispose = () => {
		if (!disposePromise) {
			disposed = true;
			operationState.acceptOutput = false;
			operationState.onDispose?.();
			onDispose?.();
			const cleanup = Promise.resolve().then(async () => {
				if (sandbox.dispose) await sandbox.dispose();
				else await sandbox.terminate();
			});
			disposePromise = new Promise<void>((resolve, reject) => {
				const deadline = setTimeout(() => {
					reject(
						new TimeoutError('Sandbox disposal did not settle within 1000 ms', {
							phase: 'dispose',
							timeoutMs: cancellationGraceMs
						})
					);
				}, cancellationGraceMs);
				cleanup.then(
					() => {
						clearTimeout(deadline);
						resolve();
					},
					(error: unknown) => {
						clearTimeout(deadline);
						reject(error);
					}
				);
			});
		}
		return disposePromise;
	};
	const retire = () => {
		// A retirement fences the instance even when disposal itself never settles.
		// Only a fresh instance from binding.load() may be used after this point.
		void dispose().catch(() => undefined);
	};
	const assertNotDisposed = () => {
		if (disposed) {
			throw new RuntimeConfigurationError('Cannot use a disposed sandbox', {
				phase: 'dispose'
			});
		}
	};
	installBoundarySinks();
	return new Proxy(sandbox, {
		get(target, prop, receiver) {
			if (prop === 'runtimeAssets') return runtimeAssets;
			if (prop === 'trustProfile') return trustProfile;
			if (prop === 'output') return outputSink;
			if (prop === 'oncompilerdiagnostic') return diagnosticSink;
			if (prop === 'dispose') {
				return dispose;
			}
			if (prop === 'cancel' || prop === 'kill' || prop === 'terminate') {
				const cancel = target[prop];
				if (cancel) {
					return (runId?: RuntimeRunId) => {
						if (disposed) return disposePromise;
						const invoke = () => cancel.call(target, runId);
						// Only the adapter can match its protocol run IDs; a stale targeted cancel
						// must not cancel the boundary's unrelated current operation.
						if (runId !== undefined) return invoke();
						return operationState.onCancel ? operationState.onCancel(invoke) : invoke();
					};
				}
			}
			if (prop === 'restart') {
				return async () => {
					assertNotDisposed();
					if (operationState.active) {
						throw new BusyError(
							'Cannot restart a runtime while an operation is active',
							{
								phase: operationState.phase
							}
						);
					}
					installBoundarySinks();
					if (target.restart) await target.restart();
					else await target.clear();
				};
			}
			if (prop === 'load') {
				return async (
					code = '',
					log = true,
					args: string[] = [],
					options: SandboxExecutionOptions = {},
					progress?: SandboxProgress
				) => {
					assertNotDisposed();
					const executionArgs = args.slice();
					const snapshot = snapshotExecutionInputs(options);
					const validated = validateSandboxExecutionOptions(
						code,
						{ ...snapshot, persistentCache: cacheOptions(snapshot.persistentCache) },
						'startup',
						trustProfile,
						defaultExecutionLimits
					);
					return runSandboxOperation(
						target,
						operationState,
						() =>
							target.load(
								runtimeAssets,
								code,
								log,
								executionArgs,
								validated,
								progress
							),
						validated.signal,
						combinedPhaseTimeoutMs(
							validated.limits.assetTimeoutMs,
							validated.limits.startupTimeoutMs
						),
						validated.limits,
						'startup',
						retire,
						installBoundarySinks
					);
				};
			}
			const execute = target.execute;
			if (prop === 'execute' && execute) {
				return async (request: ExecutionRequest) => {
					assertNotDisposed();
					// Copy caller-owned values before validation and the asynchronous dispatch.
					const snapshot = snapshotExecutionInputs(request);
					const validated = validateSandboxExecutionOptions(
						snapshot.code,
						{
							activePath: snapshot.activePath,
							persistentCache: cacheOptions(snapshot.persistentCache),
							workspaceFiles: snapshot.workspaceFiles,
							args: snapshot.args,
							compileArgs: snapshot.compileArgs,
							debug: snapshot.debug,
							env: snapshot.env,
							...(snapshot.runtimeRequirements === undefined
								? {}
								: { runtimeRequirements: snapshot.runtimeRequirements }),
							limits: snapshot.limits ?? {},
							signal: snapshot.signal,
							stdin: snapshot.stdin
						},
						'execute',
						trustProfile,
						defaultExecutionLimits
					);
					return runSandboxOperation(
						target,
						operationState,
						async () => {
							const result = await execute.call(target, {
								...snapshot,
								env: validated.env,
								persistentCache: validated.persistentCache,
								activePath: validated.activePath,
								workspaceFiles: validated.workspaceFiles,
								...(validated.runtimeRequirements === undefined
									? {}
									: { runtimeRequirements: validated.runtimeRequirements }),
								limits: validated.limits
							});
							return validateExecutionResult(result, validated.limits);
						},
						validated.signal,
						combinedPhaseTimeoutMs(
							validated.limits.compileTimeoutMs,
							validated.limits.runTimeoutMs
						),
						validated.limits,
						'execute',
						retire,
						installBoundarySinks
					);
				};
			}
			if (prop === 'run') {
				return async (
					code: string,
					prepare: boolean,
					log?: boolean,
					progress?: SandboxProgress,
					args?: string[],
					options: SandboxExecutionOptions = {}
				) => {
					assertNotDisposed();
					const executionArgs = args?.slice();
					const snapshot = snapshotExecutionInputs(options);
					const validated = validateSandboxExecutionOptions(
						code,
						{ ...snapshot, persistentCache: cacheOptions(snapshot.persistentCache) },
						'execute',
						trustProfile,
						defaultExecutionLimits
					);
					return runSandboxOperation(
						target,
						operationState,
						() => target.run(code, prepare, log, progress, executionArgs, validated),
						validated.signal,
						// Legacy prepare hooks may lazily fetch and initialize compiler assets.
						// Reserve those phase budgets without granting prepare any run time.
						prepare
							? combinedPhaseTimeoutMs(
									validated.limits.assetTimeoutMs,
									validated.limits.startupTimeoutMs,
									validated.limits.compileTimeoutMs
								)
							: validated.interactive === true
								? null
								: combinedPhaseTimeoutMs(
										validated.limits.compileTimeoutMs,
										validated.limits.runTimeoutMs
									),
						validated.limits,
						'execute',
						retire,
						installBoundarySinks
					);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
		set(target, prop, value, receiver) {
			if (prop === 'output') {
				outputSink = typeof value === 'function' ? value : undefined;
				installBoundarySinks();
				return true;
			}
			if (prop === 'oncompilerdiagnostic') {
				diagnosticSink = typeof value === 'function' ? value : undefined;
				installBoundarySinks();
				return true;
			}
			return Reflect.set(target, prop, value, receiver);
		}
	}) as BoundSandbox;
}

export function createPlaygroundBinding(
	runtimeAssets: SandboxRuntimeAssets,
	loadSandbox: SandboxLoader,
	options: PlaygroundBindingOptions = {}
): PlaygroundBinding {
	if (options.prewarm !== undefined && typeof options.prewarm !== 'boolean') {
		throw new TypeError('prewarm must be a boolean');
	}
	const trustProfile = options.trustProfile
		? defineRuntimeTrustProfile(options.trustProfile)
		: undefined;
	const sandboxes = new Set<BoundSandbox>();
	const claimedKeys = new Map<string, number>();
	const claimedSandboxes = new WeakMap<BoundSandbox, string>();
	let disposed = false;
	let disposePromise: Promise<void> | undefined;
	const normalize = (language: string) => {
		if (disposed)
			throw new RuntimeConfigurationError('Cannot load a sandbox from a disposed binding', {
				phase: 'dispose'
			});
		const normalized = normalizeLanguageId(language);
		if (!normalized) throw new UnsupportedLanguageError(language);
		return normalized;
	};
	const create = async (language: string) => {
		const sandbox = bindRuntimeAssets(
			await loadSandbox(language),
			runtimeAssets,
			trustProfile,
			options.persistentCache,
			() => {
				sandboxes.delete(sandbox);
				const cacheKey = claimedSandboxes.get(sandbox);
				if (cacheKey === undefined) return;
				claimedSandboxes.delete(sandbox);
				const remaining = (claimedKeys.get(cacheKey) ?? 1) - 1;
				if (remaining > 0) claimedKeys.set(cacheKey, remaining);
				else claimedKeys.delete(cacheKey);
			}
		);
		if (disposed) {
			if (sandbox.dispose) await sandbox.dispose();
			else await sandbox.terminate();
			throw new RuntimeConfigurationError('Binding was disposed while loading a sandbox', {
				phase: 'dispose'
			});
		}
		sandboxes.add(sandbox);
		return sandbox;
	};
	const key = (language: string) =>
		JSON.stringify([language, createRuntimeAssetsKey(runtimeAssets)]);
	const loadingKeys = new Map<string, number>();
	const prewarmer = createRuntimePrewarmer(
		async (cacheKey, signal) => {
			const [language] = JSON.parse(cacheKey) as [string, string];
			const sandbox = await create(language);
			try {
				await sandbox.load('', false, [], { signal });
				return sandbox;
			} catch (error) {
				sandboxes.delete(sandbox);
				if (sandbox.dispose) await sandbox.dispose();
				else await sandbox.terminate();
				throw error;
			}
		},
		{
			enabled: options.prewarm,
			async release(sandbox) {
				sandboxes.delete(sandbox);
				if (sandbox.dispose) await sandbox.dispose();
				else await sandbox.terminate();
			}
		}
	);
	const binding = {
		runtimeAssets,
		trustProfile,
		terminalProps: {} as PlaygroundBinding['terminalProps'],
		async load(language: string) {
			const normalized = normalize(language);
			const cacheKey = key(normalized);
			loadingKeys.set(cacheKey, (loadingKeys.get(cacheKey) ?? 0) + 1);
			try {
				const pendingWarm = prewarmer.take(cacheKey);
				const warmed = pendingWarm ? await pendingWarm : undefined;
				// Disposing a binding during warm-up must never hand out a dead resource.
				normalize(normalized);
				const sandbox = warmed ?? (await create(normalized));
				claimedSandboxes.set(sandbox, cacheKey);
				claimedKeys.set(cacheKey, (claimedKeys.get(cacheKey) ?? 0) + 1);
				return sandbox;
			} finally {
				const remaining = (loadingKeys.get(cacheKey) ?? 1) - 1;
				if (remaining > 0) loadingKeys.set(cacheKey, remaining);
				else loadingKeys.delete(cacheKey);
			}
		},
		prewarm(language: string) {
			if (!prewarmer.enabled) return Promise.resolve(false);
			const cacheKey = key(normalize(language));
			// Do not create a spare copy of a runtime already owned by a consumer.
			return claimedKeys.has(cacheKey) || loadingKeys.has(cacheKey)
				? Promise.resolve(false)
				: prewarmer.warm(cacheKey);
		},
		setPrewarmEnabled: prewarmer.setEnabled,
		cancelPrewarm: prewarmer.cancel,
		dispose() {
			if (!disposePromise) {
				disposed = true;
				const ownedSandboxes = [...sandboxes];
				sandboxes.clear();
				disposePromise = Promise.allSettled([
					prewarmer.dispose(),
					...ownedSandboxes.map((sandbox) =>
						sandbox.dispose ? sandbox.dispose() : sandbox.terminate()
					)
				]).then((results) => {
					const errors = results.flatMap((result) =>
						result.status === 'rejected' ? [result.reason] : []
					);
					if (errors.length === 1) throw errors[0];
					if (errors.length > 1)
						throw new AggregateError(errors, 'Playground binding cleanup failed');
				});
			}
			return disposePromise;
		}
	} as PlaygroundBinding;
	binding.terminalProps = { playground: binding, runtimeAssets, trustProfile };
	return binding;
}
