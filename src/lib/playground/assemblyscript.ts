import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	TimeoutError,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
import {
	resolveAssemblyScriptRuntimeModuleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

type AssemblyScriptOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
};

const abortReason = (signal: AbortSignal, phase: AssemblyScriptOperation['phase']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup'
					? 'AssemblyScript runtime startup aborted'
					: 'AssemblyScript execution aborted',
				'AbortError'
			);

class AssemblyScriptSandbox implements Sandbox {
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
	private activeOperation: AssemblyScriptOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'AssemblyScript',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let operation: AssemblyScriptOperation;
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
					this.releaseBeforeSession(operation, 'AssemblyScript runtime startup cancelled')
				);
			}
			limits = resolveExecutionLimits(options.limits);
			if (!this.isOperationActive(operation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'AssemblyScript runtime startup cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(operation, error));
		}
		if (!this.isOperationActive(operation)) {
			return Promise.reject(
				this.releaseBeforeSession(operation, 'AssemblyScript runtime startup cancelled')
			);
		}
		const loading = this.workerSession.load(async (resolve, reject) => {
			if (!this.isOperationActive(operation)) return;
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextModuleUrl = resolveAssemblyScriptRuntimeModuleUrl(runtimeAssets, currentUrl);
			if (!this.isOperationActive(operation)) return;
			if (this.worker && this.moduleUrl !== nextModuleUrl) this.workerSession.reset();
			this.moduleUrl = nextModuleUrl;
			if (!this.worker) {
				const WorkerConstructor = (
					await import('$lib/playground/worker/assemblyscript?worker')
				).default;
				if (!this.isOperationActive(operation)) return;
				const worker = new WorkerConstructor();
				if (!this.isOperationActive(operation)) {
					worker.terminate();
					return;
				}
				this.worker = worker;
				this.workerSession.attach(worker);
				let handler: (event: MessageEvent<any>) => void;
				const ownsLoad = () =>
					this.isOperationActive(operation) &&
					this.worker === worker &&
					worker.onmessage === handler;
				const failLoad = (reason: unknown) => {
					if (!ownsLoad()) return;
					this.releaseOperation(operation);
					reject(reason);
					this.cleanupOperation(operation);
				};
				handler = (event: MessageEvent<any>) => {
					if (!ownsLoad()) return;
					try {
						if (event.data?.load) {
							progress?.set?.(1);
							if (!ownsLoad()) return;
							this.releaseOperation(operation);
							resolve();
							this.cleanupOperation(operation);
							return;
						}
						if (event.data?.error !== undefined) failLoad(event.data.error);
					} catch (error) {
						failLoad(error);
					}
				};
				worker.onmessage = handler;
				worker.postMessage({
					load: true,
					moduleUrl: this.moduleUrl,
					log: _log
				});
			} else {
				try {
					progress?.set?.(1);
					if (!this.isOperationActive(operation)) return;
					this.releaseOperation(operation);
					resolve();
					this.cleanupOperation(operation);
				} catch (error) {
					if (!this.isOperationActive(operation)) return;
					this.releaseOperation(operation);
					reject(error);
					this.cleanupOperation(operation);
				}
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

	private beginOperation(phase: AssemblyScriptOperation['phase']) {
		if (this.activeOperation) {
			throw new BusyError('AssemblyScript runtime already has an active operation', {
				runtimeId: 'ASSEMBLYSCRIPT',
				phase: this.activeOperation.phase
			});
		}
		const operation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			cleanedUp: false,
			cleanups: []
		} satisfies AssemblyScriptOperation;
		this.activeOperation = operation;
		return operation;
	}

	private releaseOperation(operation: AssemblyScriptOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private isOperationActive(operation: AssemblyScriptOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private cleanupOperation(operation: AssemblyScriptOperation) {
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

	private releaseBeforeSession(operation: AssemblyScriptOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private bindPreSessionAbort(
		operation: AssemblyScriptOperation,
		signal: AbortSignal | undefined
	) {
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

	private bindAbortSignal(operation: AssemblyScriptOperation, signal: AbortSignal | undefined) {
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

	private bindOperationTimeout(operation: AssemblyScriptOperation, timeoutMs: number) {
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
					new TimeoutError(`AssemblyScript ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: 'ASSEMBLYSCRIPT',
						timeoutMs
					})
				);
			}, timeoutMs);
			if (operation.cleanedUp) clearTimeout(timeout);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
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
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		let activeOperation: AssemblyScriptOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		let worker: Worker;
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		let stdin: SandboxExecutionOptions['stdin'];
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'AssemblyScript execution cancelled')
				);
			}
			if (!this.worker) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Worker not loaded')
				);
			}
			worker = this.worker;
			limits = resolveExecutionLimits(options.limits);
			workspace = validateExecutionWorkspace(
				code,
				options.workspaceFiles ?? [],
				options.activePath ?? 'main.as.ts',
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
			stdin = options.stdin;
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'AssemblyScript execution cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'AssemblyScript execution cancelled')
			);
		}
		const hasExplicitStdin = stdin !== undefined;
		if (hasExplicitStdin) {
			this.pendingInput = [];
			this.pendingEof = false;
			this.waitingForInput = false;
			try {
				resetBufferedStdin(this.buffer);
			} catch {
				// Explicit stdin does not consume the shared terminal buffer.
			}
		}
		let explicitStdinCleaned = false;
		const cleanupExplicitStdin = () => {
			if (!hasExplicitStdin || explicitStdinCleaned) return;
			explicitStdinCleaned = true;
			this.pendingInput = [];
			this.pendingEof = false;
			this.waitingForInput = false;
			try {
				resetBufferedStdin(this.buffer);
			} catch {
				// Stdin cleanup must not replace the execution result.
			}
		};
		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			const workerOperation = this.workerSession.beginRun(worker, reject);
			const timeoutMs = Math.min(
				2_147_483_647,
				limits.compileTimeoutMs + limits.runTimeoutMs
			);
			this.bindOperationTimeout(activeOperation, timeoutMs);
			this.bindAbortSignal(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) return;
			let handler: (event: Event & { data: any }) => void;
			const ownsRun = () =>
				this.isOperationActive(activeOperation) &&
				this.worker === worker &&
				worker.onmessage === handler &&
				_uid === this.uid;
			const claimRun = () => {
				if (!ownsRun()) return false;
				cleanupExplicitStdin();
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				this.workerSession.complete(workerOperation);
				this.releaseOperation(activeOperation);
				this.cleanupOperation(activeOperation);
				try {
					if (worker.onmessage === handler) worker.onmessage = null;
				} catch {
					// Handler cleanup must not replace or defer the execution result.
				}
				return true;
			};
			const failRun = (reason: unknown, disposeWorker = false) => {
				if (disposeWorker) {
					if (!ownsRun()) return;
					this.cancelOperation(activeOperation, reason);
					return;
				}
				if (!claimRun()) return;
				reject(reason);
			};
			handler = (event) => {
				if (!ownsRun()) return;
				try {
					const { output, results, error, buffer, diagnostic, progress } = event.data;
					if (buffer && !hasExplicitStdin) {
						this.waitingForInput = true;
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					reportWorkerProgress(_prog, progress);
					if (!ownsRun()) return;
					if (output) {
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
			if (!this.isOperationActive(activeOperation)) return;
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					stdin,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					log: _log
				});
			} catch (error) {
				failRun(error);
			}
		});
		return running.finally(() => {
			if (this.releaseOperation(activeOperation)) cleanupExplicitStdin();
			this.cleanupOperation(activeOperation);
		});
	}

	private cancelOperation(operation: AssemblyScriptOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.activeOperation = null;
		this.uid += 1;
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		this.exit = true;
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Stdin cleanup must not replace the cancellation reason.
		}
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
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		if (this.activeOperation || !this.exit) {
			this.terminate();
		}
	}
}

export default AssemblyScriptSandbox;
