import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import {
	resolveCobolBaseUrl,
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	OutputLimitError,
	TimeoutError,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
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

type CobolOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
	explicitStdin: boolean;
};

const OUTPUT_ENCODER = new TextEncoder();

const abortReason = (signal: AbortSignal, phase: CobolOperation['phase']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup' ? 'COBOL runtime startup aborted' : 'COBOL execution aborted',
				'AbortError'
			);

class Cobol implements Sandbox {
	language = 'COBOL';
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
	activeCobolBaseUrl = '';
	private activeOperation: CobolOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'COBOL',
		onDispose: (worker) => {
			if (this.worker === worker) {
				const assetBridge = this.assetBridge;
				delete this.worker;
				this.assetBridge = null;
				this.activeCobolBaseUrl = '';
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

	private beginOperation(phase: CobolOperation['phase']) {
		if (this.activeOperation) {
			throw new BusyError('COBOL runtime already has an active operation', {
				runtimeId: 'COBOL',
				phase: this.activeOperation.phase
			});
		}
		const operation: CobolOperation = {
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

	private isOperationActive(operation: CobolOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: CobolOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: CobolOperation) {
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

	private releaseBeforeSession(operation: CobolOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private bindPreSessionAbort(operation: CobolOperation, signal: AbortSignal | undefined) {
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

	private bindAbortSignal(operation: CobolOperation, signal: AbortSignal | undefined) {
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

	private bindOperationTimeout(operation: CobolOperation, timeoutMs: number) {
		if (!this.isOperationActive(operation)) return;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		operation.cleanups.push(() => {
			if (timeout !== undefined) clearTimeout(timeout);
		});
		try {
			timeout = setTimeout(() => {
				if (!this.isOperationActive(operation)) return;
				const label = operation.phase === 'startup' ? 'startup' : 'execution';
				this.cancelOperation(
					operation,
					new TimeoutError(`COBOL ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: 'COBOL',
						timeoutMs
					})
				);
			}, timeoutMs);
			if (operation.cleanedUp) clearTimeout(timeout);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
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

	private finishExplicitStdin(operation: CobolOperation) {
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
		let operation: CobolOperation;
		try {
			operation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let unbindPreSessionAbort: () => void = () => undefined;
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(operation, signal);
			if (!this.isOperationActive(operation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'COBOL runtime startup cancelled')
				);
			}
			limits = resolveExecutionLimits(options.limits);
			if (!this.isOperationActive(operation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'COBOL runtime startup cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(operation, error));
		}
		if (!this.isOperationActive(operation)) {
			return Promise.reject(
				this.releaseBeforeSession(operation, 'COBOL runtime startup cancelled')
			);
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
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const clangAssets = resolveRuntimeAssetConfig('clang', runtimeAssets, currentUrl);
				if (!this.isOperationActive(operation)) return;
				const cobolBaseUrl = resolveCobolBaseUrl(runtimeAssets, currentUrl);
				if (!this.isOperationActive(operation)) return;
				const needsWorkerReset =
					!this.worker ||
					!this.assetBridge ||
					!this.assetBridge.matches(clangAssets) ||
					this.activeCobolBaseUrl !== cobolBaseUrl;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/cobol?worker'))
						.default;
					if (!this.isOperationActive(operation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(operation)) {
						worker.terminate();
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
					let handler: (event: MessageEvent<any>) => void;
					const ownsWorker = () =>
						this.worker === worker &&
						this.assetBridge === assetBridge &&
						worker.onmessage === handler;
					const ownsLoad = () => this.isOperationActive(operation) && ownsWorker();
					handler = (event: MessageEvent<any>) => {
						if (!ownsWorker()) return;
						try {
							if (assetBridge.handleMessage(event)) return;
							if (!ownsLoad()) return;
							if (event.data?.progress != null) {
								progress?.set?.(event.data.progress);
								if (!ownsLoad()) return;
							}
							if (event.data?.load) {
								this.log = log;
								this.activeCobolBaseUrl = cobolBaseUrl;
								resolveOperation();
								return;
							}
							if (event.data?.error !== undefined) rejectOperation(event.data.error);
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
						cobolBaseUrl
					});
				} else {
					const worker = this.worker;
					const assetBridge = this.assetBridge;
					if (!assetBridge) {
						return rejectOperation('COBOL asset bridge is not loaded');
					}
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
					this.activeCobolBaseUrl = cobolBaseUrl;
					resolveOperation();
				}
			} catch (error) {
				rejectOperation(error);
			}
		});
		const timeoutMs = Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs);
		this.bindOperationTimeout(operation, timeoutMs);
		this.bindAbortSignal(operation, signal);
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
		let activeOperation: CobolOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		let worker: Worker;
		let assetBridge: WorkerAssetBridge;
		let compileArgs: string[];
		let programArgs: string[];
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		let stdin: SandboxExecutionOptions['stdin'];
		try {
			const debug = options.debug;
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'COBOL execution cancelled')
				);
			}
			if (debug) {
				return Promise.reject(
					this.releaseBeforeSession(
						activeOperation,
						'COBOL debugging is not supported yet.'
					)
				);
			}
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'COBOL execution cancelled')
				);
			}
			const currentWorker = this.worker;
			worker = currentWorker as Worker;
			if (!worker) throw 'Worker not loaded';
			const currentAssetBridge = this.assetBridge;
			assetBridge = currentAssetBridge as WorkerAssetBridge;
			if (!assetBridge) throw 'COBOL asset bridge is not loaded';
			({ compileArgs, programArgs } = resolveSandboxExecutionArgs(
				this.language,
				args,
				options
			));
			limits = resolveExecutionLimits(options.limits);
			const workspaceFiles = options.workspaceFiles ?? [];
			const activePath = options.activePath ?? 'main.cob';
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
			stdin = options.stdin;
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'COBOL execution cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'COBOL execution cancelled')
			);
		}
		const hasExplicitStdin = stdin !== undefined;
		if (hasExplicitStdin) {
			activeOperation.explicitStdin = true;
			this.resetExplicitStdinState();
		}
		this.exit = false;
		try {
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
				const ownsWorker = () =>
					this.worker === worker &&
					this.assetBridge === assetBridge &&
					worker.onmessage === handler;
				const ownsRun = () =>
					this.isOperationActive(activeOperation) && ownsWorker() && runUid === this.uid;
				const claimRun = () => {
					if (!ownsRun()) return false;
					this.finishExplicitStdin(activeOperation);
					this.workerSession.complete(workerOperation);
					this.releaseOperation(activeOperation);
					this.cleanupOperation(activeOperation);
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
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
				handler = (event) => {
					if (!ownsWorker()) return;
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
						if (output) {
							const actual =
								outputBytes + OUTPUT_ENCODER.encode(String(output)).byteLength;
							if (actual > limits.maxOutputBytes) {
								failRun(
									new OutputLimitError(
										`COBOL output exceeded ${limits.maxOutputBytes} bytes`,
										{
											actual,
											limit: limits.maxOutputBytes,
											phase: 'execute',
											runtimeId: 'COBOL'
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
							if (!claimRun()) return;
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
				if (!ownsRun()) return;
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
			if (this.releaseOperation(activeOperation)) {
				this.finishExplicitStdin(activeOperation);
				this.exit = true;
			}
			this.cleanupOperation(activeOperation);
		}
	}

	private cancelOperation(operation: CobolOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		this.finishExplicitStdin(operation);
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.activeOperation = null;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
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

export default Cobol;
