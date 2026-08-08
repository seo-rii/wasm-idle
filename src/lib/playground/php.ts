import { resolvePhpRuntimeModuleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';
import { BusyError, TimeoutError, resolveExecutionLimits } from '@wasm-idle/core';

type PhpOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	explicitStdin: boolean;
	ownsStdin: boolean;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
};

const abortReason = (signal: AbortSignal, phase: PhpOperation['phase']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup' ? 'PHP runtime startup aborted' : 'PHP execution aborted',
				'AbortError'
			);

class Php implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(4096);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeOperation: PhpOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'PHP',
		onDispose: (worker) => {
			if (this.worker !== worker) return;
			delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	private beginOperation(phase: PhpOperation['phase']) {
		if (this.activeOperation) {
			throw new BusyError('PHP runtime already has an active operation', {
				runtimeId: 'PHP',
				phase: this.activeOperation.phase
			});
		}
		const operation: PhpOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			explicitStdin: false,
			ownsStdin: false,
			cleanedUp: false,
			cleanups: []
		};
		this.activeOperation = operation;
		return operation;
	}

	private isOperationActive(operation: PhpOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: PhpOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: PhpOperation) {
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

	private releaseBeforeSession(operation: PhpOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private bindAbortSignal(operation: PhpOperation, signal: AbortSignal | undefined) {
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
			if (registered) signal.removeEventListener('abort', onAbort);
		});
		try {
			registered = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private bindOperationTimeout(operation: PhpOperation, timeoutMs: number) {
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
					new TimeoutError(`PHP ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: 'PHP',
						timeoutMs
					})
				);
			}, timeoutMs);
			if (operation.cleanedUp) clearTimeout(timeout);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private resetSharedStdinBuffer() {
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Stdin cleanup must not replace the execution result.
		}
	}

	private prepareRunStdin(operation: PhpOperation, explicitStdin: boolean) {
		operation.ownsStdin = true;
		operation.explicitStdin = explicitStdin;
		if (explicitStdin) {
			this.pendingInput = [];
			this.pendingEof = false;
		}
		this.waitingForInput = false;
		this.resetSharedStdinBuffer();
	}

	private finishRunStdin(operation: PhpOperation) {
		if (!operation.ownsStdin) return;
		const resetSharedBuffer = operation.explicitStdin;
		operation.ownsStdin = false;
		operation.explicitStdin = false;
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
		if (resetSharedBuffer) this.resetSharedStdinBuffer();
	}

	private cancelOperation(operation: PhpOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.finishRunStdin(operation);
		this.activeOperation = null;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.exit = true;
		this.workerSession.terminate(reason);
		this.cleanupOperation(operation);
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let activeOperation: PhpOperation;
		try {
			activeOperation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let signal: AbortSignal | undefined;
		try {
			limits = resolveExecutionLimits(options.limits);
			signal = options.signal;
			if (signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, abortReason(signal, 'startup'))
				);
			}
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'PHP runtime startup cancelled')
			);
		}
		const loading = this.workerSession.load(async (resolve, reject) => {
			const resolveOperation = () => {
				if (!this.releaseOperation(activeOperation)) return;
				resolve();
				this.cleanupOperation(activeOperation);
			};
			const rejectOperation = (reason?: unknown) => {
				if (!this.releaseOperation(activeOperation)) return;
				reject(reason);
				this.cleanupOperation(activeOperation);
			};
			try {
				if (!this.isOperationActive(activeOperation)) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextModuleUrl = resolvePhpRuntimeModuleUrl(runtimeAssets, currentUrl);
				if (!this.isOperationActive(activeOperation)) return;
				if (this.worker && this.moduleUrl !== nextModuleUrl) this.workerSession.reset();
				this.moduleUrl = nextModuleUrl;
				if (!this.isOperationActive(activeOperation)) return;
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/php?worker'))
						.default;
					if (!this.isOperationActive(activeOperation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(activeOperation)) {
						try {
							worker.terminate();
						} catch {
							// The unattached worker is already detached.
						}
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					let handler: (event: MessageEvent<any>) => void;
					handler = (event) => {
						if (
							!this.isOperationActive(activeOperation) ||
							this.worker !== worker ||
							worker.onmessage !== handler
						) {
							return;
						}
						try {
							reportWorkerProgress(progress, event.data?.progress);
							if (
								!this.isOperationActive(activeOperation) ||
								this.worker !== worker ||
								worker.onmessage !== handler
							) {
								return;
							}
							if (event.data?.load) {
								progress?.set?.(1);
								if (
									!this.isOperationActive(activeOperation) ||
									this.worker !== worker ||
									worker.onmessage !== handler
								) {
									return;
								}
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
						moduleUrl: this.moduleUrl,
						log: _log
					});
				} else {
					const worker = this.worker;
					progress?.set?.(1);
					if (!this.isOperationActive(activeOperation) || this.worker !== worker) return;
					resolveOperation();
				}
			} catch (error) {
				rejectOperation(error);
			}
		});
		const timeoutMs = Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs);
		this.bindOperationTimeout(activeOperation, timeoutMs);
		this.bindAbortSignal(activeOperation, signal);
		return loading.finally(() => {
			this.releaseOperation(activeOperation);
			this.cleanupOperation(activeOperation);
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

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		let activeOperation: PhpOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		const worker = this.worker;
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let signal: AbortSignal | undefined;
		let request: {
			programArgs: string[];
			stdin: string | undefined;
			activePath: string;
			workspaceFiles: NonNullable<SandboxExecutionOptions['workspaceFiles']>;
		};
		try {
			limits = resolveExecutionLimits(options.limits);
			signal = options.signal;
			if (signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, abortReason(signal, 'execute'))
				);
			}
			request = {
				programArgs: resolveSandboxExecutionArgs('PHP', args, options).programArgs,
				stdin: options.stdin,
				activePath: options.activePath || 'main.php',
				workspaceFiles: options.workspaceFiles || []
			};
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!worker) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, 'Worker not loaded'));
		}
		if (!this.isOperationActive(activeOperation) || this.worker !== worker) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, 'Worker not loaded'));
		}
		const hasExplicitStdin = request.stdin !== undefined;
		this.prepareRunStdin(activeOperation, hasExplicitStdin);
		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
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
				worker.onmessage === handler &&
				runUid === this.uid;
			const settleRunState = () => {
				this.finishRunStdin(activeOperation);
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
			};
			const claimRun = () => {
				if (!ownsRun()) return false;
				settleRunState();
				this.workerSession.complete(workerOperation);
				this.releaseOperation(activeOperation);
				this.cleanupOperation(activeOperation);
				try {
					if (worker.onmessage === handler) worker.onmessage = null;
				} catch {
					// Handler cleanup must not replace the execution result.
				}
				return true;
			};
			const failRun = (reason: unknown, disposeWorker = false) => {
				if (!claimRun()) return;
				if (disposeWorker && this.worker === worker) this.workerSession.reset();
				reject(reason);
			};
			handler = (event) => {
				if (
					this.worker !== worker ||
					worker.onmessage !== handler ||
					!this.isOperationActive(activeOperation)
				) {
					return;
				}
				try {
					const { output, results, error, buffer, diagnostic, progress } = event.data;
					if (buffer && !hasExplicitStdin) {
						this.waitingForInput = true;
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					reportWorkerProgress(_prog, progress);
					if (!ownsRun()) return;
					if (typeof output === 'string' && output.length > 0) {
						this.output?.(output);
						if (!ownsRun()) return;
					}
					if (diagnostic !== undefined) {
						this.oncompilerdiagnostic?.(diagnostic);
						if (!ownsRun()) return;
					}
					if (results !== undefined) {
						if (!claimRun()) return;
						resolve(results as boolean | string);
						return;
					}
					if (error !== undefined) failRun(error);
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
					args: request.programArgs,
					stdin: request.stdin,
					activePath: request.activePath,
					workspaceFiles: request.workspaceFiles,
					log: _log
				});
			} catch (error) {
				failRun(error);
			}
		});
		return running.finally(() => {
			if (this.isOperationActive(activeOperation)) {
				this.finishRunStdin(activeOperation);
				this.releaseOperation(activeOperation);
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
			}
			this.cleanupOperation(activeOperation);
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const activeOperation = this.activeOperation;
		if (activeOperation) {
			this.cancelOperation(activeOperation, reason);
			return;
		}
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		if (this.activeOperation) this.terminate();
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		const worker = this.worker;
		if (worker) {
			try {
				worker.onmessage = null;
			} catch {
				// Idle handler cleanup is best effort.
			}
		}
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Buffer cleanup must not replace active-operation cancellation.
		}
	}
}

export default Php;
