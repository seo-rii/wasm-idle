import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const workerInstances: MockWorker[] = [];
let autoResolveLoad = true;
let autoResolveRun = true;
let loadDispatchError: unknown;
let runDispatchError: unknown;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load && loadDispatchError) throw loadDispatchError;
		if (!message.load && runDispatchError) throw runDispatchError;
		queueMicrotask(() => {
			if (message.load) {
				if (autoResolveLoad) this.resolveLoad();
				return;
			}
			if (autoResolveRun) this.resolveRun();
		});
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}

	resolveLoad() {
		this.onmessage?.({ data: { load: true } } as MessageEvent<any>);
	}

	resolveRun(result: boolean | string = true) {
		this.onmessage?.({ data: { results: result } } as MessageEvent<any>);
	}

	emit(data: Record<string, unknown>) {
		this.onmessage?.({ data } as MessageEvent<any>);
	}
}

vi.mock('$lib/playground/worker/php?worker', () => ({
	default: MockWorker
}));

import Php from './php';
import { readBufferedStdin } from './stdinBuffer';
import type { SandboxExecutionOptions } from './options';

describe('PHP worker lifecycle', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		autoResolveLoad = true;
		autoResolveRun = true;
		loadDispatchError = undefined;
		runDispatchError = undefined;
	});

	it('rejects load and run overlap while startup retains ownership', async () => {
		autoResolveLoad = false;
		const sandbox = new Php();
		const loading = sandbox.load('/assets');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const handler = worker.onmessage;

		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'PHP'
		});
		await expect(sandbox.run('<?php echo 1;', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'PHP'
		});
		expect(worker.onmessage).toBe(handler);
		expect(worker.postMessage).toHaveBeenCalledOnce();

		worker.resolveLoad();
		await expect(loading).resolves.toBeUndefined();
	});

	it('rejects run and load overlap while the first result settles its owner', async () => {
		autoResolveRun = false;
		const sandbox = new Php();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const running = sandbox.run('<?php echo 1;', false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		const handler = worker.onmessage;

		await expect(sandbox.run('<?php echo 2;', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'PHP'
		});
		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'PHP'
		});
		expect(worker.onmessage).toBe(handler);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);

		worker.resolveRun('first result');
		await expect(running).resolves.toBe('first result');
	});

	it('ignores a retained handler after terminate and reload', async () => {
		autoResolveRun = false;
		const sandbox = new Php();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const first = sandbox.run('<?php echo 1;', false);
		await vi.waitFor(() => expect(retiredWorker.postMessage).toHaveBeenCalledTimes(2));
		const staleHandler = retiredWorker.onmessage;
		const terminationReason = new Error('replace PHP execution');

		sandbox.terminate(terminationReason);
		await expect(first).rejects.toBe(terminationReason);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();

		await sandbox.load('/assets');
		const replacementWorker = workerInstances[1];
		const replacement = sandbox.run('<?php echo 2;', false);
		await vi.waitFor(() => expect(replacementWorker.postMessage).toHaveBeenCalledTimes(2));
		const resolved = vi.fn();
		const rejected = vi.fn();
		void replacement.then(resolved, rejected);

		staleHandler?.({
			data: { output: 'stale output', results: 'stale result' }
		} as MessageEvent<any>);
		await Promise.resolve();

		expect(output).not.toHaveBeenCalled();
		expect(resolved).not.toHaveBeenCalled();
		expect(rejected).not.toHaveBeenCalled();
		expect(replacementWorker.terminate).not.toHaveBeenCalled();

		replacementWorker.resolveRun('replacement result');
		await expect(replacement).resolves.toBe('replacement result');
	});

	it('cancels pending startup through clear and ignores its retained handler after retry', async () => {
		autoResolveLoad = false;
		const sandbox = new Php();
		const loading = sandbox.load('/assets');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const retiredWorker = workerInstances[0];
		const staleHandler = retiredWorker.onmessage;

		await sandbox.clear();

		const outcome = await Promise.race([
			loading.catch((error) => error),
			new Promise((resolve) => setTimeout(() => resolve('still pending'), 25))
		]);
		expect(outcome).toBe('Process terminated');
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();

		autoResolveLoad = true;
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		const replacementWorker = workerInstances[1];
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBe(replacementWorker);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
	});

	it.each(['output', 'diagnostic', 'progress'] as const)(
		'rejects a throwing %s callback, retires the worker, and permits retry',
		async (callbackKind) => {
			autoResolveRun = false;
			const sandbox = new Php();
			const callbackError = new Error(`PHP ${callbackKind} callback failed`);
			let throwCallback = true;
			sandbox.output = vi.fn(() => {
				if (throwCallback && callbackKind === 'output') throw callbackError;
			});
			sandbox.oncompilerdiagnostic = vi.fn(() => {
				if (throwCallback && callbackKind === 'diagnostic') throw callbackError;
			});
			const progress = {
				set: vi.fn(() => {
					if (throwCallback && callbackKind === 'progress') throw callbackError;
				})
			};
			await sandbox.load('/assets');
			const retiredWorker = workerInstances[0];
			const running = sandbox.run('<?php echo 1;', false, true, progress);
			await vi.waitFor(() => expect(retiredWorker.postMessage).toHaveBeenCalledTimes(2));

			retiredWorker.emit({
				progress: 0.5,
				output: 'combined output',
				diagnostic: { lineNumber: 1, severity: 'error', message: 'combined diagnostic' },
				results: true
			});

			await expect(running).rejects.toBe(callbackError);
			expect(retiredWorker.terminate).toHaveBeenCalledOnce();
			throwCallback = false;
			autoResolveRun = true;
			await sandbox.load('/assets');
			await expect(sandbox.run('<?php echo 2;', false, true, progress)).resolves.toBe(true);
		}
	);

	it('settles a throwing startup progress callback and permits retry', async () => {
		const sandbox = new Php();
		const callbackError = new Error('PHP startup progress failed');
		let throwProgress = true;
		const progress = {
			set: vi.fn(() => {
				if (throwProgress) throw callbackError;
			})
		};

		await expect(sandbox.load('/assets', '', true, [], {}, progress)).rejects.toBe(
			callbackError
		);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();

		throwProgress = false;
		await expect(sandbox.load('/assets', '', true, [], {}, progress)).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
	});

	it('releases ownership after synchronous load and run dispatch failures', async () => {
		const sandbox = new Php();
		const startupError = new Error('PHP load dispatch failed');
		loadDispatchError = startupError;

		await expect(sandbox.load('/assets')).rejects.toBe(startupError);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();

		loadDispatchError = undefined;
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		const worker = workerInstances[1];
		const executionError = new Error('PHP run dispatch failed');
		runDispatchError = executionError;
		await expect(sandbox.run('<?php echo 1;', false)).rejects.toBe(executionError);

		runDispatchError = undefined;
		await expect(sandbox.run('<?php echo 2;', false)).resolves.toBe(true);
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('keeps empty explicit stdin authoritative and isolates terminal input from the next run', async () => {
		autoResolveRun = false;
		const sandbox = new Php();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		sandbox.write('queued before explicit run\n');
		sandbox.eof();

		const explicitRun = sandbox.run(
			"<?php echo file_get_contents('php://input');",
			false,
			true,
			undefined,
			[],
			{
				stdin: ''
			}
		);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ stdin: '' }));

		worker.emit({ buffer: true });
		expect(sandbox.waitingForInput).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		sandbox.write('queued during explicit run\n');
		sandbox.eof();
		worker.resolveRun();
		await expect(explicitRun).resolves.toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		const bufferedRun = sandbox.run("<?php echo file_get_contents('php://input');", false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(3));
		worker.emit({ buffer: true });
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		sandbox.write('fresh buffered input\n');
		expect(readBufferedStdin(sandbox.buffer)).toBe('fresh buffered input\n');
		worker.resolveRun();
		await expect(bufferedRun).resolves.toBe(true);
	});

	it('clears unused buffered input before the next run requests stdin', async () => {
		autoResolveRun = false;
		const sandbox = new Php();
		await sandbox.load('/assets');
		const worker = workerInstances[0];

		const first = sandbox.run('<?php echo 1;', false);
		sandbox.write('unused input\n');
		worker.resolveRun();
		await expect(first).resolves.toBe(true);
		expect(sandbox.pendingInput).toEqual([]);

		const second = sandbox.run("<?php echo file_get_contents('php://input');", false);
		worker.emit({ buffer: true });
		expect(sandbox.waitingForInput).toBe(true);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		sandbox.write('fresh input\n');
		expect(readBufferedStdin(sandbox.buffer)).toBe('fresh input\n');
		worker.resolveRun();
		await expect(second).resolves.toBe(true);
	});

	it('preserves prequeued buffered data and EOF across successive worker requests', async () => {
		autoResolveRun = false;
		const sandbox = new Php();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		sandbox.write('queued input\n');
		sandbox.eof();

		const running = sandbox.run("<?php echo file_get_contents('php://input');", false);
		worker.emit({ buffer: true });
		expect(readBufferedStdin(sandbox.buffer)).toBe('queued input\n');
		expect(sandbox.pendingEof).toBe(true);

		worker.emit({ buffer: true });
		expect(readBufferedStdin(sandbox.buffer)).toBeNull();
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.waitingForInput).toBe(false);

		worker.resolveRun();
		await expect(running).resolves.toBe(true);
	});

	it('preserves a reentrant termination reason and replacement load during option snapshot', async () => {
		const sandbox = new Php();
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const terminationReason = new Error('terminate while reading PHP options');
		const laterGetterError = new Error('later PHP option getter failure');
		let replacement: Promise<void> | undefined;
		const options: SandboxExecutionOptions = {};
		Object.defineProperty(options, 'stdin', {
			get() {
				sandbox.terminate(terminationReason);
				replacement = sandbox.load('/replacement');
				void replacement.catch(() => undefined);
				throw laterGetterError;
			}
		});

		await expect(
			sandbox.run('<?php echo 1;', false, true, undefined, [], options)
		).rejects.toBe(terminationReason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('cleans explicit stdin after error, dispatch failure, and termination', async () => {
		autoResolveRun = false;
		const sandbox = new Php();
		await sandbox.load('/assets');
		const worker = workerInstances[0];

		const failed = sandbox.run('<?php throw new Exception();', false, true, undefined, [], {
			stdin: 'fixed\n'
		});
		sandbox.write('during failed run\n');
		worker.emit({ error: 'PHP failed' });
		await expect(failed).rejects.toBe('PHP failed');
		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		runDispatchError = new Error('PHP dispatch failed');
		sandbox.write('before dispatch failure\n');
		await expect(
			sandbox.run('<?php echo 1;', false, true, undefined, [], { stdin: 'fixed\n' })
		).rejects.toBe(runDispatchError);
		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		runDispatchError = undefined;
		const terminated = sandbox.run('<?php echo 2;', false, true, undefined, [], {
			stdin: 'fixed\n'
		});
		sandbox.write('during terminated run\n');
		const terminationReason = new Error('stop PHP');
		sandbox.terminate(terminationReason);
		await expect(terminated).rejects.toBe(terminationReason);
		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
	});

	it('treats false results and empty errors as terminal payloads', async () => {
		autoResolveRun = false;
		const sandbox = new Php();
		await sandbox.load('/assets');
		const worker = workerInstances[0];

		const falseResult = sandbox.run('<?php return false;', false);
		worker.resolveRun(false);
		await expect(falseResult).resolves.toBe(false);

		const emptyError = sandbox.run('<?php throw new Exception();', false);
		worker.emit({ error: '' });
		await expect(emptyError).rejects.toBe('');
	});

	it('keeps clear reusable but disposes an idle runtime exactly once', async () => {
		const sandbox = new Php();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/assets');
		const worker = workerInstances[0];

		await sandbox.clear();
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('<?php echo 1;', false)).resolves.toBe(true);
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
			runtimeId: 'PHP'
		});
		await firstDisposal;
		expect(cleanupSnapshot).toEqual({
			worker: undefined,
			moduleUrl: '',
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
		expect(sandbox.output).toBeNull();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();

		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'PHP'
		});
		await expect(sandbox.run('<?php echo 2;', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'PHP'
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

	it('settles an active startup with one stable disposal cancellation', async () => {
		autoResolveLoad = false;
		const sandbox = new Php();
		const loading = sandbox.load('/assets');
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
			runtimeId: 'PHP',
			recoverable: false
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBeUndefined();
		expect(workerInstances).toHaveLength(1);
	});

	it('settles an active run, clears stdin, and ignores retained messages after disposal', async () => {
		autoResolveRun = false;
		const sandbox = new Php();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const running = sandbox.run("<?php echo file_get_contents('php://input');", false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		const staleHandler = worker.onmessage;
		const cancellation = running.catch((error) => error);
		worker.emit({ buffer: true });
		sandbox.write('active input\n');
		sandbox.eof();
		expect(readBufferedStdin(sandbox.buffer)).toBe('active input\n');
		expect(sandbox.pendingEof).toBe(true);

		await sandbox.dispose();
		await expect(cancellation).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'PHP',
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
