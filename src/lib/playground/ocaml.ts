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
		const operation = {
			token: Symbol(phase),
			phase,
			cancelled: false
		} satisfies OcamlOperation;
		this.activeOperation = operation;
		return operation;
	}

	private completeOperation(operation: OcamlOperation) {
		if (this.activeOperation?.token === operation.token) this.activeOperation = null;
	}

	private isOperationActive(operation: OcamlOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
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
				resolve();
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
		const operation = this.beginOperation('execute');
		try {
			if (!this.worker) throw 'Worker not loaded';
			const worker = this.worker;
			const target: OcamlBackend = options.ocamlBackend || 'wasm';
			const wasmBinaryenMode: OcamlWasmBinaryenMode = options.ocamlWasmBinaryenMode || 'fast';
			this.exit = false;
			return await new Promise<boolean | string>((resolve, reject) => {
				const runUid = ++this.uid;
				const workerOperation = this.workerSession.beginRun(worker, reject);
				let handler: (event: Event & { data: any }) => void;
				const failRun = (error: unknown, disposeWorker = false) => {
					if (worker.onmessage === handler) worker.onmessage = null;
					this.workerSession.complete(workerOperation);
					if (disposeWorker && this.worker === worker) this.workerSession.reset();
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					reject(error);
				};
				handler = (event) => {
					if (
						!this.isOperationActive(operation) ||
						this.worker !== worker ||
						worker.onmessage !== handler ||
						runUid !== this.uid
					) {
						return;
					}
					try {
						const { output, results, error, diagnostic, progress, runtime } =
							event.data;
						reportWorkerProgress(_prog, progress);
						if (
							!this.isOperationActive(operation) ||
							this.worker !== worker ||
							worker.onmessage !== handler ||
							runUid !== this.uid
						) {
							return;
						}
						if (event.data?.buffer) {
							this.waitingForInput = true;
							this.flushPendingInput();
							if (
								!this.isOperationActive(operation) ||
								this.worker !== worker ||
								worker.onmessage !== handler ||
								runUid !== this.uid
							) {
								return;
							}
						}
						if (output) {
							this.output?.(output);
							if (
								!this.isOperationActive(operation) ||
								this.worker !== worker ||
								worker.onmessage !== handler ||
								runUid !== this.uid
							) {
								return;
							}
						}
						if (diagnostic) {
							this.oncompilerdiagnostic?.(diagnostic);
							if (
								!this.isOperationActive(operation) ||
								this.worker !== worker ||
								worker.onmessage !== handler ||
								runUid !== this.uid
							) {
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
							if (worker.onmessage === handler) worker.onmessage = null;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.waitingForInput = false;
							this.pendingEof = false;
							this.workerSession.complete(workerOperation);
							resolve(results as boolean | string);
							return;
						}
						if (error !== undefined) failRun(error);
					} catch (error) {
						failRun(error, true);
					}
				};
				worker.onmessage = handler;
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
			this.completeOperation(operation);
		}
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		if (this.activeOperation) this.activeOperation.cancelled = true;
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
