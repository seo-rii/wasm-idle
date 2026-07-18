import {
	resolveSqliteRuntimeModuleUrl,
	resolveSqliteWasmUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

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
	private readonly workerSession = new WorkerSession({
		label: 'SQLite',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
		}
	});

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		return this.workerSession.load(async (resolve, reject) => {
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextWasmUrl = resolveSqliteWasmUrl(runtimeAssets, currentUrl);
			const nextModuleUrl = resolveSqliteRuntimeModuleUrl(runtimeAssets, currentUrl);
			const needsWorkerReset =
				!this.worker || this.wasmUrl !== nextWasmUrl || this.moduleUrl !== nextModuleUrl;
			this.wasmUrl = nextWasmUrl;
			this.moduleUrl = nextModuleUrl;
			if (needsWorkerReset && this.worker) {
				this.workerSession.reset();
			}
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/sqlite?worker')).default();
				this.workerSession.attach(this.worker);
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (event.data?.load) {
						progress?.set?.(1);
						resolve();
					}
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({
					load: true,
					moduleUrl: this.moduleUrl,
					wasmUrl: this.wasmUrl,
					log: _log
				});
			} else {
				progress?.set?.(1);
				resolve();
			}
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
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const _uid = ++this.uid;
			const operation = this.workerSession.beginRun(this.worker, reject);
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { output, results, error, diagnostic, progress } = event.data;
				reportWorkerProgress(_prog, progress);
				if (output) this.output?.(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.workerSession.complete(operation);
					resolve(results as string);
				}
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.workerSession.complete(operation);
					reject(error);
				}
			};
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				activePath: options.activePath || 'main.sql',
				workspaceFiles: options.workspaceFiles || [],
				log: _log
			});
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.uid += 1;
		this.workerSession.terminate();
		this.exit = true;
	}

	async clear() {
		if (this.worker) this.worker.onmessage = null;
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default Sqlite;
