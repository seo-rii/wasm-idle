import type {
	DebugCommand,
	DebugMemory,
	DebugSessionEvent,
	DebugSourceBreakpoints,
	DebugVariable
} from './debug.js';
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
	type ExecutionLimits,
	type ExecutionRequest,
	type ExecutionResult
} from './execution.js';
import type { ProgressLike } from './progress.js';
import type { RuntimeRunId } from './protocol.js';
import type { RuntimeAssetKeySource } from './runtime-assets.js';
import {
	DEFAULT_WORKSPACE_LIMITS,
	WorkspaceValidationError,
	normalizeWorkspacePath,
	validateWorkspaceFiles,
	type WorkspaceFile,
	type WorkspaceLimits
} from './workspace.js';

export type SandboxRuntimeAssets = string | RuntimeAssetKeySource;
export type SandboxProgress = ProgressLike;

export interface SandboxExecutionOptions {
	[key: string]: unknown;
	activePath?: string;
	env?: Record<string, string>;
	limits?: Partial<ExecutionLimits>;
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
}

export interface SandboxLifecycle {
	cancel: (runId?: RuntimeRunId) => void | Promise<void>;
	reset: () => void | Promise<void>;
	clearOutput: () => void | Promise<void>;
	dispose: () => void | Promise<void>;
}

export interface Sandbox {
	constructor: unknown;
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
	debugReadMemory?: (
		memoryReference: string,
		offset: number,
		count: number
	) => Promise<DebugMemory | null>;
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
}

export interface PlaygroundTerminalProps {
	playground: PlaygroundBinding;
	runtimeAssets: SandboxRuntimeAssets;
}

export interface PlaygroundBinding {
	runtimeAssets: SandboxRuntimeAssets;
	terminalProps: PlaygroundTerminalProps;
	load: (language: string) => Promise<BoundSandbox>;
	dispose: () => Promise<void>;
}

export type SandboxLoader = (language: string) => Promise<Sandbox>;

const workspaceTextEncoder = new TextEncoder();

function validateSandboxExecutionOptions(
	code: string,
	options: SandboxExecutionOptions,
	phase: RuntimePhase = 'execute'
): ValidatedSandboxExecutionOptions {
	if (options.signal?.aborted) {
		throw new CancelledError('Runtime operation was cancelled before it started', {
			cause: options.signal.reason,
			phase
		});
	}
	const limits = resolveExecutionLimits(options.limits);
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
	const workspaceFiles = validateWorkspaceFiles(options.workspaceFiles ?? [], workspaceLimits);
	const activePath =
		options.activePath === undefined ? undefined : normalizeWorkspacePath(options.activePath);

	if (activePath !== undefined) {
		validateWorkspaceFiles(
			[
				...workspaceFiles.filter((file) => file.path !== activePath),
				{ path: activePath, content: code }
			],
			workspaceLimits
		);
	} else {
		const maxFiles = workspaceLimits.maxFiles ?? DEFAULT_WORKSPACE_LIMITS.maxFiles;
		const maxFileBytes = workspaceLimits.maxFileBytes;
		const maxTotalBytes = workspaceLimits.maxTotalBytes;
		const sourceBytes = workspaceTextEncoder.encode(code).byteLength;
		if (workspaceFiles.length + 1 > maxFiles) {
			throw new WorkspaceValidationError(
				'file-count-limit',
				`Workspace plus active source contains ${workspaceFiles.length + 1} files; limit is ${maxFiles}`,
				{ limit: maxFiles, actual: workspaceFiles.length + 1 }
			);
		}
		if (sourceBytes > maxFileBytes) {
			throw new WorkspaceValidationError(
				'file-size-limit',
				`Active source is ${sourceBytes} bytes; limit is ${maxFileBytes}`,
				{ limit: maxFileBytes, actual: sourceBytes }
			);
		}
		let totalBytes = sourceBytes;
		for (const file of workspaceFiles) {
			totalBytes +=
				typeof file.content === 'string'
					? workspaceTextEncoder.encode(file.content).byteLength
					: file.content.byteLength;
		}
		if (totalBytes > maxTotalBytes) {
			throw new WorkspaceValidationError(
				'total-size-limit',
				`Workspace plus active source is ${totalBytes} bytes; limit is ${maxTotalBytes}`,
				{ limit: maxTotalBytes, actual: totalBytes }
			);
		}
	}

	return {
		...options,
		limits,
		...(options.workspaceLimits === undefined && options.limits?.maxWorkspaceBytes === undefined
			? {}
			: { workspaceLimits }),
		...(options.activePath === undefined ? {} : { activePath }),
		...(options.workspaceFiles === undefined ? {} : { workspaceFiles })
	};
}

