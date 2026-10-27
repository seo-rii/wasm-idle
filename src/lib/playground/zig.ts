import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type DebugSessionEvent,
	type SandboxExecutionOptions,
	type ZigTargetTriple
} from '$lib/playground/options';
import {
	resolveZigCompilerUrl,
	resolveZigStdlibUrl,
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { snapshotZigExecutionAssetReceipts } from '$lib/playground/zigAssets';
import { WASM_ZIG_ASSET_RECEIPTS } from '$lib/playground/wasmZigVersion';
import {
	BusyError,
	CancelledError,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	RuntimeConfigurationError,
	TimeoutError,
	resolveExecutionLimits,
	resolveRuntimeAssetCacheOptions,
	validateExecutionWorkspace
} from '@wasm-idle/core';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer, requireSharedArrayBuffer } from '$lib/playground/sharedBuffer';
import { CompiledLldbSandbox } from '$lib/playground/compiledLldb';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerInputReady, reportWorkerProgress } from '$lib/playground/workerProgress';

type ZigOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
	explicitStdin: boolean;
};

const OUTPUT_ENCODER = new TextEncoder();

const abortReason = (signal: AbortSignal, phase: ZigOperation['phase']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup' ? 'Zig runtime startup aborted' : 'Zig execution aborted',
				'AbortError'
			);

