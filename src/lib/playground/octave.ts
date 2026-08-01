import {
	resolveOctaveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
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
	private activeLoad = false;
	private activeRun: symbol | null = null;
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
		if (this.activeLoad || this.activeRun) {
			return Promise.reject(
				new BusyError('Octave runtime already has an active operation', {
					runtimeId: 'OCTAVE',
					phase: this.activeLoad ? 'startup' : 'execute'
				})
			);
		}
		this.activeLoad = true;
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
		}).finally(() => {
			this.activeLoad = false;
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
		if (this.activeLoad || this.activeRun) {
			return Promise.reject(
				new BusyError('Octave runtime already has an active operation', {
					runtimeId: 'OCTAVE',
					phase: this.activeLoad ? 'startup' : 'execute'
				})
			);
		}
		if (prepare) return Promise.resolve(true);
		if (!this.baseUrl || !this.workerUrl || !this.manifestUrl) {
			return Promise.reject('Octave runtime is not configured.');
		}
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException('Octave execution aborted', 'AbortError')
			);
		}
		let programArgs: string[];
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		try {
			programArgs = resolveSandboxExecutionArgs('OCTAVE', args, options).programArgs;
			const limits = resolveExecutionLimits(options.limits);
			workspace = validateExecutionWorkspace(
				code,
				options.workspaceFiles ?? [],
				options.activePath ?? 'main.m',
				{
					...options.workspaceLimits,
					maxFileBytes: Math.min(
						options.workspaceLimits?.maxFileBytes ??
							DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
						limits.maxWorkspaceBytes
					),
					maxTotalBytes: Math.min(
						options.workspaceLimits?.maxTotalBytes ??
							DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
						limits.maxWorkspaceBytes
					)
				}
			);
		} catch (error) {
			return Promise.reject(error);
		}
		const hasExplicitStdin = options.stdin !== undefined;
		if (hasExplicitStdin) {
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			this.resolveStdinWaiters();
			resetBufferedStdin(this.buffer);
		}

		const runToken = Symbol('Octave run');
		this.activeRun = runToken;
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			let onAbort: (() => void) | undefined;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (hasExplicitStdin) {
					this.pendingInput = [];
					this.waitingForInput = false;
					this.pendingEof = false;
					this.resolveStdinWaiters();
					try {
						resetBufferedStdin(this.buffer);
					} catch {
						// Stdin cleanup must not replace the execution result.
					}
				}
				if (signal && onAbort) {
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Cleanup must not replace the execution result.
					}
				}
				if (this.activeRun === runToken) this.activeRun = null;
			};
			const rejectRun = (reason?: unknown) => {
				cleanup();
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				reject(reason);
			};
			const operation = this.workerSession.beginRun(null, rejectRun);
			onAbort = signal
				? () => {
						if (this.activeRun !== runToken || _uid !== this.uid) {
							cleanup();
							return;
						}
						this.terminate(
							signal.reason ??
								new DOMException('Octave execution aborted', 'AbortError')
						);
					}
				: undefined;
			if (signal && onAbort) {
				signal.addEventListener('abort', onAbort, { once: true });
				if (signal.aborted) onAbort();
			}
			if (this.activeRun !== runToken || _uid !== this.uid) return;
			this.begin = Date.now();
			this.collectStdinForRun(code, options)
				.then((stdin) => {
					if (this.activeRun !== runToken || _uid !== this.uid) return;
					const worker = this.createWorker();
					let handler: (event: MessageEvent<OctaveWorkerMessage>) => void;
					const ownsRun = () =>
						this.activeRun === runToken &&
						this.worker === worker &&
						worker.onmessage === handler &&
						_uid === this.uid;
					const failRun = (error: unknown) => {
						if (!ownsRun()) return;
						this.workerSession.terminate(error);
					};
					handler = (event) => {
						if (!ownsRun()) return;
						try {
							const { output, results, error, buffer, progress } = event.data;
							if (buffer) {
								this.waitingForInput = true;
								this.flushPendingInput();
								if (!ownsRun()) return;
							}
							reportWorkerProgress(_prog, progress);
							if (!ownsRun()) return;
							if (output) this.output?.(output);
							if (!ownsRun()) return;
							if (results) {
								if (worker.onmessage === handler) worker.onmessage = null;
								this.workerSession.complete(operation);
								cleanup();
								this.elapse = Date.now() - this.begin;
								this.exit = true;
								this.waitingForInput = false;
								this.pendingEof = false;
								resolve(true);
								return;
							}
							if (error) {
								if (worker.onmessage === handler) worker.onmessage = null;
								this.workerSession.complete(operation);
								cleanup();
								this.elapse = Date.now() - this.begin;
								this.exit = true;
								this.waitingForInput = false;
								this.pendingEof = false;
								reject(error);
								return;
							}
						} catch (error) {
							failRun(error);
						}
					};
					worker.onmessage = handler;
					worker.postMessage({
						run: true,
						baseUrl: this.baseUrl,
						manifestUrl: this.manifestUrl,
						buffer: this.buffer,
						code,
						args: programArgs,
						stdin,
						activePath: workspace.activePath,
						workspaceFiles: workspace.workspaceFiles,
						log: _log
					});
				})
				.catch((error) => {
					if (this.activeRun !== runToken || _uid !== this.uid) return;
					this.terminate(error);
				});
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		this.activeLoad = false;
		this.activeRun = null;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.resolveStdinWaiters();
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		this.resolveStdinWaiters();
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		if (!this.exit || this.activeLoad || this.activeRun) {
			this.terminate();
		}
	}
}

export default Octave;
