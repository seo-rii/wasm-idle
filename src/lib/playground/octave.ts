import {
	resolveOctaveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
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

type OctaveWorkerMessage =
	| {
			load?: never;
			output?: string;
			results?: boolean;
			error?: string;
			buffer?: boolean;
			progress?: { percent?: number };
	  }
	| {
			load: true;
	  };

class Octave implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	baseUrl = '';
	workerUrl = '';
	manifestUrl = '';
	activeReject: ((reason: string) => void) | null = null;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	stdinWaiters: Array<() => void> = [];

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return new Promise<void>((resolve) => {
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const config = resolveOctaveRuntimeAssetConfig(runtimeAssets, currentUrl);
			this.baseUrl = config.baseUrl;
			this.workerUrl = config.workerUrl;
			this.manifestUrl = config.manifestUrl;
			progress?.set?.(1);
			resolve();
		});
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.resolveStdinWaiters();
		this.flushPendingInput();
	}

	eof() {
		this.pendingEof = true;
		this.resolveStdinWaiters();
		this.flushPendingInput();
	}

	private resolveStdinWaiters() {
		const waiters = this.stdinWaiters.splice(0);
		for (const resolve of waiters) resolve();
	}

	private readsOctaveStdin(code: string) {
		return /\bstdin\b|\binput\s*\(/.test(code);
	}

	private async collectStdinForRun(code: string, options: SandboxExecutionOptions) {
		if (
			typeof options.stdin !== 'string' &&
			this.pendingInput.length === 0 &&
			!this.pendingEof &&
			this.readsOctaveStdin(code)
		) {
			await new Promise<void>((resolve) => this.stdinWaiters.push(resolve));
		}
		if (typeof options.stdin === 'string') return options.stdin;
		if (!this.readsOctaveStdin(code)) return undefined;
		const stdin = this.pendingInput.join('');
		this.pendingInput = [];
		this.pendingEof = false;
		return stdin;
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

	private createWorker() {
		if (this.worker) {
			this.worker.terminate();
			delete this.worker;
		}
		const worker = new Worker(this.workerUrl);
		this.worker = worker;
		return worker;
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (prepare) return Promise.resolve(true);

		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.baseUrl || !this.workerUrl || !this.manifestUrl) {
				return reject('Octave runtime is not configured.');
			}
			const { programArgs } = resolveSandboxExecutionArgs('OCTAVE', args, options);
			const _uid = ++this.uid;
			this.activeReject = reject;
			this.begin = Date.now();
			this.collectStdinForRun(code, options)
				.then((stdin) => {
					if (_uid !== this.uid) return;
					const worker = this.createWorker();
					worker.onerror = (event: ErrorEvent) => {
						const location =
							event.filename && event.lineno
								? ` (${event.filename}:${event.lineno}:${event.colno})`
								: '';
						reject(
							`Octave worker script error: ${event.message || 'unknown error'}${location}`
						);
					};
					worker.onmessageerror = () => {
						reject('Octave worker message deserialization failed');
					};
					worker.onmessage = (event: MessageEvent<OctaveWorkerMessage>) => {
						if (_uid !== this.uid) return;
						const { output, results, error, buffer, progress } = event.data;
						if (buffer) {
							this.waitingForInput = true;
							this.flushPendingInput();
						}
						if (progress && typeof progress.percent === 'number') {
							_prog?.set?.(Math.max(0, Math.min(progress.percent / 100, 1)));
						}
						if (output) this.output?.(output);
						if (results) {
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.waitingForInput = false;
							this.pendingEof = false;
							this.activeReject = null;
							resolve(true);
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
					worker.postMessage({
						run: true,
						baseUrl: this.baseUrl,
						manifestUrl: this.manifestUrl,
						buffer: this.buffer,
						code,
						args: programArgs,
						stdin,
						activePath: options.activePath || 'main.m',
						workspaceFiles: options.workspaceFiles || [],
						log: _log
					});
				})
				.catch(reject);
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
		this.resolveStdinWaiters();
		this.worker?.terminate?.();
		delete this.worker;
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		this.resolveStdinWaiters();
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default Octave;
