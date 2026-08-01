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
	explicitStdin: boolean;
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
			explicitStdin: false
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

	private resetExplicitStdinState() {
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Explicit stdin never consumes the shared terminal buffer.
		}
	}

	private finishExplicitStdin(operation: OcamlOperation) {
		if (!operation.explicitStdin) return;
		operation.explicitStdin = false;
		this.resetExplicitStdinState();
	}

	private abortReason(signal: AbortSignal, phase: OcamlOperation['phase']) {
		if (signal.reason !== undefined) return signal.reason;
		return new DOMException(
			phase === 'startup' ? 'OCaml runtime startup aborted' : 'OCaml execution aborted',
			'AbortError'
		);
	}

	private bindAbortSignal(operation: OcamlOperation, signal?: AbortSignal) {
		if (!signal) return;
		const onAbort = () => {
			if (!this.isOperationActive(operation)) {
				this.completeOperation(operation);
				return;
			}
			this.terminate(this.abortReason(signal, operation.phase));
		};
		operation.signal = signal;
		operation.onAbort = onAbort;
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) onAbort();
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(this.abortReason(signal, 'startup'));
		}
		let operation: OcamlOperation;
		try {
			operation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		const loading = this.workerSession.load(async (resolve, reject) => {
			if (!this.isOperationActive(operation)) return;
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			resetBufferedStdin(this.buffer);
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextModuleUrl = resolveOcamlModuleUrl(runtimeAssets, currentUrl);
			const nextManifestUrl = resolveOcamlManifestUrl(runtimeAssets, currentUrl);
			if (!nextModuleUrl || !nextManifestUrl) {
				return reject(
					'OCaml runtime is not configured. Set runtimeAssets.ocaml.moduleUrl and runtimeAssets.ocaml.manifestUrl or sync the bundled wasm-of-js-of-ocaml assets.'
				);
			}
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
					if (
						!this.isOperationActive(operation) ||
						this.worker !== worker ||
						worker.onmessage !== handler
					) {
						return;
					}
					try {
						if (event.data?.load) {
							progress?.set?.(1);
							if (
								!this.isOperationActive(operation) ||
								this.worker !== worker ||
								worker.onmessage !== handler
							) {
								return;
							}
							worker.onmessage = null;
							this.moduleUrl = nextModuleUrl;
							this.manifestUrl = nextManifestUrl;
							this.completeOperation(operation);
							resolve();
							return;
						}
						if (event.data?.error !== undefined) reject(event.data.error);
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
				this.completeOperation(operation);
				resolve();
			}
		});
		try {
			this.bindAbortSignal(operation, signal);
		} catch (error) {
			this.terminate(error);
		}
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

	async run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const signal = options.signal;
		if (signal?.aborted) throw this.abortReason(signal, 'execute');
		const operation = this.beginOperation('execute');
		try {
			if (!this.worker) throw 'Worker not loaded';
			const worker = this.worker;
			const target: OcamlBackend = options.ocamlBackend || 'wasm';
			const wasmBinaryenMode: OcamlWasmBinaryenMode = options.ocamlWasmBinaryenMode || 'fast';
			const hasExplicitStdin = options.stdin !== undefined;
			if (hasExplicitStdin) {
				operation.explicitStdin = true;
				this.resetExplicitStdinState();
			}
			this.exit = false;
			return await new Promise<boolean | string>((resolve, reject) => {
				const runUid = ++this.uid;
				const workerOperation = this.workerSession.beginRun(worker, reject);
				let handler: (event: Event & { data: any }) => void;
				const ownsRun = () =>
					this.isOperationActive(operation) &&
					this.worker === worker &&
					worker.onmessage === handler &&
					runUid === this.uid;
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
						const { output, results, error, diagnostic, progress, runtime } =
							event.data;
						reportWorkerProgress(_prog, progress);
						if (!ownsRun()) {
							return;
						}
						if (event.data?.buffer && !hasExplicitStdin) {
							this.waitingForInput = true;
							this.flushPendingInput();
							if (!ownsRun()) {
								return;
							}
						}
						if (output) {
							this.output?.(output);
							if (!ownsRun()) {
								return;
							}
						}
						if (diagnostic) {
							this.oncompilerdiagnostic?.(diagnostic);
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
				try {
					this.bindAbortSignal(operation, signal);
				} catch (error) {
					failRun(error);
					return;
				}
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
						buffer: this.buffer,
						stdin: options.stdin
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
			this.finishExplicitStdin(operation);
			operation.cancelled = true;
			this.completeOperation(operation);
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
