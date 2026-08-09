import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import {
	resolveFortranRuntimeAssetConfig,
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets,
	type ResolvedFortranRuntimeAssetConfig
} from '$lib/playground/assets';
import {
	AssetTooLargeError,
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	OutputLimitError,
	TimeoutError,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
import { FORTRAN_EXECUTION_ASSET_NAMES } from '$lib/playground/fortranAssets';
import type { SandboxExecutionOptions } from '$lib/playground/options';
import { resolveSandboxExecutionArgs } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';

const fortranAssetsKey = (assets: ResolvedFortranRuntimeAssetConfig) =>
	JSON.stringify({
		baseUrl: assets.baseUrl,
		f2cWasmUrl: assets.f2cWasmUrl,
		libf2cUrl: assets.libf2cUrl,
		f2cHeaderUrl: assets.f2cHeaderUrl,
		analyzerUrl: assets.analyzerUrl,
		integrity: assets.integrity
	});

type FortranOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellation?: { reason: unknown };
	explicitStdin: boolean;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
};

const OUTPUT_ENCODER = new TextEncoder();

const abortReason = (signal: AbortSignal, phase: FortranOperation['phase']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup'
					? 'Fortran runtime startup aborted'
					: 'Fortran execution aborted',
				'AbortError'
			);

