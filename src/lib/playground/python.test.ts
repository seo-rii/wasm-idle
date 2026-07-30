import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushQueuedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			queueMicrotask(() => {
				this.onmessage?.({
					data: { progress: { percent: 35, stage: 'Initializing Pyodide' } }
				} as MessageEvent<any>);
				this.onmessage?.({ data: { load: true } } as MessageEvent<any>);
			});
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

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

import Python from './python';

describe('Python sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('passes complex Python source with multiple assignment and mutual recursion to the worker', async () => {
		const sandbox = new Python();
		const outputs: string[] = [];
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const code = `def is_even(value):
    return True if value == 0 else is_odd(value - 1)

def is_odd(value):
    return False if value == 0 else is_even(value - 1)

left = right = 5
print(f"{left + right}:{is_even(left + right)}")`;

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/');
		await expect(
			sandbox.run(code, false, true, undefined, [], { signal: controller.signal })
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				prepare: false
			})
		);
		expect(outputs).toContain('10:True\n');
		const abortRegistrations = addEventListener.mock.calls.filter(
			(registration: unknown[]) => registration[0] === 'abort'
		);
		for (const registration of abortRegistrations) {
			expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
		}
		controller.abort(new Error('late successful-run abort'));
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('forwards separate execution and debug paths to the worker', async () => {
		const sandbox = new Python();
		sandbox.output = () => {};

		await sandbox.load('/');
		await expect(
			sandbox.run('print("wrapped")', false, false, undefined, [], {
				debug: true,
				activePath: 'Main.py',
				debugPath: 'User.py',
				workspaceFiles: [{ path: 'User.py', content: 'print("user")' }]
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code: 'print("wrapped")',
				debug: true,
				activePath: 'Main.py',
				debugPath: 'User.py',
				workspaceFiles: [{ path: 'User.py', content: 'print("user")' }]
			})
		);
	});

	it('forwards Python runtime errors', async () => {
		const sandbox = new Python();
		const worker = new MockWorker();
		const events: any[] = [];
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

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
				false,
				true,
				undefined,
				[],
				{ signal: controller.signal }
			)
		).rejects.toContain('ZeroDivisionError');
		expect(events).toEqual([{ type: 'stop' }]);
		const abortRegistrations = addEventListener.mock.calls.filter(
			(registration: unknown[]) => registration[0] === 'abort'
		);
		for (const registration of abortRegistrations) {
			expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
		}
		controller.abort(new Error('late failed-run abort'));
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('aliases kill to terminate for Python sessions', () => {
		const sandbox = new Python();
		sandbox.terminate = vi.fn();

		sandbox.kill?.();
		expect(sandbox.terminate).toHaveBeenCalledTimes(1);
	});

	it('rejects the active Python run when kill terminates the worker', async () => {
		const sandbox = new Python();

		await sandbox.load('/');
		const worker = workerInstances[workerInstances.length - 1];
		worker.postMessage.mockImplementationOnce(() => {});
		const running = sandbox.run('print("hi")', false);
		sandbox.kill();

		await expect(running).rejects.toBe('Process terminated');
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it('aborts an active non-debug Python run and ignores late worker messages', async () => {
		const sandbox = new Python();
		const outputs: string[] = [];
		const controller = new AbortController();
		const reason = new Error('stop active Python execution');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/');
		const worker = workerInstances[workerInstances.length - 1];
		worker.postMessage.mockImplementationOnce(() => {});
		const running = sandbox.run('print("late")', false, true, undefined, [], {
			signal: controller.signal
		});
		const lateHandler = worker.onmessage;
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			controller.abort(reason);
			const outcome = await Promise.race([
				running.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, reason: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome).toEqual({ status: 'rejected', reason });
			expect(worker.terminate).toHaveBeenCalledOnce();
			const abortRegistrations = addEventListener.mock.calls.filter(
				(registration: unknown[]) => registration[0] === 'abort'
			);
			for (const registration of abortRegistrations) {
				expect(removeEventListener).toHaveBeenCalledWith('abort', registration[1]);
			}

			lateHandler?.({
				data: { output: 'late output', results: true }
			} as MessageEvent<any>);
			expect(outputs).toEqual([]);

			await sandbox.load('/');
			await expect(sandbox.run('print("retry")', false)).resolves.toBe(true);
			expect(workerInstances).toHaveLength(2);
		} finally {
			if (timeout) clearTimeout(timeout);
			sandbox.kill();
			await running.catch(() => {});
		}
	});

	it('does not dispatch a pre-aborted non-debug Python run', async () => {
		const sandbox = new Python();
		const controller = new AbortController();
		const reason = new Error('stop before Python execution');
		sandbox.output = () => {};
		controller.abort(reason);

		await sandbox.load('/');
		const worker = workerInstances[workerInstances.length - 1];
		const callsBeforeRun = worker.postMessage.mock.calls.length;

		await expect(
			sandbox.run('print("never")', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(worker.postMessage).toHaveBeenCalledTimes(callsBeforeRun);
		expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('evaluates watch expressions through the worker debug buffers', async () => {
		const sandbox = new Python();
		sandbox.worker = {} as Worker;

		setTimeout(() => {
			flushQueuedStdin(['3'], sandbox.watchResultBuffer);
		}, 0);

		await expect(sandbox.debugEvaluate?.('1 + 2')).resolves.toBe('3');
	});

	it('publishes live breakpoint updates through the Python debug buffer', async () => {
		const sandbox = new Python();
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
		});
		const running = sandbox.run('print("hi")', false, true, undefined, [], {
			debug: true,
			breakpoints: [8, 3]
		});
		const control = new Int32Array(sandbox.debugBuffer);

		expect(runMessage.debugBuffer).toBe(sandbox.debugBuffer);
		expect(Atomics.load(control, 3)).toBe(2);
		expect([Atomics.load(control, 4), Atomics.load(control, 5)]).toEqual([3, 8]);
		const initialVersion = Atomics.load(control, 2);

		sandbox.setBreakpoints([12, 5, 12]);
		expect(Atomics.load(control, 2)).toBe(initialVersion + 1);
		expect(Atomics.load(control, 3)).toBe(2);
		expect([Atomics.load(control, 4), Atomics.load(control, 5)]).toEqual([5, 12]);

		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(running).resolves.toBe(true);
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

	it('forwards structured Pyodide progress with its stage label', async () => {
		const sandbox = new Python();
		const progress = { set: vi.fn() };

		await sandbox.load('/', '', true, [], {}, progress);

		expect(progress.set).toHaveBeenCalledWith(0.35, 'Initializing Pyodide');
	});
});
