import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushQueuedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
let autoResolveLoad = true;
let autoResolveRun = true;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			queueMicrotask(() => {
				if (!autoResolveLoad) return;
				this.onmessage?.({
					data: { progress: { percent: 35, stage: 'Initializing Pyodide' } }
				} as MessageEvent<any>);
				this.onmessage?.({ data: { load: true } } as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() => {
			if (!autoResolveRun) return;
			this.onmessage?.({
				data: { output: '10:True\n', results: true, buffer: true }
			} as MessageEvent<any>);
		});
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}

	emit(data: Record<string, unknown>) {
		this.onmessage?.({ data } as MessageEvent<any>);
	}

	resolveLoad() {
		this.emit({ load: true });
	}

	resolveRun(results: boolean | string = true) {
		this.emit({ results });
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
		autoResolveLoad = true;
		autoResolveRun = true;
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

	it('rejects load and run overlap while Python startup retains ownership', async () => {
		autoResolveLoad = false;
		const sandbox = new Python();
		const loading = sandbox.load('/');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const activeHandler = worker.onmessage;

		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'PYTHON3'
		});
		await expect(sandbox.run('print("too early")', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'PYTHON3'
		});
		expect(worker.onmessage).toBe(activeHandler);
		expect(worker.postMessage).toHaveBeenCalledOnce();

		worker.resolveLoad();
		await expect(loading).resolves.toBeUndefined();
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

	it('rejects an overlapping Python run without replacing the active handler', async () => {
		const sandbox = new Python();
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/');
		const worker = workerInstances[workerInstances.length - 1];
		worker.postMessage.mockImplementationOnce(() => {});
		const firstRun = sandbox.run('print("first")', false);
		const activeHandler = worker.onmessage;
		const callsBeforeOverlap = worker.postMessage.mock.calls.length;
		const secondRun = sandbox.run('print("second")', false);

		try {
			await expect(secondRun).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'PYTHON3',
				recoverable: true
			});
			expect(worker.postMessage).toHaveBeenCalledTimes(callsBeforeOverlap);
			expect(worker.onmessage).toBe(activeHandler);

			worker.emit({ output: 'first output', results: true });
			await expect(firstRun).resolves.toBe(true);
			expect(outputs).toEqual(['first output']);

			await expect(sandbox.run('print("third")', false)).resolves.toBe(true);
			expect(outputs).toEqual(['first output', '10:True\n']);
		} finally {
			sandbox.kill();
			await Promise.allSettled([firstRun, secondRun]);
		}
	});

	it('rejects debug-run and load overlap without replacing the active worker handler', async () => {
		autoResolveRun = false;
		const sandbox = new Python();
		await sandbox.load('/');
		const worker = workerInstances[0];
		const running = sandbox.run('print("first")', false, true, undefined, [], {
			debug: true
		});
		const activeHandler = worker.onmessage;
		const callsBeforeOverlap = worker.postMessage.mock.calls.length;

		await expect(
			sandbox.run('print("second")', false, true, undefined, [], { debug: true })
		).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'PYTHON3'
		});
		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'PYTHON3'
		});
		expect(worker.onmessage).toBe(activeHandler);
		expect(worker.postMessage).toHaveBeenCalledTimes(callsBeforeOverlap);

		worker.resolveRun('first result');
		await expect(running).resolves.toBe('first result');
	});

	it('rejects a pre-aborted startup before constructing a worker', async () => {
		const sandbox = new Python();
		const controller = new AbortController();
		const reason = new Error('stop Python startup before dispatch');
		controller.abort(reason);

		await expect(sandbox.load('/', '', true, [], { signal: controller.signal })).rejects.toBe(
			reason
		);
		expect(workerInstances).toHaveLength(0);
	});

	it('applies the asset byte limit and abort signal to active Python startup assets', async () => {
		autoResolveLoad = false;
		const sandbox = new Python();
		const controller = new AbortController();
		const reason = new Error('stop active Python asset load');
		let loaderSignal: AbortSignal | undefined;
		const loader = vi.fn(({ signal }: { signal?: AbortSignal }) => {
			loaderSignal = signal;
			return new Promise<Uint8Array>(() => undefined);
		});
		const loading = sandbox.load({ python: { loader } }, '', true, [], {
			signal: controller.signal,
			limits: { maxAssetBytes: 1234 }
		});
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		expect(worker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				load: true,
				assets: expect.objectContaining({ maxAssetBytes: 1234 })
			})
		);

		worker.emit({ assetRequest: { id: 81, asset: 'pyodide.mjs' } });
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
		controller.abort(reason);

		await expect(loading).rejects.toBe(reason);
		expect(loaderSignal?.aborted).toBe(true);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(worker.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ assetResponse: expect.objectContaining({ id: 81 }) }),
			expect.anything()
		);
	});

	it('forwards the caller asset ceiling to direct worker asset fetches', async () => {
		const sandbox = new Python();

		await sandbox.load(
			{ python: { baseUrl: 'https://cdn.example.test/pyodide/' } },
			'',
			true,
			[],
			{ limits: { maxAssetBytes: 4096 } }
		);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				assets: {
					baseUrl: 'https://cdn.example.test/pyodide/',
					maxAssetBytes: 4096,
					useAssetBridge: false
				}
			})
		);
	});

	it('replaces a direct worker when the caller asset ceiling changes', async () => {
		const sandbox = new Python();
		const runtimeAssets = {
			python: { baseUrl: 'https://cdn.example.test/pyodide/' }
		};

		await sandbox.load(runtimeAssets, '', true, [], {
			limits: { maxAssetBytes: 8192 }
		});
		const firstWorker = workerInstances[0];
		await sandbox.load(runtimeAssets, '', true, [], {
			limits: { maxAssetBytes: 4096 }
		});

		expect(workerInstances).toHaveLength(2);
		expect(firstWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances[1].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				assets: {
					baseUrl: 'https://cdn.example.test/pyodide/',
					maxAssetBytes: 4096,
					useAssetBridge: false
				}
			})
		);
	});

	it('rejects a throwing run callback, retires the worker, and permits retry', async () => {
		autoResolveRun = false;
		const sandbox = new Python();
		const callbackError = new Error('Python output callback failed');
		let throwOutput = true;
		sandbox.output = vi.fn(() => {
			if (throwOutput) throw callbackError;
		});
		await sandbox.load('/');
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('print("first")', false);

		retiredWorker.emit({ output: 'combined output', results: true });
		await expect(running).rejects.toBe(callbackError);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();

		throwOutput = false;
		autoResolveRun = true;
		await sandbox.load('/');
		await expect(sandbox.run('print("retry")', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('settles a throwing startup progress callback and permits retry', async () => {
		const sandbox = new Python();
		const callbackError = new Error('Python startup progress failed');
		let throwProgress = true;
		const progress = {
			set: vi.fn(() => {
				if (throwProgress) throw callbackError;
			})
		};

		await expect(sandbox.load('/', '', true, [], {}, progress)).rejects.toBe(callbackError);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();

		throwProgress = false;
		await expect(sandbox.load('/', '', true, [], {}, progress)).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
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
