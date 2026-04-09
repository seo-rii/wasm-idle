import { resolveElixirBundleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';

class Elixir implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	bundleUrl = '';
	activeReject: ((reason: string) => void) | null = null;
	prepared = false;
	hasExecuted = false;

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return new Promise<void>(async (resolve, reject) => {
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextBundleUrl = resolveElixirBundleUrl(runtimeAssets, currentUrl);
			if (!nextBundleUrl) {
				return reject(
					'Elixir runtime is not configured. Set PUBLIC_WASM_ELIXIR_BUNDLE_URL or runtimeAssets.elixir.bundleUrl.'
				);
			}

			const needsWorkerReset = !this.worker || this.bundleUrl !== nextBundleUrl;
			this.bundleUrl = nextBundleUrl;
			if (needsWorkerReset && this.worker) {
				this.worker.terminate();
				delete this.worker;
			}
			if (!this.worker) {
				progress?.set?.(0.2);
				this.worker = new (await import('$lib/playground/worker/elixir?worker')).default();
				progress?.set?.(0.5);
				this.worker.onerror = (event: ErrorEvent) => {
					const location =
						event.filename && event.lineno
							? ` (${event.filename}:${event.lineno}:${event.colno})`
							: '';
					reject(`Elixir worker script error: ${event.message || 'unknown error'}${location}`);
				};
				this.worker.onmessageerror = () => {
					reject('Elixir worker message deserialization failed');
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
					bundleUrl: this.bundleUrl,
					log
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
		log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const activeUid = ++this.uid;
			this.activeReject = reject;
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (activeUid !== this.uid) return (this.worker.onmessage = null);
				const { output, error } = event.data;
				const hasResults = Object.prototype.hasOwnProperty.call(event.data || {}, 'results');
				if (output) {
					this.output?.(output);
				}
				if (hasResults) {
					const { results } = event.data;
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.activeReject = null;
					this.prepared = prepare;
					this.hasExecuted = !prepare;
					if (!prepare && typeof results === 'string' && results) {
						this.output?.(`=> ${results}\n`);
					}
					resolve(results || true);
				}
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.activeReject = null;
					this.prepared = false;
					this.hasExecuted = false;
					reject(error);
				}
			};
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				log
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
		this.prepared = false;
		this.hasExecuted = false;
		this.worker?.terminate?.();
		delete this.worker;
		this.exit = true;
	}

	async clear() {
		if (this.worker) {
			this.worker.onmessage = null;
		}
		if (!this.exit || this.hasExecuted) {
			this.terminate();
		}
	}
}

export default Elixir;
