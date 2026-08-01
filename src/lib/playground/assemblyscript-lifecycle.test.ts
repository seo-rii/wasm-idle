import { beforeEach, describe, expect, it, vi } from 'vitest';

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
