import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushQueuedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: '10:True\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/python?worker', () => ({
	default: MockWorker
}));

import Python from './python';

describe('Python sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('passes complex Python source with multiple assignment and mutual recursion to the worker', async () => {
		const sandbox = new Python();
		const outputs: string[] = [];
		const code = `def is_even(value):
    return True if value == 0 else is_odd(value - 1)

def is_odd(value):
    return False if value == 0 else is_even(value - 1)

left = right = 5
print(f"{left + right}:{is_even(left + right)}")`;

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/');
		await expect(sandbox.run(code, false)).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				prepare: false
			})
		);
		expect(outputs).toContain('10:True\n');
	});

	it('forwards Python runtime errors', async () => {
		const sandbox = new Python();
		const worker = new MockWorker();
		const events: any[] = [];

		sandbox.ondebug = (event) => events.push(event);
		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce(() =>
			queueMicrotask(() =>
				worker.onmessage?.({
					data: { error: 'ZeroDivisionError: division by zero' }
				} as MessageEvent<any>)
			)
		);

		await expect(
			sandbox.run(
				`left = right = 10
print((left + right) // (left - left))`,
				false
			)
		).rejects.toContain('ZeroDivisionError');
		expect(events).toEqual([{ type: 'stop' }]);
	});

	it('aliases kill to terminate for Python sessions', () => {
		const sandbox = new Python();
		sandbox.terminate = vi.fn();

		sandbox.kill?.();
		expect(sandbox.terminate).toHaveBeenCalledTimes(1);
	});

	it('evaluates watch expressions through the worker debug buffers', async () => {
		const sandbox = new Python();
		sandbox.worker = {} as Worker;

		setTimeout(() => {
			flushQueuedStdin(['3'], sandbox.watchResultBuffer);
		}, 0);

		await expect(sandbox.debugEvaluate?.('1 + 2')).resolves.toBe('3');
	});

	it('configures a custom runtime asset loader bridge for Pyodide assets', async () => {
		const sandbox = new Python();
		const loader = vi.fn().mockResolvedValue({
			data: new Uint8Array([1, 2, 3]),
			mimeType: 'application/javascript'
		});

		await sandbox.load({ python: { loader } });

		const worker = workerInstances[workerInstances.length - 1];
		worker.onmessage?.({
			data: {
				assetRequest: {
					id: 7,
					asset: 'pyodide.asm.js'
				}
			}
		} as MessageEvent<any>);
		await vi.waitFor(() => {
			expect(worker.postMessage).toHaveBeenCalledTimes(2);
		});

		expect(worker.postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				assets: expect.objectContaining({
					baseUrl: 'https://wasm-idle.invalid/python/',
					useAssetBridge: true
				})
			})
		);
		expect(loader).toHaveBeenCalledWith(
			expect.objectContaining({
				runtime: 'python',
				asset: 'pyodide.asm.js',
				reportProgress: expect.any(Function)
			})
		);
		expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
			assetResponse: {
				id: 7,
				ok: true,
				mimeType: 'application/javascript'
			}
		});
	});
});
