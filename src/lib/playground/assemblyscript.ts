import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { Sandbox } from '$lib/playground/sandbox';

class AssemblyScriptSandbox implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	activeReject: ((reason: string) => void) | null = null;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;

	load(
		_runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return new Promise<void>(async (resolve, reject) => {
			if (!this.worker) {
				this.worker = new (
					await import('$lib/playground/worker/assemblyscript?worker')
				).default();
				this.worker.onerror = (event: ErrorEvent) => {
					const location =
						event.filename && event.lineno
							? ` (${event.filename}:${event.lineno}:${event.colno})`
							: '';
					reject(
						`AssemblyScript worker script error: ${event.message || 'unknown error'}${location}`
					);
				};
				this.worker.onmessageerror = () => {
					reject('AssemblyScript worker message deserialization failed');
				};
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (event.data?.load) {
						progress?.set?.(1);
						resolve();
					}
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({
					load: true,
					log: _log
				});
			} else {
				progress?.set?.(1);
				resolve();
			}
		});
	}

	write(_input: string) {}

	eof() {}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const _uid = ++this.uid;
			this.activeReject = reject;
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { output, results, error, diagnostic, progress } = event.data;
				if (progress && typeof progress.percent === 'number') {
					_prog?.set?.(Math.max(0, Math.min(progress.percent / 100, 1)));
				}
				if (output) this.output?.(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.activeReject = null;
					resolve(results as string);
				}
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.activeReject = null;
					reject(error);
				}
			};
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				activePath: options.activePath || 'main.as.ts',
				workspaceFiles: options.workspaceFiles || [],
				log: _log
			});
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.activeReject?.('Process terminated');
		this.activeReject = null;
		this.uid += 1;
		this.worker?.terminate?.();
		delete this.worker;
		this.exit = true;
	}

	async clear() {
		if (this.worker) this.worker.onmessage = null;
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default AssemblyScriptSandbox;
