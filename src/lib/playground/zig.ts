import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions,
	type ZigTargetTriple
} from '$lib/playground/options';
import {
	resolveZigCompilerUrl,
	resolveZigStdlibUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
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

class Zig implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	compilerUrl = '';
	stdlibUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeLoadCleanup: (() => void) | null = null;
	private activeRunCleanup: (() => void) | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'Zig',
		onDispose: (worker) => {
			this.activeRunCleanup?.();
			this.activeRunCleanup = null;
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
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException('Zig runtime startup aborted', 'AbortError')
			);
		}
		if (this.activeLoadCleanup || !this.exit) {
			return Promise.reject(
				new BusyError('Zig runtime already has an active operation', {
					runtimeId: 'ZIG',
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
						new DOMException('Zig runtime startup aborted', 'AbortError');
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
				const nextCompilerUrl = resolveZigCompilerUrl(runtimeAssets, currentUrl);
				const nextStdlibUrl = resolveZigStdlibUrl(runtimeAssets, currentUrl);
				if (!nextCompilerUrl || !nextStdlibUrl) {
					return rejectLoad(
						'Zig runtime is not configured. Set PUBLIC_WASM_ZIG_COMPILER_URL and PUBLIC_WASM_ZIG_STDLIB_URL, or runtimeAssets.zig.compilerUrl and runtimeAssets.zig.stdlibUrl.'
					);
				}
				const needsWorkerReset =
					!this.worker ||
					this.compilerUrl !== nextCompilerUrl ||
					this.stdlibUrl !== nextStdlibUrl;
				this.compilerUrl = nextCompilerUrl;
				this.stdlibUrl = nextStdlibUrl;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/zig?worker'))
						.default;
					if (this.activeLoadCleanup !== cleanup || signal?.aborted) return;
					const worker = new WorkerConstructor();
					if (this.activeLoadCleanup !== cleanup || signal?.aborted) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					let handler: (event: MessageEvent<any>) => void;
					const ownsLoad = () =>
						this.activeLoadCleanup === cleanup &&
						!signal?.aborted &&
						this.worker === worker &&
						worker.onmessage === handler;
					const failLoad = (error: unknown) => {
						if (!ownsLoad()) return;
						rejectLoad(error);
					};
					handler = (event: MessageEvent<any>) => {
						if (!ownsLoad()) return;
						try {
							reportWorkerProgress(progress, event.data?.progress);
							if (!ownsLoad()) return;
							if (event.data?.load) {
								progress?.set?.(1);
								if (!ownsLoad()) return;
								resolveLoad();
								return;
							}
							if (event.data?.error) rejectLoad(event.data.error);
						} catch (error) {
							failLoad(error);
						}
					};
					worker.onmessage = handler;
					worker.postMessage({
						load: true,
						compilerUrl: this.compilerUrl,
						stdlibUrl: this.stdlibUrl,
						log: _log
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
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (this.activeLoadCleanup || !this.exit) {
			return Promise.reject(
				new BusyError('Zig runtime already has an active operation', {
					runtimeId: 'ZIG',
					phase: this.activeLoadCleanup ? 'startup' : 'execute'
				})
			);
		}
		const worker = this.worker;
		if (!worker) return Promise.reject('Worker not loaded');
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException('Zig execution aborted', 'AbortError')
			);
		}
		let compileArgs: string[];
		let programArgs: string[];
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		try {
			({ compileArgs, programArgs } = resolveSandboxExecutionArgs('ZIG', args, options));
			const limits = resolveExecutionLimits(options.limits);
			workspace = validateExecutionWorkspace(
				code,
				options.workspaceFiles ?? [],
				options.activePath ?? 'main.zig',
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
		const targetTriple: ZigTargetTriple = options.zigTargetTriple || 'wasm64-wasi';
		const hasExplicitStdin = options.stdin !== undefined;
		if (hasExplicitStdin) {
			this.pendingInput = [];
			this.pendingEof = false;
			this.waitingForInput = false;
			resetBufferedStdin(this.buffer);
		}
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			const operation = this.workerSession.beginRun(worker, reject);
			let onAbort: (() => void) | undefined;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				const ownsInput = this.activeRunCleanup === cleanup;
				if (hasExplicitStdin && ownsInput) {
					this.pendingInput = [];
					this.pendingEof = false;
					this.waitingForInput = false;
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
				if (this.activeRunCleanup === cleanup) this.activeRunCleanup = null;
			};
			let handler: (event: Event & { data: any }) => void;
			const ownsRun = () =>
				this.activeRunCleanup === cleanup &&
				this.worker === worker &&
				worker.onmessage === handler &&
				_uid === this.uid;
			const failRun = (error: unknown) => {
				if (!ownsRun()) return;
				this.workerSession.terminate(error);
			};
			handler = (event: Event & { data: any }) => {
				if (!ownsRun()) return;
				try {
					const { output, results, error, buffer, diagnostic, progress } = event.data;
					if (buffer && !hasExplicitStdin) {
						this.waitingForInput = true;
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					reportWorkerProgress(_prog, progress);
					if (!ownsRun()) return;
					if (output) this.output?.(output);
					if (!ownsRun()) return;
					if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
					if (!ownsRun()) return;
					if (results) {
						if (!this.workerSession.complete(operation)) return;
						if (worker.onmessage === handler) worker.onmessage = null;
						cleanup();
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.waitingForInput = false;
						this.pendingEof = false;
						resolve(results as string);
						return;
					}
					if (error) {
						if (!this.workerSession.complete(operation)) return;
						if (worker.onmessage === handler) worker.onmessage = null;
						cleanup();
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.waitingForInput = false;
						this.pendingEof = false;
						reject(error);
					}
				} catch (error) {
					failRun(error);
				}
			};
			onAbort = signal
				? () => {
						if (
							this.worker !== worker ||
							worker.onmessage !== handler ||
							_uid !== this.uid
						) {
							cleanup();
							return;
						}
						this.terminate(
							signal.reason ?? new DOMException('Zig execution aborted', 'AbortError')
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
					args: programArgs,
					compileArgs,
					stdin: options.stdin,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					targetTriple,
					log: _log
				});
			} catch (error) {
				failRun(error);
			}
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const loadCleanup = this.activeLoadCleanup;
		loadCleanup?.();
		const cleanup = this.activeRunCleanup;
		cleanup?.();
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

export default Zig;
