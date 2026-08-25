import {
	resolveDebugRuntimeUrls,
	resolveRustCompilerUrl,
	resolveRustDebugModuleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { LldbSandboxSession, type LldbArtifactPayload } from '$lib/playground/lldbSession';
import {
	type DebugCommand,
	type DebugDataBreakpoint,
	type DebugDataBreakpointInfoArguments,
	type DebugSessionEvent,
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer, requireSharedArrayBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

const debugBreakpointBufferInts = 1028;
const rustLldbSourcePath = '/workspace/main.rs' as const;

function normalizeRustLldbSourcePath(sourcePath?: string): `/workspace/${string}` {
	let normalized = (sourcePath || 'main.rs').trim().replaceAll('\\', '/');
	if (normalized === '/workspace') {
		normalized = '';
	} else {
		normalized = normalized.replace(/^\/workspace\//u, '');
	}
	normalized = normalized.replace(/^\/+/u, '');
	const segments: string[] = [];
	for (const segment of normalized.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return `/workspace/${segments.join('/') || 'main.rs'}`;
}

function normalizeRustBreakpointLines(lines: number[]) {
	return [...new Set(lines.filter((line) => Number.isInteger(line) && line > 0))].sort(
		(left, right) => left - right
	);
}

class Rust implements Sandbox {
	output: any = null;
	ondebug?: (event: DebugSessionEvent) => void;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	debugBuffer = createWasmIdleSharedBuffer(
		Int32Array.BYTES_PER_ELEMENT * debugBreakpointBufferInts
	);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	compilerUrl = '';
	debugModuleUrl = '';
	assetPath = '';
	debugRuntimeBaseUrl = '';
	debugManifestUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private readonly workerSession = new WorkerSession({
		label: 'Rust',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
			this.ondebug?.({ type: 'stop' });
			void this.lldbSession?.disconnect();
			this.lldbSession = undefined;
			this.lldbEditorSourcePath = rustLldbSourcePath;
		}
	});
	private lldbSession?: LldbSandboxSession;
	private debugMode: 'none' | 'trace' | 'lldb' = 'none';
	private readonly lldbBreakpoints = new Map<`/workspace/${string}`, number[]>();
	private lldbEditorSourcePath: `/workspace/${string}` = rustLldbSourcePath;

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		return this.workerSession.load(async (resolve, reject) => {
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextCompilerUrl = resolveRustCompilerUrl(runtimeAssets, currentUrl);
			const nextDebugModuleUrl = resolveRustDebugModuleUrl(runtimeAssets, currentUrl);
			const debugRuntime = resolveDebugRuntimeUrls(runtimeAssets, currentUrl);
			this.debugRuntimeBaseUrl = debugRuntime.baseUrl;
			this.debugManifestUrl = debugRuntime.manifestUrl;
			const nextAssetPath =
				typeof runtimeAssets === 'string'
					? runtimeAssets
					: runtimeAssets?.rootUrl ||
						(typeof window !== 'undefined'
							? window.location.pathname.replace(/\/$/, '')
							: '');
			if (!nextCompilerUrl) {
				return reject(
					'Rust runtime is not configured. Set PUBLIC_WASM_RUST_COMPILER_URL or runtimeAssets.rust.compilerUrl.'
				);
			}
			const needsWorkerReset =
				!this.worker ||
				this.compilerUrl !== nextCompilerUrl ||
				this.debugModuleUrl !== nextDebugModuleUrl ||
				this.assetPath !== nextAssetPath;
			this.compilerUrl = nextCompilerUrl;
			this.debugModuleUrl = nextDebugModuleUrl;
			this.assetPath = nextAssetPath;
			if (needsWorkerReset && this.worker) {
				this.workerSession.reset();
			}
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/rust?worker')).default();
				this.workerSession.attach(this.worker);
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (event.data?.load) {
						progress?.set?.(1);
						resolve();
					}
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({
					load: true,
					compilerUrl: this.compilerUrl,
					debugModuleUrl: this.debugModuleUrl,
					path: this.assetPath
				});
			} else {
				progress?.set?.(1);
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
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const debugMode = options.debugMode || (options.debug ? 'trace' : 'none');
		this.debugMode = debugMode;
		if (debugMode !== 'none') requireSharedArrayBuffer('Rust debugging');
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const { programArgs } = resolveSandboxExecutionArgs('RUST', args, options);
			const targetTriple = options.rustTargetTriple || 'wasm32-wasip1';
			const _uid = ++this.uid;
			const operation = this.workerSession.beginRun(this.worker, reject);
			const editorSourcePath = normalizeRustLldbSourcePath(
				options.debugPath || options.activePath
			);
			this.lldbEditorSourcePath = editorSourcePath;
			this.lldbBreakpoints.clear();
			let lldbBreakpointLines: number[] = [];
			if (debugMode === 'lldb') {
				const requestedLines = [...(options.breakpoints || [])];
				for (const sourceBreakpoints of options.sourceBreakpoints || []) {
					if (
						normalizeRustLldbSourcePath(sourceBreakpoints.sourcePath) ===
						editorSourcePath
					) {
						requestedLines.push(...sourceBreakpoints.lines);
					}
				}
				lldbBreakpointLines = normalizeRustBreakpointLines(requestedLines);
				this.lldbBreakpoints.set(rustLldbSourcePath, lldbBreakpointLines);
			} else {
				this.setBreakpoints([...(options.breakpoints || [])], editorSourcePath);
			}
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const {
					output,
					results,
					error,
					buffer,
					diagnostic,
					progress,
					debugEvent,
					lldbArtifact
				} = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				reportWorkerProgress(_prog, progress);
				if (output) this.output(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (debugEvent) this.ondebug?.(debugEvent);
				if (lldbArtifact) {
					const compilerWorker = this.worker;
					const lldbSession = new LldbSandboxSession({
						manifestUrl: this.debugManifestUrl,
						runtimeBaseUrl: this.debugRuntimeBaseUrl,
						artifact: lldbArtifact as LldbArtifactPayload,
						sourcePath: rustLldbSourcePath,
						breakpoints: lldbBreakpointLines,
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
						onDebugEvent: (debugEvent) => {
							if (
								editorSourcePath !== rustLldbSourcePath &&
								debugEvent.type === 'breakpoints' &&
								debugEvent.sourcePath === rustLldbSourcePath
							) {
								this.ondebug?.({
									...debugEvent,
									sourcePath: editorSourcePath
								});
								return;
							}
							if (
								editorSourcePath !== rustLldbSourcePath &&
								debugEvent.type === 'pause'
							) {
								this.ondebug?.({
									...debugEvent,
									sourcePath:
										debugEvent.sourcePath === rustLldbSourcePath
											? editorSourcePath
											: debugEvent.sourcePath,
									callStack: debugEvent.callStack.map((frame) =>
										frame.sourcePath === rustLldbSourcePath
											? { ...frame, sourcePath: editorSourcePath }
											: frame
									)
								});
								return;
							}
							this.ondebug?.(debugEvent);
						},
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
					}
					void lldbSession.start().then(
						(result) => {
							if (this.lldbSession === lldbSession) this.lldbSession = undefined;
							this.lldbEditorSourcePath = rustLldbSourcePath;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.workerSession.complete(operation);
							resolve(result);
						},
						(sessionError) => {
							if (this.lldbSession === lldbSession) this.lldbSession = undefined;
							this.lldbEditorSourcePath = rustLldbSourcePath;
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
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				debugBuffer: this.debugBuffer,
				stdin: options.stdin,
				args: programArgs,
				targetTriple,
				log: _log,
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
		const resolvedSourcePath = normalizeRustLldbSourcePath(
			sourcePath || this.lldbEditorSourcePath
		);
		if (this.lldbSession) {
			if (resolvedSourcePath !== this.lldbEditorSourcePath) return;
			return this.lldbSession.setBreakpoints(
				normalizeRustBreakpointLines(lines),
				rustLldbSourcePath
			);
		}
		if (this.debugMode === 'lldb') {
			if (resolvedSourcePath !== this.lldbEditorSourcePath) return;
			this.lldbBreakpoints.set(rustLldbSourcePath, normalizeRustBreakpointLines(lines));
			return;
		}
		const control = new Int32Array(this.debugBuffer);
		const next = normalizeRustBreakpointLines(lines).slice(0, Math.max(0, control.length - 4));
		for (let index = 4; index < control.length; index += 1) {
			Atomics.store(control, index, next[index - 4] || 0);
		}
		Atomics.store(control, 3, next.length);
		Atomics.add(control, 2, 1);
	}

	debugEvaluate(expression: string) {
		return this.lldbSession?.evaluate(expression) ?? Promise.resolve('?');
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

	debugWriteMemory(
		memoryReference: string,
		offset: number,
		data: Uint8Array,
		allowPartial = false
	) {
		return (
			this.lldbSession?.writeMemory(memoryReference, offset, data, allowPartial) ??
			Promise.resolve(null)
		);
	}

	debugDataBreakpointInfo(arguments_: DebugDataBreakpointInfoArguments) {
		return this.lldbSession?.dataBreakpointInfo(arguments_) ?? Promise.resolve(null);
	}

	debugSetDataBreakpoints(breakpoints: DebugDataBreakpoint[]) {
		return this.lldbSession?.setDataBreakpoints(breakpoints) ?? Promise.resolve([]);
	}

	kill() {
		return this.terminate();
	}

	async terminate() {
		const lldbSession = this.lldbSession;
		this.lldbSession = undefined;
		this.lldbEditorSourcePath = rustLldbSourcePath;
		const disconnecting = lldbSession?.disconnect();
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		const control = new Int32Array(this.debugBuffer);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
		this.workerSession.terminate();
		this.exit = true;
		await disconnecting;
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		new Int32Array(this.debugBuffer).fill(0);
		if (!this.exit) {
			await this.terminate();
		}
	}
}

export default Rust;
