import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import { resolveRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { BusyError } from '@wasm-idle/core';
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
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		if (this.activeLoadCleanup || this.activeRunCleanup) {
			return Promise.reject(
				new BusyError('Java runtime already has an active operation', {
					runtimeId: 'JAVA',
					phase: this.activeLoadCleanup ? 'startup' : 'execute'
				})
			);
		}
		let cleanedUp = false;
		const cleanup = () => {
			if (cleanedUp) return;
			cleanedUp = true;
			if (this.activeLoadCleanup === cleanup) this.activeLoadCleanup = null;
		};
		this.activeLoadCleanup = cleanup;
		const loadPromise = this.workerSession.load(async (resolve, reject) => {
			const resolveLoad = () => {
				if (this.activeLoadCleanup !== cleanup) return;
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
					if (this.activeLoadCleanup !== cleanup) return;
					const worker = new WorkerConstructor();
					if (this.activeLoadCleanup !== cleanup) {
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
					if (this.activeLoadCleanup !== cleanup || this.worker !== worker) {
						assetBridge.dispose();
						return;
					}
					this.assetBridge = assetBridge;
					const handler = (event: MessageEvent<any>) => {
						if (
							this.worker !== worker ||
							worker.onmessage !== handler ||
							this.assetBridge !== assetBridge
						) {
							return;
						}
						if (assetBridge.handleMessage(event)) return;
						if (this.activeLoadCleanup !== cleanup) return;
						if (event.data?.load) resolveLoad();
						if (event.data?.error) rejectLoad(event.data.error);
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
		let programArgs: string[];
		try {
			programArgs = resolveSandboxExecutionArgs('JAVA', args, options).programArgs;
		} catch (error) {
			return Promise.reject(error);
		}
		const assetBridge = this.assetBridge;
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
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
			const handler = (event: Event & { data: any }) => {
				if (
					this.worker !== worker ||
					worker.onmessage !== handler ||
					this.assetBridge !== assetBridge
				) {
					return;
				}
				if (assetBridge?.handleMessage(event as MessageEvent<any>)) return;
				if (this.activeRunCleanup !== cleanup || _uid !== this.uid) return;
				const { output, results, error, buffer, diagnostic } = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				if (output) this.output?.(output);
				if (this.activeRunCleanup !== cleanup || _uid !== this.uid) return;
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (this.activeRunCleanup !== cleanup || _uid !== this.uid) return;
				if (results) {
					this.workerSession.complete(operation);
					cleanup();
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					resolve(results as string);
					return;
				}
				if (error) {
					this.workerSession.complete(operation);
					cleanup();
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					reject(error);
					return;
				}
			};
			worker.onmessage = handler;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					args: programArgs,
					stdin: options.stdin || '',
					baseUrl: this.baseUrl
				});
			} catch (error) {
				if (worker.onmessage === handler) worker.onmessage = null;
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
		const runCleanup = this.activeRunCleanup;
		this.activeRunCleanup = null;
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
