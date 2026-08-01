import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_WAT_MODULE_URL: ''
	}
}));
let suppressAutoLoadAck = false;
let suppressAutoRunAck = false;

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
							fileName: 'main.wat',
							lineNumber: 1,
							columnNumber: 2,
							severity: 'warning',
							message: 'demo warning'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
			return;
		}
		if (suppressAutoRunAck) return;
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'answer=45\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/wat?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Wat from './wat';

describe('WAT sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_WAT_MODULE_URL = '/wasm-wat/index.js';
		suppressAutoLoadAck = false;
		suppressAutoRunAck = false;
	});

	it('loads the WAT worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Wat();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = '(module (func (export "answer") (result i32) i32.const 45))';

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(sandbox.run(code, false, true, undefined, ['alpha'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-wat\/index\.js$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				activePath: 'main.wat',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				activePath: 'main.wat',
				log: true
			})
		);
		expect(outputs).toContain('answer=45\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.wat',
				lineNumber: 1,
				columnNumber: 2,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
	});

	it('normalizes a valid WAT workspace before worker dispatch', async () => {
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run('(module)', false, true, undefined, [], {
				activePath: 'nested\\main.wat',
				workspaceFiles: [{ path: 'fixtures\\helper.wat', content: '(module)' }]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				activePath: 'nested/main.wat',
				workspaceFiles: [{ path: 'fixtures/helper.wat', content: '(module)' }]
			})
		);
	});

	it.each([
		{
			name: 'traversal path',
			code: 'A',
			options: { activePath: '../main.wat' },
			expected: { code: 'invalid-path', path: '../main.wat' }
		},
		{
			name: 'absolute path',
			code: 'A',
			options: { activePath: '/tmp/main.wat' },
			expected: { code: 'invalid-path', path: '/tmp/main.wat' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: { activePath: 'bad\0.wat' },
			expected: { code: 'invalid-path', path: 'bad\0.wat' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'data/module.wat', content: 'A' },
					{ path: 'data/module.wat', content: 'B' }
				]
			},
			expected: { code: 'duplicate-path', path: 'data/module.wat' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'DATA/module.wat', content: 'A' },
					{ path: 'data/module.wat', content: 'B' }
				]
			},
			expected: { code: 'case-collision', path: 'data/module.wat' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'data/module.wat', content: 'B' }],
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
				workspaceFiles: [{ path: 'data/module.wat', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a WAT workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Wat();
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];
			const loadHandler = worker.onmessage;

			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(worker.postMessage).toHaveBeenCalledTimes(1);
			expect(worker.onmessage).toBe(loadHandler);
			expect(sandbox.uid).toBe(0);
			expect(sandbox.exit).toBe(true);
		}
	);

	it('rejects an overlapping run without replacing the active WAT operation', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const firstRun = sandbox.run('(module (func (export "first")))', false);
		const firstHandler = worker.onmessage;
		let firstSettled = false;
		void firstRun.then(
			() => {
				firstSettled = true;
			},
			() => {
				firstSettled = true;
			}
		);

		await expect(sandbox.run('(module (func (export "second")))', false)).rejects.toMatchObject(
			{
				name: 'BusyError',
				code: 'busy',
				phase: 'execute',
				runtimeId: 'WAT',
				recoverable: true
			}
		);
		expect(firstSettled).toBe(false);
		expect(worker.onmessage).toBe(firstHandler);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
		expect(sandbox.uid).toBe(1);

		firstHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(firstRun).resolves.toBe(true);

		const thirdRun = sandbox.run('(module (func (export "third")))', false);
		expect(worker.postMessage).toHaveBeenCalledTimes(3);
		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(thirdRun).resolves.toBe(true);
	});

	it('rejects load while a WAT run owns the worker handler', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const running = sandbox.run('(module (func (export "active")))', false);
		const runHandler = worker.onmessage;

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'WAT'
		});
		expect(worker.onmessage).toBe(runHandler);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);

		runHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(running).resolves.toBe(true);
	});

	it('rejects overlapping WAT startup operations without superseding readiness', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Wat();
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'WAT'
		});
		await expect(sandbox.run('(module)', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'WAT'
		});
		expect(worker.onmessage).toBe(loadHandler);
		expect(worker.postMessage).toHaveBeenCalledOnce();

		loadHandler?.({ data: { load: true } } as MessageEvent<any>);
		await expect(loading).resolves.toBeUndefined();
	});

	it('rejects a pre-aborted WAT startup without changing an existing worker', async () => {
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockClear();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const reason = new Error('WAT startup pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal }, progress)
		).rejects.toBe(reason);

		expect(sandbox.worker).toBe(worker);
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('aborts an active WAT startup and ignores stale completion', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Wat();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('WAT startup aborted');
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;

		controller.abort(reason);
		await expect(loading).rejects.toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { progress: 0.8, load: true } } as MessageEvent<any>);
		expect(progress.set).not.toHaveBeenCalled();

		suppressAutoLoadAck = false;
		const settledController = new AbortController();
		await sandbox.load('/absproxy/5173', '', true, [], {
			signal: settledController.signal
		});
		const retryWorker = workerInstances.at(-1)!;
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late startup abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('rejects a pre-aborted WAT run without changing worker or run state', async () => {
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('do not start WAT');
		controller.abort(reason);

		await expect(
			sandbox.run('(module)', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);
		expect(worker.postMessage).toHaveBeenCalledTimes(1);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('(module)', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
	});

	it('cancels an active WAT run with the caller reason and permits a clean retry', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');
		const oldWorker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('stop active WAT');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const running = sandbox.run('(module)', false, true, undefined, [], {
			signal: controller.signal
		});
		const abortRegistration = addEventListener.mock.calls.find(([type]) => type === 'abort');

		controller.abort(reason);
		await expect(running).rejects.toBe(reason);
		expect(oldWorker.terminate).toHaveBeenCalledOnce();
		expect(abortRegistration).toBeDefined();
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
		expect(sandbox.exit).toBe(true);

		suppressAutoRunAck = false;
		await sandbox.load('/absproxy/5173');
		const replacementWorker = workerInstances[1];
		const retryController = new AbortController();
		await expect(
			sandbox.run('(module)', false, true, undefined, [], {
				signal: retryController.signal
			})
		).resolves.toBe(true);
		const settledUid = sandbox.uid;
		retryController.abort(new Error('late WAT abort'));
		expect(sandbox.uid).toBe(settledUid);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
	});

	it('keeps a replacement worker handler when a terminated run posts a stale message', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');
		const oldWorker = workerInstances[0];
		const oldRun = sandbox.run('(module (func (export "old")))', false);
		const oldHandler = oldWorker.onmessage;

		sandbox.kill();
		await expect(oldRun).rejects.toBe('Process terminated');
		expect(oldWorker.terminate).toHaveBeenCalledOnce();

		await sandbox.load('/absproxy/5173');
		const replacementWorker = workerInstances[1];
		const replacementRun = sandbox.run('(module (func (export "replacement")))', false);
		const replacementHandler = replacementWorker.onmessage;
		let replacementSettled = false;
		void replacementRun.then(
			() => {
				replacementSettled = true;
			},
			() => {
				replacementSettled = true;
			}
		);

		oldHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
		await Promise.resolve();
		expect(replacementWorker.onmessage).toBe(replacementHandler);
		expect(replacementSettled).toBe(false);

		replacementHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(replacementRun).resolves.toBe(true);
	});

	it('rejects load when no WAT module url is configured', async () => {
		publicEnv.PUBLIC_WASM_WAT_MODULE_URL = '';
		const sandbox = new Wat();

		await expect(sandbox.load({})).rejects.toContain('WAT runtime is not configured');
	});

	it('rejects load when the WAT worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Wat();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/wat.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'WAT worker script error: worker script error (/worker/wat.js:8:2)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');

		const runPromise = sandbox.run(
			'(module (import "env" "readByte" (func $readByte (result i32))))',
			false
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const runMessage = worker.postMessage.mock.calls.at(-1)?.[0];

		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		sandbox.write('42\n');

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(runPromise).resolves.toBe(true);
	});

	it('writes EOF when the worker requests stdin after eof is signaled', async () => {
		suppressAutoRunAck = true;
		const sandbox = new Wat();
		await sandbox.load('/absproxy/5173');

		const runPromise = sandbox.run(
			'(module (import "env" "readByte" (func $readByte (result i32))))',
			false
		);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const runMessage = worker.postMessage.mock.calls.at(-1)?.[0];

		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		sandbox.eof();

		expect(readBufferedStdin(runMessage.buffer)).toBeNull();
		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(runPromise).resolves.toBe(true);
	});

	it('clears queued input before an explicit WAT stdin run', async () => {
		const sandbox = new Wat();
		const worker = new MockWorker();
		const runMessages: any[] = [];
		const bufferedValues: Array<string | null> = [];

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementation((message) => {
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
		});
		sandbox.write('stale\n');
		sandbox.eof();

		await expect(
			sandbox.run('(module)', false, true, undefined, [], {
				stdin: 'injected\n'
			})
		).resolves.toBe(true);
		await expect(sandbox.run('(module)', false)).resolves.toBe(true);

		expect(runMessages).toHaveLength(2);
		expect(runMessages[0].stdin).toBe('injected\n');
		expect(runMessages[1].stdin).toBeUndefined();
		expect(bufferedValues).toEqual(['', '']);
	});
});
