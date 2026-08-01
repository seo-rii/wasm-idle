import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const workerInstances: MockWorker[] = [];
let autoResolveLoad = true;
let autoResolveRun = true;
let loadDispatchError: unknown;
let runDispatchError: unknown;
let cachedLoadDispatchError: unknown;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load && loadDispatchError) throw loadDispatchError;
		if (!message.load && 'code' in message && runDispatchError) throw runDispatchError;
		if (!message.load && !('code' in message) && cachedLoadDispatchError) {
			throw cachedLoadDispatchError;
		}
		queueMicrotask(() => {
			if (message.load) {
				if (autoResolveLoad) this.resolveLoad();
				return;
			}
			if ('code' in message && autoResolveRun) this.resolveRun();
		});
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}

	resolveLoad() {
		this.onmessage?.({ data: { load: true } } as MessageEvent<any>);
	}

	resolveRun(output?: string) {
		this.onmessage?.({ data: { output, results: true } } as MessageEvent<any>);
	}

	rejectRun(reason: unknown) {
		this.onmessage?.({ data: { error: reason } } as MessageEvent<any>);
	}
}

vi.mock('$lib/playground/worker/cobol?worker', () => ({
	default: MockWorker
}));

import Cobol from './cobol';

describe('COBOL sandbox workspace boundary', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		autoResolveLoad = true;
		autoResolveRun = true;
		loadDispatchError = undefined;
		runDispatchError = undefined;
		cachedLoadDispatchError = undefined;
	});

	it('canonicalizes the active path and workspace files before worker dispatch', async () => {
		const sandbox = new Cobol();
		const code = '       IDENTIFICATION DIVISION.';
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'src\\main.cob',
				workspaceFiles: [{ path: 'copy\\shared.cpy', content: '       01 VALUE PIC 9.' }]
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				activePath: 'src/main.cob',
				workspaceFiles: [{ path: 'copy/shared.cpy', content: '       01 VALUE PIC 9.' }]
			})
		);

		await expect(sandbox.run(code, false)).resolves.toBe(true);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ activePath: 'main.cob', workspaceFiles: [] })
		);
	});

	it.each([
		{
			name: 'active path traversal',
			code: 'A',
			options: { activePath: '../main.cob' },
			expected: { code: 'invalid-path', path: '../main.cob' }
		},
		{
			name: 'workspace path traversal',
			code: 'A',
			options: { workspaceFiles: [{ path: 'copy/../secret.cpy', content: 'B' }] },
			expected: { code: 'invalid-path', path: 'copy/../secret.cpy' }
		},
		{
			name: 'absolute active path',
			code: 'A',
			options: { activePath: '/main.cob' },
			expected: { code: 'invalid-path', path: '/main.cob' }
		},
		{
			name: 'control character in a path',
			code: 'A',
			options: { workspaceFiles: [{ path: 'copy/secret\0.cpy', content: 'B' }] },
			expected: { code: 'invalid-path', path: 'copy/secret\0.cpy' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'copy/shared.cpy', content: 'B' },
					{ path: 'copy/shared.cpy', content: 'C' }
				]
			},
			expected: { code: 'duplicate-path', path: 'copy/shared.cpy' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'COPY/shared.cpy', content: 'B' },
					{ path: 'copy/shared.cpy', content: 'C' }
				]
			},
			expected: { code: 'case-collision', path: 'copy/shared.cpy' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'copy/shared.cpy', content: 'B' }],
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
				workspaceFiles: [{ path: 'copy/shared.cpy', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a COBOL workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Cobol();
			await sandbox.load('/absproxy/5173');
			const worker = workerInstances[0];
			const loadHandler = worker.onmessage;
			const assetBridge = sandbox.assetBridge;
			const begin = sandbox.begin;
			sandbox.write('queued input\n');

			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(worker.postMessage).toHaveBeenCalledOnce();
			expect(worker.onmessage).toBe(loadHandler);
			expect(worker.terminate).not.toHaveBeenCalled();
			expect(sandbox.assetBridge).toBe(assetBridge);
			expect(sandbox.uid).toBe(0);
			expect(sandbox.begin).toBe(begin);
			expect(sandbox.exit).toBe(true);
			expect(sandbox.pendingInput).toEqual(['queued input\n']);

			await expect(sandbox.run('A', false)).resolves.toBe(true);
			expect(worker.postMessage).toHaveBeenCalledTimes(2);
			expect(worker.postMessage).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ activePath: 'main.cob', workspaceFiles: [] })
			);
		}
	);

	it('preserves a pending startup across load and run overlaps', async () => {
		autoResolveLoad = false;
		const sandbox = new Cobol();
		const loading = sandbox.load('/assets', '', false);

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const startupHandler = worker.onmessage;
		const assetBridge = sandbox.assetBridge;
		sandbox.write('queued input\n');

		await expect(sandbox.load('/other-assets')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'COBOL',
			phase: 'startup'
		});
		await expect(sandbox.run('IDENTIFICATION DIVISION.', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'COBOL',
			phase: 'startup'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(startupHandler);
		expect(sandbox.assetBridge).toBe(assetBridge);
		expect(sandbox.activeCobolBaseUrl).toBe('');
		expect(sandbox.log).toBe(true);
		expect(sandbox.pendingInput).toEqual(['queued input\n']);

		worker.resolveLoad();
		await expect(loading).resolves.toBeUndefined();
		expect(sandbox.log).toBe(false);
		expect(sandbox.activeCobolBaseUrl).not.toBe('');
	});

	it('permits an immediate clean retry after terminating startup', async () => {
		autoResolveLoad = false;
		const sandbox = new Cobol();
		const loading = sandbox.load('/assets');

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const oldWorker = workerInstances[0];
		const staleReady = oldWorker.onmessage;
		sandbox.terminate('stop COBOL startup');
		autoResolveLoad = true;
		const retry = sandbox.load('/assets');

		await expect(loading).rejects.toBe('stop COBOL startup');
		await expect(retry).resolves.toBeUndefined();
		expect(oldWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		const replacementWorker = workerInstances[1];
		staleReady?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBe(replacementWorker);
	});

	it('aborts an in-flight asset loader when startup is terminated', async () => {
		autoResolveLoad = false;
		const sandbox = new Cobol();
		let finishLoader: ((value: Uint8Array) => void) | undefined;
		let loaderSignal: AbortSignal | undefined;
		const loader = vi.fn(({ signal }: { signal?: AbortSignal }) => {
			loaderSignal = signal;
			return new Promise<Uint8Array>((resolve) => {
				finishLoader = resolve;
			});
		});
		const loading = sandbox.load({ clang: { loader } });

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const oldWorker = workerInstances[0];
		oldWorker.onmessage?.({
			data: {
				assetRequest: { id: 7, asset: 'bin/clang.wasm.gz' }
			}
		} as MessageEvent<any>);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());

		sandbox.terminate('stop COBOL asset startup');
		autoResolveLoad = true;
		const retry = sandbox.load('/assets');

		await expect(loading).rejects.toBe('stop COBOL asset startup');
		await expect(retry).resolves.toBeUndefined();
		expect(loaderSignal?.aborted).toBe(true);
		finishLoader?.(new Uint8Array([1, 2, 3]));
		await Promise.resolve();
		await Promise.resolve();
		expect(oldWorker.postMessage.mock.calls.some(([message]) => message.assetResponse)).toBe(
			false
		);
		expect(
			workerInstances[1].postMessage.mock.calls.some(([message]) => message.assetResponse)
		).toBe(false);
	});

	it('hides a disposed worker from reentrant operations during asset abort', async () => {
		autoResolveLoad = false;
		autoResolveRun = false;
		const sandbox = new Cobol();
		let reentrantRun: Promise<boolean | string> | undefined;
		const loader = vi.fn(({ signal }: { signal?: AbortSignal }) => {
			signal?.addEventListener(
				'abort',
				() => {
					reentrantRun = sandbox.run('IDENTIFICATION DIVISION.', false);
					void reentrantRun.catch(() => undefined);
				},
				{ once: true }
			);
			return new Promise<Uint8Array>(() => undefined);
		});
		const loading = sandbox.load({ clang: { loader } });

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const oldWorker = workerInstances[0];
		oldWorker.onmessage?.({
			data: {
				assetRequest: { id: 8, asset: 'bin/clang.wasm.gz' }
			}
		} as MessageEvent<any>);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());

		sandbox.terminate('stop COBOL asset startup');
		await expect(loading).rejects.toBe('stop COBOL asset startup');
		await expect(reentrantRun).rejects.toBe('Worker not loaded');
		expect(oldWorker.postMessage).toHaveBeenCalledOnce();

		autoResolveLoad = true;
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
	});

	it.each(['script error', 'message error'])(
		'releases startup ownership and the bridge after a worker $kind',
		async (kind) => {
			autoResolveLoad = false;
			const sandbox = new Cobol();
			const loading = sandbox.load('/assets');

			await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
			const worker = workerInstances[0];
			if (kind === 'script error') {
				worker.onerror?.({
					message: 'worker crashed',
					filename: '/worker/cobol.js',
					lineno: 4,
					colno: 2
				} as ErrorEvent);
			} else {
				worker.onmessageerror?.({ data: null } as MessageEvent<any>);
			}

			await expect(loading).rejects.toContain(
				kind === 'script error'
					? 'COBOL worker script error: worker crashed'
					: 'COBOL worker message deserialization failed'
			);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.assetBridge).toBeNull();

			autoResolveLoad = true;
			await expect(sandbox.load('/assets')).resolves.toBeUndefined();
			expect(workerInstances).toHaveLength(2);
		}
	);

	it('rejects reentrant startup operations from bridge progress', async () => {
		autoResolveLoad = false;
		const sandbox = new Cobol();
		let overlappingLoad: Promise<void> | undefined;
		let overlappingRun: Promise<boolean | string> | undefined;
		const loading = sandbox.load(
			'/assets',
			'',
			true,
			[],
			{},
			{
				set() {
					if (overlappingLoad) return;
					overlappingLoad = sandbox.load('/other-assets');
					overlappingRun = sandbox.run('IDENTIFICATION DIVISION.', false);
					void overlappingLoad.catch(() => undefined);
					void overlappingRun.catch(() => undefined);
				}
			}
		);

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		await expect(overlappingLoad).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'startup'
		});
		await expect(overlappingRun).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'startup'
		});
		const worker = workerInstances[0];
		expect(worker.postMessage).toHaveBeenCalledOnce();
		worker.resolveLoad();
		await expect(loading).resolves.toBeUndefined();
	});

	it('preserves a pending execution across run and load overlaps', async () => {
		const sandbox = new Cobol();
		await sandbox.load('/assets');
		autoResolveRun = false;
		const worker = workerInstances[0];
		const running = sandbox.run('IDENTIFICATION DIVISION.', false);
		const runHandler = worker.onmessage;

		await expect(sandbox.run('PROGRAM-ID. SECOND.', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'COBOL',
			phase: 'execute'
		});
		await expect(sandbox.load('/other-assets')).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'execute'
		});
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
		expect(worker.onmessage).toBe(runHandler);

		worker.resolveRun('first output\n');
		await expect(running).resolves.toBe(true);
		autoResolveRun = true;
		await expect(sandbox.run('PROGRAM-ID. RETRY.', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledTimes(3);
	});

	it('rejects reentrant operations from run progress without replacing the owner', async () => {
		const sandbox = new Cobol();
		await sandbox.load('/assets');
		autoResolveRun = false;
		const worker = workerInstances[0];
		let overlappingLoad: Promise<void> | undefined;
		let overlappingRun: Promise<boolean | string> | undefined;
		const running = sandbox.run('IDENTIFICATION DIVISION.', false, true, {
			set() {
				overlappingLoad = sandbox.load('/other-assets');
				overlappingRun = sandbox.run('PROGRAM-ID. SECOND.', false);
			}
		});
		const runHandler = worker.onmessage;

		runHandler?.({ data: { progress: 0.5 } } as MessageEvent<any>);
		await expect(overlappingLoad).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'execute'
		});
		await expect(overlappingRun).rejects.toMatchObject({
			name: 'BusyError',
			phase: 'execute'
		});
		expect(worker.onmessage).toBe(runHandler);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);

		worker.resolveRun();
		await expect(running).resolves.toBe(true);
	});

	it('keeps the asset bridge reachable after load and run settlement', async () => {
		const sandbox = new Cobol();
		const progress = { set: vi.fn() };
		await sandbox.load('/assets', '', true, [], {}, progress);
		const worker = workerInstances[0];
		progress.set.mockClear();

		worker.onmessage?.({
			data: {
				assetProgress: { asset: 'bin/clang.wasm.gz', loaded: 1, total: 2 }
			}
		} as MessageEvent<any>);
		expect(progress.set).toHaveBeenCalledWith(0.1);

		await sandbox.run('IDENTIFICATION DIVISION.', false);
		progress.set.mockClear();
		worker.onmessage?.({
			data: {
				assetProgress: { asset: 'bin/clang.wasm.gz', loaded: 2, total: 2 }
			}
		} as MessageEvent<any>);
		expect(progress.set).toHaveBeenCalledWith(0.2);
	});

	it('cleans up an unattached worker when load progress throws', async () => {
		const sandbox = new Cobol();
		const callbackError = new Error('COBOL progress callback failed');

		await expect(
			sandbox.load(
				'/assets',
				'',
				true,
				[],
				{},
				{
					set() {
						throw callbackError;
					}
				}
			)
		).rejects.toBe(callbackError);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeNull();
		expect(sandbox.assetBridge).toBeNull();

		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
	});

	it('releases startup ownership after synchronous worker dispatch failure', async () => {
		const sandbox = new Cobol();
		const dispatchError = new Error('COBOL load dispatch failed');
		loadDispatchError = dispatchError;

		await expect(sandbox.load('/assets')).rejects.toBe(dispatchError);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		loadDispatchError = undefined;
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
	});

	it('releases a rebound bridge after cached load dispatch failure', async () => {
		const sandbox = new Cobol();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const dispatchError = new Error('COBOL cached load dispatch failed');
		cachedLoadDispatchError = dispatchError;

		await expect(sandbox.load('/assets')).rejects.toBe(dispatchError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.assetBridge).toBeNull();

		cachedLoadDispatchError = undefined;
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
	});

	it('keeps the loaded worker reusable after synchronous run dispatch failure', async () => {
		const sandbox = new Cobol();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const assetBridge = sandbox.assetBridge;
		const dispatchError = new Error('COBOL run dispatch failed');
		runDispatchError = dispatchError;

		await expect(sandbox.run('IDENTIFICATION DIVISION.', false)).rejects.toBe(dispatchError);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.assetBridge).toBe(assetBridge);
		expect(worker.onmessage).toEqual(expect.any(Function));

		runDispatchError = undefined;
		await expect(sandbox.run('PROGRAM-ID. RETRY.', false)).resolves.toBe(true);
	});

	it('quarantines a worker when an execution callback throws', async () => {
		const sandbox = new Cobol();
		await sandbox.load('/assets');
		autoResolveRun = false;
		const worker = workerInstances[0];
		const callbackError = new Error('COBOL output callback failed');
		sandbox.output = () => {
			throw callbackError;
		};
		const running = sandbox.run('IDENTIFICATION DIVISION.', false);

		worker.resolveRun('output\n');

		await expect(running).rejects.toBe(callbackError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.assetBridge).toBeNull();

		autoResolveRun = true;
		sandbox.output = vi.fn();
		await sandbox.load('/assets');
		await expect(sandbox.run('PROGRAM-ID. RETRY.', false)).resolves.toBe(true);
	});

	it('stops processing a result after a reentrant termination callback', async () => {
		const sandbox = new Cobol();
		await sandbox.load('/assets');
		autoResolveRun = false;
		const worker = workerInstances[0];
		sandbox.output = () => sandbox.terminate('stopped from COBOL output');
		const running = sandbox.run('IDENTIFICATION DIVISION.', false);

		worker.resolveRun('stop\n');

		await expect(running).rejects.toBe('stopped from COBOL output');
		expect(worker.terminate).toHaveBeenCalledOnce();

		autoResolveRun = true;
		sandbox.output = vi.fn();
		await sandbox.load('/assets');
		await expect(sandbox.run('PROGRAM-ID. RETRY.', false)).resolves.toBe(true);
	});

	it('ignores stale output and asset progress after worker replacement', async () => {
		const sandbox = new Cobol();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets');
		autoResolveRun = false;
		const oldWorker = workerInstances[0];
		const oldRun = sandbox.run('IDENTIFICATION DIVISION.', false);
		const staleHandler = oldWorker.onmessage;

		sandbox.terminate('replace COBOL worker');
		const replacementProgress = { set: vi.fn() };
		autoResolveLoad = true;
		const replacementLoad = sandbox.load('/assets', '', true, [], {}, replacementProgress);

		await expect(oldRun).rejects.toBe('replace COBOL worker');
		await expect(replacementLoad).resolves.toBeUndefined();
		replacementProgress.set.mockClear();
		const replacementWorker = workerInstances[1];
		const replacementRun = sandbox.run('PROGRAM-ID. REPLACEMENT.', false);
		const replacementHandler = replacementWorker.onmessage;

		staleHandler?.({
			data: {
				assetProgress: { asset: 'bin/clang.wasm.gz', loaded: 1, total: 1 }
			}
		} as MessageEvent<any>);
		staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);

		expect(replacementProgress.set).not.toHaveBeenCalled();
		expect(output).not.toHaveBeenCalledWith('stale\n');
		expect(replacementWorker.onmessage).toBe(replacementHandler);

		replacementWorker.resolveRun('replacement\n');
		await expect(replacementRun).resolves.toBe(true);
		expect(output).toHaveBeenCalledWith('replacement\n');
	});
});