class Fortran implements Sandbox {
	language = 'FORTRAN';
	output?: (data: string) => void;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(4096);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	log = true;
	waitingForInput = false;
	pendingEof = false;
	exit = true;
	assetBridge: WorkerAssetBridge | null = null;
	activeFortranAssetsKey = '';
	private activeOperation: FortranOperation | null = null;
	private preserveOperationOnWorkerDispose = false;
	private readonly workerSession = new WorkerSession({
		label: 'Fortran',
		onDispose: (worker) => {
			if (this.worker === worker) {
				const assetBridge = this.assetBridge;
				delete this.worker;
				this.assetBridge = null;
				this.activeFortranAssetsKey = '';
				if (!this.preserveOperationOnWorkerDispose && this.activeOperation) {
					const operation = this.activeOperation;
					this.finishExplicitStdin(operation);
					operation.cancelled = true;
					this.releaseOperation(operation);
					this.cleanupOperation(operation);
				}
				try {
					assetBridge?.dispose();
				} catch {
					// Asset cleanup must not replace the worker operation result.
				}
			}
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	private requireOperationIdle() {
		if (this.activeOperation) {
			throw new BusyError('Fortran runtime already has an active operation', {
				runtimeId: this.language,
				phase: this.activeOperation.phase
			});
		}
	}

	private beginOperation(phase: FortranOperation['phase']) {
		this.requireOperationIdle();
		const operation: FortranOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			explicitStdin: false,
			cleanedUp: false,
			cleanups: []
		};
		this.activeOperation = operation;
		return operation;
	}

	private isOperationActive(operation: FortranOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: FortranOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: FortranOperation) {
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

	private bindAbortSignal(operation: FortranOperation, signal: AbortSignal | undefined) {
		if (!signal) return;
		let registered = false;
		const onAbort = () => {
			if (!this.isOperationActive(operation)) return;
			this.cancelOperation(operation, abortReason(signal, operation.phase));
		};
		operation.cleanups.push(() => {
			if (registered) signal.removeEventListener('abort', onAbort);
		});
		try {
			signal.addEventListener('abort', onAbort, { once: true });
			registered = true;
		} catch (error) {
			this.cancelOperation(operation, error);
			return;
		}
		if (signal.aborted) onAbort();
	}

	private bindOperationTimeout(operation: FortranOperation, timeoutMs: number) {
		const timeout = setTimeout(() => {
			if (!this.isOperationActive(operation)) return;
			const label = operation.phase === 'startup' ? 'startup' : 'execution';
			this.cancelOperation(
				operation,
				new TimeoutError(`Fortran ${label} timed out after ${timeoutMs} ms`, {
					phase: operation.phase,
					runtimeId: this.language,
					timeoutMs
				})
			);
		}, timeoutMs);
		operation.cleanups.push(() => clearTimeout(timeout));
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

	private finishExplicitStdin(operation: FortranOperation) {
		if (!operation.explicitStdin) return;
		operation.explicitStdin = false;
		this.resetExplicitStdinState();
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		code = '',
		log = true,
		args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let limits: ReturnType<typeof resolveExecutionLimits>;
		try {
			limits = resolveExecutionLimits(options.limits);
		} catch (error) {
			return Promise.reject(error);
		}
		if (options.signal?.aborted) {
			return Promise.reject(abortReason(options.signal, 'startup'));
		}
		let operation: FortranOperation;
		try {
			operation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let clangAssets: ReturnType<typeof resolveRuntimeAssetConfig>;
		let fortranAssets: ResolvedFortranRuntimeAssetConfig;
		let nextFortranAssetsKey: string;
		let needsWorkerReset: boolean;
		try {
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			clangAssets = resolveRuntimeAssetConfig('clang', runtimeAssets, currentUrl);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(operation.cancellation?.reason);
			}
			fortranAssets = resolveFortranRuntimeAssetConfig(runtimeAssets, currentUrl);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(operation.cancellation?.reason);
			}
			for (const asset of FORTRAN_EXECUTION_ASSET_NAMES) {
				const receipt = fortranAssets.integrity[asset];
				if (receipt.bytes > limits.maxAssetBytes) {
					throw new AssetTooLargeError(
						`Fortran execution asset ${asset} exceeds the ${limits.maxAssetBytes} byte limit`,
						{
							actual: receipt.bytes,
							limit: limits.maxAssetBytes,
							runtimeId: this.language
						}
					);
				}
			}
			nextFortranAssetsKey = fortranAssetsKey(fortranAssets);
			needsWorkerReset =
				!this.worker ||
				!this.assetBridge ||
				!this.assetBridge.matches(clangAssets) ||
				this.activeFortranAssetsKey !== nextFortranAssetsKey;
		} catch (error) {
			const failure = operation.cancellation ? operation.cancellation.reason : error;
			this.releaseOperation(operation);
			this.cleanupOperation(operation);
			return Promise.reject(failure);
		}
		const timeoutMs = Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs);
		this.bindOperationTimeout(operation, timeoutMs);
		this.bindAbortSignal(operation, options.signal);
		if (!this.isOperationActive(operation)) {
			return Promise.reject(operation.cancellation?.reason);
		}
		const loading = this.workerSession.load(async (resolve, reject) => {
			const resolveOperation = () => {
				if (!this.releaseOperation(operation)) return;
				resolve();
				this.cleanupOperation(operation);
			};
			const rejectOperation = (reason?: unknown) => {
				if (!this.releaseOperation(operation)) return;
				reject(reason);
				this.cleanupOperation(operation);
			};
			try {
				if (!this.isOperationActive(operation)) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				if (needsWorkerReset && this.worker) {
					this.preserveOperationOnWorkerDispose = true;
					try {
						this.workerSession.reset();
					} finally {
						this.preserveOperationOnWorkerDispose = false;
					}
				}
				if (!this.worker) {
					const WorkerConstructor = (
						await import('$lib/playground/worker/fortran?worker')
					).default;
					if (!this.isOperationActive(operation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(operation)) {
						try {
							worker.terminate();
						} catch {
							// The unattached worker is already detached.
						}
						return;
					}
					let assetBridge: WorkerAssetBridge;
					try {
						assetBridge = new WorkerAssetBridge(worker, 'clang', clangAssets, progress);
					} catch (error) {
						try {
							worker.terminate();
						} catch {
							// Worker cleanup must not replace the progress callback error.
						}
						throw error;
					}
					if (!this.isOperationActive(operation)) {
						try {
							assetBridge.dispose();
						} catch {
							// Stale asset cleanup is best effort.
						}
						try {
							worker.terminate();
						} catch {
							// The unattached worker is already detached.
						}
						return;
					}
					this.worker = worker;
					this.assetBridge = assetBridge;
					this.workerSession.attach(worker);
					const handler = (event: MessageEvent<any>) => {
						if (
							this.worker !== worker ||
							this.assetBridge !== assetBridge ||
							worker.onmessage !== handler
						) {
							return;
						}
						try {
							if (assetBridge.handleMessage(event)) return;
							if (!this.isOperationActive(operation)) return;
							if (event.data?.progress != null) {
								progress?.set?.(event.data.progress);
								if (
									!this.isOperationActive(operation) ||
									this.worker !== worker ||
									this.assetBridge !== assetBridge ||
									worker.onmessage !== handler
								) {
									return;
								}
							}
							if (event.data?.load) {
								this.log = log;
								this.activeFortranAssetsKey = nextFortranAssetsKey;
								resolveOperation();
								return;
							}
							if (event.data?.error !== undefined) {
								rejectOperation(event.data.error);
							}
						} catch (error) {
							rejectOperation(error);
						}
					};
					worker.onmessage = handler;
					worker.postMessage({
						load: true,
						log,
						code,
						args,
						clangAssets: {
							baseUrl: clangAssets.baseUrl,
							useAssetBridge: clangAssets.useAssetBridge
						},
						fortranAssets: {
							...fortranAssets,
							maxAssetBytes: limits.maxAssetBytes
						}
					});
				} else {
					const worker = this.worker;
					const assetBridge = this.assetBridge;
					if (!assetBridge) return rejectOperation('Fortran asset bridge is not loaded');
					assetBridge.rebind(worker, clangAssets, progress);
					if (
						!this.isOperationActive(operation) ||
						this.worker !== worker ||
						this.assetBridge !== assetBridge
					) {
						return;
					}
					worker.postMessage({ log });
					this.log = log;
					this.activeFortranAssetsKey = nextFortranAssetsKey;
					resolveOperation();
				}
			} catch (error) {
				rejectOperation(error);
			}
		});
		return loading.finally(() => {
			this.releaseOperation(operation);
			this.cleanupOperation(operation);
		});
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

	async run(
		code: string,
		prepare: boolean,
		log = this.log,
		prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (options.debug) return Promise.reject('Fortran debugging is not supported yet.');
		this.requireOperationIdle();
		const limits = resolveExecutionLimits(options.limits);
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(abortReason(signal, 'execute'));
		}
		const { compileArgs, programArgs } = resolveSandboxExecutionArgs(
			this.language,
			args,
			options
		);
		const stdin = options.stdin;
		const workspace = validateExecutionWorkspace(
			code,
			options.workspaceFiles ?? [],
			options.activePath ?? 'main.f',
			{
				...options.workspaceLimits,
				maxFileBytes: Math.min(
					options.workspaceLimits?.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
					limits.maxWorkspaceBytes
				),
				maxTotalBytes: Math.min(
					options.workspaceLimits?.maxTotalBytes ??
						DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
					limits.maxWorkspaceBytes
				)
			}
		);
		const activeOperation = this.beginOperation('execute');
		try {
			const worker = this.worker;
			if (!worker) throw 'Worker not loaded';
			const assetBridge = this.assetBridge;
			if (!assetBridge) throw 'Fortran asset bridge is not loaded';
			const hasExplicitStdin = stdin !== undefined;
			if (hasExplicitStdin) {
				activeOperation.explicitStdin = true;
				this.resetExplicitStdinState();
			}
			this.exit = false;
			return await new Promise<boolean | string>((resolve, reject) => {
				let outputBytes = 0;
				const workerOperation = this.workerSession.beginRun(worker, reject);
				const timeoutMs = Math.min(
					2_147_483_647,
					limits.compileTimeoutMs + limits.runTimeoutMs
				);
				this.bindOperationTimeout(activeOperation, timeoutMs);
				this.bindAbortSignal(activeOperation, signal);
				if (!this.isOperationActive(activeOperation)) return;
				const runUid = ++this.uid;
				let handler: (event: Event & { data: any }) => void;
				const ownsRun = () =>
					this.isOperationActive(activeOperation) &&
					this.worker === worker &&
					this.assetBridge === assetBridge &&
					worker.onmessage === handler &&
					runUid === this.uid;
				const settleRunState = () => {
					this.finishExplicitStdin(activeOperation);
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
				};
				const failRun = (error: unknown, disposeWorker = false) => {
					if (!ownsRun()) return;
					settleRunState();
					this.workerSession.complete(workerOperation);
					this.releaseOperation(activeOperation);
					if (disposeWorker && this.worker === worker) this.workerSession.reset();
					this.cleanupOperation(activeOperation);
					reject(error);
				};
				handler = (event) => {
					if (
						this.worker !== worker ||
						this.assetBridge !== assetBridge ||
						worker.onmessage !== handler
					) {
						return;
					}
					try {
						if (assetBridge.handleMessage(event as MessageEvent<any>)) return;
						if (!ownsRun()) return;
						const {
							output,
							results,
							log: workerLog,
							error,
							buffer,
							progress
						} = event.data;
						if (buffer && !hasExplicitStdin) {
							this.waitingForInput = true;
							this.flushPendingInput();
							if (!ownsRun()) return;
						}
						if (typeof output === 'string' && output.length > 0) {
							const actual = outputBytes + OUTPUT_ENCODER.encode(output).byteLength;
							if (actual > limits.maxOutputBytes) {
								failRun(
									new OutputLimitError(
										`Fortran output exceeded ${limits.maxOutputBytes} bytes`,
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
							this.output?.(output);
							if (!ownsRun()) return;
						}
						if (results !== undefined) {
							if (!ownsRun()) return;
							settleRunState();
							this.workerSession.complete(workerOperation);
							this.releaseOperation(activeOperation);
							this.cleanupOperation(activeOperation);
							resolve(results as boolean | string);
							return;
						}
						if (workerLog) {
							console.log(workerLog);
							if (!ownsRun()) return;
						}
						if (error !== undefined) {
							failRun(error);
							return;
						}
						if (progress != null) {
							prog?.set?.(progress);
							if (!ownsRun()) return;
						}
					} catch (error) {
						failRun(error, true);
					}
				};
				worker.onmessage = handler;
				this.begin = Date.now();
				try {
					worker.postMessage({
						code,
						prepare,
						buffer: this.buffer,
						stdin,
						log,
						compileArgs,
						programArgs,
						activePath: workspace.activePath,
						workspaceFiles: workspace.workspaceFiles
					});
				} catch (error) {
					failRun(error);
				}
			});
		} finally {
			this.finishExplicitStdin(activeOperation);
			this.releaseOperation(activeOperation);
			this.cleanupOperation(activeOperation);
		}
	}

	private cancelOperation(operation: FortranOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		this.finishExplicitStdin(operation);
		operation.cancelled = true;
		operation.cancellation = { reason };
		this.activeOperation = null;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.exit = true;
		this.workerSession.terminate(reason);
		this.cleanupOperation(operation);
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
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		this.terminate();
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		resetBufferedStdin(this.buffer);
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

export default Fortran;
