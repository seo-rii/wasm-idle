import type {
	DebugCommand,
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
	stdin?: string | AsyncIterable<Uint8Array>;
	workspaceFiles?: WorkspaceFile[];
	workspaceLimits?: Partial<WorkspaceLimits>;
}

interface ValidatedSandboxExecutionOptions extends SandboxExecutionOptions {
	limits: ExecutionLimits;
}

interface SandboxOperationState {
	active: boolean;
	outputBytes: number;
	diagnosticCount: number;
	maxOutputBytes: number;
	maxDiagnostics: number;
	phase: RuntimePhase;
	limitExceeded: boolean;
	onLimit?: (error: OutputLimitError | DiagnosticLimitError) => void;
	onDispose?: () => void;
}

export interface SandboxLifecycle {
	cancel: (runId?: RuntimeRunId) => void | Promise<void>;
	reset: () => void | Promise<void>;
	restart: () => void | Promise<void>;
	clearOutput: () => void | Promise<void>;
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
	debugVariables?: (
		variablesReference: number,
		start?: number,
		count?: number
	) => Promise<DebugVariable[]>;
	debugScopes?: (frameId: number) => Promise<DebugScope[]>;
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
	dispose: () => Promise<void>;
}

export type SandboxLoader = (language: string) => Promise<Sandbox>;

export interface PlaygroundBindingOptions {
	trustProfile?: RuntimeTrustProfile;
}

