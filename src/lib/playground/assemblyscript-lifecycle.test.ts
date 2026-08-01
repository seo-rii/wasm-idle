import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
let autoResolveLoad = true;
let autoResolveRun = true;
let runDispatchError: unknown;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			if (autoResolveLoad) {
				queueMicrotask(() => this.resolveLoad());
			}
			return;
		}
		if (runDispatchError) throw runDispatchError;
		if (autoResolveRun) {
			queueMicrotask(() => this.resolveRun());
		}
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

vi.mock('$lib/playground/worker/assemblyscript?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import AssemblyScript from './assemblyscript';

describe('AssemblyScript operation lifecycle', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		autoResolveLoad = true;
		autoResolveRun = true;
		runDispatchError = undefined;
	});

	it('rejects pre-aborted operations without changing AssemblyScript state', async () => {
		const sandbox = new AssemblyScript();
		sandbox.write('queued input\n');
		const controller = new AbortController();
		const reason = new Error('do not start AssemblyScript');
		controller.abort(reason);

		await expect(
			sandbox.load('/assets', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);
		await expect(
			sandbox.run('export function main(): void {}', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(workerInstances).toHaveLength(0);
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
	});

	it('aborts before scheduled AssemblyScript startup can mutate state', async () => {
		const sandbox = new AssemblyScript();
		const controller = new AbortController();
		const reason = new Error('cancel AssemblyScript immediately');
		const loading = sandbox.load('/assets', '', true, [], {
			signal: controller.signal
		});

		controller.abort(reason);

		await expect(loading).rejects.toBe(reason);
		expect(workerInstances).toHaveLength(0);
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.exit).toBe(true);
	});

	it('aborts pending startup and ignores late readiness during immediate retry', async () => {
		autoResolveLoad = false;
		const sandbox = new AssemblyScript();
		const controller = new AbortController();
		const reason = new Error('stop AssemblyScript startup');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loading = sandbox.load('/assets', '', true, [], {
			signal: controller.signal
		});

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const oldWorker = workerInstances[0];
		const staleReady = oldWorker?.onmessage;
		controller.abort(reason);
		autoResolveLoad = true;
		const retry = sandbox.load('/assets');

		await expect(loading).rejects.toBe(reason);
		await expect(retry).resolves.toBeUndefined();
		expect(oldWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		const replacementWorker = workerInstances[1];
		staleReady?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBe(replacementWorker);
		const abortRegistration = addEventListener.mock.calls.find(([type]) => type === 'abort');
		expect(abortRegistration).toBeDefined();
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
	});

	it('preserves a pending startup across load and run overlaps', async () => {
		autoResolveLoad = false;
		const sandbox = new AssemblyScript();
		const loading = sandbox.load('/assets');

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const startupHandler = worker?.onmessage;

		await expect(sandbox.load('/other-assets')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ASSEMBLYSCRIPT',
			phase: 'startup'
		});
		await expect(sandbox.run('export function main(): void {}', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ASSEMBLYSCRIPT',
			phase: 'startup'
		});
		expect(worker?.postMessage).toHaveBeenCalledOnce();
		expect(worker?.onmessage).toBe(startupHandler);

		worker?.resolveLoad();
		await expect(loading).resolves.toBeUndefined();
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		expect(worker?.postMessage).toHaveBeenCalledOnce();
	});

	it('preserves a pending execution across run and load overlaps', async () => {
		autoResolveRun = false;
		const sandbox = new AssemblyScript();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const running = sandbox.run('export function first(): i32 { return 1; }', false);
		const runHandler = worker?.onmessage;

		await expect(
			sandbox.run('export function second(): i32 { return 2; }', false)
		).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ASSEMBLYSCRIPT',
			phase: 'execute'
		});
		await expect(sandbox.load('/other-assets')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			runtimeId: 'ASSEMBLYSCRIPT',
			phase: 'execute'
		});
		expect(worker?.postMessage).toHaveBeenCalledTimes(2);
		expect(worker?.onmessage).toBe(runHandler);

		worker?.resolveRun();
		await expect(running).resolves.toBe(true);
		autoResolveRun = true;
		await expect(
			sandbox.run('export function retry(): i32 { return 3; }', false)
		).resolves.toBe(true);
		expect(worker?.postMessage).toHaveBeenCalledTimes(3);
	});

	it('aborts a pending execution and ignores its stale result during retry', async () => {
		autoResolveRun = false;
		const sandbox = new AssemblyScript();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets');
		const controller = new AbortController();
		const reason = new Error('stop AssemblyScript execution');
		const running = sandbox.run(
			'export function oldRun(): void {}',
			false,
			true,
			undefined,
			[],
			{ signal: controller.signal, stdin: '' }
		);
		const oldWorker = workerInstances[0];
		const staleResult = oldWorker?.onmessage;
		sandbox.write('discard on abort\n');
		sandbox.eof();

		controller.abort(reason);
		autoResolveLoad = true;
		const retryLoad = sandbox.load('/assets');

		await expect(running).rejects.toBe(reason);
		await expect(retryLoad).resolves.toBeUndefined();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(oldWorker?.terminate).toHaveBeenCalledOnce();
		const replacementWorker = workerInstances[1];
		const replacementRun = sandbox.run('export function replacement(): void {}', false);
		const replacementHandler = replacementWorker?.onmessage;

		staleResult?.({
			data: { output: 'stale output\n', results: true }
		} as MessageEvent<any>);
		expect(output).not.toHaveBeenCalledWith('stale output\n');
		expect(replacementWorker?.onmessage).toBe(replacementHandler);

		replacementWorker?.resolveRun('replacement output\n');
		await expect(replacementRun).resolves.toBe(true);
		expect(output).toHaveBeenCalledWith('replacement output\n');
	});

	it('preserves the abort reason when stdin cleanup fails', async () => {
		autoResolveRun = false;
		const sandbox = new AssemblyScript();
		await sandbox.load('/assets');
		const controller = new AbortController();
		const reason = new Error('stop AssemblyScript with an invalid stdin buffer');
		const running = sandbox.run('export function main(): void {}', false, true, undefined, [], {
			signal: controller.signal
		});
		const oldWorker = workerInstances[0];
		sandbox.buffer = new ArrayBuffer(0);

		expect(() => controller.abort(reason)).not.toThrow();
		autoResolveLoad = true;
		const retry = sandbox.load('/assets');

		await expect(running).rejects.toBe(reason);
		await expect(retry).resolves.toBeUndefined();
		expect(oldWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
	});

	it('isolates explicit stdin from queued terminal input', async () => {
		autoResolveRun = false;
		const sandbox = new AssemblyScript();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		sandbox.write('stale\n');
		sandbox.eof();

		const explicitRun = sandbox.run(
			'export function explicitRun(): void {}',
			false,
			true,
			undefined,
			[],
			{ stdin: '' }
		);
		const explicitMessage = worker?.postMessage.mock.calls.at(-1)?.[0];
		worker?.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		sandbox.write('during\n');
		sandbox.eof();

		expect(explicitMessage.stdin).toBe('');
		expect(readBufferedStdin(explicitMessage.buffer)).toBe('');
		worker?.resolveRun();
		await expect(explicitRun).resolves.toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);

		const bufferedRun = sandbox.run('export function bufferedRun(): void {}', false);
		const bufferedMessage = worker?.postMessage.mock.calls.at(-1)?.[0];
		worker?.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);

		expect(bufferedMessage.stdin).toBeUndefined();
		expect(readBufferedStdin(bufferedMessage.buffer)).toBe('');
		sandbox.write('fresh\n');
		expect(readBufferedStdin(bufferedMessage.buffer)).toBe('fresh\n');
		worker?.resolveRun();
		await expect(bufferedRun).resolves.toBe(true);
	});

	it('clears explicit stdin state after worker and dispatch failures', async () => {
		autoResolveRun = false;
		const sandbox = new AssemblyScript();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const workerError = new Error('AssemblyScript execution failed');
		const failedRun = sandbox.run(
			'export function failedRun(): void {}',
			false,
			true,
			undefined,
			[],
			{ stdin: 'fixed\n' }
		);
		sandbox.write('discard after worker failure\n');
		sandbox.eof();

		worker?.rejectRun(workerError);
		await expect(failedRun).rejects.toBe(workerError);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		const dispatchError = new Error('AssemblyScript dispatch failed');
		runDispatchError = dispatchError;
		sandbox.write('discard after dispatch failure\n');
		sandbox.eof();

		await expect(
			sandbox.run('export function dispatchFailure(): void {}', false, true, undefined, [], {
				stdin: ''
			})
		).rejects.toBe(dispatchError);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
	});

	it('removes a settled execution listener and keeps late abort inert', async () => {
		const sandbox = new AssemblyScript();
		await sandbox.load('/assets');
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

		await expect(
			sandbox.run('export function main(): void {}', false, true, undefined, [], {
				signal: controller.signal
			})
		).resolves.toBe(true);
		const worker = sandbox.worker;
		const uid = sandbox.uid;
		const abortRegistration = addEventListener.mock.calls.find(([type]) => type === 'abort');
		expect(abortRegistration).toBeDefined();
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

		controller.abort(new Error('late AssemblyScript abort'));

		expect(sandbox.worker).toBe(worker);
		expect(sandbox.uid).toBe(uid);
	});

	it('releases execution ownership after worker and dispatch failures', async () => {
		const sandbox = new AssemblyScript();

		await expect(sandbox.run('export function main(): void {}', false)).rejects.toBe(
			'Worker not loaded'
		);
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const dispatchError = new Error('AssemblyScript dispatch failed');
		runDispatchError = dispatchError;

		await expect(sandbox.run('export function main(): void {}', false)).rejects.toBe(
			dispatchError
		);
		expect(sandbox.exit).toBe(true);
		expect(worker?.onmessage).toBeNull();

		runDispatchError = undefined;
		await expect(sandbox.run('export function retry(): void {}', false)).resolves.toBe(true);
	});

	it('releases execution ownership after a worker result error', async () => {
		autoResolveRun = false;
		const sandbox = new AssemblyScript();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const running = sandbox.run('export function main(): void {}', false);

		worker?.rejectRun('AssemblyScript compilation failed');
		await expect(running).rejects.toBe('AssemblyScript compilation failed');

		autoResolveRun = true;
		await expect(sandbox.run('export function retry(): void {}', false)).resolves.toBe(true);
	});

	it('canonicalizes AssemblyScript workspace paths before worker dispatch', async () => {
		const sandbox = new AssemblyScript();
		const code = 'export function main(): i32 { return helper(); }';
		await sandbox.load('/assets');

		await expect(
			sandbox.run(code, false, true, undefined, [], {
				activePath: 'src\\main.as.ts',
				workspaceFiles: [
					{
						path: 'src\\helper.as.ts',
						content: 'export function helper(): i32 { return 1; }'
					}
				]
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				activePath: 'src/main.as.ts',
				workspaceFiles: [
					{
						path: 'src/helper.as.ts',
						content: 'export function helper(): i32 { return 1; }'
					}
				]
			})
		);
	});

	it.each([
		{
			name: 'active path traversal',
			code: 'A',
			options: { activePath: '../main.as.ts' },
			expected: { code: 'invalid-path', path: '../main.as.ts' }
		},
		{
			name: 'workspace path traversal',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'src/../secret.as.ts', content: 'B' }]
			},
			expected: { code: 'invalid-path', path: 'src/../secret.as.ts' }
		},
		{
			name: 'absolute path',
			code: 'A',
			options: { activePath: '/tmp/main.as.ts' },
			expected: { code: 'invalid-path', path: '/tmp/main.as.ts' }
		},
		{
			name: 'NUL path',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'src/bad\0.as.ts', content: 'B' }]
			},
			expected: { code: 'invalid-path', path: 'src/bad\0.as.ts' }
		},
		{
			name: 'duplicate path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'src/helper.as.ts', content: 'B' },
					{ path: 'src/helper.as.ts', content: 'C' }
				]
			},
			expected: { code: 'duplicate-path', path: 'src/helper.as.ts' }
		},
		{
			name: 'case-colliding path',
			code: 'A',
			options: {
				workspaceFiles: [
					{ path: 'SRC/helper.as.ts', content: 'B' },
					{ path: 'src/helper.as.ts', content: 'C' }
				]
			},
			expected: { code: 'case-collision', path: 'src/helper.as.ts' }
		},
		{
			name: 'file count overflow',
			code: 'A',
			options: {
				workspaceFiles: [{ path: 'src/helper.as.ts', content: 'B' }],
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
				workspaceFiles: [{ path: 'src/helper.as.ts', content: '45' }],
				workspaceLimits: { maxTotalBytes: 100 }
			},
			expected: { code: 'total-size-limit', limit: 4, actual: 5 }
		}
	])(
		'rejects an AssemblyScript workspace with $name before changing execution state',
		async ({ code, options, expected }) => {
			const sandbox = new AssemblyScript();
			await sandbox.load('/assets');
			const worker = workerInstances[0];
			const loadHandler = worker.onmessage;
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
			expect(sandbox.uid).toBe(0);
			expect(sandbox.begin).toBe(begin);
			expect(sandbox.exit).toBe(true);
			expect(sandbox.pendingInput).toEqual(['queued input\n']);

			await expect(sandbox.run('export function retry(): void {}', false)).resolves.toBe(
				true
			);
			expect(worker.postMessage).toHaveBeenCalledTimes(2);
			expect(worker.postMessage).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ activePath: 'main.as.ts', workspaceFiles: [] })
			);
		}
	);

	it('ignores a retained handler from a terminated worker after retry', async () => {
		autoResolveRun = false;
		const sandbox = new AssemblyScript();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets');
		const oldWorker = workerInstances[0];
		const oldRun = sandbox.run('export function oldRun(): void {}', false);
		const staleHandler = oldWorker?.onmessage;

		sandbox.kill();
		await expect(oldRun).rejects.toBe('Process terminated');
		expect(oldWorker?.terminate).toHaveBeenCalledOnce();

		await sandbox.load('/assets');
		const replacementWorker = workerInstances[1];
		const replacementRun = sandbox.run('export function replacement(): void {}', false);
		const replacementHandler = replacementWorker?.onmessage;
		const resolved = vi.fn();
		const rejected = vi.fn();
		void replacementRun.then(resolved, rejected);

		staleHandler?.({
			data: { output: 'stale output\n', results: true }
		} as MessageEvent<any>);
		await Promise.resolve();

		expect(output).not.toHaveBeenCalledWith('stale output\n');
		expect(replacementWorker?.onmessage).toBe(replacementHandler);
		expect(resolved).not.toHaveBeenCalled();
		expect(rejected).not.toHaveBeenCalled();

		replacementWorker?.resolveRun('replacement output\n');
		await expect(replacementRun).resolves.toBe(true);
		expect(output).toHaveBeenCalledWith('replacement output\n');
	});
});