class Zig extends CompiledLldbSandbox implements Sandbox {
	protected lldbEntryFunction = 'main.main';
	// The public binding must preserve this runtime's full lib/ archive budget.
	readonly defaultExecutionLimits = Object.freeze({ maxAssetBytes: 256 * 1024 * 1024 });
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	compilerUrl = '';
	stdlibUrl = '';
	assetKey = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeOperation: ZigOperation | null = null;
	private loadedRuntimeAssets: string | PlaygroundRuntimeAssets = '';
	private loadedIntegrity?: ReturnType<typeof snapshotZigExecutionAssetReceipts>;
	private debugTimeout?: { pause(): void; resume(): void };
	private debugDisposal?: Promise<void>;
	private disposed = false;
	private disposePromise: Promise<void> | null = null;
	private readonly disposeCancellation = new CancelledError('Zig sandbox disposed', {
		phase: 'dispose',
		runtimeId: 'ZIG',
		recoverable: false
	});
	private readonly workerSession = new WorkerSession({
		label: 'Zig',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	private requireOperationIdle() {
		if (!this.activeOperation) return;
		throw new BusyError('Zig runtime already has an active operation', {
			runtimeId: 'ZIG',
			phase: this.activeOperation.phase
		});
	}

	private beginOperation(phase: ZigOperation['phase']) {
		if (this.disposed) {
			throw new RuntimeConfigurationError('Zig sandbox is disposed', {
				phase: 'dispose',
				runtimeId: 'ZIG'
			});
		}
		this.requireOperationIdle();
		const operation: ZigOperation = {
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

	private isOperationActive(operation: ZigOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: ZigOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: ZigOperation) {
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

	private releaseBeforeSession(operation: ZigOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private bindPreSessionAbort(operation: ZigOperation, signal: AbortSignal | undefined) {
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
				reason = abortReason(signal, operation.phase);
			} catch (error) {
				reason = error;
			}
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

	private bindAbortSignal(operation: ZigOperation, signal: AbortSignal | undefined) {
		if (!signal || !this.isOperationActive(operation)) return;
		let registered = false;
		const onAbort = () => {
			if (!this.isOperationActive(operation)) return;
			let reason: unknown;
			try {
				reason = abortReason(signal, operation.phase);
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

	private bindOperationTimeout(operation: ZigOperation, timeoutMs: number) {
		if (!this.isOperationActive(operation)) return;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const cancel = () => {
			if (timeout !== undefined) clearTimeout(timeout);
		};
		operation.cleanups.push(cancel);
		try {
			timeout = setTimeout(() => {
				if (!this.isOperationActive(operation)) return;
				const label = operation.phase === 'startup' ? 'startup' : 'execution';
				this.cancelOperation(
					operation,
					new TimeoutError(`Zig ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: 'ZIG',
						timeoutMs
					})
				);
			}, timeoutMs);
			if (operation.cleanedUp) clearTimeout(timeout);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
		return cancel;
	}

	private resetExplicitStdinState() {
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Explicit stdin never consumes the shared terminal buffer.
		}
	}

	private finishExplicitStdin(operation: ZigOperation) {
		if (!operation.explicitStdin) return;
		operation.explicitStdin = false;
		this.resetExplicitStdinState();
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let activeOperation: ZigOperation;
		try {
			activeOperation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let unbindPreSessionAbort: () => void = () => undefined;
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Zig runtime startup cancelled')
				);
			}
			limits = resolveExecutionLimits({
				...this.defaultExecutionLimits,
				...options.limits
			});
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Zig runtime startup cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'Zig runtime startup cancelled')
			);
		}
		const loadPromise = this.workerSession.load(async (resolve, reject) => {
			const resolveLoad = () => {
				if (!this.releaseOperation(activeOperation)) return;
				this.loadedRuntimeAssets = runtimeAssets;
				resolve();
				this.cleanupOperation(activeOperation);
			};
			const rejectLoad = (reason?: unknown) => {
				if (!this.releaseOperation(activeOperation)) return;
				reject(reason);
				this.cleanupOperation(activeOperation);
			};
			try {
				if (this.debugDisposal) await this.debugDisposal;
				if (!this.isOperationActive(activeOperation)) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				let resolverAssets: string | PlaygroundRuntimeAssets = runtimeAssets;
				if (typeof runtimeAssets === 'object') {
					const zig = runtimeAssets.zig;
					if (!this.isOperationActive(activeOperation)) return;
					let rootUrl: string | undefined;
					let rootUrlRead = false;
					resolverAssets = {
						get rootUrl() {
							if (!rootUrlRead) {
								rootUrlRead = true;
								rootUrl = runtimeAssets.rootUrl;
							}
							return rootUrl;
						},
						zig
					};
				}
				const nextCompilerUrl = resolveZigCompilerUrl(resolverAssets, currentUrl);
				if (!this.isOperationActive(activeOperation)) return;
				const nextStdlibUrl = resolveZigStdlibUrl(resolverAssets, currentUrl);
				if (!this.isOperationActive(activeOperation)) return;
				const configuredIntegrity =
					typeof resolverAssets === 'object' ? resolverAssets.zig?.integrity : undefined;
				if (!this.isOperationActive(activeOperation)) return;
				const nextIntegrity = snapshotZigExecutionAssetReceipts(
					configuredIntegrity === undefined
						? WASM_ZIG_ASSET_RECEIPTS
						: configuredIntegrity
				);
				if (!this.isOperationActive(activeOperation)) return;
				if (!nextCompilerUrl || !nextStdlibUrl) {
					return rejectLoad(
						'Zig runtime is not configured. Set runtimeAssets.zig.compilerUrl and runtimeAssets.zig.stdlibUrl.'
					);
				}
				for (const [asset, receipt] of Object.entries(nextIntegrity)) {
					const largestStage = Math.max(receipt.bytes, receipt.uncompressedBytes || 0);
					if (largestStage > limits.maxAssetBytes) {
						return rejectLoad(
							`Zig execution asset ${asset} exceeds the ${limits.maxAssetBytes} byte limit`
						);
					}
				}
				const nextAssetKey = JSON.stringify({
					compilerUrl: nextCompilerUrl,
					stdlibUrl: nextStdlibUrl,
					integrity: nextIntegrity
				});
				const needsWorkerReset = !this.worker || this.assetKey !== nextAssetKey;
				this.compilerUrl = nextCompilerUrl;
				this.stdlibUrl = nextStdlibUrl;
				this.assetKey = nextAssetKey;
				this.loadedIntegrity = nextIntegrity;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/zig?worker'))
						.default;
					if (!this.isOperationActive(activeOperation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(activeOperation)) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
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
							reportWorkerProgress(progress, event.data?.progress);
							if (!ownsLoad()) return;
							if (event.data?.load) {
								progress?.set?.(1);
								if (!ownsLoad()) return;
								resolveLoad();
								return;
							}
							if (event.data?.error) rejectLoad(event.data.error);
						} catch (error) {
							failLoad(error);
						}
					};
					worker.onmessage = handler;
					worker.postMessage({
						load: true,
						persistentCache: resolveRuntimeAssetCacheOptions(
							typeof runtimeAssets === 'object'
								? runtimeAssets?.persistentCache
								: undefined,
							options.persistentCache
						),
						compilerUrl: nextCompilerUrl,
						stdlibUrl: nextStdlibUrl,
						integrity: nextIntegrity,
						maxAssetBytes: limits.maxAssetBytes,
						log: _log
					});
				} else {
					const worker = this.worker;
					progress?.set?.(1);
					if (!this.isOperationActive(activeOperation) || this.worker !== worker) return;
					resolveLoad();
				}
			} catch (error) {
				rejectLoad(error);
			}
		});
		const timeoutMs = Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs);
		this.bindOperationTimeout(activeOperation, timeoutMs);
		this.bindAbortSignal(activeOperation, signal);
		return loadPromise.finally(() => {
			this.releaseOperation(activeOperation);
			this.cleanupOperation(activeOperation);
		});
	}

	write(input: string) {
		if (this.disposed) return;
		if (this.lldbSession) {
			void this.lldbSession.write(input);
			return;
		}
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.flushPendingInput();
	}

	eof() {
		if (this.disposed) return;
		if (this.lldbSession) {
			void this.lldbSession.eof();
			return;
		}
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

	async run(
		code: string,
		prepare: boolean,
		log = true,
		progress?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const debugDisposal = this.debugDisposal;
		if (debugDisposal) {
			this.requireOperationIdle();
			await debugDisposal;
			if (this.debugDisposal === debugDisposal) this.debugDisposal = undefined;
		}
		// LLDB owns a separate Worker; reload the pinned compiler after its predecessor retires.
		if (!this.worker && this.loadedIntegrity && !this.disposed) {
			this.requireOperationIdle();
			const assets = this.loadedRuntimeAssets;
			await this.load(
				{
					...(typeof assets === 'string' ? { rootUrl: assets } : assets),
					zig: {
						compilerUrl: this.compilerUrl,
						stdlibUrl: this.stdlibUrl,
						integrity: this.loadedIntegrity
					}
				},
				'',
				log,
				[],
				options,
				progress
			);
		}
		return this.runLoaded(code, prepare, log, progress, args, options);
	}

	private runLoaded(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		let activeOperation: ZigOperation;
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
		let compileArgs: string[];
		let programArgs: string[];
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let targetTriple: ZigTargetTriple;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		let stdin: SandboxExecutionOptions['stdin'];
		let debugMode: 'none' | 'lldb';
		let debugClang: ReturnType<typeof resolveRuntimeAssetConfig> | undefined;
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Zig execution cancelled')
				);
			}
			({ compileArgs, programArgs } = resolveSandboxExecutionArgs('ZIG', args, options));
			const requestedDebugMode = options.debugMode ?? (options.debug ? 'lldb' : 'none');
			if (requestedDebugMode !== 'none' && requestedDebugMode !== 'lldb') {
				throw new RuntimeConfigurationError('Zig debugging requires debugMode: lldb.');
			}
			debugMode = requestedDebugMode;
			limits = resolveExecutionLimits({ ...this.defaultExecutionLimits, ...options.limits });
			const workspaceFiles = options.workspaceFiles ?? [];
			const activePath = options.activePath ?? 'main.zig';
			const workspaceLimits = options.workspaceLimits;
			workspace = validateExecutionWorkspace(code, workspaceFiles, activePath, {
				...workspaceLimits,
				maxFileBytes: Math.min(
					workspaceLimits?.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
					limits.maxWorkspaceBytes
				),
				maxTotalBytes: Math.min(
					workspaceLimits?.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
					limits.maxWorkspaceBytes
				)
			});
			targetTriple = options.zigTargetTriple || 'wasm32-wasi';
			if (debugMode === 'lldb') {
				requireSharedArrayBuffer('Zig debugging');
				if (targetTriple !== 'wasm32-wasi') {
					throw new RuntimeConfigurationError('Zig LLDB debugging requires wasm32-wasi.');
				}
				debugClang = resolveRuntimeAssetConfig(
					'clang',
					this.loadedRuntimeAssets,
					typeof window !== 'undefined' ? window.location.href : ''
				);
				if (!this.isOperationActive(activeOperation)) {
					return Promise.reject(
						this.releaseBeforeSession(activeOperation, 'Zig execution cancelled')
					);
				}
				if (debugClang.useAssetBridge && debugClang.loader) {
					throw new RuntimeConfigurationError(
						'Zig debugging requires URL-based Clang assets.'
					);
				}
				this.configureLldb(this.loadedRuntimeAssets, options);
				const entryPath = workspace.activePath || 'main.zig';
				this.prepareLldb(options, entryPath);
				this.lldbEntryFunction = `${entryPath
					.split('/')
					.pop()!
					.replace(/\.zig$/, '')}.main`;
			}
			stdin = options.stdin;
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Zig execution cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'Zig execution cancelled')
			);
		}
		const hasExplicitStdin = stdin !== undefined;
		if (hasExplicitStdin) {
			activeOperation.explicitStdin = true;
			this.resetExplicitStdinState();
		}
		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			let diagnosticCount = 0;
			let outputBytes = 0;
			const operation = this.workerSession.beginRun(worker, reject);
			const timeoutMs = Math.min(
				2_147_483_647,
				limits.compileTimeoutMs + (debugMode === 'lldb' ? 0 : limits.runTimeoutMs)
			);
			const cancelCompileTimeout = this.bindOperationTimeout(activeOperation, timeoutMs);
			this.bindAbortSignal(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) return;
			let handler: (event: Event & { data: any }) => void;
			let handedOff = false;
			const ownsRun = () =>
				this.isOperationActive(activeOperation) &&
				(handedOff || (this.worker === worker && worker.onmessage === handler)) &&
				_uid === this.uid;
			const claimRun = () => {
				if (!ownsRun()) return false;
				this.lldbPending = false;
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
				if (handedOff || !ownsRun()) return;
				try {
					const { output, results, error, buffer, diagnostic, progress, lldbArtifact } =
						event.data;
					if (lldbArtifact) {
						if (debugMode !== 'lldb' || prepare || handedOff) {
							throw new RuntimeConfigurationError(
								'Unexpected Zig debugger artifact.'
							);
						}
						cancelCompileTimeout?.();
						handedOff = true;
						this.bindDebugTimeout(activeOperation, limits.runTimeoutMs);
						const completion = this.startLldb(
							lldbArtifact,
							options,
							programArgs,
							this.pendingInput,
							this.pendingEof,
							(text) => {
								if (!ownsRun()) return;
								const actual = outputBytes + OUTPUT_ENCODER.encode(text).byteLength;
								if (actual > limits.maxOutputBytes) {
									failRun(
										new OutputLimitError(
											`Zig output exceeded ${limits.maxOutputBytes} bytes`,
											{
												actual,
												limit: limits.maxOutputBytes,
												phase: 'execute',
												runtimeId: 'ZIG'
											}
										),
										true
									);
									return;
								}
								outputBytes = actual;
								try {
									this.output?.(text);
								} catch (error) {
									failRun(error, true);
								}
							}
						);
						this.pendingEof = false;
						if (this.workerSession.release(worker)) delete this.worker;
						void completion.then(
							(result) => {
								if (claimRun()) resolve(result);
							},
							(error) => failRun(error)
						);
						return;
					}
					if (buffer && !hasExplicitStdin) {
						this.waitingForInput = true;
						if (!prepare) {
							reportWorkerInputReady(_prog, 'Zig runtime ready for input');
							if (!ownsRun()) return;
						}
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					reportWorkerProgress(_prog, progress);
					if (!ownsRun()) return;
					if (output) {
						const actual =
							outputBytes + OUTPUT_ENCODER.encode(String(output)).byteLength;
						if (actual > limits.maxOutputBytes) {
							failRun(
								new OutputLimitError(
									`Zig output exceeded ${limits.maxOutputBytes} bytes`,
									{
										actual,
										limit: limits.maxOutputBytes,
										phase: 'execute',
										runtimeId: 'ZIG'
									}
								),
								true
							);
							return;
						}
						outputBytes = actual;
						this.output?.(output);
					}
					if (!ownsRun()) return;
					if (diagnostic) {
						const actual = diagnosticCount + 1;
						if (actual > limits.maxDiagnostics) {
							failRun(
								new DiagnosticLimitError(
									`Zig diagnostics exceeded ${limits.maxDiagnostics} messages`,
									{
										actual,
										limit: limits.maxDiagnostics,
										phase: 'execute',
										runtimeId: 'ZIG'
									}
								),
								true
							);
							return;
						}
						diagnosticCount = actual;
						this.oncompilerdiagnostic?.(diagnostic);
					}
					if (!ownsRun()) return;
					if (results) {
						if (!claimRun()) return;
						resolve(results as string);
						return;
					}
					if (error) failRun(error);
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
					buffer: this.buffer,
					args: programArgs,
					compileArgs,
					stdin,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					targetTriple,
					debugMode,
					...(debugClang
						? {
								debugClangPath: debugClang.baseUrl,
								debugClangIntegrity: debugClang.integrity,
								maxWasmMemoryBytes: limits.maxWasmMemoryBytes
							}
						: {}),
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

	private cancelOperation(operation: ZigOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		this.retireDebugger();
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
		this.retireDebugger();
		if (this.disposed) return;
		const activeOperation = this.activeOperation;
		if (activeOperation) {
			this.cancelOperation(activeOperation, reason);
			return this.debugDisposal;
		}
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
		return this.debugDisposal;
	}

	async clear() {
		if (this.disposed) return;
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		resetBufferedStdin(this.buffer);
		if (this.activeOperation) {
			this.terminate();
			return;
		}
		if (this.worker) this.worker.onmessage = null;
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.disposePromise = Promise.resolve().then(async () => {
			await this.debugDisposal;
		});
		this.retireDebugger();

		const activeOperation = this.activeOperation;
		delete this.worker;
		this.compilerUrl = '';
		this.stdlibUrl = '';
		this.assetKey = '';
		this.loadedRuntimeAssets = '';
		this.loadedIntegrity = undefined;
		this.ondebug = undefined;
		this.output = null;
		this.oncompilerdiagnostic = undefined;
		this.resetExplicitStdinState();
		if (activeOperation) {
			this.cancelOperation(activeOperation, this.disposeCancellation);
		} else {
			this.uid += 1;
			this.workerSession.terminate(this.disposeCancellation);
			this.exit = true;
		}
		return this.disposePromise;
	}

	private retireDebugger() {
		try {
			const disconnecting = this.stopLldb();
			if (!disconnecting) return;
			// Shutdown may outlive cancellation; keep the exact caller reason and wait
			// for target Workers to retire before disposal or a replacement execution.
			const cleanup = Promise.resolve(disconnecting).catch(() => undefined);
			this.debugDisposal = Promise.all([this.debugDisposal, cleanup]).then(() => undefined);
		} catch {
			// Cleanup must not replace the caller's cancellation or disposal outcome.
		}
	}

	protected onLldbEvent(event: DebugSessionEvent) {
		const operation = this.activeOperation;
		if (!operation || !this.isOperationActive(operation)) return;
		try {
			if (event.type === 'pause') this.debugTimeout?.pause();
			else if (event.type === 'resume') this.debugTimeout?.resume();
			super.onLldbEvent(event);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private bindDebugTimeout(operation: ZigOperation, timeoutMs: number) {
		let remaining = timeoutMs;
		let started = Date.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let paused = true;
		const clear = () => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		};
		const control = {
			pause: () => {
				if (paused) return;
				remaining = Math.max(0, remaining - Math.max(0, Date.now() - started));
				paused = true;
				clear();
			},
			resume: () => {
				if (!paused || !this.isOperationActive(operation)) return;
				paused = false;
				started = Date.now();
				timer = setTimeout(
					() =>
						this.cancelOperation(
							operation,
							new TimeoutError(`Zig execution timed out after ${timeoutMs} ms`, {
								phase: 'execute',
								runtimeId: 'ZIG',
								timeoutMs
							})
						),
					Math.min(2_147_483_647, remaining)
				);
			}
		};
		this.debugTimeout = control;
		operation.cleanups.push(() => {
			clear();
			if (this.debugTimeout === control) this.debugTimeout = undefined;
		});
		control.resume();
	}
}

export default Zig;
