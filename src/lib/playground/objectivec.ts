import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import {
	resolveObjectiveCRuntimeAssetConfig,
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets,
	type ResolvedObjectiveCRuntimeAssetConfig
} from '$lib/playground/assets';
import type { SandboxExecutionOptions } from '$lib/playground/options';
import { resolveSandboxExecutionArgs } from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import type { Writable } from 'svelte/store';

const objectiveCAssetsKey = (assets: ResolvedObjectiveCRuntimeAssetConfig) =>
	JSON.stringify({
		baseUrl: assets.baseUrl,
		libobjcUrl: assets.libobjcUrl,
		headersUrl: assets.headersUrl,
		libgnustepBaseUrl: assets.libgnustepBaseUrl,
		libgnustepBaseObjectUrl: assets.libgnustepBaseObjectUrl,
		foundationHeadersUrl: assets.foundationHeadersUrl,
		libffiUrl: assets.libffiUrl
	});

class ObjectiveC implements Sandbox {
	language = 'OBJC';
	output?: (data: string) => void;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(4096);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	log = true;
	waitingForInput = false;
	pendingEof = false;
	exit = true;
	assetBridge: WorkerAssetBridge | null = null;
	activeObjectiveCAssetsKey = '';
	private readonly workerSession = new WorkerSession({
		label: 'Objective-C',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.assetBridge = null;
			this.activeObjectiveCAssetsKey = '';
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		code = '',
		log = true,
		args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | Writable<number>
	) {
		void options;
		return this.workerSession.load(async (resolve, reject) => {
			this.log = log;
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const clangAssets = resolveRuntimeAssetConfig('clang', runtimeAssets, currentUrl);
			const objectivecAssets = resolveObjectiveCRuntimeAssetConfig(runtimeAssets, currentUrl);
			const nextObjectiveCAssetsKey = objectiveCAssetsKey(objectivecAssets);
			const needsWorkerReset =
				!this.worker ||
				!this.assetBridge ||
				!this.assetBridge.matches(clangAssets) ||
				this.activeObjectiveCAssetsKey !== nextObjectiveCAssetsKey;
			if (needsWorkerReset && this.worker) {
				this.workerSession.reset();
			}
			if (!this.worker) {
				this.worker = new (
					await import('$lib/playground/worker/objectivec?worker')
				).default();
				this.workerSession.attach(this.worker);
				this.assetBridge = new WorkerAssetBridge(
					this.worker,
					'clang',
					clangAssets,
					progress
				);
				this.activeObjectiveCAssetsKey = nextObjectiveCAssetsKey;
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (this.assetBridge?.handleMessage(event)) return;
					if (event.data?.progress != null) progress?.set?.(event.data.progress);
					if (event.data?.load) resolve();
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({
					load: true,
					log,
					code,
					args,
					clangAssets: {
						baseUrl: clangAssets.baseUrl,
						useAssetBridge: clangAssets.useAssetBridge
					},
					objectivecAssets
				});
			} else {
				this.assetBridge?.rebind(this.worker, clangAssets, progress);
				this.worker.postMessage({ log });
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
		log = this.log,
		prog?: Writable<number> | { set?: (value: number) => void },
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (options.debug) return Promise.reject('Objective-C debugging is not supported yet.');
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const operation = this.workerSession.beginRun(this.worker, reject);
			const { compileArgs, programArgs } = resolveSandboxExecutionArgs(
				this.language,
				args,
				options
			);
			const _uid = ++this.uid;
			const handler = (event: Event & { data: any }) => {
				if (this.assetBridge?.handleMessage(event as MessageEvent<any>)) return;
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { output, results, log, error, buffer, progress } = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				if (output) this.output?.(output);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					resolve(results as string);
				}
				if (log) console.log(log);
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					this.exit = true;
					reject(error);
				}
				if (progress) prog?.set?.(progress);
			};
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				stdin: options.stdin,
				log,
				compileArgs,
				programArgs,
				activePath: options.activePath,
				workspaceFiles: options.workspaceFiles
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
		this.workerSession.terminate();
		this.exit = true;
	}

	async clear() {
		this.terminate();
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		resetBufferedStdin(this.buffer);
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

export default ObjectiveC;
