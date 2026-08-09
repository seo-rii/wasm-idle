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

	it('rejects a pre-aborted Octave startup without changing runtime state', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		await sandbox.run('disp("create worker")', false);
		const worker = workerInstances[0];
		sandbox.write('queued before startup abort\n');
		const previousState = {
			baseUrl: sandbox.baseUrl,
			workerUrl: sandbox.workerUrl,
			manifestUrl: sandbox.manifestUrl,
			uid: sandbox.uid
		};
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		controller.abort(null);

		await expect(
			sandbox.load(
				{
					octave: {
						baseUrl: '/replacement/runtime/',
						workerUrl: '/replacement/worker.js',
						manifestUrl: '/replacement/manifest.json'
					}
				},
				'',
				true,
				[],
				{ signal: controller.signal }
			)
		).rejects.toBeNull();
		expect(addEventListener).not.toHaveBeenCalled();
		const fallbackSignal = {
			aborted: true,
			reason: undefined,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as AbortSignal;
		await expect(
			sandbox.load('/fallback/', '', true, [], { signal: fallbackSignal })
		).rejects.toMatchObject({
			name: 'AbortError',
			message: 'Octave runtime startup aborted'
		});
		expect({
			baseUrl: sandbox.baseUrl,
			workerUrl: sandbox.workerUrl,
			manifestUrl: sandbox.manifestUrl,
			uid: sandbox.uid
		}).toEqual(previousState);
		expect(sandbox.pendingInput).toEqual(['queued before startup abort\n']);
		expect(sandbox.worker).toBe(worker);
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('preserves an aborting Octave startup reason and replacement load state', async () => {
		const sandbox = new Octave();
		await sandbox.load('/initial/');
		await sandbox.run('disp("idle worker")', false);
		const idleWorker = workerInstances[0];
		sandbox.write('stale before replacement\n');
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const abortReason = new Error('abort Octave startup progress');
		const callbackError = new Error('throw after Octave startup abort');
		let replacement: Promise<void> | undefined;
		const loading = sandbox.load(
			{
				octave: {
					baseUrl: '/cancelled/runtime/',
					workerUrl: '/cancelled/worker.js',
					manifestUrl: '/cancelled/manifest.json'
				}
			},
			'',
			true,
			[],
			{ signal: controller.signal },
			{
				set() {
					controller.abort(abortReason);
					replacement = sandbox.load({
						octave: {
							baseUrl: '/replacement/runtime/',
							workerUrl: '/replacement/worker.js',
							manifestUrl: '/replacement/manifest.json'
						}
					});
					sandbox.write('replacement startup input\n');
					throw callbackError;
				}
			}
		);
		const outcome = loading.catch((error) => error);

		await expect(outcome).resolves.toBe(abortReason);
		await expect(replacement).resolves.toBeUndefined();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.baseUrl).toBe('http://localhost:3000/replacement/runtime/');
		expect(sandbox.workerUrl).toBe('http://localhost:3000/replacement/worker.js');
		expect(sandbox.manifestUrl).toBe('http://localhost:3000/replacement/manifest.json');
		expect(sandbox.pendingInput).toEqual(['replacement startup input\n']);
		expect(sandbox.worker).toBe(idleWorker);
		expect(idleWorker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('disp("replacement")', false)).resolves.toBe(true);
	});

	it('settles a progress-time Octave termination without clearing its replacement load', async () => {
		const sandbox = new Octave();
		await sandbox.load('/initial/');
		const terminationReason = new Error('terminate Octave startup progress');
		const callbackError = new Error('throw after Octave startup termination');
		let replacement: Promise<void> | undefined;
		const loading = sandbox.load(
			'/cancelled/',
			'',
			true,
			[],
			{},
			{
				set() {
					sandbox.terminate(terminationReason);
					replacement = sandbox.load('/replacement/');
					throw callbackError;
				}
			}
		);
		const outcome = loading.catch((error) => error);

		await expect(outcome).resolves.toBe(terminationReason);
		await expect(replacement).resolves.toBeUndefined();
		expect(sandbox.baseUrl).toBe('http://localhost:3000/replacement/wasm-octave/runtime/');
		await expect(sandbox.run('disp("replacement")', false)).resolves.toBe(true);
	});

	it('reserves Octave startup ownership before reading the signal getter', async () => {
		const sandbox = new Octave();
		await sandbox.load('/initial/');
		await sandbox.run('disp("idle worker")', false);
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Octave while reading the startup signal');
		let replacement: Promise<void> | undefined;
		let staleAssetReads = 0;
		const runtimeAssets = {
			get octave() {
				staleAssetReads += 1;
				return { baseUrl: '/superseded/' };
			}
		};
		const options = {
			get signal() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement/');
				return undefined;
			}
		};

		const superseded = sandbox.load(runtimeAssets, '', true, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleAssetReads).toBe(0);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.baseUrl).toBe('http://localhost:3000/replacement/wasm-octave/runtime/');
		await expect(sandbox.run('disp("replacement")', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('stops Octave startup when the aborted getter replaces its operation', async () => {
		const sandbox = new Octave();
		await sandbox.load('/initial/');
		const reason = new Error('replace Octave while reading startup aborted');
		let replacement: Promise<void> | undefined;
		let staleAssetReads = 0;
		const signal = {
			get aborted() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement/');
				return false;
			},
			get reason() {
				throw new Error('stale Octave startup reason was read');
			}
		} as unknown as AbortSignal;
		const runtimeAssets = {
			get octave() {
				staleAssetReads += 1;
				return { baseUrl: '/superseded/' };
			}
		};

		const superseded = sandbox.load(runtimeAssets, '', true, [], { signal });

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleAssetReads).toBe(0);
		expect(sandbox.baseUrl).toBe('http://localhost:3000/replacement/wasm-octave/runtime/');
	});

	it('preserves an Octave run started while an active load removes its signal listener', async () => {
		const sandbox = new Octave();
		await sandbox.load('/initial/');
		const reason = new Error('terminate active Octave load');
		let replacement: Promise<boolean | string> | undefined;
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(),
			removeEventListener() {
				replacement = sandbox.run('disp("replacement")', false);
			}
		} as unknown as AbortSignal;
		const runtimeAssets = {
			get octave() {
				sandbox.terminate(reason);
				return { baseUrl: '/superseded/' };
			}
		};

		const superseded = sandbox.load(runtimeAssets, '', true, [], { signal });

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
		expect(sandbox.baseUrl).toBe('http://localhost:3000/initial/wasm-octave/runtime/');
	});

	it('removes Octave startup listeners on success and callback failure', async () => {
		const sandbox = new Octave();
		const settledController = new AbortController();
		const settledRemoveEventListener = vi.spyOn(
			settledController.signal,
			'removeEventListener'
		);
		await sandbox.load('/settled/', '', true, [], { signal: settledController.signal });
		const settledState = [sandbox.baseUrl, sandbox.workerUrl, sandbox.manifestUrl];
		expect(settledRemoveEventListener).toHaveBeenCalledWith('abort', expect.any(Function));

		settledController.abort(new Error('late Octave startup abort'));
		expect([sandbox.baseUrl, sandbox.workerUrl, sandbox.manifestUrl]).toEqual(settledState);

		const callbackController = new AbortController();
		const callbackRemoveEventListener = vi.spyOn(
			callbackController.signal,
			'removeEventListener'
		);
		const callbackError = new Error('Octave startup progress failed');
		await expect(
			sandbox.load(
				'/failed/',
				'',
				true,
				[],
				{ signal: callbackController.signal },
				{
					set() {
						throw callbackError;
					}
				}
			)
		).rejects.toBe(callbackError);
		expect(callbackRemoveEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect([sandbox.baseUrl, sandbox.workerUrl, sandbox.manifestUrl]).toEqual(settledState);

		callbackController.abort(new Error('late failed Octave startup abort'));
		await expect(sandbox.load('/retry/')).resolves.toBeUndefined();
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

	it('reserves Octave run ownership before option getters and preserves its replacement', async () => {
		const sandbox = new Octave();
		await sandbox.load('/initial/');
		const reason = new Error('replace Octave while reading execution limits');
		let replacement: Promise<void> | undefined;
		let staleWorkspaceReads = 0;
		const options = {
			get limits() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement/');
				return undefined;
			},
			get workspaceFiles() {
				staleWorkspaceReads += 1;
				return [];
			}
		};

		const superseded = sandbox.run('disp("superseded")', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleWorkspaceReads).toBe(0);
		expect(sandbox.baseUrl).toBe('http://localhost:3000/replacement/wasm-octave/runtime/');
		await expect(sandbox.run('disp("replacement")', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});

	it('keeps the first Octave cancellation when the signal reason getter replaces the run', async () => {
		const sandbox = new Octave();
		await sandbox.load('/initial/');
		const firstReason = new Error('first Octave cancellation');
		const laterReason = new Error('later Octave signal reason');
		let replacement: Promise<void> | undefined;
		let staleArgumentReads = 0;
		const signal = {
			aborted: true,
			get reason() {
				sandbox.terminate(firstReason);
				replacement = sandbox.load('/replacement/');
				return laterReason;
			}
		} as unknown as AbortSignal;
		const options = {
			signal,
			get programArgs() {
				staleArgumentReads += 1;
				return [];
			}
		};

		const superseded = sandbox.run('disp("superseded")', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(firstReason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleArgumentReads).toBe(0);
		expect(sandbox.baseUrl).toBe('http://localhost:3000/replacement/wasm-octave/runtime/');
		await expect(sandbox.run('disp("replacement")', false)).resolves.toBe(true);
	});

	it('snapshots explicit Octave stdin once before asynchronous collection', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		let stdinReads = 0;
		const options = {
			get stdin() {
				stdinReads += 1;
				if (stdinReads > 1) throw new Error('Octave stdin was read more than once');
				return 'captured input\n';
			}
		};

		await expect(
			sandbox.run('n = str2double(fgetl(stdin));', false, true, undefined, [], options)
		).resolves.toBe(true);

		expect(stdinReads).toBe(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'captured input\n' })
		);
	});

	it('releases Octave run ownership when explicit stdin buffer reset fails', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		const originalBuffer = sandbox.buffer;
		sandbox.write('stale input\n');
		sandbox.eof();
		sandbox.buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);

		await expect(
			sandbox.run('value = fgetl(stdin);', false, true, undefined, [], { stdin: 'input\n' })
		).rejects.toMatchObject({ name: 'RangeError' });
		expect(workerInstances).toHaveLength(0);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);

		sandbox.buffer = originalBuffer;
		const retry = sandbox.run('value = fgetl(stdin);', false);
		sandbox.write('fresh input\n');
		sandbox.eof();
		await expect(retry).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'fresh input\n' })
		);
	});

	it('releases Octave run ownership when signal listener registration throws', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		const listenerError = new Error('Octave signal listener registration failed');
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener() {
				throw listenerError;
			},
			removeEventListener: vi.fn()
		} as unknown as AbortSignal;

		await expect(
			sandbox.run('disp("fail")', false, true, undefined, [], { signal })
		).rejects.toBe(listenerError);
		expect(workerInstances).toHaveLength(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('disp("retry")', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
	});

	it('preserves an Octave replacement started during signal listener cleanup', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		let replacement: Promise<boolean | string> | undefined;
		let removeCalls = 0;
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(),
			removeEventListener() {
				removeCalls += 1;
				if (removeCalls !== 1) return;
				replacement = sandbox.run('value = fgetl(stdin);', false);
				sandbox.write('replacement input\n');
				sandbox.eof();
			}
		} as unknown as AbortSignal;

		const completed = sandbox.run('disp("completed")', false, true, undefined, [], { signal });

		await expect(completed).resolves.toBe(true);
		await expect(replacement).resolves.toBe(true);
		expect(removeCalls).toBe(1);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'replacement input\n' })
		);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
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

	it.each(['progress', 'output'] as const)(
		'rejects and retires the Octave worker when a %s callback throws',
		async (callbackKind) => {
			const sandbox = new Octave();
			await sandbox.load('/absproxy/5173');
			onPostMessage = () => undefined;
			const callbackError = new Error(`Octave ${callbackKind} callback failed`);
			const controller = new AbortController();
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const progress =
				callbackKind === 'progress'
					? {
							set: vi.fn(() => {
								throw callbackError;
							})
						}
					: undefined;
			sandbox.output =
				callbackKind === 'output'
					? () => {
							throw callbackError;
						}
					: vi.fn();
			const running = sandbox.run(
				'n = str2double(fgetl(stdin));',
				false,
				true,
				progress,
				[],
				{ stdin: 'fixed\n', signal: controller.signal }
			);
			await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
			const worker = workerInstances[0];
			const staleHandler = worker.onmessage;
			sandbox.write('discard after explicit stdin\n');

			staleHandler?.({
				data: {
					progress: callbackKind === 'progress' ? { percent: 50 } : undefined,
					output: callbackKind === 'output' ? 'callback output\n' : undefined,
					results: true
				}
			} as MessageEvent<any>);

			await expect(running).rejects.toBe(callbackError);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			expect((sandbox as any).activeRun).toBeNull();

			staleHandler?.({
				data: { progress: { percent: 75 }, output: 'stale\n', results: true }
			} as MessageEvent<any>);
			sandbox.output = vi.fn();
			onPostMessage = null;
			await expect(sandbox.run('disp("retry")', false)).resolves.toBe(true);
			expect(workerInstances).toHaveLength(2);
		}
	);

	it('preserves abort and replacement stdin when an Octave output callback subsequently throws', async () => {
		const sandbox = new Octave();
		await sandbox.load('/absproxy/5173');
		onPostMessage = () => undefined;
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const abortReason = new Error('abort Octave output callback');
		const callbackError = new Error('throw after Octave abort');
		sandbox.output = () => {
			controller.abort(abortReason);
			sandbox.write('replacement Octave input\n');
			sandbox.eof();
			throw callbackError;
		};
		const running = sandbox.run('n = str2double(fgetl(stdin));', false, true, undefined, [], {
			stdin: '',
			signal: controller.signal
		});
		const outcome = running.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;
		sandbox.write('discard before abort\n');

		staleHandler?.({ data: { output: 'trigger abort\n', results: true } } as MessageEvent<any>);

		await expect(outcome).resolves.toBe(abortReason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.pendingInput).toEqual(['replacement Octave input\n']);
		expect(sandbox.pendingEof).toBe(true);

		sandbox.output = vi.fn();
		const retry = sandbox.run('n = str2double(fgetl(stdin));', false);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const replacement = workerInstances[1];
		const replacementHandler = replacement.onmessage;
		expect(replacement.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ stdin: 'replacement Octave input\n' })
		);

		staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
		expect(replacement.onmessage).toBe(replacementHandler);
		replacementHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(retry).resolves.toBe(true);
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
		controller.abort(null);

		await expect(
			sandbox.run('disp("cancelled")', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBeNull();

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