const workspaceTextEncoder = new TextEncoder();

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
	phase: RuntimePhase
): Promise<T> {
	if (operationState.active) {
		return Promise.reject(
			new BusyError('A sandbox operation is already active', {
				phase
			})
		);
	}
	operationState.active = true;
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
		let timeout: ReturnType<typeof setTimeout> | undefined;

		const cleanup = () => {
			if (timeout !== undefined) clearTimeout(timeout);
			signal?.removeEventListener('abort', onAbort);
			operationState.onLimit = undefined;
			operationState.onDispose = undefined;
		};
		const requestCancellation = () => {
			if (cancellationRequested) return;
			cancellationRequested = true;
			try {
				const cancellation = sandbox.cancel
					? sandbox.cancel()
					: sandbox.kill
						? sandbox.kill()
						: sandbox.terminate();
				cancellationPromise = Promise.resolve(cancellation).then(
					() => undefined,
					() => undefined
				);
			} catch {
				// The boundary error remains authoritative even if runtime cleanup fails.
				cancellationPromise = Promise.resolve();
			}
		};
		const releaseOperation = () => {
			operationState.active = false;
			operationState.outputBytes = 0;
			operationState.diagnosticCount = 0;
			operationState.limitExceeded = false;
			operationState.onLimit = undefined;
			operationState.onDispose = undefined;
		};
		const settle = (callback: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};
		const onAbort = () => {
			if (operationStarted) requestCancellation();
			else releaseOperation();
			settle(() =>
				reject(
					new CancelledError('Runtime operation cancelled', {
						cause: signal?.reason,
						phase
					})
				)
			);
		};
		operationState.onLimit = (error) => {
			if (operationStarted) requestCancellation();
			else releaseOperation();
			settle(() => reject(error));
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
				if (operationStarted) requestCancellation();
				else releaseOperation();
				settle(() =>
					reject(
						new TimeoutError(`Runtime ${phase} exceeded ${timeoutMs} ms`, {
							phase,
							timeoutMs
						})
					)
				);
			}, timeoutMs);
		}
		void Promise.resolve().then(async () => {
			if (settled) {
				releaseOperation();
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
	trustProfile?: RuntimeTrustProfile
): BoundSandbox {
	const defaultExecutionLimits = Object.freeze({ ...sandbox.defaultExecutionLimits });
	let disposePromise: Promise<void> | undefined;
	let disposed = false;
	const operationState: SandboxOperationState = {
		active: false,
		outputBytes: 0,
		diagnosticCount: 0,
		maxOutputBytes: 0,
		maxDiagnostics: 0,
		phase: 'execute',
		limitExceeded: false
	};
	let outputSink = sandbox.output;
	let diagnosticSink = sandbox.oncompilerdiagnostic;
	const emitOutput = (data: string) => {
		if (!operationState.active) {
			outputSink?.(data);
			return;
		}
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
	const emitDiagnostic = (diagnostic: unknown) => {
		if (!operationState.active) {
			diagnosticSink?.(diagnostic);
			return;
		}
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
	const installBoundarySinks = () => {
		sandbox.output = emitOutput;
		sandbox.oncompilerdiagnostic = emitDiagnostic;
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
				return () => {
					if (!disposePromise) {
						disposed = true;
						operationState.onDispose?.();
						disposePromise = (async () => {
							if (target.dispose) await target.dispose();
							else await target.terminate();
						})();
					}
					return disposePromise;
				};
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
					const validated = validateSandboxExecutionOptions(
						code,
						options,
						'startup',
						trustProfile,
						defaultExecutionLimits
					);
					installBoundarySinks();
					return runSandboxOperation(
						target,
						operationState,
						() => target.load(runtimeAssets, code, log, args, validated, progress),
						validated.signal,
						combinedPhaseTimeoutMs(
							validated.limits.assetTimeoutMs,
							validated.limits.startupTimeoutMs
						),
						validated.limits,
						'startup'
					);
				};
			}
			const execute = target.execute;
			if (prop === 'execute' && execute) {
				return async (request: ExecutionRequest) => {
					assertNotDisposed();
					const validated = validateSandboxExecutionOptions(
						request.code,
						{
							activePath: request.activePath,
							workspaceFiles: request.workspaceFiles,
							args: request.args,
							compileArgs: request.compileArgs,
							debug: request.debug,
							env: request.env,
							...(request.runtimeRequirements === undefined
								? {}
								: { runtimeRequirements: request.runtimeRequirements }),
							limits: request.limits ?? {},
							signal: request.signal,
							stdin: request.stdin
						},
						'execute',
						trustProfile,
						defaultExecutionLimits
					);
					installBoundarySinks();
					return runSandboxOperation(
						target,
						operationState,
						async () => {
							const result = await execute.call(target, {
								...request,
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
						'execute'
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
					const validated = validateSandboxExecutionOptions(
						code,
						options,
						'execute',
						trustProfile,
						defaultExecutionLimits
					);
					installBoundarySinks();
					return runSandboxOperation(
						target,
						operationState,
						() => target.run(code, prepare, log, progress, args, validated),
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
						'execute'
					);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
		set(target, prop, value, receiver) {
			if (prop === 'output') {
				outputSink = typeof value === 'function' ? value : undefined;
				target.output = emitOutput;
				return true;
			}
			if (prop === 'oncompilerdiagnostic') {
				diagnosticSink = typeof value === 'function' ? value : undefined;
				target.oncompilerdiagnostic = emitDiagnostic;
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
	const trustProfile = options.trustProfile
		? defineRuntimeTrustProfile(options.trustProfile)
		: undefined;
	const sandboxes = new Set<BoundSandbox>();
	let disposed = false;
	let disposePromise: Promise<void> | undefined;
	const binding = {
		runtimeAssets,
		trustProfile,
		terminalProps: {} as PlaygroundBinding['terminalProps'],
		async load(language: string) {
			if (disposed) {
				throw new RuntimeConfigurationError(
					'Cannot load a sandbox from a disposed binding',
					{
						phase: 'dispose'
					}
				);
			}
			const normalizedLanguage = normalizeLanguageId(language);
			if (!normalizedLanguage) throw new UnsupportedLanguageError(language);
			const sandbox = bindRuntimeAssets(
				await loadSandbox(normalizedLanguage),
				runtimeAssets,
				trustProfile
			);
			if (disposed) {
				if (sandbox.dispose) await sandbox.dispose();
				else await sandbox.terminate();
				throw new RuntimeConfigurationError(
					'Binding was disposed while loading a sandbox',
					{
						phase: 'dispose'
					}
				);
			}
			sandboxes.add(sandbox);
			return sandbox;
		},
		dispose() {
			if (!disposePromise) {
				disposed = true;
				const ownedSandboxes = [...sandboxes];
				sandboxes.clear();
				disposePromise = Promise.all(
					ownedSandboxes.map((sandbox) =>
						sandbox.dispose ? sandbox.dispose() : sandbox.terminate()
					)
				).then(() => undefined);
			}
			return disposePromise;
		}
	} as PlaygroundBinding;
	binding.terminalProps = {
		playground: binding,
		runtimeAssets,
		trustProfile
	};
	return binding;
}
