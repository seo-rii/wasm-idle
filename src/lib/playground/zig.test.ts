import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_ZIG_COMPILER_URL: '',
		PUBLIC_WASM_ZIG_STDLIB_URL: ''
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
			queueMicrotask(() =>
				this.onmessage?.({
					data: {
						progress: { percent: 100 },
						load: true
					}
				} as MessageEvent<any>)
			);
			return;
		}
		if (message.prepare) {
			queueMicrotask(() =>
				this.onmessage?.({
					data: {
						output: 'zig artifact ready\n',
						results: true,
						buffer: true
					}
				} as MessageEvent<any>)
			);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'zig-ok\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/zig?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Zig from './zig';
import { WASM_ZIG_ASSET_RECEIPTS } from './wasmZigVersion';
import type { ZigExecutionAssetReceipts } from './zigAssets';

describe('Zig sandbox', () => {
	beforeEach(() => {
		vi.useRealTimers();
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_ZIG_COMPILER_URL = '/wasm-zig/zig_small.wasm';
		publicEnv.PUBLIC_WASM_ZIG_STDLIB_URL = '/wasm-zig/std.tar.gz';
		suppressAutoLoadAck = false;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads the Zig worker and forwards prepare/run requests', async () => {
		const sandbox = new Zig();
		const outputs: string[] = [];
		const progressValues: number[] = [];
		const code = 'pub fn main() void {}';
		const helperFile = { path: 'src/helper.zig', content: 'pub const bonus = 3;' };
		const workspaceFiles = [{ path: 'src/main.zig', content: code }, helperFile];

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{},
			{
				set(value) {
					progressValues.push(value);
				}
			}
		);
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				activePath: 'src/main.zig',
				workspaceFiles,
				compileArgs: ['-O', 'Debug']
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['one'], {
				stdin: '5\n'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				compilerUrl: expect.stringMatching(/\/wasm-zig\/zig_small\.wasm$/),
				stdlibUrl: expect.stringMatching(/\/wasm-zig\/std\.tar\.gz$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: [],
				compileArgs: ['-O', 'Debug'],
				activePath: 'src/main.zig',
				workspaceFiles: [helperFile],
				targetTriple: 'wasm64-wasi',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['one'],
				stdin: '5\n',
				activePath: 'main.zig',
				targetTriple: 'wasm64-wasi',
				log: true
			})
		);
		expect(progressValues).toContain(1);
		expect(outputs).toEqual(['zig artifact ready\n', 'zig-ok\n']);
	});

	it('rejects malformed or over-limit receipts before creating a worker', async () => {
		const sandbox = new Zig();
		const urls = {
			compilerUrl: '/wasm-zig/zig_small.wasm',
			stdlibUrl: '/wasm-zig/std.tar.gz'
		};

		await expect(
			sandbox.load({
				zig: {
					...urls,
					integrity: {
						'zig_small.wasm': WASM_ZIG_ASSET_RECEIPTS['zig_small.wasm']
					} as never
				}
			})
		).rejects.toThrow('exactly two asset receipts');
		expect(workerInstances).toHaveLength(0);

		await expect(
			sandbox.load({ zig: { ...urls, integrity: WASM_ZIG_ASSET_RECEIPTS } }, '', true, [], {
				limits: {
					maxAssetBytes: WASM_ZIG_ASSET_RECEIPTS['std.tar.gz'].uncompressedBytes - 1
				}
			})
		).rejects.toContain('byte limit');
		expect(workerInstances).toHaveLength(0);
	});

	it('replaces a warm worker when only the pinned receipt changes', async () => {
		const sandbox = new Zig();
		const firstIntegrity = structuredClone(WASM_ZIG_ASSET_RECEIPTS);
		const secondIntegrity = {
			...structuredClone(WASM_ZIG_ASSET_RECEIPTS),
			'zig_small.wasm': {
				...WASM_ZIG_ASSET_RECEIPTS['zig_small.wasm'],
				sha256: 'd'.repeat(64)
			}
		};
		const runtimeAssets = (integrity: ZigExecutionAssetReceipts) => ({
			rootUrl: '/absproxy/5173',
			zig: { integrity }
		});

		await sandbox.load(runtimeAssets(firstIntegrity));
		const firstWorker = workerInstances[0];
		await sandbox.load(runtimeAssets(secondIntegrity));

		expect(workerInstances).toHaveLength(2);
		expect(firstWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				integrity: expect.objectContaining({
					'zig_small.wasm': expect.objectContaining({ sha256: 'd'.repeat(64) })
				}),
				maxAssetBytes: expect.any(Number)
			})
		);
	});

	it('terminates Zig output before exceeding the cumulative UTF-8 byte limit', async () => {
		const sandbox = new Zig();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('pub fn main() void {}', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const staleHandler = worker.onmessage;

		staleHandler?.({ data: { output: 'é' } } as MessageEvent<any>);
		staleHandler?.({ data: { output: '🙂' } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'ZIG',
			actual: 6,
			limit: 5
		});
		expect(output).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith('é');
		expect(output).not.toHaveBeenCalledWith('🙂');
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalledWith('stale\n');

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('terminates Zig diagnostics before exceeding the message limit', async () => {
		const sandbox = new Zig();
		const oncompilerdiagnostic = vi.fn();
		sandbox.oncompilerdiagnostic = oncompilerdiagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('pub fn main() void {}', true, true, undefined, [], {
			limits: { maxDiagnostics: 1 }
		});
		const staleHandler = worker.onmessage;
		const diagnostic = {
			fileName: 'main.zig',
			lineNumber: 1,
			columnNumber: 1,
			severity: 'warning',
			message: 'bounded warning'
		};

		staleHandler?.({ data: { diagnostic } } as MessageEvent<any>);
		staleHandler?.({ data: { diagnostic } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'DiagnosticLimitError',
			code: 'diagnostic-limit',
			phase: 'execute',
			runtimeId: 'ZIG',
			actual: 2,
			limit: 1
		});
		expect(oncompilerdiagnostic).toHaveBeenCalledOnce();
		expect(oncompilerdiagnostic).toHaveBeenCalledWith(diagnostic);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { diagnostic, results: true } } as MessageEvent<any>);
		expect(oncompilerdiagnostic).toHaveBeenCalledOnce();
	});

	it('normalizes a valid Zig workspace before worker dispatch', async () => {
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run('pub fn main() void {}', false, true, undefined, [], {
				activePath: 'nested\\main.zig',
				workspaceFiles: [{ path: 'fixtures\\helper.zig', content: 'pub const helper = 1;' }]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				activePath: 'nested/main.zig',
				workspaceFiles: [{ path: 'fixtures/helper.zig', content: 'pub const helper = 1;' }]
			})
		);
	});

	it.each([
		{
			name: 'traversal path',
			code: 'A',
			options: { activePath: '../main.zig' },
			expected: { code: 'invalid-path', path: '../main.zig' }
		},
		{
			name: 'absolute path',
			code: 'A',
			options: { activePath: '/tmp/main.zig' },
			expected: { code: 'invalid-path', path: '/tmp/main.zig' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: { activePath: 'bad\0.zig' },
			expected: { code: 'invalid-path', path: 'bad\0.zig' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'data/module.zig', content: 'A' },
					{ path: 'data/module.zig', content: 'B' }
				]
			},
			expected: { code: 'duplicate-path', path: 'data/module.zig' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'DATA/module.zig', content: 'A' },
					{ path: 'data/module.zig', content: 'B' }
				]
			},
			expected: { code: 'case-collision', path: 'data/module.zig' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'data/module.zig', content: 'B' }],
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
				workspaceFiles: [{ path: 'data/module.zig', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a Zig workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new Zig();
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

	it('rejects an overlapping Zig run without disturbing the active execution', async () => {
		const sandbox = new Zig();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		sandbox.output = (chunk: string) => outputs.push(chunk);

		const firstRun = sandbox.run('pub fn main() void {}', false);
		const firstHandler = worker.onmessage;
		await expect(sandbox.run('pub fn main() void {}', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ZIG'
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
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
	});

	it('rejects a pre-aborted Zig run without changing worker state', async () => {
		const sandbox = new Zig();
		const worker = new MockWorker();
		const originalHandler = vi.fn();
		worker.onmessage = originalHandler;
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const reason = new Error('Zig pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.run('pub fn main() void {}', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.onmessage).toBe(originalHandler);
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
		expect(worker.postMessage).toHaveBeenCalledOnce();
	});

	it('aborts an active Zig run with its exact reason and permits a clean retry', async () => {
		const sandbox = new Zig();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const outputs: string[] = [];
		const progress = { set: vi.fn() };
		sandbox.output = (chunk: string) => outputs.push(chunk);
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Zig active abort');

		const running = sandbox.run('pub fn main() void {}', false, true, progress, [], {
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
			sandbox.run('pub fn main() void {}', false, true, undefined, [], {
				signal: settledController.signal
			})
		).resolves.toBe(true);
		expect(retryWorker.terminate).not.toHaveBeenCalled();

		settledController.abort(new Error('late abort'));
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('rejects overlapping Zig startup operations without superseding readiness', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Zig();
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const loadHandler = worker.onmessage;

		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ZIG'
		});
		await expect(sandbox.run('pub fn main() void {}', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ZIG'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(loadHandler);

		loadHandler?.({ data: { load: true } } as MessageEvent<any>);
		await expect(loading).resolves.toBeUndefined();
		suppressAutoLoadAck = false;
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
	});

	it('rejects a pre-aborted Zig startup without changing an existing worker', async () => {
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockClear();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const reason = new Error('Zig startup pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal }, progress)
		).rejects.toBe(reason);

		expect(sandbox.worker).toBe(worker);
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('aborts an active Zig startup and ignores stale completion', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Zig();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('Zig startup aborted');
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

	it.each([
		{ stage: 'streamed', message: { progress: { percent: 50 } } },
		{ stage: 'ready', message: { load: true } }
	])('retires the Zig worker when the $stage progress callback throws', async ({ message }) => {
		suppressAutoLoadAck = true;
		const sandbox = new Zig();
		const callbackError = new Error('Zig startup progress failed');
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const progress = {
			set: vi.fn(() => {
				throw callbackError;
			})
		};
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

		expect(() => staleHandler?.({ data: message } as MessageEvent<any>)).not.toThrow();
		await expect(loading).rejects.toBe(callbackError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(sandbox.worker).toBeUndefined();
		controller.abort(new Error('late failed startup abort'));
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(progress.set).toHaveBeenCalledOnce();

		suppressAutoLoadAck = false;
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
	});

	it('preserves a Zig replacement after startup progress terminates and throws', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Zig();
		const terminationReason = new Error('terminate Zig startup progress');
		const callbackError = new Error('Zig startup callback throw after termination');
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
					suppressAutoLoadAck = false;
					replacement = sandbox.load('/replacement/');
					throw callbackError;
				}
			}
		);
		await vi.dynamicImportSettled();
		const staleHandler = workerInstances[0].onmessage;

		expect(() =>
			staleHandler?.({ data: { progress: { percent: 50 } } } as MessageEvent<any>)
		).not.toThrow();
		await expect(loading).rejects.toBe(terminationReason);
		await expect(replacement).resolves.toBeUndefined();
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[0]?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('keeps the active Zig operation while callbacks attempt reentrant work', async () => {
		const sandbox = new Zig();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		let reentrantRun: Promise<boolean | string> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		sandbox.output = () => {
			reentrantRun = sandbox.run('pub fn main() void {}', false);
			reentrantLoad = sandbox.load('/replacement/');
		};

		const running = sandbox.run('pub fn main() void {}', false);
		const handler = worker.onmessage;
		handler?.({ data: { output: 'trigger\n', results: true } } as MessageEvent<any>);

		await expect(reentrantRun).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ZIG'
		});
		await expect(reentrantLoad).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ZIG'
		});
		await expect(running).resolves.toBe(true);
		expect(worker.onmessage).toBeNull();
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('preserves a replacement after a Zig callback terminates and throws', async () => {
		const sandbox = new Zig();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const abortReason = new Error('Zig callback abort');
		const callbackError = new Error('Zig callback throw after abort');
		let replacement: Promise<void> | undefined;
		sandbox.output = () => {
			controller.abort(abortReason);
			replacement = sandbox.load('/replacement/');
			throw callbackError;
		};
		const running = sandbox.run('pub fn main() void {}', false, true, undefined, [], {
			stdin: 'fixed\n',
			signal: controller.signal
		});
		const outcome = running.catch((error) => error);
		const staleHandler = worker.onmessage;

		expect(() =>
			staleHandler?.({ data: { output: 'trigger\n', results: true } } as MessageEvent<any>)
		).not.toThrow();
		await expect(outcome).resolves.toBe(abortReason);
		await expect(replacement).resolves.toBeUndefined();
		const replacementWorker = workerInstances.at(-1)!;
		const replacementHandler = replacementWorker.onmessage;
		sandbox.write('replacement input\n');
		sandbox.eof();

		staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBe(replacementWorker);
		expect(replacementWorker.onmessage).toBe(replacementHandler);
		expect(sandbox.pendingInput).toEqual(['replacement input\n']);
		expect(sandbox.pendingEof).toBe(true);
	});

	it.each(['progress', 'output', 'diagnostic'] as const)(
		'rejects and retires the Zig worker when a %s callback throws',
		async (callbackKind) => {
			const sandbox = new Zig();
			const worker = new MockWorker();
			worker.postMessage.mockImplementation(() => undefined);
			sandbox.worker = worker as unknown as Worker;
			const callbackError = new Error(`Zig ${callbackKind} callback failed`);
			const controller = new AbortController();
			const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
			const progress = {
				set: vi.fn(() => {
					if (callbackKind === 'progress') throw callbackError;
				})
			};
			const output = vi.fn(() => {
				if (callbackKind === 'output') throw callbackError;
			});
			const diagnostic = vi.fn(() => {
				if (callbackKind === 'diagnostic') throw callbackError;
			});
			sandbox.output = output;
			sandbox.oncompilerdiagnostic = diagnostic;

			const running = sandbox.run('pub fn main() void {}', false, true, progress, [], {
				stdin: 'fixed\n',
				signal: controller.signal
			});
			const handler = worker.onmessage;
			sandbox.write('discard after explicit stdin\n');
			expect(() =>
				handler?.({
					data: {
						progress: 0.5,
						output: 'callback output\n',
						diagnostic: { message: 'callback diagnostic' },
						results: true
					}
				} as MessageEvent<any>)
			).not.toThrow();

			await expect(running).rejects.toBe(callbackError);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(worker.onmessage).toBeNull();
			expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			if (callbackKind === 'progress') {
				expect(output).not.toHaveBeenCalled();
				expect(diagnostic).not.toHaveBeenCalled();
			} else if (callbackKind === 'output') {
				expect(diagnostic).not.toHaveBeenCalled();
			}

			handler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
			sandbox.output = vi.fn();
			sandbox.oncompilerdiagnostic = vi.fn();
			await sandbox.load('/absproxy/5173');
			await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
			expect(workerInstances.at(-1)).not.toBe(worker);
		}
	);

	it('releases the Zig operation after a normal worker error', async () => {
		const sandbox = new Zig();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const runtimeError = new Error('Zig worker execution failed');

		const running = sandbox.run('pub fn main() void {}', false);
		worker.onmessage?.({ data: { error: runtimeError } } as MessageEvent<any>);

		await expect(running).rejects.toBe(runtimeError);
		expect(worker.onmessage).toBeNull();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.exit).toBe(true);

		worker.postMessage.mockImplementationOnce(() => {
			queueMicrotask(() => {
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
	});

	it('rejects Zig load while a run is active without replacing its handler', async () => {
		const sandbox = new Zig();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;

		const running = sandbox.run('pub fn main() void {}', false);
		const runHandler = worker.onmessage;
		await expect(sandbox.load('/absproxy/5173')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ZIG'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(runHandler);

		runHandler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(running).resolves.toBe(true);
	});

	it('releases Zig run activity after synchronous dispatch failure', async () => {
		const sandbox = new Zig();
		const worker = new MockWorker();
		const dispatchError = new Error('Zig dispatch failed');
		worker.postMessage.mockImplementationOnce(() => {
			throw dispatchError;
		});
		sandbox.worker = worker as unknown as Worker;

		await expect(sandbox.run('pub fn main() void {}', false)).rejects.toBe(dispatchError);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
	});

	it('keeps Zig execution idle when no worker is loaded', async () => {
		const sandbox = new Zig();

		await expect(sandbox.run('pub fn main() void {}', false)).rejects.toBe('Worker not loaded');
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
	});

	it('releases Zig startup activity after termination', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Zig();
		const loading = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		sandbox.terminate();
		await expect(loading).rejects.toBe('Process terminated');
		expect(worker.terminate).toHaveBeenCalledOnce();

		suppressAutoLoadAck = false;
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
	});

	it('rejects load when Zig compiler or stdlib assets are not configured', async () => {
		publicEnv.PUBLIC_WASM_ZIG_COMPILER_URL = '';
		publicEnv.PUBLIC_WASM_ZIG_STDLIB_URL = '';
		const sandbox = new Zig();

		await expect(sandbox.load({})).rejects.toContain('Zig runtime is not configured');
	});

	it('rejects load when the worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Zig();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/zig.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Zig worker script error: worker script error (/worker/zig.js:88:24)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Zig();
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

		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});

	it('clears queued input before an explicit Zig stdin run', async () => {
		const sandbox = new Zig();
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
			sandbox.run('pub fn main() void {}', false, true, undefined, [], {
				stdin: 'injected\n'
			})
		).resolves.toBe(true);
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);

		expect(runMessages).toHaveLength(2);
		expect(runMessages[0].stdin).toBe('injected\n');
		expect(runMessages[1].stdin).toBeUndefined();
		expect(bufferedValues).toEqual(['', '']);
	});

	it('does not stream terminal input into an explicit Zig stdin run', async () => {
		const sandbox = new Zig();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;

		const running = sandbox.run('pub fn main() void {}', false, true, undefined, [], {
			stdin: 'authoritative\n'
		});
		const handler = worker.onmessage;
		sandbox.write('terminal input\n');
		handler?.({ data: { buffer: true } } as MessageEvent<any>);

		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		expect(sandbox.pendingInput).toEqual(['terminal input\n']);
		handler?.({ data: { results: true } } as MessageEvent<any>);
		await expect(running).resolves.toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
	});

	it('preserves an exact null pre-abort reason without changing idle Zig state', async () => {
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		const compilerUrl = sandbox.compilerUrl;
		const stdlibUrl = sandbox.stdlibUrl;
		const uid = sandbox.uid;
		sandbox.write('queued input\n');
		const controller = new AbortController();
		controller.abort(null);

		await expect(
			sandbox.load('/replacement', '', true, [], { signal: controller.signal })
		).rejects.toBeNull();
		await expect(
			sandbox.run('pub fn main() void {}', false, true, undefined, [], {
				signal: controller.signal,
				stdin: ''
			})
		).rejects.toBeNull();

		expect(sandbox.worker).toBe(worker);
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(sandbox.compilerUrl).toBe(compilerUrl);
		expect(sandbox.stdlibUrl).toBe(stdlibUrl);
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);
	});

	it('preserves replacement startup when the outer signal getter terminates Zig', async () => {
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Zig during startup option snapshot');
		let replacement: Promise<void> | undefined;
		const options = {
			get signal() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement');
				return undefined;
			}
		};

		const superseded = sandbox.load('/outer', '', true, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('preserves the first cancellation and replacement across later Zig option failure', async () => {
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Zig during execution option snapshot');
		const laterError = new Error('later Zig workspace getter failed');
		let replacement: Promise<void> | undefined;
		const options = {
			get limits() {
				sandbox.terminate(reason);
				replacement = sandbox.load('/replacement');
				return undefined;
			},
			get workspaceFiles(): never {
				throw laterError;
			}
		};

		const superseded = sandbox.run(
			'pub fn main() void {}',
			false,
			true,
			undefined,
			[],
			options
		);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(retiredWorker.postMessage).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('preserves a Zig replacement when a later option getter aborts the snapshot', async () => {
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const controller = new AbortController();
		const reason = new Error('abort Zig during execution option snapshot');
		let replacement: Promise<void> | undefined;
		const options = {
			signal: controller.signal,
			get limits() {
				controller.abort(reason);
				replacement = sandbox.load({
					zig: {
						compilerUrl: '/replacement/zig.wasm',
						stdlibUrl: '/replacement/std.tar.gz'
					}
				});
				return undefined;
			}
		};

		const superseded = sandbox.run(
			'pub fn main() void {}',
			false,
			true,
			undefined,
			[],
			options
		);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(retiredWorker.postMessage).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('snapshots each explicit Zig runtime asset once without reading the root URL', async () => {
		const sandbox = new Zig();
		const reads = { rootUrl: 0, zig: 0, compilerUrl: 0, stdlibUrl: 0 };
		const runtimeConfig = {
			get compilerUrl() {
				reads.compilerUrl += 1;
				return '/snapshot/zig.wasm';
			},
			get stdlibUrl() {
				reads.stdlibUrl += 1;
				return '/snapshot/std.tar.gz';
			}
		};
		const runtimeAssets = {
			get rootUrl() {
				reads.rootUrl += 1;
				return '/snapshot-root';
			},
			get zig() {
				reads.zig += 1;
				return runtimeConfig;
			}
		};

		await sandbox.load(runtimeAssets);

		expect(reads).toEqual({ rootUrl: 0, zig: 1, compilerUrl: 1, stdlibUrl: 1 });
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				compilerUrl: expect.stringMatching(/\/snapshot\/zig\.wasm$/),
				stdlibUrl: expect.stringMatching(/\/snapshot\/std\.tar\.gz$/)
			})
		);
		expect(sandbox.compilerUrl).toMatch(/\/snapshot\/zig\.wasm$/);
		expect(sandbox.stdlibUrl).toMatch(/\/snapshot\/std\.tar\.gz$/);
	});

	it('reads the Zig root URL once when both runtime assets use fallback resolution', async () => {
		publicEnv.PUBLIC_WASM_ZIG_COMPILER_URL = '';
		publicEnv.PUBLIC_WASM_ZIG_STDLIB_URL = '';
		const sandbox = new Zig();
		let rootUrlReads = 0;
		const runtimeAssets = {
			get rootUrl() {
				rootUrlReads += 1;
				return '/fallback';
			}
		};

		await sandbox.load(runtimeAssets);

		expect(rootUrlReads).toBe(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				compilerUrl: expect.stringMatching(/\/fallback\/wasm-zig\/zig_small\.wasm$/),
				stdlibUrl: expect.stringMatching(/\/fallback\/wasm-zig\/std\.tar\.gz$/)
			})
		);
	});

	it('ignores a Zig config after its top-level getter starts a replacement', async () => {
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Zig while reading the runtime config');
		let replacement: Promise<void> | undefined;
		let staleCompilerReads = 0;
		const runtimeAssets = {
			get zig() {
				sandbox.terminate(reason);
				replacement = sandbox.load({
					zig: {
						compilerUrl: '/replacement/zig.wasm',
						stdlibUrl: '/replacement/std.tar.gz'
					}
				});
				return {
					get compilerUrl() {
						staleCompilerReads += 1;
						return '/superseded/zig.wasm';
					},
					stdlibUrl: '/superseded/std.tar.gz'
				};
			}
		};

		const superseded = sandbox.load(runtimeAssets);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleCompilerReads).toBe(0);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(sandbox.compilerUrl).toMatch(/\/replacement\/zig\.wasm$/);
		expect(sandbox.stdlibUrl).toMatch(/\/replacement\/std\.tar\.gz$/);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('ignores resolved Zig assets after the compiler resolver starts a replacement', async () => {
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace Zig while resolving assets');
		let replacement: Promise<void> | undefined;
		let staleStdlibReads = 0;
		const runtimeAssets = {
			zig: {
				get compilerUrl() {
					sandbox.terminate(reason);
					replacement = sandbox.load({
						zig: {
							compilerUrl: '/replacement/zig.wasm',
							stdlibUrl: '/replacement/std.tar.gz'
						}
					});
					return '/superseded/zig.wasm';
				},
				get stdlibUrl() {
					staleStdlibReads += 1;
					return '/superseded/std.tar.gz';
				}
			}
		};

		const superseded = sandbox.load(runtimeAssets);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(staleStdlibReads).toBe(0);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(sandbox.compilerUrl).toMatch(/\/replacement\/zig\.wasm$/);
		expect(sandbox.stdlibUrl).toMatch(/\/replacement\/std\.tar\.gz$/);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('reads explicit Zig stdin and target triple once before worker dispatch', async () => {
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173');
		let stdinReads = 0;
		let targetReads = 0;
		const options = {
			get zigTargetTriple() {
				targetReads += 1;
				if (targetReads > 1) throw new Error('Zig target was read more than once');
				return 'wasm64-wasi' as const;
			},
			get stdin() {
				stdinReads += 1;
				if (stdinReads > 1) throw new Error('Zig stdin was read more than once');
				return 'captured input\n';
			}
		};

		await expect(
			sandbox.run('pub fn main() void {}', false, true, undefined, [], options)
		).resolves.toBe(true);

		expect({ stdinReads, targetReads }).toEqual({ stdinReads: 1, targetReads: 1 });
		expect(workerInstances[0].postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				stdin: 'captured input\n',
				targetTriple: 'wasm64-wasi'
			})
		);
	});

	it('enforces the aggregate Zig startup deadline and ignores stale readiness', async () => {
		vi.useFakeTimers();
		suppressAutoLoadAck = true;
		const sandbox = new Zig();
		const progress = { set: vi.fn() };
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 } },
			progress
		);
		const rejected = expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'ZIG',
			timeoutMs: 12
		});
		await vi.dynamicImportSettled();
		const retiredWorker = workerInstances[0];
		const staleHandler = retiredWorker.onmessage;

		await vi.advanceTimersByTimeAsync(12);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { progress: 0.5, load: true } } as MessageEvent<any>);
		expect(progress.set).not.toHaveBeenCalled();
		suppressAutoLoadAck = false;
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('enforces the aggregate Zig execution deadline and permits a clean retry', async () => {
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		retiredWorker.postMessage.mockImplementationOnce(() => undefined);
		const output = vi.fn();
		const progress = { set: vi.fn() };
		sandbox.output = output;
		vi.useFakeTimers();
		const running = sandbox.run('pub fn main() void {}', false, true, progress, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'ZIG',
			timeoutMs: 10
		});
		const staleHandler = retiredWorker.onmessage;

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({
			data: { output: 'stale output', progress: 0.5, results: true }
		} as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('clears settled Zig deadlines before they can retire an idle worker', async () => {
		vi.useFakeTimers();
		const sandbox = new Zig();
		await sandbox.load('/absproxy/5173', '', true, [], {
			limits: { assetTimeoutMs: 2, startupTimeoutMs: 3 }
		});
		const worker = workerInstances[0];
		await expect(
			sandbox.run('pub fn main() void {}', false, true, undefined, [], {
				limits: { compileTimeoutMs: 2, runTimeoutMs: 3 }
			})
		).resolves.toBe(true);

		await vi.advanceTimersByTimeAsync(10);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
	});

	it('keeps clear reusable but disposes an idle Zig runtime exactly once', async () => {
		const sandbox = new Zig();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];

		await sandbox.clear();
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('pub fn main() void {}', false)).resolves.toBe(true);
		sandbox.write('queued input\n');
		sandbox.eof();
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.pendingEof).toBe(true);

		let cleanupSnapshot: Record<string, unknown> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		let reentrantDisposal: Promise<void> | undefined;
		worker.terminate.mockImplementationOnce(() => {
			cleanupSnapshot = {
				worker: sandbox.worker,
				compilerUrl: sandbox.compilerUrl,
				stdlibUrl: sandbox.stdlibUrl,
				assetKey: sandbox.assetKey,
				output: sandbox.output,
				diagnostic: sandbox.oncompilerdiagnostic,
				pendingInput: [...sandbox.pendingInput],
				waitingForInput: sandbox.waitingForInput,
				pendingEof: sandbox.pendingEof,
				bufferedInput: readBufferedStdin(sandbox.buffer)
			};
			reentrantLoad = sandbox.load('/reentrant');
			reentrantDisposal = sandbox.dispose();
		});
		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();
		expect(secondDisposal).toBe(firstDisposal);
		expect(reentrantDisposal).toBe(firstDisposal);
		const reentrantLoadResult = expect(reentrantLoad!).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'ZIG'
		});
		await firstDisposal;
		expect(cleanupSnapshot).toEqual({
			worker: undefined,
			compilerUrl: '',
			stdlibUrl: '',
			assetKey: '',
			output: null,
			diagnostic: undefined,
			pendingInput: [],
			waitingForInput: false,
			pendingEof: false,
			bufferedInput: ''
		});
		await reentrantLoadResult;

		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(worker.onmessageerror).toBeNull();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.compilerUrl).toBe('');
		expect(sandbox.stdlibUrl).toBe('');
		expect(sandbox.assetKey).toBe('');
		expect(sandbox.output).toBeNull();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();

		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'ZIG'
		});
		await expect(sandbox.run('pub fn main() void {}', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'ZIG'
		});
		sandbox.write('ignored input\n');
		sandbox.eof();
		sandbox.terminate();
		await sandbox.clear();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(1);
	});

	it('settles active Zig startup with one stable disposal cancellation', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Zig();
		const loading = sandbox.load('/absproxy/5173');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;

		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();
		expect(secondDisposal).toBe(firstDisposal);
		const cancellation = await loading.catch((error) => error);
		await firstDisposal;

		expect(cancellation).toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'ZIG',
			recoverable: false
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.compilerUrl).toBe('');
		expect(sandbox.stdlibUrl).toBe('');
		expect(sandbox.assetKey).toBe('');
		expect(workerInstances).toHaveLength(1);
	});

	it('settles an active Zig run, clears stdin, and ignores retained messages after disposal', async () => {
		const sandbox = new Zig();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('pub fn main() void {}', false);
		const staleHandler = worker.onmessage;
		const cancellation = running.catch((error) => error);
		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		sandbox.write('active input\n');
		sandbox.eof();
		expect(readBufferedStdin(sandbox.buffer)).toBe('active input\n');
		expect(sandbox.pendingEof).toBe(true);

		await sandbox.dispose();
		await expect(cancellation).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'ZIG',
			recoverable: false
		});

		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.waitingForInput).toBe(false);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		staleHandler?.({
			data: {
				buffer: true,
				output: 'late output',
				diagnostic: { lineNumber: 1, severity: 'error', message: 'late diagnostic' },
				results: 'late result'
			}
		} as MessageEvent<any>);
		await Promise.resolve();
		expect(output).not.toHaveBeenCalled();
		expect(diagnostic).not.toHaveBeenCalled();
		expect(sandbox.waitingForInput).toBe(false);
		expect(sandbox.output).toBeNull();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();
	});
});
