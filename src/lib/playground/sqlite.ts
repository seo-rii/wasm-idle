import {
	resolveSqliteRuntimeModuleUrl,
	resolveSqliteWasmUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';
import {
	BusyError,
	CancelledError,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	RuntimeConfigurationError,
	TimeoutError,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';

type SqliteOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
};

const OUTPUT_ENCODER = new TextEncoder();

const abortReason = (signal: AbortSignal, phase: SqliteOperation['phase']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup' ? 'SQLite runtime startup aborted' : 'SQLite execution aborted',
				'AbortError'
			);

class Sqlite implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	wasmUrl = '';
	moduleUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	private activeOperation: SqliteOperation | null = null;
	private disposed = false;
	private disposePromise: Promise<void> | null = null;
	private readonly disposeCancellation = new CancelledError('SQLite sandbox disposed', {
		phase: 'dispose',
		runtimeId: 'SQLITE',
		recoverable: false
	});
	private readonly workerSession = new WorkerSession({
		label: 'SQLite',
		onDispose: (worker) => {
			if (this.worker !== worker) return;
			delete this.worker;
			this.exit = true;
		}
	});

	private requireOperationIdle() {
		if (!this.activeOperation) return;
		throw new BusyError('SQLite runtime already has an active operation', {
			runtimeId: 'SQLITE',
			phase: this.activeOperation.phase
		});
	}

	private beginOperation(phase: SqliteOperation['phase']) {
		if (this.disposed) {
			throw new RuntimeConfigurationError('SQLite sandbox is disposed', {
				phase: 'dispose',
				runtimeId: 'SQLITE'
			});
		}
		this.requireOperationIdle();
		const operation: SqliteOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			cleanedUp: false,
			cleanups: []
		};
		this.activeOperation = operation;
		return operation;
	}

	private isOperationActive(operation: SqliteOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: SqliteOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: SqliteOperation) {
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

	private releaseBeforeSession(operation: SqliteOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private bindPreSessionAbort(operation: SqliteOperation, signal: AbortSignal | undefined) {
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

	private bindAbortSignal(operation: SqliteOperation, signal: AbortSignal | undefined) {
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

	private bindOperationTimeout(operation: SqliteOperation, timeoutMs: number) {
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
					new TimeoutError(`SQLite ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: 'SQLITE',
						timeoutMs
					})
				);
			}, timeoutMs);
			if (operation.cleanedUp) clearTimeout(timeout);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private cancelOperation(operation: SqliteOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.activeOperation = null;
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
		let activeOperation: SqliteOperation;
		try {
			activeOperation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let signal: AbortSignal | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'SQLite runtime startup cancelled')
				);
			}
			limits = resolveExecutionLimits(options.limits);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'SQLite runtime startup cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'SQLite runtime startup cancelled')
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
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextWasmUrl = resolveSqliteWasmUrl(runtimeAssets, currentUrl);
				const nextModuleUrl = resolveSqliteRuntimeModuleUrl(runtimeAssets, currentUrl);
				if (!this.isOperationActive(activeOperation)) return;
				const needsWorkerReset =
					!this.worker ||
					this.wasmUrl !== nextWasmUrl ||
					this.moduleUrl !== nextModuleUrl;
				this.wasmUrl = nextWasmUrl;
				this.moduleUrl = nextModuleUrl;
				if (needsWorkerReset && this.worker) this.workerSession.reset();
				if (!this.isOperationActive(activeOperation)) return;
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/sqlite?worker'))
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
						wasmUrl: this.wasmUrl,
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

	write() {}

	eof() {}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		let activeOperation: SqliteOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let signal: AbortSignal | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'SQLite execution cancelled')
				);
			}
			limits = resolveExecutionLimits(options.limits);
			workspace = validateExecutionWorkspace(
				code,
				options.workspaceFiles ?? [],
				options.activePath ?? 'main.sql',
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
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'SQLite execution cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'SQLite execution cancelled')
			);
		}
		const worker = this.worker;
		if (!worker) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, 'Worker not loaded'));
		}
		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
			const runUid = ++this.uid;
			let diagnosticCount = 0;
			let outputBytes = 0;
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
				runUid === this.uid;
			const claimRun = () => {
				if (!ownsRun()) return false;
				this.elapse = Date.now() - this.begin;
				this.exit = true;
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
				if (disposeWorker) {
					if (!ownsRun()) return;
					this.cancelOperation(activeOperation, reason);
					return;
				}
				if (!claimRun()) return;
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
					const { output, results, error, diagnostic, progress } = event.data;
					reportWorkerProgress(_prog, progress);
					if (!ownsRun()) return;
					if (typeof output === 'string' && output.length > 0) {
						const actual = outputBytes + OUTPUT_ENCODER.encode(output).byteLength;
						if (actual > limits.maxOutputBytes) {
							failRun(
								new OutputLimitError(
									`SQLite output exceeded ${limits.maxOutputBytes} bytes`,
									{
										actual,
										limit: limits.maxOutputBytes,
										phase: 'execute',
										runtimeId: 'SQLITE'
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
					if (diagnostic !== undefined) {
						const actual = diagnosticCount + 1;
						if (actual > limits.maxDiagnostics) {
							failRun(
								new DiagnosticLimitError(
									`SQLite diagnostics exceeded ${limits.maxDiagnostics} messages`,
									{
										actual,
										limit: limits.maxDiagnostics,
										phase: 'execute',
										runtimeId: 'SQLITE'
									}
								),
								true
							);
							return;
						}
						diagnosticCount = actual;
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
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					log: _log
				});
			} catch (error) {
				failRun(error);
			}
		});
		return running.finally(() => {
			if (this.releaseOperation(activeOperation)) this.exit = true;
			this.cleanupOperation(activeOperation);
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		if (this.disposed) return;
		const activeOperation = this.activeOperation;
		if (activeOperation) {
			this.cancelOperation(activeOperation, reason);
			return;
		}
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		if (this.disposed) return;
		if (this.activeOperation) {
			this.terminate();
			return;
		}
		const worker = this.worker;
		if (worker) {
			try {
				worker.onmessage = null;
			} catch {
				// Idle handler cleanup is best effort.
			}
		}
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.disposePromise = Promise.resolve();

		const activeOperation = this.activeOperation;
		delete this.worker;
		this.wasmUrl = '';
		this.moduleUrl = '';
		this.output = null;
		this.oncompilerdiagnostic = undefined;
		if (activeOperation) {
			this.cancelOperation(activeOperation, this.disposeCancellation);
		} else {
			this.uid += 1;
			this.workerSession.terminate(this.disposeCancellation);
			this.exit = true;
		}
		return this.disposePromise;
	}
}

export default Sqlite;