function runSandboxOperation<T>(
	sandbox: Sandbox,
	operationState: SandboxOperationState,
	operation: () => Promise<T>,
	signal: AbortSignal | undefined,
	timeoutMs: number,
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
		let timeout: ReturnType<typeof setTimeout> | undefined;

		const cleanup = () => {
			if (timeout !== undefined) clearTimeout(timeout);
			signal?.removeEventListener('abort', onAbort);
			operationState.onLimit = undefined;
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
				void Promise.resolve(cancellation).catch(() => undefined);
			} catch {
				// The boundary error remains authoritative even if runtime cleanup fails.
			}
		};
		const releaseOperation = () => {
			operationState.active = false;
			operationState.outputBytes = 0;
			operationState.diagnosticCount = 0;
			operationState.limitExceeded = false;
			operationState.onLimit = undefined;
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

		signal?.addEventListener('abort', onAbort, { once: true });
		if (signal?.aborted) {
			onAbort();
			return;
		}
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
		void Promise.resolve().then(async () => {
			if (settled) {
				releaseOperation();
				return;
			}
			operationStarted = true;
			try {
				const value = await operation();
				releaseOperation();
				settle(() => resolve(value));
			} catch (error) {
				releaseOperation();
				settle(() => reject(error));
			}
		});
	});
}

function combinedPhaseTimeoutMs(firstTimeoutMs: number, secondTimeoutMs: number): number {
	return Math.min(2_147_483_647, firstTimeoutMs + secondTimeoutMs);
}

function bindRuntimeAssets(sandbox: Sandbox, runtimeAssets: SandboxRuntimeAssets): BoundSandbox {
	let disposePromise: Promise<void> | undefined;
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
	installBoundarySinks();
	return new Proxy(sandbox, {
		get(target, prop, receiver) {
			if (prop === 'runtimeAssets') return runtimeAssets;
			if (prop === 'output') return outputSink;
			if (prop === 'oncompilerdiagnostic') return diagnosticSink;
			if (prop === 'dispose') {
				return () => {
					if (!disposePromise) {
						disposePromise = (async () => {
							if (target.dispose) await target.dispose();
							else await target.terminate();
						})();
					}
					return disposePromise;
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
					const validated = validateSandboxExecutionOptions(code, options, 'startup');
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
					const validated = validateSandboxExecutionOptions(request.code, {
						activePath: request.activePath,
						workspaceFiles: request.workspaceFiles,
						args: request.args,
						compileArgs: request.compileArgs,
						debug: request.debug,
						env: request.env,
						limits: request.limits ?? {},
						signal: request.signal,
						stdin: request.stdin
					});
					installBoundarySinks();
					return runSandboxOperation(
						target,
						operationState,
						async () => {
							const result = await execute.call(target, {
								...request,
								activePath: validated.activePath,
								workspaceFiles: validated.workspaceFiles,
								limits: validated.limits
							});
							const outputBytes =
								workspaceTextEncoder.encode(result.stdout).byteLength +
								workspaceTextEncoder.encode(result.stderr).byteLength;
							if (outputBytes > validated.limits.maxOutputBytes) {
								throw new OutputLimitError(
									`Runtime output exceeded ${validated.limits.maxOutputBytes} bytes`,
									{
										limit: validated.limits.maxOutputBytes,
										actual: outputBytes
									}
								);
							}
							if (result.diagnostics.length > validated.limits.maxDiagnostics) {
								throw new DiagnosticLimitError(
									`Runtime diagnostics exceeded ${validated.limits.maxDiagnostics} entries`,
									{
										limit: validated.limits.maxDiagnostics,
										actual: result.diagnostics.length
									}
								);
							}
							return result;
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
					const validated = validateSandboxExecutionOptions(code, options);
					installBoundarySinks();
					return runSandboxOperation(
						target,
						operationState,
						() => target.run(code, prepare, log, progress, args, validated),
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
	loadSandbox: SandboxLoader
): PlaygroundBinding {
	const sandboxes = new Set<BoundSandbox>();
	let disposed = false;
	let disposePromise: Promise<void> | undefined;
	const binding = {
		runtimeAssets,
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
			const sandbox = bindRuntimeAssets(await loadSandbox(normalizedLanguage), runtimeAssets);
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
		runtimeAssets
	};
	return binding;
}
