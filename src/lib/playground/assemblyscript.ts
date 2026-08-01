import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import { BusyError } from '@wasm-idle/core';
import {
	resolveAssemblyScriptRuntimeModuleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

type AssemblyScriptOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
};

class AssemblyScriptSandbox implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(4096);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeOperation: AssemblyScriptOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'AssemblyScript',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let operation: AssemblyScriptOperation;
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
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextModuleUrl = resolveAssemblyScriptRuntimeModuleUrl(runtimeAssets, currentUrl);
			if (this.worker && this.moduleUrl !== nextModuleUrl) this.workerSession.reset();
			this.moduleUrl = nextModuleUrl;
			if (!this.worker) {
				const WorkerConstructor = (
					await import('$lib/playground/worker/assemblyscript?worker')
				).default;
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
					if (event.data?.load) {
						progress?.set?.(1);
						if (!this.isOperationActive(operation)) return;
						resolve();
					}
					if (event.data?.error) reject(event.data.error);
				};
				worker.onmessage = handler;
				worker.postMessage({
					load: true,
					moduleUrl: this.moduleUrl,
					log: _log
				});
			} else {
				progress?.set?.(1);
				if (!this.isOperationActive(operation)) return;
				resolve();
			}
		});
		return loading.finally(() => this.completeOperation(operation));
	}

	private beginOperation(phase: AssemblyScriptOperation['phase']) {
		if (this.activeOperation) {
			throw new BusyError('AssemblyScript runtime already has an active operation', {
				runtimeId: 'ASSEMBLYSCRIPT',
				phase: this.activeOperation.phase
			});
		}
		const operation = { token: Symbol(phase), phase } satisfies AssemblyScriptOperation;
		this.activeOperation = operation;
		return operation;
	}

	private completeOperation(operation: AssemblyScriptOperation) {
		if (this.activeOperation?.token === operation.token) this.activeOperation = null;
	}

	private isOperationActive(operation: AssemblyScriptOperation) {
		return this.activeOperation?.token === operation.token;
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
		let activeOperation: AssemblyScriptOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		if (!this.worker) {
			this.completeOperation(activeOperation);
			return Promise.reject('Worker not loaded');
		}
		const worker = this.worker;
		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			const workerOperation = this.workerSession.beginRun(worker, reject);
			const handler = (event: Event & { data: any }) => {
				if (
					!this.isOperationActive(activeOperation) ||
					this.worker !== worker ||
					worker.onmessage !== handler ||
					_uid !== this.uid
				) {
					return;
				}
				const { output, results, error, buffer, diagnostic, progress } = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				reportWorkerProgress(_prog, progress);
				if (!this.isOperationActive(activeOperation)) return;
				if (output) {
					this.output?.(output);
					if (!this.isOperationActive(activeOperation)) return;
				}
				if (diagnostic) {
					this.oncompilerdiagnostic?.(diagnostic);
					if (!this.isOperationActive(activeOperation)) return;
				}
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					if (worker.onmessage === handler) worker.onmessage = null;
					this.workerSession.complete(workerOperation);
					resolve(results as string);
				}
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					if (worker.onmessage === handler) worker.onmessage = null;
					this.workerSession.complete(workerOperation);
					reject(error);
				}
			};
			worker.onmessage = handler;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					stdin: options.stdin,
					activePath: options.activePath || 'main.as.ts',
					workspaceFiles: options.workspaceFiles || [],
					log: _log
				});
			} catch (error) {
				if (worker.onmessage === handler) worker.onmessage = null;
				this.workerSession.complete(workerOperation);
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				reject(error);
			}
		});
		return running.finally(() => this.completeOperation(activeOperation));
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.activeOperation = null;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate();
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

export default AssemblyScriptSandbox;
