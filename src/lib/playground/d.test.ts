import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { WASM_D_OUTER_ASSET_RECEIPTS } from './wasmDIntegrity';

describe('D sandbox', () => {
	beforeEach(() => {
		vi.useRealTimers();
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_D_MODULE_URL = '/wasm-d/index.js';
		suppressAutoLoadAck = false;
	});

	afterEach(() => {
		vi.useRealTimers();
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
				moduleUrl: expect.stringMatching(/\/wasm-d\/index\.js$/),
				manifestUrl: expect.stringMatching(
					/\/wasm-d\/runtime\/runtime-manifest\.v1\.json$/
				),
				outerIntegrity: WASM_D_OUTER_ASSET_RECEIPTS
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

	it('replaces the D worker when an outer asset receipt changes', async () => {
		const sandbox = new D();
		const moduleUrl = 'https://runtime.example/wasm-d/index.js?v=one';
		const manifestUrl = 'https://runtime.example/wasm-d/runtime/runtime-manifest.v1.json?v=one';
		await sandbox.load({
			d: {
				moduleUrl,
				manifestUrl,
				integrity: WASM_D_OUTER_ASSET_RECEIPTS
			}
		});
		const firstWorker = workerInstances[0];
		const firstAssetsKey = sandbox.activeDAssetsKey;
		const changedIntegrity = {
			'index.js': {
				...WASM_D_OUTER_ASSET_RECEIPTS['index.js'],
				sha256: 'a'.repeat(64),
				uncompressedSha256: 'a'.repeat(64)
			},
			'runtime/runtime-manifest.v1.json': {
				...WASM_D_OUTER_ASSET_RECEIPTS['runtime/runtime-manifest.v1.json']
			}
		};

		await sandbox.load({ d: { moduleUrl, manifestUrl, integrity: changedIntegrity } });

		expect(sandbox.activeDAssetsKey).not.toBe(firstAssetsKey);
		expect(firstWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ outerIntegrity: changedIntegrity })
		);
	});

	it('terminates D output before exceeding the cumulative UTF-8 byte limit', async () => {
		const sandbox = new D();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('void main() {}', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const staleHandler = worker.onmessage;

		staleHandler?.({ data: { output: 'é' } } as MessageEvent<any>);
		staleHandler?.({ data: { output: '🙂' } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'D',
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
		await expect(sandbox.run('void main() {}', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('terminates D diagnostics before exceeding the message limit', async () => {
		const sandbox = new D();
		const oncompilerdiagnostic = vi.fn();
		sandbox.oncompilerdiagnostic = oncompilerdiagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('void main() {}', true, true, undefined, [], {
			limits: { maxDiagnostics: 1 }
		});
		const staleHandler = worker.onmessage;
		const diagnostic = {
			fileName: 'main.d',
			lineNumber: 1,
			columnNumber: 2,
			severity: 'warning',
			message: 'bounded warning'
		};

		staleHandler?.({ data: { diagnostic } } as MessageEvent<any>);
		staleHandler?.({ data: { diagnostic } } as MessageEvent<any>);

		await expect(running).rejects.toMatchObject({
			name: 'DiagnosticLimitError',
			code: 'diagnostic-limit',
			phase: 'execute',
			runtimeId: 'D',
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

	it('normalizes a valid D workspace before worker dispatch', async () => {
		const sandbox = new D();
		await sandbox.load('/absproxy/5173');

		await expect(
			sandbox.run('void main() {}', false, true, undefined, [], {
				activePath: 'nested\\main.d',
				workspaceFiles: [{ path: 'fixtures\\helper.d', content: 'int helper = 1;' }]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				fileName: 'nested/main.d'
			})
		);
	});

	it.each([
		{
			name: 'traversal path',
			code: 'A',
			options: { activePath: '../main.d' },
			expected: { code: 'invalid-path', path: '../main.d' }
		},
		{
			name: 'absolute path',
			code: 'A',
			options: { activePath: '/tmp/main.d' },
			expected: { code: 'invalid-path', path: '/tmp/main.d' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: { activePath: 'bad\0.d' },
			expected: { code: 'invalid-path', path: 'bad\0.d' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'data/module.d', content: 'A' },
					{ path: 'data/module.d', content: 'B' }
				]
			},
			expected: { code: 'duplicate-path', path: 'data/module.d' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'DATA/module.d', content: 'A' },
					{ path: 'data/module.d', content: 'B' }
				]
			},
			expected: { code: 'case-collision', path: 'data/module.d' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'data/module.d', content: 'B' }],
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
				workspaceFiles: [{ path: 'data/module.d', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects a D workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new D();
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

	it('rejects a pre-aborted D startup without changing an existing worker', async () => {
		const sandbox = new D();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockClear();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const reason = new Error('D startup pre-aborted');
		controller.abort(reason);

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal }, progress)
		).rejects.toBe(reason);

		expect(sandbox.worker).toBe(worker);
		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(progress.set).not.toHaveBeenCalled();
	});

	it('aborts an active D startup and ignores stale completion', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new D();
		const progress = { set: vi.fn() };
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const reason = new Error('D startup aborted');
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
	])('retires the D worker when the $stage progress callback throws', async ({ message }) => {
		suppressAutoLoadAck = true;
		const sandbox = new D();
		const callbackError = new Error('D startup progress failed');
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

	it('keeps the active D operation while callbacks attempt reentrant work', async () => {
		const sandbox = new D();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		let reentrantRun: Promise<boolean | string> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		sandbox.output = () => {
			reentrantRun = sandbox.run('void main() {}', false);
			reentrantLoad = sandbox.load('/replacement/');
		};

		const running = sandbox.run('void main() {}', false);
		const handler = worker.onmessage;
		handler?.({ data: { output: 'trigger\n', results: true } } as MessageEvent<any>);

		await expect(reentrantRun).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'D'
		});
		await expect(reentrantLoad).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'D'
		});
		await expect(running).resolves.toBe(true);
		expect(worker.onmessage).toBeNull();
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('preserves a replacement after a D callback terminates and throws', async () => {
		const sandbox = new D();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;
		const controller = new AbortController();
		const abortReason = new Error('D callback abort');
		const callbackError = new Error('D callback throw after abort');
		let replacement: Promise<void> | undefined;
		sandbox.output = () => {
			controller.abort(abortReason);
			replacement = sandbox.load('/replacement/');
			throw callbackError;
		};
		const running = sandbox.run('void main() {}', false, true, undefined, [], {
			stdin: 'fixed\n',
			signal: controller.signal
		});
		const outcome = running.catch((error) => error);
		const staleHandler = worker.onmessage;

		expect(() =>
			staleHandler?.({
				data: { output: 'trigger\n', results: true }
			} as MessageEvent<any>)
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
		'rejects and retires the D worker when a %s callback throws',
		async (callbackKind) => {
			const sandbox = new D();
			const worker = new MockWorker();
			worker.postMessage.mockImplementation(() => undefined);
			sandbox.worker = worker as unknown as Worker;
			const callbackError = new Error(`D ${callbackKind} callback failed`);
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

			const running = sandbox.run('void main() {}', false, true, progress, [], {
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
			await expect(sandbox.run('void main() {}', false)).resolves.toBe(true);
			expect(workerInstances.at(-1)).not.toBe(worker);
		}
	);

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

		await expect(sandbox.load({})).rejects.toThrow('D runtime is not configured');
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

	it('clears queued input before an explicit D stdin run', async () => {
		const sandbox = new D();
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
			sandbox.run('void main() {}', false, true, undefined, [], {
				stdin: 'injected\n'
			})
		).resolves.toBe(true);
		await expect(sandbox.run('void main() {}', false)).resolves.toBe(true);

		expect(runMessages).toHaveLength(2);
		expect(runMessages[0].stdin).toBe('injected\n');
		expect(runMessages[1].stdin).toBeUndefined();
		expect(bufferedValues).toEqual(['', '']);
	});

	it('does not stream terminal input into an explicit D stdin run', async () => {
		const sandbox = new D();
		const worker = new MockWorker();
		worker.postMessage.mockImplementation(() => undefined);
		sandbox.worker = worker as unknown as Worker;

		const running = sandbox.run('void main() {}', false, true, undefined, [], {
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

	it('preserves an exact null pre-abort reason without changing idle D state', async () => {
		const sandbox = new D();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		const moduleUrl = sandbox.moduleUrl;
		const uid = sandbox.uid;
		sandbox.write('queued input\n');
		const controller = new AbortController();
		controller.abort(null);

		await expect(
			sandbox.load('/replacement', '', true, [], { signal: controller.signal })
		).rejects.toBeNull();
		await expect(
			sandbox.run('void main() {}', false, true, undefined, [], {
				signal: controller.signal,
				stdin: ''
			})
		).rejects.toBeNull();

		expect(sandbox.worker).toBe(worker);
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(sandbox.moduleUrl).toBe(moduleUrl);
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.uid).toBe(uid);
		expect(sandbox.exit).toBe(true);
	});

	it('preserves replacement startup when the outer signal getter terminates D', async () => {
		const sandbox = new D();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace D during startup option snapshot');
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

	it('preserves the first cancellation and replacement across later D option failure', async () => {
		const sandbox = new D();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace D during execution option snapshot');
		const laterError = new Error('later D workspace getter failed');
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

		const superseded = sandbox.run('void main() {}', false, true, undefined, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(retiredWorker.postMessage).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('reads explicit D stdin once before worker dispatch', async () => {
		const sandbox = new D();
		await sandbox.load('/absproxy/5173');
		let reads = 0;
		const options = {
			get stdin() {
				reads += 1;
				if (reads > 1) throw new Error('D stdin was read more than once');
				return 'captured input\n';
			}
		};

		await expect(
			sandbox.run('void main() {}', false, true, undefined, [], options)
		).resolves.toBe(true);

		expect(reads).toBe(1);
		expect(workerInstances[0].postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({ stdin: 'captured input\n' })
		);
	});

	it('enforces the aggregate D startup deadline and ignores stale readiness', async () => {
		vi.useFakeTimers();
		suppressAutoLoadAck = true;
		const sandbox = new D();
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 }
		});
		const rejected = expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'D',
			timeoutMs: 12
		});
		await vi.dynamicImportSettled();
		const retiredWorker = workerInstances[0];
		const staleHandler = retiredWorker.onmessage;

		await vi.advanceTimersByTimeAsync(12);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		suppressAutoLoadAck = false;
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('enforces the aggregate D execution deadline and permits a clean retry', async () => {
		const sandbox = new D();
		await sandbox.load('/absproxy/5173');
		const retiredWorker = workerInstances[0];
		retiredWorker.postMessage.mockImplementationOnce(() => undefined);
		vi.useFakeTimers();
		const running = sandbox.run('void main() {}', false, true, undefined, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'D',
			timeoutMs: 10
		});
		const staleHandler = retiredWorker.onmessage;

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { output: 'stale output', results: true } } as MessageEvent<any>);
		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run('void main() {}', false)).resolves.toBe(true);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('clears settled D deadlines before they can retire an idle worker', async () => {
		vi.useFakeTimers();
		const sandbox = new D();
		await sandbox.load('/absproxy/5173', '', true, [], {
			limits: { assetTimeoutMs: 2, startupTimeoutMs: 3 }
		});
		const worker = workerInstances[0];
		await expect(
			sandbox.run('void main() {}', false, true, undefined, [], {
				limits: { compileTimeoutMs: 2, runTimeoutMs: 3 }
			})
		).resolves.toBe(true);

		await vi.advanceTimersByTimeAsync(10);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
		await expect(sandbox.run('void main() {}', false)).resolves.toBe(true);
	});

	it('keeps clear reusable but disposes an idle D runtime exactly once', async () => {
		const sandbox = new D();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];

		await sandbox.clear();
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('void main() {}', false)).resolves.toBe(true);
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
				moduleUrl: sandbox.moduleUrl,
				manifestUrl: sandbox.manifestUrl,
				outerIntegrity: sandbox.outerIntegrity,
				activeDAssetsKey: sandbox.activeDAssetsKey,
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
			runtimeId: 'D'
		});
		await firstDisposal;
		expect(cleanupSnapshot).toEqual({
			worker: undefined,
			moduleUrl: '',
			manifestUrl: '',
			outerIntegrity: undefined,
			activeDAssetsKey: '',
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
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.manifestUrl).toBe('');
		expect(sandbox.outerIntegrity).toBeUndefined();
		expect(sandbox.activeDAssetsKey).toBe('');
		expect(sandbox.output).toBeNull();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();

		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'D'
		});
		await expect(sandbox.run('void main() {}', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'D'
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

	it('settles active D startup with one stable disposal cancellation', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new D();
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
			runtimeId: 'D',
			recoverable: false
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.manifestUrl).toBe('');
		expect(sandbox.outerIntegrity).toBeUndefined();
		expect(sandbox.activeDAssetsKey).toBe('');
		expect(workerInstances).toHaveLength(1);
	});

	it('settles an active D run, clears stdin, and ignores retained messages after disposal', async () => {
		const sandbox = new D();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);
		const running = sandbox.run('void main() {}', false);
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
			runtimeId: 'D',
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
