import {
	BusyError,
	CancelledError,
	CompileError,
	DiagnosticLimitError,
	OutputLimitError,
	ProtocolError,
	RuntimeConfigurationError,
	RuntimeExecutionError,
	TimeoutError,
	UnsupportedBrowserFeatureError,
	resolveExecutionLimits,
	validateWorkspaceFiles,
	type ExecutionLimits,
	type RuntimeAssetCacheOptions,
	type RuntimePhase
} from '@wasm-idle/core';
import type { PlaygroundRuntimeAssets } from './assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from './options';
import type { Sandbox, SandboxProgress } from './sandbox';
import { createScalaCompilerPayload } from './scalaAssets';
import { parseScalaDiagnostics } from './scalaDiagnostics';
import { reportWorkerProgress, type WorkerProgressPayload } from './workerProgress';

type Reply = {
	progress?: WorkerProgressPayload;
	failureKind?: string;
	limit?: number;
	actual?: number;
	id: number;
	type: string;
	code?: string;
	message?: string;
	diagnostics?: string[];
	exitCode?: number;
	data?: string;
};
type Operation = { controller: AbortController; signal?: AbortSignal; abort: () => void };
const encoder = new TextEncoder();
const HARD_SOURCE_BYTES = 1024 * 1024;

/** Scala 3 through the genuine browser compiler and Scala.js linker. */
export default class Scala implements Sandbox {
	output?: (data: string) => void;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	elapse = 0;
	private compiler: Worker | null = null;
	private execution: Worker | null = null;
	private active: Operation | null = null;
	private disposed = false;
	private sequence = 0;
	private payload: Record<string, Uint8Array> | null = null;
	private payloadKey = '';
	private baseUrl?: string;
	private cache?: RuntimeAssetCacheOptions;
	private pendingInput = '';

	private begin(signal?: AbortSignal): Operation {
		if (this.disposed)
			throw new RuntimeConfigurationError('Scala sandbox is disposed', {
				runtimeId: 'SCALA'
			});
		if (this.active) throw new BusyError('Scala sandbox is busy', { runtimeId: 'SCALA' });
		if (signal?.aborted)
			throw new CancelledError('Scala request aborted', {
				runtimeId: 'SCALA',
				cause: signal.reason
			});
		const controller = new AbortController();
		const operation: Operation = {
			controller,
			signal,
			abort: () => controller.abort(signal?.reason)
		};
		signal?.addEventListener('abort', operation.abort, { once: true });
		this.active = operation;
		return operation;
	}

	private check(operation: Operation) {
		if (this.disposed || this.active !== operation || operation.controller.signal.aborted)
			throw new CancelledError('Scala request cancelled', {
				runtimeId: 'SCALA',
				cause: operation.controller.signal.reason
			});
	}

	private end(operation: Operation) {
		operation.signal?.removeEventListener('abort', operation.abort);
		if (this.active === operation) this.active = null;
	}

	private validateOptions(options: SandboxExecutionOptions) {
		if (
			(options.debugMode && options.debugMode !== 'none') ||
			options.debug ||
			options.interactive ||
			options.compileArgs?.length ||
			Object.keys(options.env ?? {}).length
		)
			throw new RuntimeConfigurationError(
				'Scala.js supports buffered stdin and program arguments; debugging, interactive input, compiler options and environment overrides are unavailable.',
				{ runtimeId: 'SCALA' }
			);
		for (const feature of ['JSTag', 'Suspending', 'promising'] as const) {
			if (
				typeof globalThis.WebAssembly?.[feature as keyof typeof WebAssembly] === 'undefined'
			)
				throw new UnsupportedBrowserFeatureError(
					`WebAssembly.${feature} (Scala browser compiler)`,
					{ runtimeId: 'SCALA' }
				);
		}
	}

