import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import { CompiledLldbSandbox } from '$lib/playground/compiledLldb';
import type { RuntimeAssetCache } from '$lib/playground/runtimeAssetCache';
import type { DebugCommand } from '$lib/playground/options';
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
import { reportWorkerInputReady } from '$lib/playground/workerProgress';
import {
	bufferedSequence,
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin,
	waitForBufferedSequenceChange
} from '$lib/playground/stdinBuffer';
import {
	AssetTooLargeError,
	RuntimeConfigurationError,
	createRuntimeAssetsKey,
	resolveExecutionLimits
} from '@wasm-idle/core';

const debugBreakpointBufferInts = 1028;

const objectiveCAssetsKey = (assets: ResolvedObjectiveCRuntimeAssetConfig) =>
	createRuntimeAssetsKey({ objectivec: assets }) || '';

export type ObjectiveCSandboxLanguage = 'OBJC' | 'OBJECTIVECXX';

class ObjectiveC extends CompiledLldbSandbox implements Sandbox {
	language: ObjectiveCSandboxLanguage;
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
	private runtimeAssetCache?: RuntimeAssetCache;
	private readonly workerSession = new WorkerSession({
		label: 'Objective-C',
		onDispose: (worker) => {
			if (this.worker === worker) {
				const assetBridge = this.assetBridge;
				delete this.worker;
				this.assetBridge = null;
				try {
					assetBridge?.dispose();
				} catch {
					// Asset cleanup must not replace the worker operation result.
				}
			}
			this.activeObjectiveCAssetsKey = '';
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
			this.ondebug?.({ type: 'stop' });
		}
	});

	constructor(language: ObjectiveCSandboxLanguage = 'OBJC') {
		super();
		this.language = language;
	}

