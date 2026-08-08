import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
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
	reason?: unknown;
};

const abortReason = (signal: AbortSignal, phase: AssemblyScriptOperation['phase']) =>
	signal.reason ??
	new DOMException(
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
		if (options.signal?.aborted) {
			return Promise.reject(abortReason(options.signal, 'startup'));
		}
		let operation: AssemblyScriptOperation;
		try {
			operation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		const loading = this.workerSession.load(async (resolve, reject) => {
			if (!this.isOperationActive(operation)) return;
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextModuleUrl = resolveAssemblyScriptRuntimeModuleUrl(runtimeAssets, currentUrl);
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
					this.completeOperation(operation);
					reject(reason);
				};
				handler = (event: MessageEvent<any>) => {
					if (!ownsLoad()) return;
					try {
						if (event.data?.load) {
							progress?.set?.(1);
							if (!ownsLoad()) return;
							this.completeOperation(operation);
							resolve();
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
					this.completeOperation(operation);
					resolve();
				} catch (error) {
					if (!this.isOperationActive(operation)) return;
					this.completeOperation(operation);
					reject(error);
				}
			}
		});
		const cleanupSignal = this.bindAbortSignal(operation, options.signal);
		return loading.finally(() => {
			cleanupSignal();
			this.completeOperation(operation);
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
			cancelled: false
		} satisfies AssemblyScriptOperation;
		this.activeOperation = operation;
		return operation;
	}

	private completeOperation(operation: AssemblyScriptOperation) {
		if (this.activeOperation?.token === operation.token) this.activeOperation = null;
	}

	private isOperationActive(operation: AssemblyScriptOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private bindAbortSignal(operation: AssemblyScriptOperation, signal: AbortSignal | undefined) {
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
		if (options.signal?.aborted) {
			return Promise.reject(abortReason(options.signal, 'execute'));
		}
		let activeOperation: AssemblyScriptOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		if (!this.worker) {
			this.completeOperation(activeOperation);
			return Promise.reject('Worker not loaded');
		}
		const worker = this.worker;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		try {
			const limits = resolveExecutionLimits(options.limits);
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
		} catch (error) {
			this.completeOperation(activeOperation);
			return Promise.reject(error);
		}
		const hasExplicitStdin = options.stdin !== undefined;
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
		let cleanupSignal: () => void = () => undefined;
		const running = new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			const workerOperation = this.workerSession.beginRun(worker, reject);
			cleanupSignal = this.bindAbortSignal(activeOperation, options.signal);
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
				cleanupSignal();
				this.completeOperation(activeOperation);
				try {
					if (worker.onmessage === handler) worker.onmessage = null;
				} catch {
					// Handler cleanup must not replace or defer the execution result.
				}
				return true;
			};
			const failRun = (reason: unknown, disposeWorker = false) => {
				if (!claimRun()) return;
				if (disposeWorker && this.worker === worker) {
					try {
						this.workerSession.reset();
					} catch {
						if (this.worker === worker) delete this.worker;
						try {
							worker.terminate();
						} catch {
							// Worker cleanup must not replace the callback error.
						}
					}
				}
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
					stdin: options.stdin,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					log: _log
				});
			} catch (error) {
				failRun(error);
			}
		});
		return running.finally(() => {
			if (this.isOperationActive(activeOperation)) cleanupExplicitStdin();
			cleanupSignal();
			this.completeOperation(activeOperation);
		});
	}

	private cancelOperation(operation: AssemblyScriptOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.reason = reason;
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
