import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import {
	resolveCobolBaseUrl,
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
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
	explicitStdin: boolean;
};

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
			explicitStdin: false
		};
		this.activeOperation = operation;
		return operation;
	}

	private completeOperation(operation: CobolOperation) {
		if (this.activeOperation?.token === operation.token) this.activeOperation = null;
	}

	private isOperationActive(operation: CobolOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private bindAbortSignal(operation: CobolOperation, signal: AbortSignal | undefined) {
		if (!signal) return () => undefined;
		let registered = false;
		let cleanedUp = false;
		const onAbort = () => {
			if (!this.isOperationActive(operation)) return;
			this.cancelOperation(operation, abortReason(signal, operation.phase));
		};
		try {
			signal.addEventListener('abort', onAbort, { once: true });
			registered = true;
		} catch (error) {
			this.cancelOperation(operation, error);
		}
		if (signal.aborted) onAbort();
		return () => {
			if (cleanedUp) return;
			cleanedUp = true;
			if (!registered) return;
			try {
				signal.removeEventListener('abort', onAbort);
			} catch {
				// Listener cleanup must not replace the operation result.
			}
		};
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
		if (options.signal?.aborted) {
			return Promise.reject(abortReason(options.signal, 'startup'));
		}
		let operation: CobolOperation;
		try {
			operation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let cleanupSignal: () => void = () => undefined;
		const loading = this.workerSession.load(async (resolve, reject) => {
			const settleOperation = () => {
				cleanupSignal();
				this.completeOperation(operation);
			};
			const resolveOperation = () => {
				settleOperation();
				resolve();
			};
			const rejectOperation = (reason?: unknown) => {
				settleOperation();
				reject(reason);
			};
			try {
				if (!this.isOperationActive(operation)) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const clangAssets = resolveRuntimeAssetConfig('clang', runtimeAssets, currentUrl);
				const cobolBaseUrl = resolveCobolBaseUrl(runtimeAssets, currentUrl);
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
		cleanupSignal = this.bindAbortSignal(operation, options.signal);
		return loading.finally(() => {
			cleanupSignal();
			this.completeOperation(operation);
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
		if (options.debug) return Promise.reject('COBOL debugging is not supported yet.');
		if (options.signal?.aborted) {
			return Promise.reject(abortReason(options.signal, 'execute'));
		}
		const activeOperation = this.beginOperation('execute');
		let cleanupSignal: () => void = () => undefined;
		try {
			const worker = this.worker;
			if (!worker) throw 'Worker not loaded';
			const assetBridge = this.assetBridge;
			if (!assetBridge) throw 'COBOL asset bridge is not loaded';
			const { compileArgs, programArgs } = resolveSandboxExecutionArgs(
				this.language,
				args,
				options
			);
			const limits = resolveExecutionLimits(options.limits);
			const workspace = validateExecutionWorkspace(
				code,
				options.workspaceFiles ?? [],
				options.activePath ?? 'main.cob',
				{
					...options.workspaceLimits,
					maxFileBytes: Math.min(
						options.workspaceLimits?.maxFileBytes ??
							DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
						limits.maxWorkspaceBytes
					),
					maxTotalBytes: Math.min(
						options.workspaceLimits?.maxTotalBytes ??
							DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
						limits.maxWorkspaceBytes
					)
				}
			);
			const hasExplicitStdin = options.stdin !== undefined;
			if (hasExplicitStdin) {
				activeOperation.explicitStdin = true;
				this.resetExplicitStdinState();
			}
			this.exit = false;
			return await new Promise<boolean | string>((resolve, reject) => {
				const workerOperation = this.workerSession.beginRun(worker, reject);
				cleanupSignal = this.bindAbortSignal(activeOperation, options.signal);
				if (!this.isOperationActive(activeOperation)) return;
				const runUid = ++this.uid;
				let handler: (event: Event & { data: any }) => void;
				const failRun = (error: unknown, disposeWorker = false) => {
					this.finishExplicitStdin(activeOperation);
					this.workerSession.complete(workerOperation);
					cleanupSignal();
					this.completeOperation(activeOperation);
					if (disposeWorker && this.worker === worker) this.workerSession.reset();
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
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
						if (!this.isOperationActive(activeOperation) || runUid !== this.uid) return;
						const { output, results, log, error, buffer, progress } = event.data;
						if (buffer && !hasExplicitStdin) {
							this.waitingForInput = true;
							this.flushPendingInput();
							if (
								!this.isOperationActive(activeOperation) ||
								this.worker !== worker ||
								this.assetBridge !== assetBridge ||
								worker.onmessage !== handler ||
								runUid !== this.uid
							) {
								return;
							}
						}
						if (output) {
							this.output?.(output);
							if (
								!this.isOperationActive(activeOperation) ||
								this.worker !== worker ||
								this.assetBridge !== assetBridge ||
								worker.onmessage !== handler ||
								runUid !== this.uid
							) {
								return;
							}
						}
						if (results !== undefined) {
							this.finishExplicitStdin(activeOperation);
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.waitingForInput = false;
							this.pendingEof = false;
							this.workerSession.complete(workerOperation);
							cleanupSignal();
							this.completeOperation(activeOperation);
							resolve(results as boolean | string);
							return;
						}
						if (log) {
							console.log(log);
							if (
								!this.isOperationActive(activeOperation) ||
								this.worker !== worker ||
								this.assetBridge !== assetBridge ||
								worker.onmessage !== handler ||
								runUid !== this.uid
							) {
								return;
							}
						}
						if (error !== undefined) {
							failRun(error);
							return;
						}
						if (progress != null) {
							prog?.set?.(progress);
							if (
								!this.isOperationActive(activeOperation) ||
								this.worker !== worker ||
								this.assetBridge !== assetBridge ||
								worker.onmessage !== handler ||
								runUid !== this.uid
							) {
								return;
							}
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
						stdin: options.stdin,
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
			cleanupSignal();
			this.completeOperation(activeOperation);
		}
	}

	private cancelOperation(operation: CobolOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		this.finishExplicitStdin(operation);
		operation.cancelled = true;
		this.activeOperation = null;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
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
