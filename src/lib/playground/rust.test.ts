import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_RUST_COMPILER_URL: ''
	}
}));
let suppressAutoLoadAck = false;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			if (suppressAutoLoadAck) return;
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		if (message.prepare) {
			queueMicrotask(() => {
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.rs',
							lineNumber: 1,
							columnNumber: 4,
							severity: 'warning',
							message: 'unused mut'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true, buffer: true } } as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'hi\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/rust?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Rust from './rust';

describe('Rust sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_RUST_COMPILER_URL = '/wasm-rust/index.js';
		suppressAutoLoadAck = false;
	});

	it('loads the rust worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Rust();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = `fn main() {
    println!("hi");
}`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(sandbox.run(code, false, true, undefined, ['one', 'two'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				compilerUrl: expect.stringMatching(/\/wasm-rust\/index\.js$/),
				path: '/absproxy/5173'
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: [],
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['one', 'two'],
				log: true
			})
		);
		expect(outputs).toContain('hi\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.rs',
				lineNumber: 1,
				columnNumber: 4,
				severity: 'warning',
				message: 'unused mut'
			}
		]);
	});

	it('rejects load when no rust compiler url is configured', async () => {
		publicEnv.PUBLIC_WASM_RUST_COMPILER_URL = '';
		const sandbox = new Rust();

		await expect(sandbox.load('/absproxy/5173')).rejects.toContain(
			'Rust runtime is not configured'
		);
	});

	it('rejects load when the rust worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Rust();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/rust.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Rust worker script error: worker script error (/worker/rust.js:88:24)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Rust();
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.write('42\n');
				worker.onmessage?.({
					data: {
						buffer: true,
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await expect(
			sandbox.run(
				`fn main() {
    println!("hi");
}`,
				false
			)
		).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});
});
