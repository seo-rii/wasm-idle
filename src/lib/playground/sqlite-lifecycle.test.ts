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

vi.mock('$lib/playground/worker/sqlite?worker', () => ({
	default: MockWorker
}));

import Sqlite from './sqlite';

describe('SQLite worker lifecycle', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		autoResolveLoad = true;
		autoResolveRun = true;
		loadDispatchError = undefined;
		runDispatchError = undefined;
	});

	it('rejects load and run overlap while startup retains ownership', async () => {
		autoResolveLoad = false;
		const sandbox = new Sqlite();
		const loading = sandbox.load('/assets');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const handler = worker.onmessage;

		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'SQLITE'
		});
		await expect(sandbox.run('select 1', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup',
			runtimeId: 'SQLITE'
		});
		expect(worker.onmessage).toBe(handler);
		expect(worker.postMessage).toHaveBeenCalledOnce();

		worker.resolveLoad();
		await expect(loading).resolves.toBeUndefined();
	});

	it('rejects run and load overlap while the first result settles its owner', async () => {
		autoResolveRun = false;
		const sandbox = new Sqlite();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const running = sandbox.run('select 1', false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		const handler = worker.onmessage;

		await expect(sandbox.run('select 2', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'SQLITE'
		});
		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'execute',
			runtimeId: 'SQLITE'
		});
		expect(worker.onmessage).toBe(handler);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);

		worker.resolveRun('first result');
		await expect(running).resolves.toBe('first result');
	});

	it('ignores a retained handler after terminate and reload', async () => {
		autoResolveRun = false;
		const sandbox = new Sqlite();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const first = sandbox.run('select 1', false);
		await vi.waitFor(() => expect(retiredWorker.postMessage).toHaveBeenCalledTimes(2));
		const staleHandler = retiredWorker.onmessage;
		const terminationReason = new Error('replace SQLite execution');

		sandbox.terminate(terminationReason);
		await expect(first).rejects.toBe(terminationReason);
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();

		await sandbox.load('/assets');
		const replacementWorker = workerInstances[1];
		const replacement = sandbox.run('select 2', false);
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
		const sandbox = new Sqlite();
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
			const sandbox = new Sqlite();
			const callbackError = new Error(`SQLite ${callbackKind} callback failed`);
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
			const running = sandbox.run('select 1', false, true, progress);
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
			await expect(sandbox.run('select 2', false, true, progress)).resolves.toBe(true);
		}
	);

	it('settles a throwing startup progress callback and permits retry', async () => {
		const sandbox = new Sqlite();
		const callbackError = new Error('SQLite startup progress failed');
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
		const sandbox = new Sqlite();
		const startupError = new Error('SQLite load dispatch failed');
		loadDispatchError = startupError;

		await expect(sandbox.load('/assets')).rejects.toBe(startupError);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();

		loadDispatchError = undefined;
		await expect(sandbox.load('/assets')).resolves.toBeUndefined();
		const worker = workerInstances[1];
		const executionError = new Error('SQLite run dispatch failed');
		runDispatchError = executionError;
		await expect(sandbox.run('select 1', false)).rejects.toBe(executionError);

		runDispatchError = undefined;
		await expect(sandbox.run('select 2', false)).resolves.toBe(true);
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('keeps clear reusable but disposes an idle runtime exactly once', async () => {
		const sandbox = new Sqlite();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/assets');
		const worker = workerInstances[0];

		await sandbox.clear();
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('select 1', false)).resolves.toBe(true);

		let cleanupSnapshot: Record<string, unknown> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		let reentrantDisposal: Promise<void> | undefined;
		worker.terminate.mockImplementationOnce(() => {
			cleanupSnapshot = {
				worker: sandbox.worker,
				wasmUrl: sandbox.wasmUrl,
				moduleUrl: sandbox.moduleUrl,
				output: sandbox.output,
				diagnostic: sandbox.oncompilerdiagnostic
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
			runtimeId: 'SQLITE'
		});
		await firstDisposal;
		expect(cleanupSnapshot).toEqual({
			worker: undefined,
			wasmUrl: '',
			moduleUrl: '',
			output: null,
			diagnostic: undefined
		});
		await reentrantLoadResult;

		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(worker.onmessageerror).toBeNull();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.wasmUrl).toBe('');
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.output).toBeNull();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();

		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'SQLITE'
		});
		await expect(sandbox.run('select 2', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'SQLITE'
		});
		sandbox.terminate();
		await sandbox.clear();
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(1);
	});

	it('settles an active startup with one stable disposal cancellation', async () => {
		autoResolveLoad = false;
		const sandbox = new Sqlite();
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
			runtimeId: 'SQLITE',
			recoverable: false
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(sandbox.worker).toBeUndefined();
		expect(workerInstances).toHaveLength(1);
	});

	it('settles an active run and ignores retained messages after disposal', async () => {
		autoResolveRun = false;
		const sandbox = new Sqlite();
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const running = sandbox.run('select 1', false);
		await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
		const staleHandler = worker.onmessage;
		const cancellation = running.catch((error) => error);

		await sandbox.dispose();
		await expect(cancellation).resolves.toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'SQLITE',
			recoverable: false
		});

		expect(worker.terminate).toHaveBeenCalledOnce();
		staleHandler?.({
			data: {
				output: 'late output',
				diagnostic: { lineNumber: 1, severity: 'error', message: 'late diagnostic' },
				results: 'late result'
			}
		} as MessageEvent<any>);
		await Promise.resolve();
		expect(output).not.toHaveBeenCalled();
		expect(diagnostic).not.toHaveBeenCalled();
		expect(sandbox.output).toBeNull();
		expect(sandbox.oncompilerdiagnostic).toBeUndefined();
	});
});