	private files(code: string, options: SandboxExecutionOptions, limits: ExecutionLimits) {
		const activePath = options.activePath ?? 'Main.scala';
		const files = (
			options.workspaceFiles?.length
				? options.workspaceFiles
				: [{ path: activePath, content: code }]
		).map((file) => ({
			path: file.path,
			content: file.path === activePath ? code : file.content
		}));
		if (!files.some((file) => file.path === activePath))
			files.push({ path: activePath, content: code });
		const validated = validateWorkspaceFiles(files, {
			...options.workspaceLimits,
			maxFiles: Math.min(options.workspaceLimits?.maxFiles ?? 64, 64),
			maxFileBytes: Math.min(
				options.workspaceLimits?.maxFileBytes ?? HARD_SOURCE_BYTES,
				HARD_SOURCE_BYTES
			),
			maxTotalBytes: Math.min(
				options.workspaceLimits?.maxTotalBytes ?? HARD_SOURCE_BYTES,
				HARD_SOURCE_BYTES,
				limits.maxWorkspaceBytes
			)
		});
		for (const file of validated) {
			if (
				!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.scala$/.test(file.path) ||
				file.path === 'WasmIdleScalaRunner.scala'
			)
				throw new RuntimeConfigurationError(`Unsupported Scala source path: ${file.path}`, {
					runtimeId: 'SCALA'
				});
		}
		return validated;
	}

	private retire(worker: Worker) {
		worker.terminate();
		if (this.compiler === worker) this.compiler = null;
		if (this.execution === worker) this.execution = null;
	}