	setRuntimeAssetCache(cache: RuntimeAssetCache) {
		if (this.runtimeAssetCache === cache) return;
		if (this.worker) {
			throw new RuntimeConfigurationError(
				'Cannot replace an active Objective-C compiler cache'
			);
		}
		this.runtimeAssetCache = cache;
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		code = '',
		log = true,
		args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let limits: ReturnType<typeof resolveExecutionLimits>;
		try {
			limits = resolveExecutionLimits(options.limits);
		} catch (error) {
			return Promise.reject(error);
		}
		return this.workerSession.load(async (resolve, reject, operation) => {
			this.configureLldb(runtimeAssets, options);
			this.log = log;
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const clangAssets = resolveRuntimeAssetConfig('clang', runtimeAssets, currentUrl);
			const objectivecAssets = resolveObjectiveCRuntimeAssetConfig(runtimeAssets, currentUrl);
			for (const [asset, receipt] of Object.entries(objectivecAssets.integrity)) {
				if (receipt.bytes > limits.maxAssetBytes) {
					throw new AssetTooLargeError(
						`Objective-C execution asset ${asset} exceeds the ${limits.maxAssetBytes} byte limit`,
						{
							actual: receipt.bytes,
							limit: limits.maxAssetBytes,
							runtimeId: this.language
						}
					);
				}
			}
			const nextObjectiveCAssetsKey = objectiveCAssetsKey(objectivecAssets);
			const needsWorkerReset =
				!this.worker ||
				!this.assetBridge ||
				!this.assetBridge.matches(clangAssets, limits.maxAssetBytes) ||
				this.activeObjectiveCAssetsKey !== nextObjectiveCAssetsKey;
			if (needsWorkerReset && this.worker) {
				this.workerSession.reset();
			}
			if (!this.worker) {
				const { default: ObjectiveCWorker } =
					await import('$lib/playground/worker/objectivec?worker');
				if (!this.workerSession.isActive(operation)) return;
				const worker = new ObjectiveCWorker();
				if (!this.workerSession.attach(worker, operation)) return;
				this.worker = worker;
				this.assetBridge = new WorkerAssetBridge(
					this.worker,
					'clang',
					clangAssets,
					progress,
					limits.maxAssetBytes,
					false,
					this.runtimeAssetCache
				);
				this.activeObjectiveCAssetsKey = nextObjectiveCAssetsKey;
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (!this.workerSession.isActive(operation)) return;
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
						maxAssetBytes: limits.maxAssetBytes,
						useAssetBridge: clangAssets.useAssetBridge
					},
					objectivecAssets: {
						...objectivecAssets,
						maxAssetBytes: limits.maxAssetBytes
					}
				});
			} else {
				this.assetBridge?.rebind(this.worker, clangAssets, progress, limits.maxAssetBytes);
				this.worker.postMessage({ log });
				resolve();
			}
		});
	}

	write(input: string) {
		if (this.lldbSession) {
			void this.lldbSession.write(input);
			return;
		}
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.flushPendingInput();
	}

	eof() {
		if (this.lldbSession) {
			void this.lldbSession.eof();
			return;
		}
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
		const debugMode = options.debugMode || (options.debug ? 'trace' : 'none');
		if (debugMode !== 'none' && debugMode !== 'trace' && debugMode !== 'lldb') {
			return Promise.reject(
				new Error(`Objective-C does not support ${debugMode} debugging.`)
			);
		}
		if (debugMode !== 'none') requireSharedArrayBuffer('Objective-C debugging');
		if (debugMode === 'lldb') {
			this.prepareLldb(options, this.language === 'OBJECTIVECXX' ? 'main.mm' : 'main.m');
		} else this.lldbPending = false;
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const operation = this.workerSession.beginRun(this.worker, reject);
			const { compileArgs, programArgs } = resolveSandboxExecutionArgs(
				this.language,
				args,
				options
			);
			if (debugMode !== 'lldb') {
				this.setBreakpoints(debugMode === 'trace' ? [...(options.breakpoints || [])] : []);
			}
			const interrupt = new Uint8Array(this.interruptBuffer);
			const _uid = ++this.uid;
			const handler = (event: Event & { data: any }) => {
				if (!this.workerSession.isActive(operation)) return;
				if (this.assetBridge?.handleMessage(event as MessageEvent<any>)) return;
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { output, results, log, error, buffer, progress, debugEvent, lldbArtifact } =
					event.data;
				if (lldbArtifact) {
					const worker = this.worker;
					const completion = this.startLldb(
						lldbArtifact,
						options,
						programArgs,
						this.pendingInput,
						this.pendingEof
					);
					this.pendingEof = false;
					if (this.workerSession.release(worker)) {
						this.assetBridge?.dispose();
						this.assetBridge = null;
						delete this.worker;
					}
					void completion.then(
						(result) => {
							if (!this.workerSession.isActive(operation)) return;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.workerSession.complete(operation);
							resolve(result);
						},
						(sessionError) => {
							if (!this.workerSession.isActive(operation)) return;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.workerSession.complete(operation);
							reject(sessionError);
						}
					);
					return;
				}
				if (buffer) {
					this.waitingForInput = true;
					if (!prepare) {
						reportWorkerInputReady(prog, 'Objective-C runtime ready for input');
					}
					this.flushPendingInput();
				}
				if (output) this.output?.(output);
				if (debugEvent) this.ondebug?.(debugEvent);
				if (results) {
					this.lldbPending = false;
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
					this.lldbPending = false;
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
				cVersion: options.cVersion,
				cppVersion: options.cppVersion,
				gnuExtensions: options.objectivecGnuExtensions,
				activePath:
					options.activePath ||
					(this.language === 'OBJECTIVECXX' ? 'main.mm' : undefined),
				workspaceFiles: options.workspaceFiles,
				debugMode,
				debug: debugMode === 'trace',
				breakpoints: [...(options.breakpoints || [])],
				pauseOnEntry: !!options.pauseOnEntry
			});
		});
	}

	debugCommand(command: DebugCommand) {
		if (this.lldbPending) return super.debugCommand(command);
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

	setBreakpoints(lines: number[], sourcePath?: string) {
		if (this.lldbPending) return super.setBreakpoints(lines, sourcePath);
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
		if (this.lldbPending) return super.debugEvaluate(expression);
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
		void this.stopLldb();
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
