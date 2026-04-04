import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_GO_COMPILER_URL: ''
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
						progress: {
							stage: 'compile',
							percent: 45
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.go',
							lineNumber: 1,
							columnNumber: 1,
							severity: 'warning',
							message: 'demo warning'
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

vi.mock('$lib/playground/worker/go?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Go from './go';

describe('Go sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_GO_COMPILER_URL = '/wasm-go/index.js';
		suppressAutoLoadAck = false;
	});

	it('loads the go worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Go();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const values: number[] = [];
		const code = `package main

import "fmt"

func main() {
	fmt.Println("hi")
}`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run(code, true, true, {
				set(value: number) {
					values.push(value);
				}
			})
		).resolves.toBe(true);
		await expect(sandbox.run(code, false, true, undefined, ['one', 'two'])).resolves.toBe(
			true
		);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				compilerUrl: expect.stringMatching(/\/wasm-go\/index\.js$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: [],
				target: 'wasip1/wasm',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['one', 'two'],
				target: 'wasip1/wasm',
				log: true
			})
		);
		expect(outputs).toContain('hi\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.go',
				lineNumber: 1,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
		expect(values).toEqual([0.45]);
	});

	it('rejects load when no go compiler url is configured', async () => {
		publicEnv.PUBLIC_WASM_GO_COMPILER_URL = '';
		const sandbox = new Go();

		await expect(sandbox.load('/absproxy/5173')).rejects.toContain(
			'Go runtime is not configured'
		);
	});

	it('rejects load when the go worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Go();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/go.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Go worker script error: worker script error (/worker/go.js:88:24)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Go();
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
				`package main

func main() {}`,
				false
			)
		).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});
});
