import {
	resolveDebugRuntimeUrls,
	resolveRustCompilerUrl,
	resolveRustDebugModuleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { LldbSandboxSession, type LldbArtifactPayload } from '$lib/playground/lldbSession';
import {
	type DebugCommand,
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
import {
	loadVerifiedRustExecutableGraph,
	type LoadedRustExecutableGraph
} from '$lib/playground/rustExecutableGraph';
import { resolveRustNonDebugResourceLimits } from '$lib/playground/rustWorkerLimits';
import {
	WASM_RUST_EXECUTABLE_GRAPH_PROFILE,
	WASM_RUST_RUNTIME_PROFILE
} from '$lib/playground/wasmRustVersion';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerInputReady, reportWorkerProgress } from '$lib/playground/workerProgress';
import { resolveExecutionLimits, TimeoutError } from '@wasm-idle/core';

const debugBreakpointBufferInts = 1028;
const rustLldbSourcePath = '/workspace/main.rs' as const;
const outputEncoder = new TextEncoder();

interface DebugPhaseTimeoutControl {
	pause(): void;
	resume(): void;
}

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
	executableGraphFingerprint = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private readonly workerSession = new WorkerSession({
		label: 'Rust',
		onDispose: (worker) => {
			this.disposeWorkerExecutableGraph(worker);
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
	private readonly workerExecutableGraphs = new WeakMap<Worker, LoadedRustExecutableGraph>();
	private loadGeneration = 0;
	private loadController: AbortController | null = null;
	private pendingLoadWorker: Worker | null = null;
	private pendingLoadGraph: LoadedRustExecutableGraph | null = null;
	private pendingLoadReject: ((reason?: unknown) => void) | null = null;
	private runActive = false;
	private lldbSession?: LldbSandboxSession;
	private debugMode: 'none' | 'trace' | 'lldb' = 'none';
	private activeDebugPhaseTimeout?: DebugPhaseTimeoutControl;
	private readonly lldbBreakpoints = new Map<`/workspace/${string}`, number[]>();
	private lldbEditorSourcePath: `/workspace/${string}` = rustLldbSourcePath;

	private disposeWorkerExecutableGraph(worker: Worker) {
		const executableGraph = this.workerExecutableGraphs.get(worker);
		this.workerExecutableGraphs.delete(worker);
		executableGraph?.dispose();
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		this.loadGeneration += 1;
		const generation = this.loadGeneration;
		this.loadController?.abort(new Error('Rust runtime load superseded'));
		this.loadController = new AbortController();
		this.pendingLoadReject?.('Rust runtime load superseded');
		this.pendingLoadReject = null;
		if (this.pendingLoadWorker) {
			try {
				this.pendingLoadWorker.terminate();
			} catch {
				// A superseded candidate worker may already be stopped.
			}
			this.pendingLoadWorker = null;
		}
		this.pendingLoadGraph?.dispose();
		this.pendingLoadGraph = null;
		const controller = this.loadController;
		const forwardAbort = () =>
			controller.abort(_options.signal?.reason ?? new Error('Rust runtime load aborted'));
		if (_options.signal?.aborted) {
			forwardAbort();
		} else {
			_options.signal?.addEventListener('abort', forwardAbort, { once: true });
		}
		return (async () => {
			let nextExecutableGraph: LoadedRustExecutableGraph | null = null;
			let candidateWorker: Worker | null = null;
			let candidateLoadReject: ((reason?: unknown) => void) | null = null;
			let clearCandidateWait = () => {};
			try {
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
					throw new Error(
						'Rust runtime is not configured. Set PUBLIC_WASM_RUST_COMPILER_URL or runtimeAssets.rust.compilerUrl.'
					);
				}
				const configuredGraphFingerprint =
					typeof runtimeAssets === 'string'
						? undefined
						: runtimeAssets.rust?.executableGraphFingerprint;
				if (
					configuredGraphFingerprint !== undefined &&
					configuredGraphFingerprint !== WASM_RUST_EXECUTABLE_GRAPH_PROFILE.fingerprint
				) {
					throw new Error(
						'Rust executable graph fingerprint does not match the bundled receipt profile'
					);
				}
				const configuredRuntimeProfile =
					typeof runtimeAssets === 'string' ? undefined : runtimeAssets.rust;
				if (
					configuredRuntimeProfile &&
					((configuredRuntimeProfile.profileId !== undefined &&
						configuredRuntimeProfile.profileId !==
							WASM_RUST_RUNTIME_PROFILE.profileId) ||
						(configuredRuntimeProfile.protocolVersion !== undefined &&
							configuredRuntimeProfile.protocolVersion !==
								WASM_RUST_RUNTIME_PROFILE.protocolVersion) ||
						(configuredRuntimeProfile.manifestPath !== undefined &&
							configuredRuntimeProfile.manifestPath !==
								WASM_RUST_RUNTIME_PROFILE.manifestPath) ||
						(configuredRuntimeProfile.manifestFingerprint !== undefined &&
							configuredRuntimeProfile.manifestFingerprint !==
								WASM_RUST_RUNTIME_PROFILE.manifestFingerprint) ||
						(configuredRuntimeProfile.manifestReceipt !== undefined &&
							(configuredRuntimeProfile.manifestReceipt.bytes !==
								WASM_RUST_RUNTIME_PROFILE.manifestReceipt.bytes ||
								configuredRuntimeProfile.manifestReceipt.sha256 !==
									WASM_RUST_RUNTIME_PROFILE.manifestReceipt.sha256)))
				) {
					throw new Error(
						'Rust runtime profile does not match the bundled receipt profile'
					);
				}
				if (controller.signal.aborted) {
					throw controller.signal.reason ?? new Error('Rust runtime load aborted');
				}
				const needsWorkerReset =
					!this.worker ||
					this.compilerUrl !== nextCompilerUrl ||
					this.debugModuleUrl !== nextDebugModuleUrl ||
					this.assetPath !== nextAssetPath ||
					this.executableGraphFingerprint !==
						WASM_RUST_EXECUTABLE_GRAPH_PROFILE.fingerprint;
				if (!needsWorkerReset) {
					progress?.set?.(1);
					return;
				}

				nextExecutableGraph = await loadVerifiedRustExecutableGraph({
					moduleUrl: nextCompilerUrl,
					currentUrl,
					profile: WASM_RUST_EXECUTABLE_GRAPH_PROFILE,
					runtimeProfile: WASM_RUST_RUNTIME_PROFILE,
					signal: controller.signal,
					...(_options.limits?.maxAssetBytes !== undefined
						? { maxAssetBytes: _options.limits.maxAssetBytes }
						: {}),
					...(_options.limits?.assetTimeoutMs !== undefined
						? { assetTimeoutMs: _options.limits.assetTimeoutMs }
						: {})
				});
				if (
					generation !== this.loadGeneration ||
					controller.signal.aborted ||
					this.loadController !== controller
				) {
					throw controller.signal.reason ?? new Error('Rust runtime load superseded');
				}
				this.pendingLoadGraph = nextExecutableGraph;
				const WorkerConstructor = (await import('$lib/playground/worker/rust?worker'))
					.default;
				if (
					generation !== this.loadGeneration ||
					controller.signal.aborted ||
					this.loadController !== controller
				) {
					throw controller.signal.reason ?? new Error('Rust runtime load superseded');
				}
				candidateWorker = new WorkerConstructor();
				this.pendingLoadWorker = candidateWorker;
				await new Promise<void>((resolveCandidate, rejectCandidate) => {
					const startupTimeoutMs = _options.limits?.startupTimeoutMs ?? 60_000;
					if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs <= 0) {
						rejectCandidate(
							new Error('Rust worker startup timeout must be a positive integer')
						);
						return;
					}
					let settled = false;
					const settle = (action: () => void) => {
						if (settled) return;
						settled = true;
						clearCandidateWait();
						action();
					};
					const rejectForAbort = () =>
						settle(() =>
							rejectCandidate(
								controller.signal.reason ?? new Error('Rust runtime load aborted')
							)
						);
					const timeout = setTimeout(
						() =>
							settle(() =>
								rejectCandidate(
									new Error(
										`Rust worker startup timed out after ${startupTimeoutMs} ms`
									)
								)
							),
						startupTimeoutMs
					);
					clearCandidateWait = () => {
						clearTimeout(timeout);
						controller.signal.removeEventListener('abort', rejectForAbort);
					};
					controller.signal.addEventListener('abort', rejectForAbort, { once: true });
					if (controller.signal.aborted) {
						rejectForAbort();
						return;
					}
					candidateLoadReject = rejectCandidate;
					this.pendingLoadReject = rejectCandidate;
					candidateWorker!.onmessage = (event: MessageEvent<any>) => {
						if (event.data?.load) {
							settle(resolveCandidate);
							return;
						}
						if (event.data?.error) settle(() => rejectCandidate(event.data.error));
					};
					candidateWorker!.onerror = (event: ErrorEvent) => {
						const location =
							event.filename && event.lineno
								? ` (${event.filename}:${event.lineno}:${event.colno})`
								: '';
						settle(() =>
							rejectCandidate(
								`Rust worker script error: ${event.message || 'unknown error'}${location}`
							)
						);
					};
					candidateWorker!.onmessageerror = () => {
						settle(() => rejectCandidate('Rust worker message deserialization failed'));
					};
					candidateWorker!.postMessage({
						load: true,
						compilerUrl: nextExecutableGraph!.entryUrl,
						debugModuleUrl: nextDebugModuleUrl,
						path: nextAssetPath,
						runtimeProfile: nextExecutableGraph!.runtimeProfile,
						verifiedModuleUrls: nextExecutableGraph!.networkModuleUrls,
						executableGraphFingerprint: WASM_RUST_EXECUTABLE_GRAPH_PROFILE.fingerprint
					});
				});
				if (this.pendingLoadReject === candidateLoadReject) this.pendingLoadReject = null;
				if (
					generation !== this.loadGeneration ||
					controller.signal.aborted ||
					this.loadController !== controller
				) {
					throw controller.signal.reason ?? new Error('Rust runtime load superseded');
				}
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				this.compilerUrl = nextCompilerUrl;
				this.debugModuleUrl = nextDebugModuleUrl;
				this.assetPath = nextAssetPath;
				this.executableGraphFingerprint = WASM_RUST_EXECUTABLE_GRAPH_PROFILE.fingerprint;
				if (this.worker && this.worker !== candidateWorker) {
					this.workerSession.terminate('Rust runtime worker replaced');
				}
				this.worker = candidateWorker;
				this.workerExecutableGraphs.set(candidateWorker, nextExecutableGraph);
				nextExecutableGraph = null;
				this.pendingLoadGraph = null;
				this.pendingLoadWorker = null;
				this.workerSession.attach(candidateWorker);
				candidateWorker = null;
				progress?.set?.(1);
			} finally {
				clearCandidateWait();
				if (this.pendingLoadReject === candidateLoadReject) this.pendingLoadReject = null;
				if (candidateWorker) {
					try {
						candidateWorker.terminate();
					} catch {
						// Candidate cleanup must not replace the load result.
					}
				}
				if (this.pendingLoadWorker === candidateWorker) this.pendingLoadWorker = null;
				nextExecutableGraph?.dispose();
				if (this.pendingLoadGraph === nextExecutableGraph) this.pendingLoadGraph = null;
				if (this.loadController === controller) this.loadController = null;
				_options.signal?.removeEventListener('abort', forwardAbort);
			}
		})();
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
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			if (this.runActive) return reject('Rust runtime already has an active run');
			if (options.signal?.aborted) {
				return reject(options.signal.reason ?? new Error('Rust runtime run aborted'));
			}
			let limits;
			let nonDebugResourceLimits;
			try {
				limits = resolveExecutionLimits(options.limits);
				nonDebugResourceLimits =
					debugMode === 'none' ? resolveRustNonDebugResourceLimits(limits) : undefined;
			} catch (error) {
				return reject(error);
			}
			this.runActive = true;
			this.exit = false;
			let settled = false;
			let phaseTimeout: ReturnType<typeof setTimeout> | undefined;
			let phaseTimeoutState:
				| {
						phase: 'compile' | 'run';
						timeoutMs: number;
						remainingMs: number;
						startedAt: number;
						paused: boolean;
				  }
				| undefined;
			let outputBytes = 0;
			let diagnosticCount = 0;
			const clearScheduledPhaseTimeout = () => {
				if (phaseTimeout !== undefined) clearTimeout(phaseTimeout);
				phaseTimeout = undefined;
			};
			const clearPhaseTimeout = () => {
				clearScheduledPhaseTimeout();
				phaseTimeoutState = undefined;
			};
			const armPhaseTimeout = () => {
				const state = phaseTimeoutState;
				if (!state || state.paused || settled) return;
				clearScheduledPhaseTimeout();
				state.startedAt = Date.now();
				phaseTimeout = setTimeout(() => {
					if (phaseTimeoutState !== state || state.paused || settled) return;
					phaseTimeout = undefined;
					state.remainingMs = 0;
					this.workerSession.terminate(
						new TimeoutError(
							`Rust ${state.phase} timed out after ${state.timeoutMs} ms`,
							{
								phase: state.phase === 'compile' ? 'compile' : 'execute',
								runtimeId: 'RUST',
								timeoutMs: state.timeoutMs
							}
						)
					);
				}, state.remainingMs);
			};
			const debugPhaseTimeout: DebugPhaseTimeoutControl = {
				pause: () => {
					const state = phaseTimeoutState;
					if (!state || state.paused || settled) return;
					state.remainingMs = Math.max(
						0,
						state.remainingMs - Math.max(0, Date.now() - state.startedAt)
					);
					state.paused = true;
					clearScheduledPhaseTimeout();
				},
				resume: () => {
					const state = phaseTimeoutState;
					if (!state || !state.paused || settled) return;
					state.paused = false;
					armPhaseTimeout();
				}
			};
			if (debugMode !== 'none') this.activeDebugPhaseTimeout = debugPhaseTimeout;
			const finishResolve = (result: boolean | string) => {
				if (settled) return;
				settled = true;
				this.runActive = false;
				clearPhaseTimeout();
				if (this.activeDebugPhaseTimeout === debugPhaseTimeout) {
					this.activeDebugPhaseTimeout = undefined;
				}
				options.signal?.removeEventListener('abort', abortRun);
				resolve(result);
			};
			const finishReject = (reason?: unknown) => {
				if (settled) return;
				settled = true;
				this.runActive = false;
				clearPhaseTimeout();
				if (this.activeDebugPhaseTimeout === debugPhaseTimeout) {
					this.activeDebugPhaseTimeout = undefined;
				}
				options.signal?.removeEventListener('abort', abortRun);
				reject(reason);
			};
			const abortRun = () => {
				this.workerSession.terminate(
					options.signal?.reason ?? new Error('Rust runtime run aborted')
				);
			};
			const startPhaseTimeout = (phase: 'compile' | 'run', timeoutMs: number) => {
				const paused = phaseTimeoutState?.paused === true;
				clearScheduledPhaseTimeout();
				phaseTimeoutState = {
					phase,
					timeoutMs,
					remainingMs: timeoutMs,
					startedAt: Date.now(),
					paused
				};
				armPhaseTimeout();
			};
			const forwardDebugEvent = (event: DebugSessionEvent) => {
				if (event.type === 'pause') debugPhaseTimeout.pause();
				else if (event.type === 'resume') debugPhaseTimeout.resume();
				this.ondebug?.(event);
			};
			const { programArgs } = resolveSandboxExecutionArgs('RUST', args, options);
			const targetTriple = options.rustTargetTriple || 'wasm32-wasip1';
			const _uid = ++this.uid;
			const operation = this.workerSession.beginRun(this.worker, finishReject);
			startPhaseTimeout('compile', limits.compileTimeoutMs);
			options.signal?.addEventListener('abort', abortRun, { once: true });
			if (options.signal?.aborted) {
				abortRun();
				return;
			}
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
				if (!this.worker) return finishReject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const {
					output,
					results,
					error,
					buffer,
					diagnostic,
					progress,
					runtimePhase,
					debugEvent,
					lldbArtifact
				} = event.data;
				if (runtimePhase === 'run') {
					startPhaseTimeout('run', limits.runTimeoutMs);
				}
				if (buffer) {
					if (!prepare) {
						reportWorkerInputReady(_prog, 'Rust program is waiting for input');
					}
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				reportWorkerProgress(_prog, progress);
				if (output) {
					outputBytes += outputEncoder.encode(String(output)).byteLength;
					if (outputBytes > limits.maxOutputBytes) {
						this.workerSession.terminate(
							new Error(`Rust output exceeded ${limits.maxOutputBytes} bytes`)
						);
						return;
					}
					this.output(output);
				}
				if (diagnostic) {
					diagnosticCount += 1;
					if (diagnosticCount > limits.maxDiagnostics) {
						this.workerSession.terminate(
							new Error(`Rust diagnostics exceeded ${limits.maxDiagnostics} entries`)
						);
						return;
					}
					this.oncompilerdiagnostic?.(diagnostic);
				}
				if (debugEvent) forwardDebugEvent(debugEvent);
				if (lldbArtifact) {
					startPhaseTimeout('run', limits.runTimeoutMs);
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
								forwardDebugEvent({
									...debugEvent,
									sourcePath: editorSourcePath
								});
								return;
							}
							if (
								editorSourcePath !== rustLldbSourcePath &&
								debugEvent.type === 'pause'
							) {
								forwardDebugEvent({
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
							forwardDebugEvent(debugEvent);
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
						this.disposeWorkerExecutableGraph(compilerWorker);
						if (this.worker === compilerWorker) delete this.worker;
					}
					void lldbSession.start().then(
						(result) => {
							if (this.lldbSession === lldbSession) this.lldbSession = undefined;
							this.lldbEditorSourcePath = rustLldbSourcePath;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							if (!this.workerSession.complete(operation)) return;
							finishResolve(result);
						},
						(sessionError) => {
							if (this.lldbSession === lldbSession) this.lldbSession = undefined;
							this.lldbEditorSourcePath = rustLldbSourcePath;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							if (!this.workerSession.complete(operation)) return;
							finishReject(sessionError);
						}
					);
					return;
				}
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					if (!this.workerSession.complete(operation)) return;
					this.ondebug?.({ type: 'stop' });
					finishResolve(results as string);
				}
				if (error) {
					const errorText = String(error);
					outputBytes += outputEncoder.encode(errorText).byteLength;
					if (outputBytes > limits.maxOutputBytes) {
						this.workerSession.terminate(
							new Error(`Rust output exceeded ${limits.maxOutputBytes} bytes`)
						);
						return;
					}
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					if (!this.workerSession.complete(operation)) return;
					this.ondebug?.({ type: 'stop' });
					finishReject(errorText);
				}
			};
			this.worker.onmessage = handler;
			this.begin = Date.now();
			try {
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
					pauseOnEntry: !!options.pauseOnEntry,
					limits: {
						maxOutputBytes: limits.maxOutputBytes,
						maxDiagnostics: limits.maxDiagnostics,
						...(nonDebugResourceLimits
							? {
									maxAssetBytes: limits.maxAssetBytes,
									maxWorkers: nonDebugResourceLimits.maxWorkers,
									maxThreads: nonDebugResourceLimits.maxThreads
								}
							: {})
					}
				});
			} catch (error) {
				this.workerSession.terminate(error);
			}
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
		this.activeDebugPhaseTimeout?.resume();
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

	kill() {
		return this.terminate();
	}

	async terminate() {
		this.loadGeneration += 1;
		this.loadController?.abort(new Error('Rust runtime terminated'));
		this.loadController = null;
		this.pendingLoadReject?.('Process terminated');
		this.pendingLoadReject = null;
		if (this.pendingLoadWorker) {
			try {
				this.pendingLoadWorker.terminate();
			} catch {
				// A candidate worker may already be stopped.
			}
			this.pendingLoadWorker = null;
		}
		this.pendingLoadGraph?.dispose();
		this.pendingLoadGraph = null;
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
