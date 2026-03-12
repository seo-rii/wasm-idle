import type { Sandbox } from '$lib/playground/sandbox';
import type { SandboxExecutionOptions } from '$lib/playground/options';

class Python implements Sandbox {
	ts = Date.now();
	output: any = null;
	image?: (data: { mime: string; b64: string; ts?: number }) => void;
	worker: Worker = <any>null;
	buffer = new SharedArrayBuffer(1024);
	interruptBuffer = new SharedArrayBuffer(1);
	internalBuffer: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;

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
		_options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		return new Promise<boolean | string>(async (resolve, reject) => {
			const interrupt = new Uint8Array(this.interruptBuffer),
				_uid = ++this.uid;
			const handler = (event: Event & { data: any }) => {
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { id, output, results, log, error, buffer, type, data: payload } = event.data;
				if (buffer && this.internalBuffer.length)
					this._write(this.internalBuffer.splice(0, 1)[0]);
				if (type === 'img' && payload) this.image?.(payload);
				if (output) this.output(output);
				if (results) {
					this.elapse = Date.now() - this.begin;
					resolve(results as string);
				}
				if (log) console.log(log);
				if (error) {
					this.elapse = Date.now() - this.begin;
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
				interrupt: this.interruptBuffer,
				context: {}
			});
		});
	}

	terminate() {
		new Uint8Array(this.interruptBuffer)[0] = 2;
	}

	async clear() {
		this.terminate();
		this.internalBuffer = [];
		if (this.worker) this.worker.onmessage = null;
		const buffer = new Int32Array(this.buffer);
		buffer.fill(0);
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

export default Python;
