import type {
	DebugCommand,
	DebugSessionEvent,
	SandboxExecutionOptions
} from '$lib/playground/options';
import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import { resolveRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	bufferedSequence,
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin,
	waitForBufferedSequenceChange
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer, requireSharedArrayBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

class Python implements Sandbox {
	ts = Date.now();
	output: any = null;
	ondebug?: (event: DebugSessionEvent) => void;
	image?: (data: { mime: string; b64: string; ts?: number }) => void;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	debugBuffer = createWasmIdleSharedBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
	watchBuffer = createWasmIdleSharedBuffer(1024);
	watchResultBuffer = createWasmIdleSharedBuffer(1024);
	interruptBuffer = createWasmIdleSharedBuffer(1);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	waitingForInput = false;
	pendingEof = false;
	exit = true;
	assetBridge: WorkerAssetBridge | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'Python',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.assetBridge = null;
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
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		return this.workerSession.load(async (resolve, reject) => {
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const assetConfig = resolveRuntimeAssetConfig(
				'python',
				runtimeAssets,
				typeof window !== 'undefined' ? window.location.href : ''
			);
			const needsWorkerReset =
				!this.worker || !this.assetBridge || !this.assetBridge.matches(assetConfig);
			if (needsWorkerReset && this.worker) {
				this.workerSession.reset();
			}
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/python?worker')).default();
				this.workerSession.attach(this.worker);
				this.assetBridge = new WorkerAssetBridge(
					this.worker,
					'python',
					assetConfig,
					progress
				);
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (this.assetBridge?.handleMessage(event)) return;
					reportWorkerProgress(progress, event.data?.progress);
					if (event.data?.load) resolve();
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({
					load: true,
					log,
					code,
					assets: {
						baseUrl: assetConfig.baseUrl,
						useAssetBridge: assetConfig.useAssetBridge
					}
				});
			} else {
				if (!this.assetBridge) return reject('Worker asset bridge unavailable');
				this.assetBridge.rebind(this.worker, assetConfig, progress);
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
		_log = true,
		_prog?: SandboxProgress,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (options.debug) requireSharedArrayBuffer('Python debugging');
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const operation = this.workerSession.beginRun(this.worker, reject);
			const interrupt = new Uint8Array(this.interruptBuffer),
				_uid = ++this.uid;
			const handler = (event: Event & { data: any }) => {
				if (this.assetBridge?.handleMessage(event as MessageEvent<any>)) return;
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const {
					output,
					results,
					log,
					error,
					buffer,
					type,
					data: payload,
					debugEvent
				} = event.data;
				reportWorkerProgress(_prog, event.data?.progress);
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				if (type === 'img' && payload) this.image?.(payload);
				if (output) this.output(output);
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
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					this.ondebug?.({ type: 'stop' });
					reject(error);
				}
			};
			interrupt[0] = 0;
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				debugBuffer: this.debugBuffer,
				watchBuffer: this.watchBuffer,
				watchResultBuffer: this.watchResultBuffer,
				interrupt: this.interruptBuffer,
				context: {},
				stdin: options.stdin,
				debug: !!options.debug,
				breakpoints: [...(options.breakpoints || [])],
				pauseOnEntry: !!options.pauseOnEntry,
				activePath: options.activePath,
				debugPath: options.debugPath,
				workspaceFiles: options.workspaceFiles
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
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		resetBufferedStdin(this.watchBuffer);
		resetBufferedStdin(this.watchResultBuffer);
		const debugBuffer = new Int32Array(this.debugBuffer);
		debugBuffer.fill(0);
		await new Promise((resolve) => setTimeout(resolve, 200));
		if (!this.exit) {
			this.workerSession.terminate();
			this.exit = true;
		}
	}
}

export default Python;
