import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
import { resolveWatModuleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

class Wat implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(4096);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeLoadCleanup: (() => void) | null = null;
	private activeRun = false;
	private activeRunCleanup: (() => void) | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'WAT',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.activeRunCleanup?.();
			this.activeRunCleanup = null;
			this.activeRun = false;
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
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException('WAT runtime startup aborted', 'AbortError')
			);
		}
		if (this.activeLoadCleanup || this.activeRun) {
			return Promise.reject(
				new BusyError('WAT runtime already has an active operation', {
					runtimeId: 'WAT',
					phase: this.activeLoadCleanup ? 'startup' : 'execute'
				})
			);
		}
		let onAbort: (() => void) | undefined;
		let cleanedUp = false;
		const cleanup = () => {
			if (cleanedUp) return;
			cleanedUp = true;
			if (signal && onAbort) {
				try {
					signal.removeEventListener('abort', onAbort);
				} catch {
					// Cleanup must not replace the startup result.
				}
			}
			if (this.activeLoadCleanup === cleanup) this.activeLoadCleanup = null;
		};
		onAbort = signal
			? () => {
					if (this.activeLoadCleanup !== cleanup) {
						cleanup();
						return;
					}
					const reason =
						signal.reason ??
						new DOMException('WAT runtime startup aborted', 'AbortError');
					cleanup();
					this.workerSession.terminate(reason);
				}
			: undefined;
		const loadPromise = this.workerSession.load(async (resolve, reject) => {
			const resolveLoad = () => {
				cleanup();
				resolve();
			};
			const rejectLoad = (reason?: unknown) => {
				cleanup();
				reject(reason);
			};
			try {
				if (this.activeLoadCleanup !== cleanup || signal?.aborted) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextModuleUrl = resolveWatModuleUrl(runtimeAssets, currentUrl);
				if (!nextModuleUrl) {
					return rejectLoad(
						'WAT runtime is not configured. Set PUBLIC_WASM_WAT_MODULE_URL or runtimeAssets.wat.moduleUrl.'
					);
				}
				const needsWorkerReset = !this.worker || this.moduleUrl !== nextModuleUrl;
				this.moduleUrl = nextModuleUrl;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/wat?worker'))
						.default;
					if (this.activeLoadCleanup !== cleanup || signal?.aborted) return;
					const worker = new WorkerConstructor();
					if (this.activeLoadCleanup !== cleanup || signal?.aborted) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					worker.onmessage = (event: MessageEvent<any>) => {
						if (
							this.activeLoadCleanup !== cleanup ||
							signal?.aborted ||
							this.worker !== worker
						) {
							return;
						}
						reportWorkerProgress(progress, event.data?.progress);
						if (event.data?.load) {
							progress?.set?.(1);
							if (this.activeLoadCleanup !== cleanup || signal?.aborted) return;
							resolveLoad();
						}
						if (event.data?.error) rejectLoad(event.data.error);
					};
					worker.postMessage({
						load: true,
						moduleUrl: this.moduleUrl
					});
				} else {
					progress?.set?.(1);
					if (this.activeLoadCleanup !== cleanup || signal?.aborted) return;
					resolveLoad();
				}
			} catch (error) {
				rejectLoad(error);
			}
		});
		this.activeLoadCleanup = cleanup;
		if (signal && onAbort) {
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		}
		return loadPromise.finally(cleanup);
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
		_prog?: SandboxProgress,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (this.activeLoadCleanup || this.activeRun) {
			return Promise.reject(
				new BusyError('WAT runtime already has an active operation', {
					runtimeId: 'WAT',
					phase: this.activeLoadCleanup ? 'startup' : 'execute'
				})
			);
		}
		const worker = this.worker;
		if (!worker) return Promise.reject('Worker not loaded');
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException('WAT execution aborted', 'AbortError')
			);
		}
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		try {
			const limits = resolveExecutionLimits(options.limits);
			workspace = validateExecutionWorkspace(
				code,
				options.workspaceFiles ?? [],
				options.activePath ?? 'main.wat',
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
		this.activeRun = true;
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			const operation = this.workerSession.beginRun(worker, reject);
			let onAbort: (() => void) | undefined;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (signal && onAbort) {
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Cleanup must not replace the execution result.
					}
				}
				if (this.activeRunCleanup === cleanup) this.activeRunCleanup = null;
			};
			const handler = (event: Event & { data: any }) => {
				if (this.worker !== worker || worker.onmessage !== handler || _uid !== this.uid) {
					cleanup();
					if (worker.onmessage === handler) worker.onmessage = null;
					return;
				}
				const { output, results, error, buffer, diagnostic, progress } = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				reportWorkerProgress(_prog, progress);
				if (output) this.output?.(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (results) {
					cleanup();
					this.activeRun = false;
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					resolve(results as string);
				}
				if (error) {
					cleanup();
					this.activeRun = false;
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					reject(error);
				}
			};
			onAbort = signal
				? () => {
						if (
							!this.activeRun ||
							this.worker !== worker ||
							worker.onmessage !== handler ||
							_uid !== this.uid
						) {
							cleanup();
							return;
						}
						this.terminate(
							signal.reason ?? new DOMException('WAT execution aborted', 'AbortError')
						);
					}
				: undefined;
			this.activeRunCleanup = cleanup;
			worker.onmessage = handler;
			if (signal && onAbort) {
				signal.addEventListener('abort', onAbort, { once: true });
				if (signal.aborted) onAbort();
			}
			if (this.worker !== worker || worker.onmessage !== handler || _uid !== this.uid) return;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					stdin: options.stdin,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					log: _log
				});
			} catch (error) {
				cleanup();
				this.activeRun = false;
				this.workerSession.terminate(error);
			}
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const loadCleanup = this.activeLoadCleanup;
		this.activeLoadCleanup = null;
		loadCleanup?.();
		const cleanup = this.activeRunCleanup;
		this.activeRunCleanup = null;
		cleanup?.();
		this.activeRun = false;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		if (!this.exit || this.activeLoadCleanup) {
			this.terminate();
		}
	}
}

export default Wat;
