import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_RUST_COMPILER_URL: '',
		PUBLIC_WASM_GO_COMPILER_URL: '',
		PUBLIC_WASM_TINYGO_APP_URL: '',
		PUBLIC_WASM_TINYGO_MODULE_URL: ''
	}
}));
let suppressAutoLoadAck = false;
let onPostMessage: ((worker: MockWorker, message: any) => void) | null = null;
let onWorkerConstruct: (() => void) | null = null;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (onPostMessage) {
			onPostMessage(this, message);
			return;
		}
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
							fileName: 'Main.java',
							lineNumber: 2,
							columnNumber: 5,
							severity: 'warning',
							message: 'unused import'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true, buffer: true } } as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'sum=10\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
		onWorkerConstruct?.();
	}
}

vi.mock('$lib/playground/worker/java?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Java from './java';

describe('TeaVM Java sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		suppressAutoLoadAck = false;
		onPostMessage = null;
		onWorkerConstruct = null;
	});

	it('loads the TeaVM worker and resolves prepare/run messages', async () => {
		const sandbox = new Java();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = `public class Main {
    static boolean isEven(int value) {
        return value == 0 || isOdd(value - 1);
    }

    static boolean isOdd(int value) {
        return value != 0 && isEven(value - 1);
    }

    public static void main(String[] args) {
        int left = 3, right = 7;
        System.out.println((left + right) + ":" + isEven(left + right));
    }
}`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['one', 'two'], { stdin: '4\n6\n' })
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				assets: expect.objectContaining({
					baseUrl: expect.stringMatching(
						/^http:\/\/localhost(?::\d+)?\/absproxy\/5173\/teavm\/$/
					),
					useAssetBridge: false
				})
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: [],
				activePath: 'Main.java',
				workspaceFiles: []
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['one', 'two'],
				stdin: '4\n6\n',
				activePath: 'Main.java',
				workspaceFiles: []
			})
		);
		expect(outputs).toContain('sum=10\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'Main.java',
				lineNumber: 2,
				columnNumber: 5,
				severity: 'warning',
				message: 'unused import'
			}
		]);
	});

	it('normalizes a valid Java workspace before worker dispatch', async () => {
		const sandbox = new Java();
		const code = `package nested;

public class Main {
    public static void main(String[] args) {
        System.out.println(Helper.value());
    }
}`;
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'nested\\Main.java',
				workspaceFiles: [
					{
						path: 'nested\\Helper.java',
						content:
							'package nested; final class Helper { static int value() { return 42; } }'
					}
				]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				activePath: 'nested/Main.java',
				workspaceFiles: [
					{
						path: 'nested/Helper.java',
						content:
							'package nested; final class Helper { static int value() { return 42; } }'
					}
				]
			})
		);
	});

	it.each([
		{
			name: 'traversal path',
			code: 'class Main {}',
			options: { activePath: '../Main.java' },
			expected: { code: 'invalid-path', path: '../Main.java' }
		},
		{
			name: 'absolute path',
			code: 'class Main {}',
			options: { activePath: '/tmp/Main.java' },
			expected: { code: 'invalid-path', path: '/tmp/Main.java' }
		},
		{
			name: 'NUL path',
			code: 'class Main {}',
			options: { activePath: 'bad\0.java' },
			expected: { code: 'invalid-path', path: 'bad\0.java' }
		},
		{
			name: 'duplicate path',
			code: 'class Main {}',
			options: {
				workspaceFiles: [
					{ path: 'lib/Helper.java', content: 'class Helper {}' },
					{ path: 'lib/Helper.java', content: 'class Other {}' }
				]
			},
			expected: { code: 'duplicate-path', path: 'lib/Helper.java' }
		},
		{
			name: 'case-colliding path',
			code: 'class Main {}',
			options: {
				workspaceFiles: [
					{ path: 'LIB/Helper.java', content: 'class Helper {}' },
					{ path: 'lib/helper.java', content: 'class Other {}' }
				]
			},
			expected: { code: 'case-collision', path: 'lib/helper.java' }
		},
		{
			name: 'file count overflow',
			code: 'class Main {}',
			options: {
				workspaceFiles: [{ path: 'Helper.java', content: 'class Helper {}' }],
				workspaceLimits: { maxFiles: 1 }
			},
			expected: { code: 'file-count-limit', limit: 1, actual: 2 }
		},
		{
			name: 'per-file overflow clamped to execution limits',
			code: 'class A {}',
			options: {
				limits: { maxWorkspaceBytes: 4 },
				workspaceLimits: { maxFileBytes: 100 }
			},
			expected: { code: 'file-size-limit', limit: 4, actual: 10 }
		},
		{
			name: 'aggregate overflow clamped to execution limits',
			code: 'class A {}',
			options: {
				limits: { maxWorkspaceBytes: 10 },
				workspaceFiles: [{ path: 'B.java', content: 'X' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 10, actual: 11 }
		}
	])(
		'rejects a Java workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Java();
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];
			const handler = worker.onmessage;
			const assetBridge = sandbox.assetBridge;

			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(worker.postMessage).toHaveBeenCalledOnce();
			expect(worker.onmessage).toBe(handler);
			expect(worker.terminate).not.toHaveBeenCalled();
			expect(sandbox.worker).toBe(worker);
			expect(sandbox.assetBridge).toBe(assetBridge);
			expect(sandbox.uid).toBe(0);
			expect(sandbox.exit).toBe(true);

			await expect(sandbox.run('class Retry {}', false)).resolves.toBe(true);
		}
	);

	it('rejects operations that overlap a pending Java load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Java();
		const loading = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;
		const assetBridge = sandbox.assetBridge;
		const baseUrl = sandbox.baseUrl;

		await expect(sandbox.load('/other/')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'JAVA',
			phase: 'startup'
		});
		await expect(sandbox.run('public class Main {}', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'JAVA',
			phase: 'startup'
		});

		expect(workerInstances).toHaveLength(1);
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(loadHandler);
		expect(sandbox.assetBridge).toBe(assetBridge);
		expect(sandbox.baseUrl).toBe(baseUrl);
		expect(worker.terminate).not.toHaveBeenCalled();

		loadHandler?.({ data: { load: true } } as MessageEvent<any>);
		await expect(loading).resolves.toBeUndefined();
		await expect(sandbox.run('public class Main {}', false)).resolves.toBe(true);
	});

	it('keeps Java load ownership through a reentrant asset progress callback', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Java();
		let nestedLoad: Promise<void> | undefined;
		let nestedRun: Promise<boolean | string> | undefined;
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{},
			{
				set() {
					nestedLoad = sandbox.load('/other/');
					nestedRun = sandbox.run('public class Nested {}', false);
					void nestedLoad.catch(() => undefined);
					void nestedRun.catch(() => undefined);
				}
			}
		);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		await expect(nestedLoad).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'JAVA'
		});
		await expect(nestedRun).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'JAVA'
		});
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();

		workerInstances[0].onmessage?.({ data: { load: true } } as MessageEvent<any>);
		await expect(loading).resolves.toBeUndefined();
	});

	it('rejects a pre-aborted Java startup without changing its loaded worker or bridge', async () => {
		const sandbox = new Java();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		const assetBridge = sandbox.assetBridge!;
		const rebind = vi.spyOn(assetBridge, 'rebind');
		const dispose = vi.spyOn(assetBridge, 'dispose');
		const baseUrl = sandbox.baseUrl;
		const controller = new AbortController();
		const reason = new Error('Java startup pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.load('/other/', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);

		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(rebind).not.toHaveBeenCalled();
		expect(dispose).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.assetBridge).toBe(assetBridge);
		expect(sandbox.baseUrl).toBe(baseUrl);

		await expect(sandbox.run('public class Main {}', false)).resolves.toBe(true);
	});

	it('aborts Java startup during worker construction before attaching it', async () => {
		const sandbox = new Java();
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Java constructor abort');
		onWorkerConstruct = () => controller.abort(reason);

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).not.toHaveBeenCalled();
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.worker).toBeNull();
		expect(sandbox.assetBridge).toBeNull();
		expect(sandbox.exit).toBe(true);

		onWorkerConstruct = null;
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('public class Main {}', false)).resolves.toBe(true);
	});

	it('aborts Java readiness with its exact reason and ignores settled startup signals', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Java();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Java readiness abort');
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const lateHandler = worker.onmessage;
		const assetBridge = sandbox.assetBridge!;
		const handleMessage = vi.spyOn(assetBridge, 'handleMessage');
		const dispose = vi.spyOn(assetBridge, 'dispose');
		const progressCalls = progress.set.mock.calls.length;

		controller.abort(reason);
		await expect(loading).rejects.toBe(reason);
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(dispose).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.assetBridge).toBeNull();

		lateHandler?.({
			data: {
				assetProgress: { asset: 'teavm.wasm', loaded: 1, total: 1 },
				load: true
			}
		} as MessageEvent<any>);
		expect(handleMessage).not.toHaveBeenCalled();
		expect(progress.set).toHaveBeenCalledTimes(progressCalls);

		suppressAutoLoadAck = false;
		const settledController = new AbortController();
		const settledRemoveEventListener = vi.spyOn(
			settledController.signal,
			'removeEventListener'
		);
		await sandbox.load('/absproxy/5173', '', true, [], {
			signal: settledController.signal
		});
		const retryWorker = workerInstances[1];
		const retryBridge = sandbox.assetBridge!;
		const retryDispose = vi.spyOn(retryBridge, 'dispose');
		expect(settledRemoveEventListener).toHaveBeenCalledWith('abort', expect.any(Function));

		settledController.abort(new Error('Java late startup abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
		expect(retryDispose).not.toHaveBeenCalled();
	});

	it('rejects operations that overlap an active Java run without rebinding assets', async () => {
		const sandbox = new Java();
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const assetBridge = sandbox.assetBridge!;
		const handleMessage = vi.spyOn(assetBridge, 'handleMessage');
		onPostMessage = () => undefined;

		const running = sandbox.run('public class Main {}', false);
		const firstHandler = worker.onmessage;
		firstHandler?.({
			data: { assetProgress: { asset: 'teavm.wasm', loaded: 1, total: 2 } }
		} as MessageEvent<any>);
		expect(handleMessage).toHaveBeenCalledOnce();

		await expect(sandbox.run('public class Second {}', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'JAVA',
			phase: 'execute'
		});
		await expect(sandbox.load('/other/')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'JAVA',
			phase: 'execute'
		});
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
		expect(worker.onmessage).toBe(firstHandler);
		expect(sandbox.assetBridge).toBe(assetBridge);
		expect(worker.terminate).not.toHaveBeenCalled();

		firstHandler?.({ data: { output: 'first\n', results: true } } as MessageEvent<any>);
		await expect(running).resolves.toBe(true);
		expect(outputs).toEqual(['first\n']);

		handleMessage.mockClear();
		const secondRun = sandbox.run('public class Second {}', false);
		const secondHandler = worker.onmessage;
		firstHandler?.({
			data: {
				assetProgress: { asset: 'teavm.wasm', loaded: 2, total: 2 },
				output: 'stale\n',
				results: true
			}
		} as MessageEvent<any>);
		expect(handleMessage).not.toHaveBeenCalled();
		expect(worker.onmessage).toBe(secondHandler);
		expect(outputs).toEqual(['first\n']);

		secondHandler?.({ data: { output: 'second\n', results: true } } as MessageEvent<any>);
		await expect(secondRun).resolves.toBe(true);
		expect(outputs).toEqual(['first\n', 'second\n']);
	});

	it('keeps Java idle when run is called without a loaded worker', async () => {
		const sandbox = new Java();

		await expect(sandbox.run('public class Main {}', false)).rejects.toBe('Worker not loaded');
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
		expect(sandbox.assetBridge).toBeNull();

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('public class Main {}', false)).resolves.toBe(true);
	});

	it('rejects a pre-aborted Java run without changing its loaded worker or bridge', async () => {
		const sandbox = new Java();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		const assetBridge = sandbox.assetBridge!;
		const dispose = vi.spyOn(assetBridge, 'dispose');
		const controller = new AbortController();
		const reason = new Error('Java pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.run('public class Main {}', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(dispose).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.assetBridge).toBe(assetBridge);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('public class Main {}', false)).resolves.toBe(true);
	});

	it('aborts an active Java worker with its exact reason and disposes owned assets', async () => {
		const sandbox = new Java();
		const outputs: string[] = [];
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const assetBridge = sandbox.assetBridge!;
		const handleMessage = vi.spyOn(assetBridge, 'handleMessage');
		const dispose = vi.spyOn(assetBridge, 'dispose');
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Java active abort');
		sandbox.output = (chunk: string) => {
			outputs.push(chunk);
			controller.abort(reason);
		};
		onPostMessage = () => undefined;

		const running = sandbox.run('public class Main {}', false, true, undefined, [], {
			signal: controller.signal
		});
		const lateHandler = worker.onmessage;
		lateHandler?.({ data: { output: 'before-abort\n', results: true } } as MessageEvent<any>);

		await expect(running).rejects.toBe(reason);
		expect(outputs).toEqual(['before-abort\n']);
		expect(handleMessage).toHaveBeenCalledOnce();
		expect(dispose).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.assetBridge).toBeNull();
		expect(sandbox.exit).toBe(true);

		handleMessage.mockClear();
		lateHandler?.({
			data: {
				assetProgress: { asset: 'teavm.wasm', loaded: 1, total: 1 },
				output: 'late\n',
				results: true
			}
		} as MessageEvent<any>);
		expect(handleMessage).not.toHaveBeenCalled();
		expect(outputs).toEqual(['before-abort\n']);

		onPostMessage = null;
		sandbox.output = () => undefined;
		await sandbox.load('/absproxy/5173');
		const retryWorker = workerInstances[1];
		const retryBridge = sandbox.assetBridge!;
		const retryDispose = vi.spyOn(retryBridge, 'dispose');
		const settledController = new AbortController();
		const settledRemoveEventListener = vi.spyOn(
			settledController.signal,
			'removeEventListener'
		);
		await expect(
			sandbox.run('public class Retry {}', false, true, undefined, [], {
				signal: settledController.signal
			})
		).resolves.toBe(true);
		expect(settledRemoveEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
		expect(retryDispose).not.toHaveBeenCalled();

		settledController.abort(new Error('Java late abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
		expect(retryDispose).not.toHaveBeenCalled();
	});

	it('releases Java operation ownership after synchronous dispatch failure', async () => {
		const sandbox = new Java();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const dispatchError = new Error('Java dispatch failed');
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		onPostMessage = () => {
			throw dispatchError;
		};

		await expect(
			sandbox.run('public class Main {}', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(dispatchError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.assetBridge).toBeNull();
		expect(sandbox.exit).toBe(true);

		onPostMessage = null;
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('public class Main {}', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('releases Java ownership after a worker error and ignores its stale handler', async () => {
		const sandbox = new Java();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const assetBridge = sandbox.assetBridge!;
		const handleMessage = vi.spyOn(assetBridge, 'handleMessage');
		onPostMessage = () => undefined;

		const running = sandbox.run('public class Main {}', false);
		const staleHandler = worker.onmessage;
		worker.onerror?.({
			message: 'worker crashed',
			filename: '/worker/java.js',
			lineno: 7,
			colno: 3
		} as ErrorEvent);

		await expect(running).rejects.toContain(
			'Java worker script error: worker crashed (/worker/java.js:7:3)'
		);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.assetBridge).toBeNull();
		expect(sandbox.exit).toBe(true);

		onPostMessage = null;
		await sandbox.load('/absproxy/5173');
		const replacementWorker = workerInstances[1];
		const replacementBridge = sandbox.assetBridge;
		onPostMessage = () => undefined;
		const replacementRun = sandbox.run('public class Replacement {}', false);
		const replacementHandler = replacementWorker.onmessage;

		staleHandler?.({
			data: {
				assetProgress: { asset: 'teavm.wasm', loaded: 1, total: 1 },
				results: true
			}
		} as MessageEvent<any>);
		expect(handleMessage).not.toHaveBeenCalled();
		expect(sandbox.assetBridge).toBe(replacementBridge);
		expect(replacementWorker.onmessage).toBe(replacementHandler);

		replacementHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(replacementRun).resolves.toBe(true);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Java();
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
				`public class Main {
    public static void main(String[] args) throws Exception {
        System.out.println(System.in.read());
    }
}`,
				false
			)
		).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});

	it('writes EOF when the worker requests stdin after eof is signaled', async () => {
		const sandbox = new Java();
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.eof();
				worker.onmessage?.({
					data: {
						buffer: true,
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await expect(sandbox.run('public class Main {}', false)).resolves.toBe(true);
		expect(readBufferedStdin(runMessage.buffer)).toBeNull();
	});

	it('clears queued input before and after an explicit Java stdin run', async () => {
		const sandbox = new Java();
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
			sandbox.run('public class Main {}', false, true, undefined, [], {
				stdin: 'injected\n'
			})
		).resolves.toBe(true);
		await expect(sandbox.run('public class Main {}', false)).resolves.toBe(true);

		expect(runMessages).toHaveLength(2);
		expect(runMessages[0].stdin).toBe('injected\n');
		expect(runMessages[1].stdin).toBe('');
		expect(bufferedValues).toEqual(['', '']);
	});

	it('rejects the active run when kill terminates the worker', async () => {
		const sandbox = new Java();

		await sandbox.load('/');
		const worker = workerInstances[workerInstances.length - 1];
		worker.postMessage.mockImplementationOnce(() => {});
		const running = sandbox.run('public class Main {}', false);
		sandbox.kill();

		await expect(running).rejects.toBe('Process terminated');
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it('forwards runtime errors from the TeaVM worker', async () => {
		const sandbox = new Java();
		const worker = new MockWorker();

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce(() =>
			queueMicrotask(() =>
				worker.onmessage?.({
					data: {
						error: 'Exception in thread "main" java.lang.ArithmeticException: / by zero'
					}
				} as MessageEvent<any>)
			)
		);

		await expect(
			sandbox.run(
				`public class Main {
    public static void main(String[] args) {
        int zero = 0, value = 10;
        System.out.println(value / zero);
    }
}`,
				false
			)
		).rejects.toContain('ArithmeticException');
	});
});