	private request(
		worker: Worker,
		payload: Record<string, unknown>,
		operation: Operation,
		phase: RuntimePhase,
		timeoutMs: number,
		onOutput?: (stream: string, text: string) => void,
		progress?: SandboxProgress
	): Promise<Reply> {
		this.check(operation);
		return new Promise((resolve, reject) => {
			const id = ++this.sequence;
			let settled = false;
			const finish = (error?: unknown, reply?: Reply) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				operation.controller.signal.removeEventListener('abort', abort);
				worker.onmessage = null;
				worker.onerror = null;
				worker.onmessageerror = null;
				if (error) {
					this.retire(worker);
					reject(error);
				} else resolve(reply!);
			};
			const abort = () =>
				finish(
					new CancelledError('Scala request cancelled', { runtimeId: 'SCALA', phase })
				);
			const timer = setTimeout(
				() =>
					finish(
						new TimeoutError(`Scala ${phase} timed out`, {
							runtimeId: 'SCALA',
							phase,
							timeoutMs
						})
					),
				timeoutMs
			);
			operation.controller.signal.addEventListener('abort', abort, { once: true });
			worker.onmessage = ({ data }: MessageEvent<Reply>) => {
				if (data.id !== id) return;
				try {
					if (data.type === 'execution-ready') {
						reportWorkerProgress(progress, data.progress);
					} else if (data.type === 'stdout' || data.type === 'stderr') {
						if (typeof data.data !== 'string')
							throw new ProtocolError('Invalid Scala output');
						onOutput?.(data.type, data.data);
					} else if (['ready', 'compiled', 'exit', 'error'].includes(data.type))
						finish(undefined, data);
				} catch (error) {
					finish(error);
				}
			};
			worker.onerror = (event) =>
				finish(
					new RuntimeExecutionError(event.message || 'Scala worker failed', {
						runtimeId: 'SCALA',
						phase
					})
				);
			worker.onmessageerror = () =>
				finish(
					new ProtocolError('Scala worker message cannot be decoded', {
						runtimeId: 'SCALA'
					})
				);
			try {
				worker.postMessage({ id, ...payload });
			} catch (error) {
				finish(error);
			}
		});
	}

	private async ensureCompiler(
		operation: Operation,
		limits: ExecutionLimits,
		options: SandboxExecutionOptions,
		progress?: SandboxProgress
	) {
		this.check(operation);
		const baseUrl = this.baseUrl;
		const cache = options.persistentCache ?? this.cache;
		const key = JSON.stringify([baseUrl, cache]);
		if (
			this.payload &&
			(this.payloadKey !== key ||
				Object.values(this.payload).some((bytes) => bytes.length > limits.maxAssetBytes))
		) {
			if (this.compiler) this.retire(this.compiler);
			this.payload = null;
		}
		if (this.compiler) return;
		if (!this.payload) {
			const controller = new AbortController();
			const abort = () => controller.abort(operation.controller.signal.reason);
			const timer = setTimeout(
				() =>
					controller.abort(
						new TimeoutError('Scala asset loading timed out', {
							runtimeId: 'SCALA',
							phase: 'asset',
							timeoutMs: limits.assetTimeoutMs
						})
					),
				limits.assetTimeoutMs
			);
			operation.controller.signal.addEventListener('abort', abort, { once: true });
			try {
				progress?.set?.(0.05, 'Downloading verified Scala compiler assets');
				this.payload = await createScalaCompilerPayload({
					baseUrl,
					persistentCache: cache,
					signal: controller.signal,
					maxAssetBytes: limits.maxAssetBytes
				});
				this.payloadKey = key;
			} catch (error) {
				if (operation.controller.signal.aborted)
					throw new CancelledError('Scala asset loading cancelled', {
						runtimeId: 'SCALA',
						phase: 'asset'
					});
				if (controller.signal.aborted)
					throw (
						controller.signal.reason ??
						new CancelledError('Scala asset download cancelled')
					);
				throw error;
			} finally {
				clearTimeout(timer);
				operation.controller.signal.removeEventListener('abort', abort);
			}
		}
		this.check(operation);
		progress?.set?.(0.25, 'Initializing Scala 3 compiler');
		const worker = new Worker(new URL('./worker/scala/compiler.worker.js', import.meta.url), {
			type: 'module'
		});
		this.compiler = worker;
		const reply = await this.request(
			worker,
			{ type: 'initialize', runtimeAssets: this.payload },
			operation,
			'startup',
			limits.startupTimeoutMs
		);
		this.check(operation);
		if (reply.type !== 'ready') {
			this.retire(worker);
			throw new RuntimeExecutionError(reply.message ?? 'Scala initialization failed', {
				runtimeId: 'SCALA',
				phase: 'startup'
			});
		}
	}

	async load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		const operation = this.begin(options.signal);
		try {
			this.validateOptions(options);
			const config = typeof runtimeAssets === 'object' ? runtimeAssets.scala : undefined;
			const baseUrl =
				config?.baseUrl ??
				(typeof runtimeAssets === 'string' && runtimeAssets
					? `${runtimeAssets.replace(/\/$/, '')}/wasm-scala/`
					: undefined);
			if (baseUrl !== this.baseUrl) {
				if (this.compiler) this.retire(this.compiler);
				this.payload = null;
			}
			this.baseUrl = baseUrl;
			this.cache =
				typeof runtimeAssets === 'object' ? runtimeAssets.persistentCache : undefined;
			await this.ensureCompiler(
				operation,
				resolveExecutionLimits(options.limits),
				options,
				progress
			);
		} finally {
			this.end(operation);
		}
	}

	async run(
		code: string,
		_prepare = false,
		_log = true,
		progress?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	) {
		const operation = this.begin(options.signal);
		let outcome: 'completed' | 'failed' | 'cancelled' | 'timed-out' = 'failed';
		const start = performance.now();
		try {
			this.validateOptions(options);
			const requestedLimits = resolveExecutionLimits(options.limits);
			const limits = {
				...requestedLimits,
				maxOutputBytes: Math.min(requestedLimits.maxOutputBytes, 1024 * 1024)
			};
			const files = this.files(code, options, limits);
			const { programArgs } = resolveSandboxExecutionArgs('SCALA', args, options);
			if (encoder.encode(programArgs.join('')).length > HARD_SOURCE_BYTES)
				throw new RuntimeConfigurationError('Scala program arguments exceed 1 MiB', {
					runtimeId: 'SCALA'
				});
			const stdin = options.stdin ?? this.pendingInput;
			this.pendingInput = '';
			if (encoder.encode(stdin).length > HARD_SOURCE_BYTES)
				throw new RuntimeConfigurationError('Scala stdin exceeds 1 MiB', {
					runtimeId: 'SCALA'
				});
			await this.ensureCompiler(operation, limits, options, progress);
			this.check(operation);
			progress?.set?.(0.4, 'Compiling Scala and linking Scala.js');
			const compiled = await this.request(
				this.compiler!,
				{
					files,
					limits: {
						maxDiagnostics: limits.maxDiagnostics,
						maxDiagnosticBytes: limits.maxOutputBytes
					}
				},
				operation,
				'compile',
				limits.compileTimeoutMs
			);
			this.check(operation);
			if (compiled.failureKind === 'diagnostic-limit') {
				if (this.compiler) this.retire(this.compiler);
				throw new DiagnosticLimitError(
					compiled.message ?? 'Scala diagnostic limit exceeded',
					{
						runtimeId: 'SCALA',
						limit: compiled.limit ?? limits.maxDiagnostics,
						actual: compiled.actual ?? limits.maxDiagnostics + 1
					}
				);
			}
			const lines = compiled.diagnostics ?? [];
			if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string'))
				throw new ProtocolError('Invalid Scala diagnostics');
			if (encoder.encode(lines.join('\n')).length > limits.maxOutputBytes)
				throw new DiagnosticLimitError('Scala diagnostics exceed byte budget', {
					runtimeId: 'SCALA',
					limit: limits.maxOutputBytes,
					actual: encoder.encode(lines.join('\n')).length
				});
			const diagnostics = parseScalaDiagnostics(lines, limits.maxDiagnostics);
			for (const diagnostic of diagnostics) this.oncompilerdiagnostic?.(diagnostic);
			if (compiled.type !== 'compiled' || typeof compiled.code !== 'string') {
				if (this.compiler) this.retire(this.compiler);
				throw new CompileError(
					lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '') ||
						compiled.message ||
						'Scala compilation failed',
					{ runtimeId: 'SCALA' }
				);
			}
			if (encoder.encode(compiled.code).length > 32 * 1024 * 1024)
				throw new CompileError('Scala generated program exceeds 32 MiB', {
					runtimeId: 'SCALA'
				});
			if (limits.maxWorkers < 2 && this.compiler) this.retire(this.compiler);
			this.check(operation);
			const execution = new Worker(
				new URL('./worker/scala/execution.worker.js', import.meta.url),
				{ type: 'module' }
			);
			this.execution = execution;

			let outputBytes = 0;
			const result = await this.request(
				execution,
				{
					code: compiled.code,
					stdin,
					args: programArgs,
					maxOutputBytes: limits.maxOutputBytes
				},
				operation,
				'execute',
				limits.runTimeoutMs,
				(_stream, text) => {
					outputBytes += encoder.encode(text).length;
					if (outputBytes > limits.maxOutputBytes)
						throw new OutputLimitError('Scala output limit exceeded', {
							runtimeId: 'SCALA',
							limit: limits.maxOutputBytes,
							actual: outputBytes
						});
					this.output?.(text);
				},
				progress
			);
			this.check(operation);
			if (result.type !== 'exit' || result.exitCode !== 0) {
				if (/output exceeds/.test(result.message ?? ''))
					throw new OutputLimitError(result.message!, {
						runtimeId: 'SCALA',
						limit: limits.maxOutputBytes,
						actual: limits.maxOutputBytes + 1
					});
				throw new RuntimeExecutionError(result.message ?? 'Scala program failed', {
					runtimeId: 'SCALA'
				});
			}
			outcome = 'completed';
			return true;
		} catch (error) {
			if (operation.controller.signal.aborted || error instanceof CancelledError)
				outcome = 'cancelled';
			else if (error instanceof TimeoutError) outcome = 'timed-out';
			throw error;
		} finally {
			if (this.execution) this.retire(this.execution);
			this.elapse = performance.now() - start;
			this.end(operation);
			progress?.report?.({
				kind: 'settled',
				outcome
			});
		}
	}

	write(data: string) {
		// The terminal may submit late keystrokes; they cannot extend buffered execution.
		if (this.active || this.disposed) return;
		if (encoder.encode(this.pendingInput + data).length > HARD_SOURCE_BYTES)
			throw new RuntimeConfigurationError('Scala stdin exceeds 1 MiB');
		this.pendingInput += data;
	}
	eof() {
		/* Every supplied input buffer ends in EOF; execution is never replayed. */
	}
	terminate() {
		this.active?.controller.abort(
			new CancelledError('Scala execution stopped', { runtimeId: 'SCALA' })
		);
	}
	async clear() {
		this.terminate();
		if (this.compiler) this.retire(this.compiler);
		this.pendingInput = '';
	}
	async dispose() {
		this.disposed = true;
		await this.clear();
		this.payload = null;
	}
}
