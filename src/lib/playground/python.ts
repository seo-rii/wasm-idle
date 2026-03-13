import type {
	DebugCommand,
	DebugSessionEvent,
	SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';

class Python implements Sandbox {
	ts = Date.now();
	output: any = null;
	ondebug?: (event: DebugSessionEvent) => void;
	image?: (data: { mime: string; b64: string; ts?: number }) => void;
	worker?: Worker = <any>null;
	buffer = new SharedArrayBuffer(1024);
	debugBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
	interruptBuffer = new SharedArrayBuffer(1);
	internalBuffer: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;

	load(
		path: string,
		code = '',
		log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {}
	) {
		return new Promise<void>(async (resolve) => {
			this.internalBuffer = [];
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/python?worker')).default();
				this.worker.onmessage = () => resolve();
				this.worker.postMessage({ load: true, path, log, code });
			} else {
				this.worker.postMessage({ log });
				resolve();
			}
		});
	}

	write(input: string) {
		this.internalBuffer.push(input);
	}

	_write(input: string) {
		let strInfo = input,
			padding = 4 - (strInfo.length % 4);
		while (strInfo.length % 4 !== 3) strInfo += ' ';
		strInfo += padding;
		const buffer = new Int32Array(this.buffer);
		const enc = new TextEncoder();
		const data = enc.encode(strInfo);
		buffer.set(new Int32Array(data.buffer.slice(data.byteOffset), 0));
	}

	eof() {}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>(async (resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const interrupt = new Uint8Array(this.interruptBuffer),
				_uid = ++this.uid;
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
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
				if (buffer && this.internalBuffer.length)
					this._write(this.internalBuffer.splice(0, 1)[0]);
				if (type === 'img' && payload) this.image?.(payload);
				if (output) this.output(output);
				if (debugEvent) this.ondebug?.(debugEvent);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.ondebug?.({ type: 'stop' });
					resolve(results as string);
				}
				if (log) console.log(log);
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					reject(error);
				}
			};
			interrupt[0] = 0;
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				debugBuffer: this.debugBuffer,
				interrupt: this.interruptBuffer,
				context: {},
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

	terminate() {
		new Uint8Array(this.interruptBuffer)[0] = 2;
		const control = new Int32Array(this.debugBuffer);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
	}

	async clear() {
		this.terminate();
		this.internalBuffer = [];
		if (this.worker) this.worker.onmessage = null;
		const buffer = new Int32Array(this.buffer);
		buffer.fill(0);
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

export default Python;
