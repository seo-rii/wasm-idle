import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import { resolveRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
import { resolveJavaSourceIdentity } from '$lib/playground/javaSource';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';

class Java implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	baseUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	assetBridge: WorkerAssetBridge | null = null;
	private activeLoadCleanup: (() => void) | null = null;
	private activeRunCleanup: (() => void) | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'Java',
		onDispose: (worker) => {
			this.activeRunCleanup?.();
			this.activeRunCleanup = null;
			if (this.worker === worker) {
				this.assetBridge?.dispose();
				delete this.worker;
				this.assetBridge = null;
			}
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
				signal.reason ?? new DOMException('Java runtime startup aborted', 'AbortError')
			);
		}
		if (this.activeLoadCleanup || this.activeRunCleanup) {
			return Promise.reject(
				new BusyError('Java runtime already has an active operation', {
					runtimeId: 'JAVA',
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
						new DOMException('Java runtime startup aborted', 'AbortError');
					cleanup();
					this.workerSession.terminate(reason);
				}
			: undefined;
		this.activeLoadCleanup = cleanup;
		const loadPromise = this.workerSession.load(async (resolve, reject) => {
			const resolveLoad = () => {
				if (this.activeLoadCleanup !== cleanup || signal?.aborted) return;
				cleanup();
				resolve();
			};
			const rejectLoad = (reason?: unknown) => {
				if (this.activeLoadCleanup !== cleanup) return;
				cleanup();
				reject(reason);
			};
			try {
				if (this.activeLoadCleanup !== cleanup) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				const assetConfig = resolveRuntimeAssetConfig(
					'java',
					runtimeAssets,
					typeof window !== 'undefined' ? window.location.href : ''
				);
				this.baseUrl = assetConfig.baseUrl;
				const needsWorkerReset =
					!this.worker || !this.assetBridge || !this.assetBridge.matches(assetConfig);
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/java?worker'))
						.default;
					if (this.activeLoadCleanup !== cleanup || signal?.aborted) return;
					const worker = new WorkerConstructor();
					if (this.activeLoadCleanup !== cleanup || signal?.aborted) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					const assetBridge = new WorkerAssetBridge(
						worker,
						'java',
						assetConfig,
						progress
					);
					if (
						this.activeLoadCleanup !== cleanup ||
						signal?.aborted ||
						this.worker !== worker
					) {
						assetBridge.dispose();
						return;
					}
					this.assetBridge = assetBridge;
					let handler: (event: MessageEvent<any>) => void;
					const ownsWorker = () =>
						this.worker === worker &&
						worker.onmessage === handler &&
						this.assetBridge === assetBridge;
					const ownsLoad = () =>
						ownsWorker() && this.activeLoadCleanup === cleanup && !signal?.aborted;
					const failLoad = (error: unknown) => {
						if (!ownsLoad()) return;
						rejectLoad(error);
					};
					handler = (event: MessageEvent<any>) => {
						if (!ownsWorker()) return;
						try {
							if (assetBridge.handleMessage(event)) return;
							if (!ownsLoad()) return;
							if (event.data?.load) {
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
						assets: {
							baseUrl: assetConfig.baseUrl,
							useAssetBridge: assetConfig.useAssetBridge
						}
					});
				} else {
					const worker = this.worker;
					const assetBridge = this.assetBridge;
					if (!assetBridge) return rejectLoad('Worker asset bridge unavailable');
					assetBridge.rebind(worker, assetConfig, progress);
					if (
						this.activeLoadCleanup !== cleanup ||
						signal?.aborted ||
						this.worker !== worker ||
						this.assetBridge !== assetBridge
					) {
						return;
					}
					resolveLoad();
				}
			} catch (error) {
				rejectLoad(error);
			}
		});
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
		if (this.activeLoadCleanup || this.activeRunCleanup) {
			return Promise.reject(
				new BusyError('Java runtime already has an active operation', {
					runtimeId: 'JAVA',
					phase: this.activeLoadCleanup ? 'startup' : 'execute'
				})
			);
		}
		const worker = this.worker;
		if (!worker) return Promise.reject('Worker not loaded');
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException('Java execution aborted', 'AbortError')
			);
		}
		let programArgs: string[];
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		try {
			programArgs = resolveSandboxExecutionArgs('JAVA', args, options).programArgs;
			const { sourcePath } = resolveJavaSourceIdentity(code);
			const limits = resolveExecutionLimits(options.limits);
			workspace = validateExecutionWorkspace(
				code,
				options.workspaceFiles ?? [],
				options.activePath ?? sourcePath,
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
			this.pendingEof = false;
			this.waitingForInput = false;
			resetBufferedStdin(this.buffer);
		}
		const assetBridge = this.assetBridge;
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
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
			const rejectRun = (reason?: unknown) => {
				cleanup();
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				reject(reason);
			};
			this.activeRunCleanup = cleanup;
			const operation = this.workerSession.beginRun(worker, rejectRun);
			let handler: (event: Event & { data: any }) => void;
			const ownsWorker = () =>
				this.worker === worker &&
				worker.onmessage === handler &&
				this.assetBridge === assetBridge;
			const ownsRun = () =>
				ownsWorker() && this.activeRunCleanup === cleanup && _uid === this.uid;
			const failRun = (error: unknown) => {
				if (!ownsRun()) return;
				this.workerSession.terminate(error);
			};
			handler = (event: Event & { data: any }) => {
				if (!ownsWorker()) return;
				try {
					if (assetBridge?.handleMessage(event as MessageEvent<any>)) return;
					if (!ownsRun()) return;
					const { output, results, error, buffer, diagnostic } = event.data;
					if (buffer) {
						this.waitingForInput = true;
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					if (output) this.output?.(output);
					if (!ownsRun()) return;
					if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
					if (!ownsRun()) return;
					if (results) {
						if (!this.workerSession.complete(operation)) return;
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
							this.activeRunCleanup !== cleanup ||
							this.worker !== worker ||
							worker.onmessage !== handler ||
							_uid !== this.uid
						) {
							cleanup();
							return;
						}
						this.terminate(
							signal.reason ??
								new DOMException('Java execution aborted', 'AbortError')
						);
					}
				: undefined;
			worker.onmessage = handler;
			if (signal && onAbort) {
				signal.addEventListener('abort', onAbort, { once: true });
				if (signal.aborted) onAbort();
			}
			if (
				this.activeRunCleanup !== cleanup ||
				this.worker !== worker ||
				worker.onmessage !== handler ||
				_uid !== this.uid
			) {
				return;
			}
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					args: programArgs,
					stdin: options.stdin || '',
					baseUrl: this.baseUrl,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles
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
		const runCleanup = this.activeRunCleanup;
		runCleanup?.();
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
		if (!this.exit || this.activeLoadCleanup || this.activeRunCleanup) {
			this.terminate();
		}
	}
}

export default Java;
