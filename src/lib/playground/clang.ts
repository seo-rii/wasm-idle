import type {
	DebugCommand,
	DebugSessionEvent,
	SandboxExecutionOptions
} from '$lib/playground/options';
import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { resolveSandboxExecutionArgs } from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';
import {
	bufferedSequence,
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin,
	waitForBufferedSequenceChange
} from '$lib/playground/stdinBuffer';
import type { Writable } from 'svelte/store';

const debugBreakpointBufferInts = 1028;

class Clang implements Sandbox {
	language: 'C' | 'CPP';
	ts = Date.now();
	output: any = null;
	ondebug?: (event: DebugSessionEvent) => void;
	worker?: Worker = <any>null;
	buffer = new SharedArrayBuffer(1024);
	debugBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * debugBreakpointBufferInts);
	watchBuffer = new SharedArrayBuffer(1024);
	watchResultBuffer = new SharedArrayBuffer(1024);
	interruptBuffer = new SharedArrayBuffer(1);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	log = true;
	waitingForInput = false;
	pendingEof = false;
	exit = true;

	constructor(language: 'C' | 'CPP') {
		this.language = language;
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		code = '',
		log = true,
		args: string[] = [],
		_options: SandboxExecutionOptions = {},
		_progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return new Promise<void>(async (resolve) => {
			this.log = log;
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const path =
				typeof runtimeAssets === 'string' ? runtimeAssets : runtimeAssets?.rootUrl || '';
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/clang?worker')).default();
				this.worker.onmessage = () => resolve();
				this.worker.postMessage({ load: true, path, log, code, args });
			} else {
				this.worker.postMessage({ log });
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
		log = this.log,
		prog?: Writable<number> | { set?: (value: number) => void },
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>(async (resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const { compileArgs, programArgs } = resolveSandboxExecutionArgs(
				this.language,
				args,
				options
			);
			this.setBreakpoints(options.debug ? [...(options.breakpoints || [])] : []);
			const interrupt = new Uint8Array(this.interruptBuffer),
				_uid = ++this.uid;
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { id, output, results, log, error, buffer, progress, debugEvent } =
					event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				if (output) this.output(output);
				if (debugEvent) this.ondebug?.(debugEvent);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.ondebug?.({ type: 'stop' });
					resolve(results as string);
				}
				if (log) console.log(log);
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.exit = true;
					this.ondebug?.({ type: 'stop' });
					reject(error);
				}
				if (progress) prog?.set?.(progress);
			};
			interrupt[0] = 0;
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker?.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				debugBuffer: this.debugBuffer,
				watchBuffer: this.watchBuffer,
				watchResultBuffer: this.watchResultBuffer,
				interrupt: this.interruptBuffer,
				context: {},
				log,
				language: this.language,
				compileArgs,
				programArgs,
				cppVersion: options.cppVersion,
				cVersion: options.cVersion,
				debug: !!options.debug,
				breakpoints: [...(options.breakpoints || [])],
				pauseOnEntry: !!options.pauseOnEntry
			});
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

	terminate() {
		this.pendingEof = false;
		new Uint8Array(this.interruptBuffer)[0] = 2;
		const control = new Int32Array(this.debugBuffer);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
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
			this.worker?.terminate?.();
			delete this.worker;
			this.exit = true;
		}
	}
}

export default Clang;
