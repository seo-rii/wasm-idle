import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_D_MODULE_URL: ''
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
							percent: 25
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.d',
							lineNumber: 2,
							columnNumber: 5,
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

vi.mock('$lib/playground/worker/d?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import D from './d';

describe('D sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_D_MODULE_URL = '/wasm-d/index.js';
		suppressAutoLoadAck = false;
	});

	it('loads the D worker and forwards diagnostics plus run output', async () => {
		const sandbox = new D();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const values: number[] = [];
		const code = `import std.stdio;

void main() {
    writeln("hi");
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
		await expect(sandbox.run(code, false, true, undefined, ['one', 'two'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-d\/index\.js$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: [],
				fileName: 'main.d',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['one', 'two'],
				fileName: 'main.d',
				log: true
			})
		);
		expect(outputs).toContain('hi\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.d',
				lineNumber: 2,
				columnNumber: 5,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
		expect(values).toEqual([0.25]);
	});

	it('rejects an overlapping D run without disturbing the active execution', async () => {
		const sandbox = new D();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);

		const firstRun = sandbox.run('void main() {}', false);
		const firstHandler = worker.onmessage;
		await expect(sandbox.run('void main() {}', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'D'
		});

		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(firstHandler);
		expect(worker.terminate).not.toHaveBeenCalled();

		firstHandler?.({ data: { output: 'first\n', results: true } } as MessageEvent<any>);
		await expect(firstRun).resolves.toBe(true);
		expect(outputs).toEqual(['first\n']);

		worker.postMessage.mockImplementationOnce(() => {
			queueMicrotask(() => {
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});
		await expect(sandbox.run('void main() {}', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
	});

	it('rejects a pre-aborted D run without changing worker state', async () => {
		const sandbox = new D();
		const worker = new MockWorker();
		const originalHandler = vi.fn();
		worker.onmessage = originalHandler;
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const reason = new Error('D pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.run('void main() {}', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.onmessage).toBe(originalHandler);
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('void main() {}', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledOnce();
	});

	it('aborts an active D run with its exact reason and permits a clean retry', async () => {
		const sandbox = new D();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		const progress = { set: vi.fn() };
		sandbox.output = (chunk: string) => outputs.push(chunk);
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('D active abort');

		const running = sandbox.run('void main() {}', false, true, progress, [], {
			signal: controller.signal
		});
		const lateHandler = worker.onmessage;
		controller.abort(reason);

		await expect(running).rejects.toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		lateHandler?.({
			data: { output: 'late\n', progress: 0.8, results: true }
		} as MessageEvent<any>);
		expect(outputs).toEqual([]);
		expect(progress.set).not.toHaveBeenCalled();

		await sandbox.load('/absproxy/5173');
		const retryWorker = workerInstances.at(-1)!;
		const settledController = new AbortController();
		await expect(
			sandbox.run('void main() {}', false, true, undefined, [], {
				signal: settledController.signal
			})
		).resolves.toBe(true);
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('rejects overlapping D startup operations without superseding readiness', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new D();
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'D'
		});
		await expect(sandbox.run('void main() {}', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'D'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(loadHandler);

		loadHandler?.({ data: { load: true } } as MessageEvent<any>);
		await expect(loading).resolves.toBeUndefined();
		await expect(sandbox.run('void main() {}', false)).resolves.toBe(true);
	});

	it('releases D run activity after synchronous dispatch failure', async () => {
		const sandbox = new D();
		const worker = new MockWorker();
		const dispatchFailure = new Error('D dispatch failed');
		worker.postMessage.mockImplementationOnce(() => {
			throw dispatchFailure;
		});
		sandbox.worker = worker as unknown as Worker;

		await expect(sandbox.run('void main() {}', false)).rejects.toBe(dispatchFailure);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('void main() {}', false)).resolves.toBe(true);
	});

	it('rejects load when no D module url is configured', async () => {
		publicEnv.PUBLIC_WASM_D_MODULE_URL = '';
		const sandbox = new D();

		await expect(sandbox.load({})).rejects.toContain('D runtime is not configured');
	});

	it('rejects load when the D worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new D();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/d.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'D worker script error: worker script error (/worker/d.js:88:24)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new D();
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

		await expect(sandbox.run(`void main() {}`, false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});
});
