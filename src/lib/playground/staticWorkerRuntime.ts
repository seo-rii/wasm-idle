import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';

export interface StaticWorkerRuntimeUrls {
	baseUrl: string;
	workerUrl: string;
	manifestUrl?: string;
}

export interface StaticWorkerRuntimeConfig {
	languageId: string;
	displayName: string;
	defaultActivePath: string;
	moduleWorker?: boolean;
	readStdinPattern: RegExp;
	resolveRuntimeAssets: (
		runtimeAssets: string | PlaygroundRuntimeAssets,
		currentUrl: string
	) => StaticWorkerRuntimeUrls;
}

type StaticWorkerMessage = {
	output?: string;
	results?: boolean | string;
	error?: string;
	diagnostic?: CompilerDiagnostic;
	progress?: { percent?: number };
};

export class StaticWorkerRuntimeSandbox implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
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
	pendingEof = false;
	stdinWaiters: Array<() => void> = [];

	constructor(private readonly config: StaticWorkerRuntimeConfig) {}

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
			this.pendingEof = false;
			this.resolveStdinWaiters();
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const urls = this.config.resolveRuntimeAssets(runtimeAssets, currentUrl);
			this.baseUrl = urls.baseUrl;
			this.workerUrl = urls.workerUrl;
			this.manifestUrl = urls.manifestUrl || '';
			progress?.set?.(1);
			resolve();
		});
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.resolveStdinWaiters();
	}

	eof() {
		this.pendingEof = true;
		this.resolveStdinWaiters();
	}

	private resolveStdinWaiters() {
		const waiters = this.stdinWaiters.splice(0);
		for (const resolve of waiters) resolve();
	}

	private readsStdin(code: string) {
		return this.config.readStdinPattern.test(code);
	}

	private async collectStdinForRun(code: string, options: SandboxExecutionOptions) {
		const readsStdin = this.readsStdin(code);
		if (
			typeof options.stdin !== 'string' &&
			this.pendingInput.length === 0 &&
			!this.pendingEof &&
			readsStdin
		) {
			await new Promise<void>((resolve) => this.stdinWaiters.push(resolve));
		}
		if (typeof options.stdin === 'string') return options.stdin;
		if (!readsStdin) return undefined;
		const stdin = this.pendingInput.join('');
		this.pendingInput = [];
		this.pendingEof = false;
		return stdin;
	}

	private createWorker() {
		if (this.worker) {
			this.worker.terminate();
			delete this.worker;
		}
		const worker = this.config.moduleWorker
			? new Worker(this.workerUrl, { type: 'module' })
			: new Worker(this.workerUrl);
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
			if (!this.baseUrl || !this.workerUrl) {
				return reject(`${this.config.displayName} runtime is not configured.`);
			}
			const { programArgs } = resolveSandboxExecutionArgs(
				this.config.languageId,
				args,
				options
			);
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
							`${this.config.displayName} worker script error: ${
								event.message || 'unknown error'
							}${location}`
						);
					};
					worker.onmessageerror = () => {
						reject(`${this.config.displayName} worker message deserialization failed`);
					};
					worker.onmessage = (event: MessageEvent<StaticWorkerMessage>) => {
						if (_uid !== this.uid) return;
						const { output, results, error, diagnostic, progress } = event.data;
						if (progress && typeof progress.percent === 'number') {
							_prog?.set?.(Math.max(0, Math.min(progress.percent / 100, 1)));
						}
						if (output) this.output?.(output);
						if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
						if (results) {
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.pendingEof = false;
							this.activeReject = null;
							resolve(typeof results === 'string' ? results : true);
						}
						if (error) {
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.pendingEof = false;
							this.activeReject = null;
							reject(error);
						}
					};
					worker.postMessage({
						run: true,
						baseUrl: this.baseUrl,
						manifestUrl: this.manifestUrl,
						code,
						args: programArgs,
						stdin,
						activePath: options.activePath || this.config.defaultActivePath,
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
		this.pendingEof = false;
		this.uid += 1;
		this.resolveStdinWaiters();
		this.worker?.terminate?.();
		delete this.worker;
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.pendingEof = false;
		this.resolveStdinWaiters();
		if (this.worker) this.worker.onmessage = null;
		if (!this.exit) {
			this.terminate();
		}
	}
}
