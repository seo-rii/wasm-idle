import type { Sandbox } from '$lib/playground/sandbox';
import type { Writable } from 'svelte/store';

class Clang implements Sandbox {
	ts = Date.now();
	output: any = null;
	worker?: Worker = <any>null;
	buffer = new SharedArrayBuffer(1024);
	interruptBuffer = new SharedArrayBuffer(1);
	internalBuffer: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	log = true;
	exit = true;

	load(path: string, code = '', log = true, args = []) {
		return new Promise<void>(async (resolve) => {
			this.log = log;
			this.internalBuffer = [];
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

	run(code: string, prepare: boolean, log = this.log, prog?: Writable<number>, args = []) {
		this.exit = false;
		return new Promise<string>(async (resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const interrupt = new Uint8Array(this.interruptBuffer),
				_uid = ++this.uid;
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { id, output, results, log, error, buffer, progress } = event.data;
				if (buffer && this.internalBuffer.length)
					this._write(this.internalBuffer.splice(0, 1)[0]);
				if (output) this.output(output);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					resolve(results as string);
				}
				if (log) console.log(log);
				if (error) {
					this.elapse = Date.now() - this.begin;
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
				interrupt: this.interruptBuffer,
				context: {},
				log,
				args
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
		if (!this.exit) {
			this.worker?.terminate?.();
			delete this.worker;
			this.exit = true;
		}
	}
}

export default Clang;
