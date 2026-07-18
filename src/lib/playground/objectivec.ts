import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import type { DebugCommand, DebugSessionEvent } from '$lib/playground/options';
import {
	resolveObjectiveCRuntimeAssetConfig,
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets,
	type ResolvedObjectiveCRuntimeAssetConfig
} from '$lib/playground/assets';
import type { SandboxExecutionOptions } from '$lib/playground/options';
import { resolveSandboxExecutionArgs } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { createWasmIdleSharedBuffer, requireSharedArrayBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import {
	bufferedSequence,
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin,
	waitForBufferedSequenceChange
} from '$lib/playground/stdinBuffer';

const debugBreakpointBufferInts = 1028;

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
	ondebug?: (event: DebugSessionEvent) => void;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(4096);
	debugBuffer = createWasmIdleSharedBuffer(
		Int32Array.BYTES_PER_ELEMENT * debugBreakpointBufferInts
	);
	watchBuffer = createWasmIdleSharedBuffer(1024);
	watchResultBuffer = createWasmIdleSharedBuffer(1024);
	interruptBuffer = createWasmIdleSharedBuffer(1);
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
			this.ondebug?.({ type: 'stop' });
		}
	});

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		code = '',
		log = true,
		args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
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
		prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (options.debug) requireSharedArrayBuffer('Objective-C debugging');
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const operation = this.workerSession.beginRun(this.worker, reject);
			const { compileArgs, programArgs } = resolveSandboxExecutionArgs(
				this.language,
				args,
				options
			);
			this.setBreakpoints(options.debug ? [...(options.breakpoints || [])] : []);
			const interrupt = new Uint8Array(this.interruptBuffer);
			const _uid = ++this.uid;
			const handler = (event: Event & { data: any }) => {
				if (this.assetBridge?.handleMessage(event as MessageEvent<any>)) return;
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { output, results, log, error, buffer, progress, debugEvent } = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				if (output) this.output?.(output);
				if (debugEvent) this.ondebug?.(debugEvent);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					this.ondebug?.({ type: 'stop' });
					resolve(results as string);
				}
				if (log) console.log(log);
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					this.exit = true;
					this.ondebug?.({ type: 'stop' });
					reject(error);
				}
				if (progress) prog?.set?.(progress);
			};
			this.worker.onmessage = handler;
			interrupt[0] = 0;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				debugBuffer: this.debugBuffer,
				watchBuffer: this.watchBuffer,
				watchResultBuffer: this.watchResultBuffer,
				interrupt: this.interruptBuffer,
				stdin: options.stdin,
				log,
				compileArgs,
				programArgs,
				activePath: options.activePath,
				workspaceFiles: options.workspaceFiles,
				debug: !!options.debug,
				breakpoints: [...(options.breakpoints || [])],
				pauseOnEntry: !!options.pauseOnEntry
			});
		});
	}

	debugCommand(command: DebugCommand) {
		const control = new Int32Array(this.debugBuffer);
		Atomics.store(
			control,
			1,
			command === 'stepInto' ? 2 : command === 'nextLine' ? 3 : command === 'stepOut' ? 4 : 1
		);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
		this.ondebug?.({ type: 'resume', command });
	}

	setBreakpoints(lines: number[]) {
		const control = new Int32Array(this.debugBuffer);
		const next = [...new Set(lines.filter((line) => Number.isInteger(line) && line > 0))]
			.sort((left, right) => left - right)
			.slice(0, Math.max(0, control.length - 4));
		for (let index = 4; index < control.length; index += 1) {
			Atomics.store(control, index, next[index - 4] || 0);
		}
		Atomics.store(control, 3, next.length);
		Atomics.add(control, 2, 1);
	}

	async debugEvaluate(expression: string) {
		if (!this.worker) throw new Error('Worker not loaded');
		resetBufferedStdin(this.watchResultBuffer);
		const previousSequence = bufferedSequence(this.watchResultBuffer);
		flushQueuedStdin([expression], this.watchBuffer);
		const control = new Int32Array(this.debugBuffer);
		Atomics.store(control, 1, 5);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
		return (
			(await waitForBufferedSequenceChange(this.watchResultBuffer, previousSequence, 5000)) ??
			'?'
		);
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		new Uint8Array(this.interruptBuffer)[0] = 2;
		const control = new Int32Array(this.debugBuffer);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
		this.workerSession.terminate();
		this.exit = true;
	}

	async clear() {
		this.terminate();
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		resetBufferedStdin(this.buffer);
		resetBufferedStdin(this.watchBuffer);
		resetBufferedStdin(this.watchResultBuffer);
		new Int32Array(this.debugBuffer).fill(0);
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

export default ObjectiveC;
