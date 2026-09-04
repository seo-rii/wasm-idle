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
import { BusyError, TimeoutError, resolveExecutionLimits } from '@wasm-idle/core';

const debugBreakpointBufferInts = 1028;

type PythonOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
};

const abortReason = (signal: AbortSignal, phase: PythonOperation['phase']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup' ? 'Python runtime startup aborted' : 'Python execution aborted',
				'AbortError'
			);

class Python implements Sandbox {
	ts = Date.now();
	output: any = null;
	ondebug?: (event: DebugSessionEvent) => void;
	image?: (data: { mime: string; b64: string; ts?: number }) => void;
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
	waitingForInput = false;
	pendingEof = false;
	exit = true;
	assetBridge: WorkerAssetBridge | null = null;
	private activeOperation: PythonOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'Python',
		onDispose: (worker) => {
			if (this.worker !== worker) return;
			delete this.worker;
			this.assetBridge?.dispose();
			this.assetBridge = null;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
			this.ondebug?.({ type: 'stop' });
		}
	});

	private beginOperation(phase: PythonOperation['phase']) {
		if (this.activeOperation) {
			throw new BusyError('Python runtime already has an active operation', {
				runtimeId: 'PYTHON3',
				phase: this.activeOperation.phase
			});
		}
		const operation: PythonOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			cleanedUp: false,
			cleanups: []
		};
		this.activeOperation = operation;
		return operation;
	}

	private isOperationActive(operation: PythonOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: PythonOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: PythonOperation) {
		if (operation.cleanedUp) return;
		operation.cleanedUp = true;
		for (const cleanup of operation.cleanups.splice(0)) {
			try {
				cleanup();
			} catch {
				// Caller-owned lifecycle cleanup must not replace the operation result.
			}
		}
	}

	private releaseBeforeSession(operation: PythonOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private cancelOperation(operation: PythonOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.activeOperation = null;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.exit = true;
		this.workerSession.terminate(reason);
		this.cleanupOperation(operation);
	}

	private bindAbortSignal(operation: PythonOperation, signal: AbortSignal | undefined) {
		if (!signal || !this.isOperationActive(operation)) return;
		let registered = false;
		const onAbort = () => {
			if (!this.isOperationActive(operation)) return;
			let reason: unknown;
			try {
				reason = abortReason(signal, operation.phase);
			} catch (error) {
				reason = error;
			}
			this.cancelOperation(operation, reason);
		};
		operation.cleanups.push(() => {
			if (registered) signal.removeEventListener('abort', onAbort);
		});
		try {
			registered = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private bindStartupTimeout(operation: PythonOperation, timeoutMs: number) {
		if (!this.isOperationActive(operation)) return;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		operation.cleanups.push(() => {
			if (timeout !== undefined) clearTimeout(timeout);
		});
		try {
			timeout = setTimeout(() => {
				if (!this.isOperationActive(operation)) return;
				this.cancelOperation(
					operation,
					new TimeoutError(`Python startup timed out after ${timeoutMs} ms`, {
						phase: 'startup',
						runtimeId: 'PYTHON3',
						timeoutMs
					})
				);
			}, timeoutMs);
			if (operation.cleanedUp) clearTimeout(timeout);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		code = '',
		log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let operation: PythonOperation;
		try {
			operation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let signal: AbortSignal | undefined;
		try {
			signal = options.signal;
			limits = resolveExecutionLimits(options.limits);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'Python runtime startup cancelled')
				);
			}
			if (signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(operation, abortReason(signal, 'startup'))
				);
			}
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(operation, error));
		}

		const loading = this.workerSession.load(async (resolve, reject) => {
			const resolveOperation = () => {
				if (!this.releaseOperation(operation)) return;
				resolve();
				this.cleanupOperation(operation);
			};
			const rejectOperation = (reason?: unknown) => {
				if (!this.releaseOperation(operation)) return;
				reject(reason);
				this.cleanupOperation(operation);
			};
			try {
				if (!this.isOperationActive(operation)) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				const assetConfig = resolveRuntimeAssetConfig(
					'python',
					runtimeAssets,
					typeof window !== 'undefined' ? window.location.href : ''
				);
				if (!this.isOperationActive(operation)) return;
				const needsWorkerReset =
					!this.worker ||
					!this.assetBridge ||
					!this.assetBridge.matches(assetConfig, limits.maxAssetBytes);
				if (needsWorkerReset && this.worker) this.workerSession.reset();
				if (!this.isOperationActive(operation)) return;

				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/python?worker'))
						.default;
					if (!this.isOperationActive(operation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(operation)) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					const assetBridge = new WorkerAssetBridge(
						worker,
						'python',
						assetConfig,
						progress,
						limits.maxAssetBytes
					);
					if (!this.isOperationActive(operation) || this.worker !== worker) {
						assetBridge.dispose();
						return;
					}
					this.assetBridge = assetBridge;
					let handler: (event: MessageEvent<any>) => void;
					handler = (event) => {
						if (this.worker !== worker || worker.onmessage !== handler) return;
						try {
							if (this.assetBridge?.handleMessage(event)) return;
							if (!this.isOperationActive(operation)) return;
							reportWorkerProgress(progress, event.data?.progress);
							if (event.data?.load) {
								progress?.set?.(1);
								resolveOperation();
								return;
							}
							if (event.data?.error !== undefined) rejectOperation(event.data.error);
						} catch (error) {
							if (this.isOperationActive(operation)) rejectOperation(error);
							else this.workerSession.terminate(error);
						}
					};
					worker.onmessage = handler;
					worker.postMessage({
						load: true,
						log,
						code,
						assets: {
							baseUrl: assetConfig.baseUrl,
							maxAssetBytes: limits.maxAssetBytes,
							useAssetBridge: assetConfig.useAssetBridge
						}
					});
					return;
				}

				const worker = this.worker;
				if (!this.assetBridge) {
					rejectOperation('Worker asset bridge unavailable');
					return;
				}
				this.assetBridge.rebind(worker, assetConfig, progress, limits.maxAssetBytes);
				progress?.set?.(1);
				if (!this.isOperationActive(operation) || this.worker !== worker) return;
				resolveOperation();
			} catch (error) {
				rejectOperation(error);
			}
		});
		const timeoutMs = Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs);
		this.bindStartupTimeout(operation, timeoutMs);
		this.bindAbortSignal(operation, signal);
		return loading.finally(() => {
			this.releaseOperation(operation);
			this.cleanupOperation(operation);
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
		let activeOperation: PythonOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		const worker = this.worker;
		let signal: AbortSignal | undefined;
		let debug: boolean;
		let breakpoints: number[];
		let stdin: string | undefined;
		let pauseOnEntry: boolean;
		let activePath: string | undefined;
		let debugPath: string | undefined;
		let workspaceFiles: SandboxExecutionOptions['workspaceFiles'];
		try {
			signal = options.signal;
			debug = !!options.debug;
			breakpoints = [...(options.breakpoints || [])];
			stdin = options.stdin;
			pauseOnEntry = !!options.pauseOnEntry;
			activePath = options.activePath;
			debugPath = options.debugPath;
			workspaceFiles = options.workspaceFiles;
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Python execution cancelled')
				);
			}
			if (debug) requireSharedArrayBuffer('Python debugging');
			this.setBreakpoints(debug ? breakpoints : []);
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!worker || this.worker !== worker) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, 'Worker not loaded'));
		}

		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
			const workerOperation = this.workerSession.beginRun(worker, reject);
			this.bindAbortSignal(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) return;
			const interrupt = new Uint8Array(this.interruptBuffer),
				runUid = ++this.uid;
			let handler: (event: Event & { data: any }) => void;
			const ownsRun = () =>
				this.isOperationActive(activeOperation) &&
				this.worker === worker &&
				worker.onmessage === handler &&
				runUid === this.uid;
			const settleRunState = () => {
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
			};
			const claimRun = () => {
				if (!ownsRun()) return false;
				settleRunState();
				this.workerSession.complete(workerOperation);
				this.releaseOperation(activeOperation);
				this.cleanupOperation(activeOperation);
				try {
					if (worker.onmessage === handler) worker.onmessage = null;
				} catch {
					// Handler cleanup must not replace the execution result.
				}
				return true;
			};
			const failRun = (reason: unknown, disposeWorker = false) => {
				if (disposeWorker) {
					if (!ownsRun()) return;
					this.cancelOperation(activeOperation, reason);
					return;
				}
				if (!claimRun()) return;
				reject(reason);
			};
			handler = (event) => {
				if (!ownsRun()) return;
				try {
					if (this.assetBridge?.handleMessage(event as MessageEvent<any>)) return;
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
					if (!ownsRun()) return;
					if (buffer) {
						if (!prepare) {
							_prog?.report?.({
								kind: 'ready',
								state: 'waiting-input',
								reason: 'stdin-request',
								label: 'Python program is waiting for input'
							});
						}
						this.waitingForInput = true;
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					if (type === 'img' && payload) this.image?.(payload);
					if (!ownsRun()) return;
					if (output) this.output?.(output);
					if (!ownsRun()) return;
					if (debugEvent) this.ondebug?.(debugEvent);
					if (!ownsRun()) return;
					if (log) console.log(log);
					if (results !== undefined) {
						this.ondebug?.({ type: 'stop' });
						if (!claimRun()) return;
						resolve(results as boolean | string);
						return;
					}
					if (error !== undefined) {
						this.ondebug?.({ type: 'stop' });
						failRun(error);
					}
				} catch (error) {
					failRun(error, true);
				}
			};
			interrupt[0] = 0;
			worker.onmessage = handler;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					debugBuffer: this.debugBuffer,
					watchBuffer: this.watchBuffer,
					watchResultBuffer: this.watchResultBuffer,
					interrupt: this.interruptBuffer,
					context: {},
					stdin,
					debug,
					breakpoints,
					pauseOnEntry,
					activePath,
					debugPath,
					workspaceFiles
				});
			} catch (error) {
				failRun(error);
			}
		});
		return running.finally(() => {
			if (this.isOperationActive(activeOperation)) {
				this.releaseOperation(activeOperation);
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
			}
			this.cleanupOperation(activeOperation);
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

	terminate(reason: unknown = 'Process terminated') {
		const activeOperation = this.activeOperation;
		if (activeOperation) {
			this.cancelOperation(activeOperation, reason);
			return;
		}
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		new Uint8Array(this.interruptBuffer)[0] = 2;
		const control = new Int32Array(this.debugBuffer);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
		this.workerSession.terminate(reason);
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
