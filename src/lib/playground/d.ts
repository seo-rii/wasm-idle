import { resolveDModuleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { BusyError } from '@wasm-idle/core';
import {
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
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

class D implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private loading = false;
	private activeRunCleanup: (() => void) | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'D',
		onDispose: (worker) => {
			this.activeRunCleanup?.();
			this.activeRunCleanup = null;
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
		if (this.loading || !this.exit) {
			return Promise.reject(
				new BusyError('D runtime already has an active operation', { runtimeId: 'D' })
			);
		}
		this.loading = true;
		return this.workerSession
			.load(async (resolve, reject) => {
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextModuleUrl = resolveDModuleUrl(runtimeAssets, currentUrl);
				if (!nextModuleUrl) {
					return reject(
						'D runtime is not configured. Set PUBLIC_WASM_D_MODULE_URL or runtimeAssets.d.moduleUrl.'
					);
				}
				const needsWorkerReset = !this.worker || this.moduleUrl !== nextModuleUrl;
				this.moduleUrl = nextModuleUrl;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
				if (!this.worker) {
					this.worker = new (await import('$lib/playground/worker/d?worker')).default();
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
						moduleUrl: this.moduleUrl,
						log: _log
					});
				} else {
					progress?.set?.(1);
					resolve();
				}
			})
			.finally(() => {
				this.loading = false;
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
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (this.loading || !this.exit) {
			return Promise.reject(
				new BusyError('D runtime already has an active operation', { runtimeId: 'D' })
			);
		}
		if (!this.worker) return Promise.reject('Worker not loaded');
		const worker = this.worker;
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException('D execution aborted', 'AbortError')
			);
		}
		let programArgs: string[];
		try {
			programArgs = resolveSandboxExecutionArgs('D', args, options).programArgs;
		} catch (error) {
			return Promise.reject(error);
		}
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			const operation = this.workerSession.beginRun(worker, reject);
			let onAbort: (() => void) | undefined;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (signal && onAbort) {
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Cleanup must not replace the execution result.
					}
				}
				if (this.activeRunCleanup === cleanup) this.activeRunCleanup = null;
			};
			const handler = (event: Event & { data: any }) => {
				if (this.worker !== worker || worker.onmessage !== handler || _uid !== this.uid) {
					cleanup();
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
					cleanup();
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					resolve(results as string);
				}
				if (error) {
					cleanup();
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					reject(error);
				}
			};
			onAbort = signal
				? () => {
						if (
							this.worker !== worker ||
							worker.onmessage !== handler ||
							_uid !== this.uid
						) {
							cleanup();
							return;
						}
						this.terminate(
							signal.reason ?? new DOMException('D execution aborted', 'AbortError')
						);
					}
				: undefined;
			this.activeRunCleanup = cleanup;
			worker.onmessage = handler;
			if (signal && onAbort) {
				signal.addEventListener('abort', onAbort, { once: true });
				if (signal.aborted) onAbort();
			}
			if (this.worker !== worker || worker.onmessage !== handler || _uid !== this.uid) return;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					args: programArgs,
					stdin: options.stdin,
					fileName: options.activePath || 'main.d',
					log: _log
				});
			} catch (error) {
				cleanup();
				this.workerSession.terminate(error);
			}
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const cleanup = this.activeRunCleanup;
		this.activeRunCleanup = null;
		cleanup?.();
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
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default D;
