import {
	resolveElixirBundleUrl,
	resolveErlangBundleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import type { SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';

type BeamEvalLanguage = 'ELIXIR' | 'ERLANG';

class Elixir implements Sandbox {
	language: BeamEvalLanguage;
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	bundleUrl = '';
	prepared = false;
	hasExecuted = false;
	waitingForInput = false;
	pendingEof = false;
	private readonly workerSession = new WorkerSession({
		label: () => (this.language === 'ERLANG' ? 'Erlang' : 'Elixir'),
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.prepared = false;
			this.hasExecuted = false;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	constructor(language: BeamEvalLanguage = 'ELIXIR') {
		this.language = language;
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		return this.workerSession.load(async (resolve, reject) => {
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextBundleUrl =
				this.language === 'ERLANG'
					? resolveErlangBundleUrl(runtimeAssets, currentUrl)
					: resolveElixirBundleUrl(runtimeAssets, currentUrl);
			const runtimeLabel = this.language === 'ERLANG' ? 'Erlang' : 'Elixir';
			if (!nextBundleUrl) {
				return reject(
					`${runtimeLabel} runtime is not configured. Set ${
						this.language === 'ERLANG'
							? 'PUBLIC_WASM_ERLANG_BUNDLE_URL or runtimeAssets.erlang.bundleUrl'
							: 'PUBLIC_WASM_ELIXIR_BUNDLE_URL or runtimeAssets.elixir.bundleUrl'
					}.`
				);
			}

			const needsWorkerReset = !this.worker || this.bundleUrl !== nextBundleUrl;
			const preservePendingInput = this.prepared && !needsWorkerReset;
			if (!preservePendingInput) {
				this.pendingInput = [];
				this.pendingEof = false;
			}
			this.waitingForInput = false;
			this.bundleUrl = nextBundleUrl;
			if (needsWorkerReset && this.worker) {
				this.workerSession.reset();
			}
			if (!this.worker) {
				progress?.set?.(0.2);
				this.worker = new (await import('$lib/playground/worker/elixir?worker')).default();
				progress?.set?.(0.5);
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
		_prog?: SandboxProgress,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const activeUid = ++this.uid;
			const operation = this.workerSession.beginRun(this.worker, reject);
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
					this.workerSession.complete(operation);
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
					this.workerSession.complete(operation);
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
				language: this.language,
				log,
				stdin: options.stdin
			});
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.uid += 1;
		this.prepared = false;
		this.hasExecuted = false;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.workerSession.terminate();
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
