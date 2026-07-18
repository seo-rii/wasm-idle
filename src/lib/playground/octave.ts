import {
	resolveOctaveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

type OctaveWorkerMessage = {
	load?: true;
	output?: string;
	results?: boolean;
	error?: string;
	buffer?: boolean;
	progress?: { percent?: number; stage?: string };
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
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	stdinWaiters: Array<() => void> = [];
	private readonly workerSession = new WorkerSession({
		label: 'Octave',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
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
			this.workerSession.reset();
			this.exit = false;
		}
		const worker = new Worker(this.workerUrl);
		this.worker = worker;
		this.workerSession.attach(worker);
		return worker;
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
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
			const operation = this.workerSession.beginRun(null, reject);
			this.begin = Date.now();
			this.collectStdinForRun(code, options)
				.then((stdin) => {
					if (_uid !== this.uid) return;
					const worker = this.createWorker();
					worker.onmessage = (event: MessageEvent<OctaveWorkerMessage>) => {
						if (_uid !== this.uid) return;
						const { output, results, error, buffer, progress } = event.data;
						if (buffer) {
							this.waitingForInput = true;
							this.flushPendingInput();
						}
						reportWorkerProgress(_prog, progress);
						if (output) this.output?.(output);
						if (results) {
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.waitingForInput = false;
							this.pendingEof = false;
							this.workerSession.complete(operation);
							resolve(true);
						}
						if (error) {
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.waitingForInput = false;
							this.pendingEof = false;
							this.workerSession.complete(operation);
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
				.catch((error) => {
					this.workerSession.complete(operation);
					reject(error);
				});
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.resolveStdinWaiters();
		this.workerSession.terminate();
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
