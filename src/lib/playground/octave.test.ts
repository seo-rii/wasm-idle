import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_OCTAVE_BASE_URL: '',
		PUBLIC_WASM_OCTAVE_WORKER_URL: '',
		PUBLIC_WASM_OCTAVE_MANIFEST_URL: ''
	}
}));
let onPostMessage: ((worker: MockWorker, message: any) => void) | null = null;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (onPostMessage) {
			onPostMessage(this, message);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'factorial_plus_bonus=27\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor(public url: string) {
		workerInstances.push(this);
	}
}

vi.stubGlobal('Worker', MockWorker);

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Octave from './octave';

describe('Octave sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_OCTAVE_BASE_URL = '';
		publicEnv.PUBLIC_WASM_OCTAVE_WORKER_URL = '';
		publicEnv.PUBLIC_WASM_OCTAVE_MANIFEST_URL = '';
		onPostMessage = null;
	});

	it('loads Octave runtime urls and forwards run output to a classic worker', async () => {
		const sandbox = new Octave();
		const outputs: string[] = [];
		const code = 'printf("factorial_plus_bonus=27\\n");';

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			octave: {
				baseUrl: '/wasm-octave/runtime/',
				workerUrl: '/wasm-octave/runner-worker.js?v=test',
				manifestUrl: '/wasm-octave/runtime/runtime-manifest.v1.json?v=test'
			}
		});
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['5'], {
				activePath: 'main.m',
				stdin: '4\n'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].url).toBe(
			'http://localhost:3000/wasm-octave/runner-worker.js?v=test'
		);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/wasm-octave/runtime/',
				manifestUrl:
					'http://localhost:3000/wasm-octave/runtime/runtime-manifest.v1.json?v=test',
				code,
				args: ['5'],
				stdin: '4\n',
				activePath: 'main.m',
				log: true
			})
		);
		expect(outputs).toContain('factorial_plus_bonus=27\n');
	});

	it('normalizes a valid Octave workspace before worker dispatch', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run('disp(helper())', false, true, undefined, [], {
				activePath: 'nested\\main.m',
				workspaceFiles: [
					{ path: 'fixtures\\helper.m', content: 'function x = helper(); x = 1; end' }
				]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				activePath: 'nested/main.m',
				workspaceFiles: [
					{ path: 'fixtures/helper.m', content: 'function x = helper(); x = 1; end' }
				]
			})
		);
	});

	it.each([
		{
			name: 'traversal path',
			code: 'A',
			options: { activePath: '../main.m' },
			expected: { code: 'invalid-path', path: '../main.m' }
		},
		{
			name: 'absolute path',
			code: 'A',
			options: { activePath: '/tmp/main.m' },
			expected: { code: 'invalid-path', path: '/tmp/main.m' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: { activePath: 'bad\0.m' },
			expected: { code: 'invalid-path', path: 'bad\0.m' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'data/helper.m', content: 'A' },
					{ path: 'data/helper.m', content: 'B' }
				]
			},
			expected: { code: 'duplicate-path', path: 'data/helper.m' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'DATA/helper.m', content: 'A' },
					{ path: 'data/helper.m', content: 'B' }
				]
			},
			expected: { code: 'case-collision', path: 'data/helper.m' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'data/helper.m', content: 'B' }],
				workspaceLimits: { maxFiles: 1 }
			},
			expected: { code: 'file-count-limit', limit: 1, actual: 2 }
		},
		{
			name: 'per-file overflow clamped to execution limits',
			code: '12345',
			options: {
				limits: { maxWorkspaceBytes: 4 },
				workspaceLimits: { maxFileBytes: 100 }
			},
			expected: { code: 'file-size-limit', limit: 4, actual: 5 }
		},
		{
			name: 'aggregate overflow clamped to execution limits',
			code: '123',
			options: {
				limits: { maxWorkspaceBytes: 4 },
				workspaceFiles: [{ path: 'data/helper.m', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects an Octave workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Octave();
			await sandbox.load('/absproxy/5173');

			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(workerInstances).toHaveLength(0);
			expect(sandbox.uid).toBe(0);
			expect(sandbox.exit).toBe(true);

			await expect(sandbox.run('disp("retry")', false)).resolves.toBe(true);
		}
	);

	it('rejects overlapping Octave operations without replacing the active worker', async () => {
		const sandbox = new Octave();
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);
		await sandbox.load('/absproxy/5173');
		onPostMessage = () => undefined;

		const running = sandbox.run('disp("first")', false);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const handler = worker.onmessage;

		await expect(sandbox.run('disp("second")', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'OCTAVE'
		});
		await expect(sandbox.run('disp("prepare")', true)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'OCTAVE'
		});
		await expect(sandbox.load('/other/')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'OCTAVE'
		});

		expect(workerInstances).toHaveLength(1);
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();

		handler?.({ data: { output: 'first\n', results: true } } as MessageEvent<any>);
		await expect(running).resolves.toBe(true);
		expect(outputs).toEqual(['first\n']);
	});

	it('preserves a stdin-waiting Octave run when another operation is requested', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		const runtimeUrls = [sandbox.baseUrl, sandbox.workerUrl, sandbox.manifestUrl];

		const running = sandbox.run('n = str2double(fgetl(stdin));', false);
		await Promise.resolve();
		expect(workerInstances).toHaveLength(0);

		await expect(sandbox.run('disp("second")', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'OCTAVE'
		});
		await expect(sandbox.load('/other/')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'OCTAVE'
		});
		expect([sandbox.baseUrl, sandbox.workerUrl, sandbox.manifestUrl]).toEqual(runtimeUrls);

		sandbox.write('42\n');
		await expect(running).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
	});

	it('keeps Octave load ownership through a reentrant progress callback', async () => {
		const sandbox = new Octave();
		let nestedLoad: Promise<void> | undefined;
		let nestedRun: Promise<boolean | string> | undefined;

		await sandbox.load(
			{
				octave: {
					baseUrl: '/wasm-octave/runtime/',
					workerUrl: '/wasm-octave/runner-worker.js',
					manifestUrl: '/wasm-octave/runtime/manifest.json'
				}
			},
			'',
			true,
			[],
			{},
			{
				set() {
					nestedLoad = sandbox.load('/other/');
					nestedRun = sandbox.run('disp("nested")', false);
					void nestedLoad.catch(() => undefined);
					void nestedRun.catch(() => undefined);
				}
			}
		);

		await expect(nestedLoad).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'OCTAVE'
		});
		await expect(nestedRun).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'OCTAVE'
		});
		expect(sandbox.baseUrl).toBe('http://localhost:3000/wasm-octave/runtime/');
		expect(workerInstances).toHaveLength(0);
	});

	it('keeps Octave idle when runtime configuration is missing', async () => {
		const sandbox = new Octave();

		await expect(sandbox.run('disp("missing")', false)).rejects.toBe(
			'Octave runtime is not configured.'
		);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
		expect(workerInstances).toHaveLength(0);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('disp("ready")', false)).resolves.toBe(true);
	});

	it('releases Octave operation ownership after synchronous dispatch failure', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		const dispatchError = new Error('Octave dispatch failed');
		onPostMessage = () => {
			throw dispatchError;
		};

		await expect(sandbox.run('disp("fail")', false)).rejects.toBe(dispatchError);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		onPostMessage = null;
		await expect(sandbox.run('disp("retry")', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('ignores a stale Octave worker handler after a clean rerun', async () => {
		const sandbox = new Octave();
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);
		await sandbox.load('/absproxy/5173');
		onPostMessage = () => undefined;

		const firstRun = sandbox.run('disp("first")', false);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const firstHandler = workerInstances[0].onmessage;
		firstHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(firstRun).resolves.toBe(true);

		const secondRun = sandbox.run('disp("second")', false);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const secondWorker = workerInstances[1];
		const secondHandler = secondWorker.onmessage;

		firstHandler?.({ data: { output: 'late\n', results: true } } as MessageEvent<any>);
		expect(outputs).toEqual([]);
		expect(secondWorker.onmessage).toBe(secondHandler);

		secondHandler?.({ data: { output: 'second\n', results: true } } as MessageEvent<any>);
		await expect(secondRun).resolves.toBe(true);
		expect(outputs).toEqual(['second\n']);
	});

	it('releases a stdin-waiting Octave run after termination', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		const running = sandbox.run('n = str2double(fgetl(stdin));', false);
		await Promise.resolve();

		sandbox.terminate();
		await expect(running).rejects.toBe('Process terminated');
		expect(sandbox.exit).toBe(true);
		expect(workerInstances).toHaveLength(0);

		await expect(sandbox.run('disp("retry")', false)).resolves.toBe(true);
	});

	it('rejects a pre-aborted Octave run without changing lifecycle state', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		const controller = new AbortController();
		const reason = new Error('Octave pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.run('disp("cancelled")', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
		expect(workerInstances).toHaveLength(0);

		await expect(sandbox.run('disp("retry")', false)).resolves.toBe(true);
	});

	it('aborts an Octave run while it is waiting for stdin', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Octave stdin abort');

		const running = sandbox.run('n = str2double(fgetl(stdin));', false, true, undefined, [], {
			signal: controller.signal
		});
		await Promise.resolve();
		expect(sandbox.stdinWaiters).toHaveLength(1);
		expect(workerInstances).toHaveLength(0);

		controller.abort(reason);
		await expect(running).rejects.toBe(reason);
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.stdinWaiters).toHaveLength(0);
		expect(sandbox.exit).toBe(true);
		expect(workerInstances).toHaveLength(0);

		await expect(sandbox.run('disp("retry")', false)).resolves.toBe(true);
	});

	it('aborts an active Octave worker with its exact reason and ignores late aborts', async () => {
		const sandbox = new Octave();
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);
		await sandbox.load('/absproxy/5173');
		onPostMessage = () => undefined;
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Octave active abort');
		const progress = {
			set: vi.fn(() => controller.abort(reason))
		};

		const running = sandbox.run('disp("cancelled")', false, true, progress, [], {
			signal: controller.signal
		});
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const lateHandler = worker.onmessage;
		lateHandler?.({
			data: { progress: { percent: 50 }, output: 'after-abort\n', results: true }
		} as MessageEvent<any>);

		await expect(running).rejects.toBe(reason);
		expect(progress.set).toHaveBeenCalledWith(0.5, undefined);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		lateHandler?.({ data: { output: 'late\n', results: true } } as MessageEvent<any>);
		expect(outputs).toEqual([]);

		onPostMessage = null;
		const settledController = new AbortController();
		await expect(
			sandbox.run('disp("retry")', false, true, undefined, [], {
				signal: settledController.signal
			})
		).resolves.toBe(true);
		const retryWorker = workerInstances[1];
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('Octave late abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('collects queued terminal input before starting stdin-using Octave code', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		let runMessage: any;

		onPostMessage = (worker, message) => {
			runMessage = message;
			queueMicrotask(() => {
				worker.onmessage?.({
					data: {
						results: true
					}
				} as MessageEvent<any>);
			});
		};

		const runPromise = sandbox.run('n = str2double(fgetl(stdin));', false);
		await Promise.resolve();
		expect(workerInstances).toHaveLength(0);
		sandbox.write('42\n');

		await expect(runPromise).resolves.toBe(true);
		expect(runMessage.stdin).toBe('42\n');
	});

	it('isolates explicit Octave stdin from queued and subsequent terminal input', async () => {
		const sandbox = new Octave();
		const runMessages: any[] = [];
		const bufferedValues: Array<string | null> = [];
		await sandbox.load('/absproxy/5173');

		onPostMessage = (worker, message) => {
			runMessages.push(message);
			queueMicrotask(() => {
				worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
				bufferedValues.push(readBufferedStdin(message.buffer));
				if (runMessages.length === 1) {
					sandbox.write('during\n');
					sandbox.eof();
				}
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		};
		sandbox.write('stale\n');
		sandbox.eof();

		await expect(
			sandbox.run('n = str2double(fgetl(stdin));', false, true, undefined, [], {
				stdin: 'injected\n'
			})
		).resolves.toBe(true);

		const bufferedRun = sandbox.run('n = str2double(fgetl(stdin));', false);
		await Promise.resolve();
		expect(workerInstances).toHaveLength(1);
		expect(runMessages).toHaveLength(1);

		sandbox.write('fresh\n');
		await expect(bufferedRun).resolves.toBe(true);

		expect(runMessages).toHaveLength(2);
		expect(runMessages[0].stdin).toBe('injected\n');
		expect(runMessages[1].stdin).toBe('fresh\n');
		expect(bufferedValues).toEqual(['', '']);
	});
});
