import { resolveElixirBundleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';

class Elixir implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = new SharedArrayBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	bundleUrl = '';
	activeReject: ((reason: string) => void) | null = null;
	prepared = false;
	hasExecuted = false;
	waitingForInput = false;
	pendingEof = false;

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return new Promise<void>(async (resolve, reject) => {
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
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
					reject(
						`Elixir worker script error: ${event.message || 'unknown error'}${location}`
					);
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
				const { output, error, buffer } = event.data;
				const hasResults = Object.prototype.hasOwnProperty.call(
					event.data || {},
					'results'
				);
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				if (output) {
					this.output?.(output);
				}
				if (hasResults) {
					const { results } = event.data;
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
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
					this.waitingForInput = false;
					this.pendingEof = false;
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
				buffer: this.buffer,
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
		this.waitingForInput = false;
		this.pendingEof = false;
		this.worker?.terminate?.();
		delete this.worker;
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) {
			this.worker.onmessage = null;
		}
		resetBufferedStdin(this.buffer);
		if (!this.exit || this.hasExecuted) {
			this.terminate();
		}
	}
}

export default Elixir;
