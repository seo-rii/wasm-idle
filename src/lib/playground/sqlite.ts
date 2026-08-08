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
	DEFAULT_WORKSPACE_LIMITS,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';

type SqliteOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
};

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
		this.requireOperationIdle();
		const operation: SqliteOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false
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

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let activeOperation: SqliteOperation;
		try {
			activeOperation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		const loading = this.workerSession.load(async (resolve, reject) => {
			const resolveOperation = () => {
				if (!this.releaseOperation(activeOperation)) return;
				resolve();
			};
			const rejectOperation = (reason?: unknown) => {
				if (!this.releaseOperation(activeOperation)) return;
				reject(reason);
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
		return loading.finally(() => {
			this.releaseOperation(activeOperation);
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
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		try {
			this.requireOperationIdle();
			const limits = resolveExecutionLimits(options.limits);
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
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		const worker = this.worker;
		if (!worker) {
			this.releaseOperation(activeOperation);
			return Promise.reject('Worker not loaded');
		}
		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
			const runUid = ++this.uid;
			const workerOperation = this.workerSession.beginRun(worker, reject);
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
					const { output, results, error, diagnostic, progress } = event.data;
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
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					log: _log
				});
			} catch (error) {
				failRun(error);
			}
		});
		return running.finally(() => {
			if (!this.releaseOperation(activeOperation)) return;
			this.exit = true;
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const activeOperation = this.activeOperation;
		if (activeOperation) {
			activeOperation.cancelled = true;
			this.releaseOperation(activeOperation);
		}
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
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
}

export default Sqlite;
