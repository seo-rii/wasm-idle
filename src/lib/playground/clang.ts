import type {
	DebugCommand,
	DebugSessionEvent,
	SandboxExecutionOptions
} from '$lib/playground/options';
import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import {
	resolveDebugRuntimeUrls,
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { LldbSandboxSession, type LldbArtifactPayload } from '$lib/playground/lldbSession';
import { normalizeDwarfWorkspacePath } from '@wasm-idle/llvm-core/clang';
import { resolveSandboxExecutionArgs } from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';
import {
	bufferedSequence,
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin,
	waitForBufferedSequenceChange
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer, requireSharedArrayBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress, type ProgressSink } from '$lib/playground/workerProgress';

const debugBreakpointBufferInts = 1028;

function normalizeLldbSourcePath(
	sourcePath: string | undefined,
	fallback: string
): `/workspace/${string}` {
	const normalized =
		normalizeDwarfWorkspacePath(sourcePath?.replace(/^\/workspace\//u, '') || fallback) ||
		fallback;
	return `/workspace/${normalized}`;
}

class Clang implements Sandbox {
	language: 'C' | 'CPP';
	ts = Date.now();
	output: any = null;
	ondebug?: (event: DebugSessionEvent) => void;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
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
	debugRuntimeBaseUrl = '';
	debugManifestUrl = '';
	private lldbSession?: LldbSandboxSession;
	private debugMode: 'none' | 'trace' | 'lldb' = 'none';
	private readonly lldbBreakpoints = new Map<`/workspace/${string}`, number[]>();
	private debugEvaluationQueue: Promise<void> = Promise.resolve();
	private readonly workerSession = new WorkerSession({
		label: 'Clang',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.assetBridge = null;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
			this.ondebug?.({ type: 'stop' });
			void this.lldbSession?.disconnect();
			this.lldbSession = undefined;
		}
	});

	constructor(language: 'C' | 'CPP') {
		this.language = language;
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		code = '',
		log = true,
		args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: ProgressSink
	) {
		return this.workerSession.load(async (resolve, reject) => {
			this.log = log;
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const assetConfig = resolveRuntimeAssetConfig(
				'clang',
				runtimeAssets,
				typeof window !== 'undefined' ? window.location.href : ''
			);
			const debugRuntime = resolveDebugRuntimeUrls(
				runtimeAssets,
				typeof window !== 'undefined' ? window.location.href : ''
			);
			this.debugRuntimeBaseUrl = debugRuntime.baseUrl;
			this.debugManifestUrl = debugRuntime.manifestUrl;
			const needsWorkerReset =
				!this.worker || !this.assetBridge || !this.assetBridge.matches(assetConfig);
			if (needsWorkerReset && this.worker) {
				this.workerSession.reset();
			}
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/clang?worker')).default();
				this.workerSession.attach(this.worker);
				this.assetBridge = new WorkerAssetBridge(
					this.worker,
					'clang',
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
					args,
					assets: {
						baseUrl: assetConfig.baseUrl,
						useAssetBridge: assetConfig.useAssetBridge
					}
				});
			} else {
				this.assetBridge?.rebind(this.worker, assetConfig, progress);
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
		prog?: ProgressSink,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const debugMode = options.debugMode || (options.debug ? 'trace' : 'none');
		this.debugMode = debugMode;
		if (debugMode !== 'none') requireSharedArrayBuffer(`${this.language} debugging`);
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const operation = this.workerSession.beginRun(this.worker, reject);
			const { compileArgs, programArgs } = resolveSandboxExecutionArgs(
				this.language,
				args,
				options
			);
			const sourcePath = normalizeLldbSourcePath(
				options.debugPath || options.activePath,
				this.language === 'C' ? 'main.c' : 'main.cc'
			);
			this.lldbBreakpoints.clear();
			if (debugMode === 'lldb') {
				for (const sourceBreakpoints of options.sourceBreakpoints || []) {
					this.setBreakpoints(sourceBreakpoints.lines, sourceBreakpoints.sourcePath);
				}
				this.setBreakpoints([...(options.breakpoints || [])], sourcePath);
			} else {
				this.setBreakpoints([...(options.breakpoints || [])], sourcePath);
			}
			const interrupt = new Uint8Array(this.interruptBuffer),
				_uid = ++this.uid;
			const handler = (event: Event & { data: any }) => {
				if (this.assetBridge?.handleMessage(event as MessageEvent<any>)) return;
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const {
					id,
					output,
					results,
					log,
					error,
					buffer,
					progress,
					debugEvent,
					lldbArtifact
				} = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				if (output) this.output(output);
				if (debugEvent) this.ondebug?.(debugEvent);
				if (lldbArtifact) {
					const compilerWorker = this.worker;
					const lldbSession = new LldbSandboxSession({
						manifestUrl: this.debugManifestUrl,
						runtimeBaseUrl: this.debugRuntimeBaseUrl,
						artifact: lldbArtifact as LldbArtifactPayload,
						sourcePath,
						breakpoints: [...(options.breakpoints || [])],
						sourceBreakpoints: Array.from(
							this.lldbBreakpoints,
							([sourcePath, lines]) => ({
								sourcePath,
								lines: [...lines]
							})
						),
						pauseOnEntry: !!options.pauseOnEntry,
						programArgs,
						stdin: options.stdin,
						onDebugEvent: (debugEvent) => this.ondebug?.(debugEvent),
						onOutput: (debugOutput) => this.output(debugOutput)
					});
					this.lldbSession = lldbSession;
					for (const input of this.pendingInput.splice(0)) void lldbSession.write(input);
					if (this.pendingEof) {
						this.pendingEof = false;
						void lldbSession.eof();
					}
					if (compilerWorker && this.workerSession.release(compilerWorker)) {
						if (this.worker === compilerWorker) delete this.worker;
						this.assetBridge = null;
					}
					void lldbSession.start().then(
						(result) => {
							if (this.lldbSession === lldbSession) this.lldbSession = undefined;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.workerSession.complete(operation);
							resolve(result);
						},
						(sessionError) => {
							if (this.lldbSession === lldbSession) this.lldbSession = undefined;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.workerSession.complete(operation);
							reject(sessionError);
						}
					);
					return;
				}
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
				reportWorkerProgress(prog, progress);
			};
			interrupt[0] = 0;
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker?.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				debugBuffer: this.debugBuffer,
				watchBuffer: this.watchBuffer,
				watchResultBuffer: this.watchResultBuffer,
				interrupt: this.interruptBuffer,
				context: {},
				stdin: options.stdin,
				log,
				language: this.language,
				compileArgs,
				programArgs,
				activePath: options.activePath,
				workspaceFiles: options.workspaceFiles,
				cppVersion: options.cppVersion,
				cVersion: options.cVersion,
				debugMode,
				debug: debugMode === 'trace',
				breakpoints: [...(options.breakpoints || [])],
				pauseOnEntry: !!options.pauseOnEntry
			});
		});
	}

	debugCommand(command: DebugCommand) {
		if (this.lldbSession) return this.lldbSession.debugCommand(command);
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

	debugPause() {
		return this.lldbSession?.pause();
	}

	setBreakpoints(lines: number[], sourcePath?: string) {
		const resolvedSourcePath = normalizeLldbSourcePath(
			sourcePath,
			this.language === 'C' ? 'main.c' : 'main.cc'
		);
		if (this.lldbSession) {
			return this.lldbSession.setBreakpoints(lines, resolvedSourcePath);
		}
		if (this.debugMode === 'lldb') {
			this.lldbBreakpoints.set(resolvedSourcePath, [...lines]);
			return;
		}
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

	debugEvaluate(expression: string) {
		if (this.lldbSession) return this.lldbSession.evaluate(expression);
		const evaluation = this.debugEvaluationQueue.then(async () => {
			if (!this.worker) throw new Error('Worker not loaded');
			resetBufferedStdin(this.watchResultBuffer);
			const previousSequence = bufferedSequence(this.watchResultBuffer);
			flushQueuedStdin([expression], this.watchBuffer);
			const control = new Int32Array(this.debugBuffer);
			Atomics.store(control, 1, 5);
			Atomics.add(control, 0, 1);
			Atomics.notify(control, 0);
			return (
				(await waitForBufferedSequenceChange(
					this.watchResultBuffer,
					previousSequence,
					5000
				)) ?? '?'
			);
		});
		this.debugEvaluationQueue = evaluation.then(
			() => undefined,
			() => undefined
		);
		return evaluation;
	}

	debugVariables(variablesReference: number, start?: number, count?: number) {
		return this.lldbSession?.variables(variablesReference, start, count) ?? Promise.resolve([]);
	}

	debugScopes(frameId: number) {
		return this.lldbSession?.scopes(frameId) ?? Promise.resolve([]);
	}

	debugReadMemory(memoryReference: string, offset: number, count: number) {
		return (
			this.lldbSession?.readMemory(memoryReference, offset, count) ?? Promise.resolve(null)
		);
	}

	kill() {
		return this.terminate();
	}

	async terminate() {
		const lldbSession = this.lldbSession;
		this.lldbSession = undefined;
		const disconnecting = lldbSession?.disconnect();
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		new Uint8Array(this.interruptBuffer)[0] = 2;
		const control = new Int32Array(this.debugBuffer);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
		this.workerSession.terminate();
		this.exit = true;
		await disconnecting;
	}

	async clear() {
		await this.terminate();
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

export default Clang;
