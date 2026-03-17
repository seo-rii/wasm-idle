import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { resolveTeaVmBaseUrl } from '$lib/playground/teavmConfig';

class Java implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = new SharedArrayBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	baseUrl = '';
	activeReject: ((reason: string) => void) | null = null;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;

	load(
		path: string,
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {}
	) {
		return new Promise<void>(async (resolve, reject) => {
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			this.baseUrl = resolveTeaVmBaseUrl(
				path,
				typeof window !== 'undefined' ? window.location.href : ''
			);
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/java?worker')).default();
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (event.data?.load) resolve();
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({ load: true, baseUrl: this.baseUrl });
			} else {
				resolve();
			}
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
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const { programArgs } = resolveSandboxExecutionArgs('JAVA', args, options);
			const _uid = ++this.uid;
			this.activeReject = reject;
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { output, results, error, buffer, diagnostic } = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				if (output) this.output(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.activeReject = null;
					resolve(results as string);
				}
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.activeReject = null;
					reject(error);
				}
			};
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				args: programArgs,
				stdin: options.stdin || '',
				baseUrl: this.baseUrl
			});
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.activeReject?.('Process terminated');
		this.activeReject = null;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.worker?.terminate?.();
		delete this.worker;
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

export default Java;
