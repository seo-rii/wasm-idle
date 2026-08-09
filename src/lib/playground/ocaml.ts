import {
	resolveOcamlManifestUrl,
	resolveOcamlModuleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import {
	type CompilerDiagnostic,
	type OcamlBackend,
	type OcamlWasmBinaryenMode,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';
import { BusyError, ProtocolError } from '@wasm-idle/core';

type OcamlOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	explicitStdin: boolean;
	sessionActive: boolean;
	abortReasonReading: boolean;
	buffer?: ArrayBufferLike;
	signal?: AbortSignal;
	onAbort?: () => void;
};

class Ocaml implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	manifestUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeOperation: OcamlOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'OCaml',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	private beginOperation(phase: OcamlOperation['phase']) {
		if (this.activeOperation) {
			throw new BusyError('OCaml runtime already has an active operation', {
				runtimeId: 'OCAML',
				phase: this.activeOperation.phase
			});
		}
		const operation: OcamlOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			explicitStdin: false,
			sessionActive: false,
			abortReasonReading: false
		};
		this.activeOperation = operation;
		return operation;
	}

	private completeOperation(operation: OcamlOperation) {
		if (this.activeOperation?.token === operation.token) this.activeOperation = null;
		const { signal, onAbort } = operation;
		operation.signal = undefined;
		operation.onAbort = undefined;
		if (signal && onAbort) {
			try {
				signal.removeEventListener('abort', onAbort);
			} catch {
				// Listener cleanup must not replace the operation result.
			}
		}
	}

	private isOperationActive(operation: OcamlOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private ownsWorkerOperation(
		operation: OcamlOperation,
		worker: Worker,
		handler: unknown,
		uid?: number
	) {
		return (
			this.isOperationActive(operation) &&
			this.worker === worker &&
			worker.onmessage === handler &&
			(uid === undefined || uid === this.uid)
		);
	}

	private releaseBeforeSession(operation: OcamlOperation, fallback: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : fallback;
		this.completeOperation(operation);
		return outcome;
	}

	private resetExplicitStdinState(buffer: ArrayBufferLike) {
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
		try {
			resetBufferedStdin(buffer);
		} catch {
			// Explicit stdin never consumes the shared terminal buffer.
		}
	}

	private finishExplicitStdin(operation: OcamlOperation) {
		if (!operation.explicitStdin) return;
		operation.explicitStdin = false;
		const buffer = operation.buffer;
		if (buffer) this.resetExplicitStdinState(buffer);
	}

	private abortReason(signal: AbortSignal, phase: OcamlOperation['phase']) {
		const reason = signal.reason;
		if (reason !== undefined) return reason;
		return new DOMException(
			phase === 'startup' ? 'OCaml runtime startup aborted' : 'OCaml execution aborted',
			'AbortError'
		);
	}

	private bindAbortSignal(operation: OcamlOperation, signal?: AbortSignal) {
		if (!signal || !this.isOperationActive(operation)) return;
		const onAbort = () => {
			if (!this.isOperationActive(operation) || operation.abortReasonReading) return;
			operation.abortReasonReading = true;
			let reason: unknown;
			try {
				reason = this.abortReason(signal, operation.phase);
			} catch (error) {
				reason = error;
			} finally {
				operation.abortReasonReading = false;
			}
			if (!this.isOperationActive(operation)) return;
			if (operation.sessionActive) this.abortOperation(operation, reason);
			else this.cancelBeforeSession(operation, reason);
		};
		operation.signal = signal;
		operation.onAbort = onAbort;
		try {
			signal.addEventListener('abort', onAbort, { once: true });
		} catch (error) {
			if (!this.isOperationActive(operation)) return;
			let signalAborted = false;
			try {
				signalAborted = signal.aborted;
			} catch {
				if (!this.isOperationActive(operation)) return;
			}
			if (signalAborted) onAbort();
			else this.cancelBeforeSession(operation, error);
			return;
		}
		if (!this.isOperationActive(operation)) return;
		try {
			if (signal.aborted) onAbort();
		} catch (error) {
			if (this.isOperationActive(operation)) this.cancelBeforeSession(operation, error);
		}
	}

	private cancelBeforeSession(operation: OcamlOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.completeOperation(operation);
	}

	private abortOperation(operation: OcamlOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.finishExplicitStdin(operation);
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
		this.completeOperation(operation);
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let operation: OcamlOperation;
		try {
			operation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let nextModuleUrl: string;
		let nextManifestUrl: string;
		let buffer: ArrayBufferLike;
		try {
			signal = options.signal;
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			this.bindAbortSignal(operation, signal);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			let resolverAssets: string | PlaygroundRuntimeAssets = runtimeAssets;
			if (runtimeAssets === null) {
				resolverAssets = {};
			} else if (typeof runtimeAssets === 'object') {
				const source = runtimeAssets.ocaml;
				if (!this.isOperationActive(operation)) {
					return Promise.reject(
						this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
					);
				}
				const moduleUrl = source?.moduleUrl;
				if (!this.isOperationActive(operation)) {
					return Promise.reject(
						this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
					);
				}
				const manifestUrl = source?.manifestUrl;
				if (!this.isOperationActive(operation)) {
					return Promise.reject(
						this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
					);
				}
				let rootUrl: string | undefined;
				let rootUrlRead = false;
				resolverAssets = { ocaml: source ? { moduleUrl, manifestUrl } : undefined };
				Object.defineProperty(resolverAssets, 'rootUrl', {
					get: () => {
						if (!rootUrlRead) {
							rootUrlRead = true;
							rootUrl = runtimeAssets.rootUrl;
						}
						if (!this.isOperationActive(operation)) {
							throw operation.cancellationReason;
						}
						return rootUrl;
					}
				});
			}
			nextModuleUrl = resolveOcamlModuleUrl(resolverAssets, currentUrl);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			nextManifestUrl = resolveOcamlManifestUrl(resolverAssets, currentUrl);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			if (!nextModuleUrl || !nextManifestUrl) {
				throw 'OCaml runtime is not configured. Set runtimeAssets.ocaml.moduleUrl and runtimeAssets.ocaml.manifestUrl or sync the bundled wasm-of-js-of-ocaml assets.';
			}
			buffer = this.buffer;
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(operation, error));
		}
		operation.sessionActive = true;
		const loading = this.workerSession.load(async (resolve, reject) => {
			if (!this.isOperationActive(operation)) return;
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			resetBufferedStdin(buffer);
			if (!this.isOperationActive(operation)) return;
			const needsWorkerReset =
				!this.worker ||
				this.moduleUrl !== nextModuleUrl ||
				this.manifestUrl !== nextManifestUrl;
			if (needsWorkerReset) {
				const WorkerConstructor = (await import('$lib/playground/worker/ocaml?worker'))
					.default;
				if (!this.isOperationActive(operation)) return;
				const worker = new WorkerConstructor();
				if (!this.isOperationActive(operation)) {
					worker.terminate();
					return;
				}
				this.worker = worker;
				this.workerSession.attach(worker);
				const handler = (event: MessageEvent<any>) => {
					if (!this.ownsWorkerOperation(operation, worker, handler)) return;
					try {
						const message = event.data;
						if (!this.ownsWorkerOperation(operation, worker, handler)) return;
						const loaded = message?.load;
						if (!this.ownsWorkerOperation(operation, worker, handler)) return;
						const error = message?.error;
						if (!this.ownsWorkerOperation(operation, worker, handler)) return;
						if (loaded) {
							progress?.set?.(1);
							if (!this.ownsWorkerOperation(operation, worker, handler)) return;
							worker.onmessage = null;
							this.moduleUrl = nextModuleUrl;
							this.manifestUrl = nextManifestUrl;
							resolve();
							this.completeOperation(operation);
							return;
						}
						if (error !== undefined) reject(error);
					} catch (error) {
						reject(error);
					}
				};
				worker.onmessage = handler;
				worker.postMessage({
					load: true,
					moduleUrl: nextModuleUrl,
					manifestUrl: nextManifestUrl
				});
			} else {
				progress?.set?.(1);
				if (!this.isOperationActive(operation)) return;
				resolve();
				this.completeOperation(operation);
			}
		});
		return loading.finally(() => this.completeOperation(operation));
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

	private flushPendingInput(buffer = this.activeOperation?.buffer ?? this.buffer) {
		if (!this.waitingForInput) return;
		if (flushQueuedStdin(this.pendingInput, buffer)) {
			this.waitingForInput = false;
			return;
		}
		if (this.pendingEof) {
			flushBufferedEof(buffer);
			this.pendingEof = false;
			this.waitingForInput = false;
		}
	}

	async run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const operation = this.beginOperation('execute');
		let signal: AbortSignal | undefined;
		let worker: Worker;
		let target: OcamlBackend;
		let wasmBinaryenMode: OcamlWasmBinaryenMode;
		let stdin: SandboxExecutionOptions['stdin'];
		let buffer: ArrayBufferLike;
		let outputCallback: any;
		let onDiagnostic: ((diagnostic: CompilerDiagnostic) => void) | undefined;
		try {
			signal = options.signal;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			this.bindAbortSignal(operation, signal);
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			const configuredWorker = this.worker;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			if (!configuredWorker) throw 'Worker not loaded';
			worker = configuredWorker;
			const configuredTarget = options.ocamlBackend;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			target = configuredTarget || 'wasm';
			const configuredBinaryenMode = options.ocamlWasmBinaryenMode;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			wasmBinaryenMode = configuredBinaryenMode || 'fast';
			stdin = options.stdin;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			buffer = this.buffer;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			outputCallback = this.output;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			onDiagnostic = this.oncompilerdiagnostic;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			operation.buffer = buffer;
			if (stdin !== undefined) {
				operation.explicitStdin = true;
				this.resetExplicitStdinState(buffer);
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
				}
			}
		} catch (error) {
			throw this.releaseBeforeSession(operation, error);
		}
		const hasExplicitStdin = stdin !== undefined;
		operation.sessionActive = true;
		try {
			this.exit = false;
			return await new Promise<boolean | string>((resolve, reject) => {
				const runUid = ++this.uid;
				const workerOperation = this.workerSession.beginRun(worker, reject);
				let handler: (event: Event & { data: any }) => void;
				const ownsRun = () => this.ownsWorkerOperation(operation, worker, handler, runUid);
				const failRun = (error: unknown, disposeWorker = false) => {
					if (!ownsRun()) return;
					this.finishExplicitStdin(operation);
					if (worker.onmessage === handler) worker.onmessage = null;
					this.workerSession.complete(workerOperation);
					if (disposeWorker && this.worker === worker) this.workerSession.reset();
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.completeOperation(operation);
					reject(error);
				};
				handler = (event) => {
					if (!ownsRun()) {
						return;
					}
					try {
						const message = event.data;
						if (!ownsRun()) return;
						const output = message?.output;
						if (!ownsRun()) return;
						const results = message?.results;
						if (!ownsRun()) return;
						const error = message?.error;
						if (!ownsRun()) return;
						const diagnostic = message?.diagnostic;
						if (!ownsRun()) return;
						const progress = message?.progress;
						if (!ownsRun()) return;
						const runtime = message?.runtime;
						if (!ownsRun()) return;
						const requestsInput = message?.buffer;
						if (!ownsRun()) return;
						reportWorkerProgress(_prog, progress);
						if (!ownsRun()) {
							return;
						}
						if (requestsInput && !hasExplicitStdin) {
							this.waitingForInput = true;
							this.flushPendingInput(buffer);
							if (!ownsRun()) {
								return;
							}
						}
						if (output) {
							if (outputCallback != null) {
								Reflect.apply(outputCallback, this, [output]);
							}
							if (!ownsRun()) {
								return;
							}
						}
						if (diagnostic) {
							if (onDiagnostic != null)
								Reflect.apply(onDiagnostic, this, [diagnostic]);
							if (!ownsRun()) {
								return;
							}
						}
						if (runtime) {
							failRun(
								new ProtocolError('Unexpected OCaml page runtime message', {
									phase: 'execute',
									runtimeId: 'OCAML'
								}),
								true
							);
							return;
						}
						if (results !== undefined) {
							this.finishExplicitStdin(operation);
							if (worker.onmessage === handler) worker.onmessage = null;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.waitingForInput = false;
							this.pendingEof = false;
							this.workerSession.complete(workerOperation);
							this.completeOperation(operation);
							resolve(results as boolean | string);
							return;
						}
						if (error !== undefined) failRun(error);
					} catch (error) {
						failRun(error, true);
					}
				};
				worker.onmessage = handler;
				if (!ownsRun()) {
					return;
				}
				this.begin = Date.now();
				try {
					worker.postMessage({
						code,
						prepare,
						target,
						wasmBinaryenMode,
						log: _log,
						buffer,
						stdin
					});
				} catch (error) {
					failRun(error);
				}
			});
		} finally {
			this.finishExplicitStdin(operation);
			this.completeOperation(operation);
		}
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const operation = this.activeOperation;
		if (operation) {
			if (operation.sessionActive) this.abortOperation(operation, reason);
			else this.cancelBeforeSession(operation, reason);
			return;
		}
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
		if (this.activeOperation || !this.exit) {
			this.terminate();
		}
	}
}

export default Ocaml;
