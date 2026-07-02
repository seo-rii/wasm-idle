import { resolveRBaseUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';

class R implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	baseUrl = '';
	activeReject: ((reason: string) => void) | null = null;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return new Promise<void>(async (resolve, reject) => {
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextBaseUrl = resolveRBaseUrl(runtimeAssets, currentUrl);
			if (!nextBaseUrl) {
				return reject(
					'R runtime is not configured. Set PUBLIC_WASM_R_BASE_URL or runtimeAssets.r.baseUrl.'
				);
			}
			const needsWorkerReset = !this.worker || this.baseUrl !== nextBaseUrl;
			this.baseUrl = nextBaseUrl;
			if (needsWorkerReset && this.worker) {
				this.worker.terminate();
				delete this.worker;
			}
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/r?worker')).default();
				this.worker.onerror = (event: ErrorEvent) => {
					const location =
						event.filename && event.lineno
							? ` (${event.filename}:${event.lineno}:${event.colno})`
							: '';
					reject(`R worker script error: ${event.message || 'unknown error'}${location}`);
				};
				this.worker.onmessageerror = () => {
					reject('R worker message deserialization failed');
				};
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (event.data?.progress && typeof event.data.progress.percent === 'number') {
						progress?.set?.(
							Math.max(0, Math.min(event.data.progress.percent / 100, 1))
						);
					}
					if (event.data?.load) {
						progress?.set?.(1);
						resolve();
					}
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({
					load: true,
					baseUrl: this.baseUrl,
					log: _log
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
		_log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const { programArgs } = resolveSandboxExecutionArgs('R', args, options);
			const _uid = ++this.uid;
			this.activeReject = reject;
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { output, results, error, buffer, diagnostic, progress } = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				if (progress && typeof progress.percent === 'number') {
					_prog?.set?.(Math.max(0, Math.min(progress.percent / 100, 1)));
				}
				if (output) this.output?.(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.activeReject = null;
					resolve(results as string);
				}
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.activeReject = null;
					reject(error);
				}
			};
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				args: programArgs,
				stdin: options.stdin,
				activePath: options.activePath || 'main.R',
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
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.worker?.terminate?.();
		delete this.worker;
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default R;
