import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import {
	resolveDuckDbRuntimeModuleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';
import { BusyError } from '@wasm-idle/core';

type DuckDbOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
};

class DuckDB implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	private activeOperation: DuckDbOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'DuckDB',
		onDispose: (worker) => {
			if (this.worker !== worker) return;
			delete this.worker;
			this.exit = true;
		}
	});

	private beginOperation(phase: DuckDbOperation['phase']) {
		if (this.activeOperation) {
			throw new BusyError('DuckDB runtime already has an active operation', {
				runtimeId: 'DUCKDB',
				phase: this.activeOperation.phase
			});
		}
		const operation: DuckDbOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false
		};
		this.activeOperation = operation;
		return operation;
	}

	private isOperationActive(operation: DuckDbOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: DuckDbOperation) {
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
		let activeOperation: DuckDbOperation;
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
				const nextModuleUrl = resolveDuckDbRuntimeModuleUrl(runtimeAssets, currentUrl);
				if (!this.isOperationActive(activeOperation)) return;
				if (this.worker && this.moduleUrl !== nextModuleUrl) this.workerSession.reset();
				this.moduleUrl = nextModuleUrl;
				if (!this.isOperationActive(activeOperation)) return;
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/duckdb?worker'))
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
		let activeOperation: DuckDbOperation;
		try {
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
					activePath: options.activePath || 'main.duckdb',
					workspaceFiles: options.workspaceFiles || [],
					stdin: options.stdin,
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

export default DuckDB;
