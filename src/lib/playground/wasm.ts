import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

class Wasm implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(4096);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeLoad = false;
	private activeRun = false;
	private readonly workerSession = new WorkerSession({
		label: 'WASM',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.activeRun = false;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	load(
		_runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		if (this.activeLoad || this.activeRun) {
			return Promise.reject(
				new BusyError('WASM runtime already has an active operation', {
					runtimeId: 'WASM',
					phase: this.activeLoad ? 'startup' : 'execute'
				})
			);
		}
		this.activeLoad = true;
		return this.workerSession
			.load(async (resolve, reject) => {
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				if (!this.worker) {
					this.worker = new (
						await import('$lib/playground/worker/wasm?worker')
					).default();
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
						log: _log
					});
				} else {
					progress?.set?.(1);
					resolve();
				}
			})
			.finally(() => {
				this.activeLoad = false;
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
		if (this.activeLoad || this.activeRun) {
			return Promise.reject(
				new BusyError('WASM runtime already has an active operation', {
					runtimeId: 'WASM',
					phase: this.activeLoad ? 'startup' : 'execute'
				})
			);
		}
		const worker = this.worker;
		if (!worker) return Promise.reject('Worker not loaded');
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		try {
			const limits = resolveExecutionLimits(options.limits);
			workspace = validateExecutionWorkspace(
				code,
				options.workspaceFiles ?? [],
				options.activePath ?? 'main.wasm',
				{
					...options.workspaceLimits,
					maxFileBytes: Math.min(
						options.workspaceLimits?.maxFileBytes ??
							DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
						limits.maxWorkspaceBytes
					),
					maxTotalBytes: Math.min(
						options.workspaceLimits?.maxTotalBytes ??
							DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
						limits.maxWorkspaceBytes
					)
				}
			);
		} catch (error) {
			return Promise.reject(error);
		}
		this.activeRun = true;
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			const operation = this.workerSession.beginRun(worker, reject);
			const handler = (event: Event & { data: any }) => {
				if (this.worker !== worker || worker.onmessage !== handler || _uid !== this.uid) {
					if (worker.onmessage === handler) worker.onmessage = null;
					return;
				}
				const { output, results, error, buffer, diagnostic, progress } = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				reportWorkerProgress(_prog, progress);
				if (output) this.output?.(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (results) {
					this.activeRun = false;
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					resolve(results as string);
				}
				if (error) {
					this.activeRun = false;
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
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
					args: _args,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					log: _log
				});
			} catch (error) {
				this.activeRun = false;
				this.workerSession.terminate(error);
			}
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.activeRun = false;
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
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default Wasm;
