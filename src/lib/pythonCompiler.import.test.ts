// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PythonCompileResult } from './pythonCompiler';

function deferred() {
	let resolve!: () => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<void>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return { promise, resolve, reject };
}

const pending: Promise<unknown>[] = [];
const releaseGates: Array<() => void> = [];
type Outcome =
	| { status: 'pending' }
	| { status: 'fulfilled'; value: PythonCompileResult }
	| { status: 'rejected'; reason: unknown };

function observe(task: Promise<PythonCompileResult>) {
	let outcome: Outcome = { status: 'pending' };
	const settled = task.then(
		(value) => (outcome = { status: 'fulfilled', value }),
		(reason) => (outcome = { status: 'rejected', reason })
	);
	pending.push(settled);
	return {
		settled,
		get outcome() {
			return outcome;
		}
	};
}

async function createHarness() {
	const gate = deferred();
	const started = deferred();
	releaseGates.push(gate.resolve);
	const constructed = vi.fn();
	const load = vi.fn(async (..._args: unknown[]) => {});
	const result: PythonCompileResult = {
		path: 'main.pyc',
		data: new Uint8Array(32),
		pythonVersion: '3.14.2',
		cacheTag: 'cpython-314',
		magicNumber: '2b0e0d0a'
	};
	const compile = vi.fn(async (..._args: unknown[]) => result);
	const dispose = vi.fn(async () => {});
	vi.doMock('./playground/python', async () => {
		started.resolve();
		await gate.promise;
		return {
			default: class {
				constructor() {
					constructed();
				}
				load = load;
				compile = compile;
				dispose = dispose;
			}
		};
	});
	const { compilePython } = await import('./pythonCompiler');
	return {
		compilePython,
		gate,
		started: started.promise,
		constructed,
		load,
		compile,
		dispose,
		result
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
});

afterEach(async () => {
	for (const release of releaseGates.splice(0)) release();
	await vi.dynamicImportSettled();
	await Promise.all(pending.splice(0));
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.doUnmock('./playground/python');
	vi.resetModules();
});

describe('compilePython adapter import lifecycle', () => {
	it('aborts immediately while the adapter import is pending', async () => {
		const harness = await createHarness();
		const controller = new AbortController();
		const reason = new Error('cancel during adapter import');
		const task = observe(harness.compilePython('pass', { signal: controller.signal }));
		await harness.started;
		controller.abort(reason);
		await vi.advanceTimersByTimeAsync(0);
		expect(task.outcome).toEqual({ status: 'rejected', reason });
		expect(harness.constructed).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('times out while the adapter import remains pending', async () => {
		const harness = await createHarness();
		const task = observe(harness.compilePython('pass', { limits: { startupTimeoutMs: 40 } }));
		await harness.started;
		await vi.advanceTimersByTimeAsync(39);
		expect(task.outcome.status).toBe('pending');
		await vi.advanceTimersByTimeAsync(1);
		expect(task.outcome).toMatchObject({
			status: 'rejected',
			reason: {
				name: 'TimeoutError',
				code: 'timeout',
				phase: 'startup',
				runtimeId: 'PYTHON3',
				timeoutMs: 40
			}
		});
		expect(harness.constructed).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		['abort', 'resolve'],
		['abort', 'reject'],
		['timeout', 'resolve'],
		['timeout', 'reject']
	])(
		'ignores a late import %s/%s without constructing a worker or leaking rejection',
		async (stop, late) => {
			const harness = await createHarness();
			const controller = new AbortController();
			const reason = 'cancel deferred import';
			const unhandled = vi.fn();
			process.on('unhandledRejection', unhandled);
			try {
				const task = observe(
					harness.compilePython('pass', {
						signal: controller.signal,
						limits: { startupTimeoutMs: 40 }
					})
				);
				await harness.started;
				if (stop === 'abort') controller.abort(reason);
				await vi.advanceTimersByTimeAsync(stop === 'abort' ? 0 : 40);
				if (stop === 'abort') expect(task.outcome).toEqual({ status: 'rejected', reason });
				else
					expect(task.outcome).toMatchObject({
						status: 'rejected',
						reason: { code: 'timeout' }
					});
				const outcome = task.outcome;
				if (late === 'resolve') harness.gate.resolve();
				else harness.gate.reject(new Error('late adapter import failure'));
				await vi.dynamicImportSettled();
				await vi.advanceTimersByTimeAsync(0);
				expect(task.outcome).toBe(outcome);
				expect(harness.constructed).not.toHaveBeenCalled();
				expect(harness.load).not.toHaveBeenCalled();
				expect(unhandled).not.toHaveBeenCalled();
				expect(vi.getTimerCount()).toBe(0);
			} finally {
				process.removeListener('unhandledRejection', unhandled);
			}
		}
	);

	it.each(['success', 'import failure', 'load failure', 'compile failure'])(
		'removes the import abort listener and timer after %s',
		async (outcome) => {
			const harness = await createHarness();
			const controller = new AbortController();
			const added = vi.spyOn(controller.signal, 'addEventListener');
			const removed = vi.spyOn(controller.signal, 'removeEventListener');
			const failure = new Error(outcome);
			if (outcome === 'load failure') harness.load.mockRejectedValueOnce(failure);
			if (outcome === 'compile failure') harness.compile.mockRejectedValueOnce(failure);
			const task = observe(harness.compilePython('pass', { signal: controller.signal }));
			await harness.started;
			if (outcome === 'import failure') harness.gate.reject(failure);
			else harness.gate.resolve();
			await task.settled;
			expect(task.outcome.status).toBe(outcome === 'success' ? 'fulfilled' : 'rejected');
			const registrations = added.mock.calls.filter(([type]) => type === 'abort');
			expect(registrations.length).toBeGreaterThan(0);
			for (const [type, listener] of registrations) {
				expect(
					removed.mock.calls.some(
						([removedType, removedListener]) =>
							removedType === type && removedListener === listener
					)
				).toBe(true);
			}
			expect(vi.getTimerCount()).toBe(0);
			controller.abort(new Error('abort after completion'));
			await vi.advanceTimersByTimeAsync(0);
			expect(harness.dispose).toHaveBeenCalledTimes(outcome === 'import failure' ? 0 : 1);
		}
	);

	it('keeps concurrent requests independent when one aborts before adapter construction', async () => {
		const harness = await createHarness();
		const loading = deferred();
		const loadStarted = deferred();
		releaseGates.push(loading.resolve);
		harness.load.mockImplementation(async () => {
			loadStarted.resolve();
			await loading.promise;
		});
		// Overlap load and import: Vitest treats simultaneous manual mock imports as recursion.
		const surviving = observe(harness.compilePython('pass'));
		harness.gate.resolve();
		await loadStarted.promise;
		const controller = new AbortController();
		const reason = new Error('cancel only the second request');
		const cancelled = observe(
			harness.compilePython('cancelled', { signal: controller.signal })
		);
		controller.abort(reason);
		await cancelled.settled;
		expect(cancelled.outcome).toEqual({ status: 'rejected', reason });
		expect(surviving.outcome.status).toBe('pending');
		loading.resolve();
		await surviving.settled;
		expect(surviving.outcome).toEqual({ status: 'fulfilled', value: harness.result });
		expect(harness.constructed).toHaveBeenCalledOnce();
		expect(harness.compile).toHaveBeenCalledWith('pass', expect.any(Object));
		expect(harness.dispose).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('subtracts adapter import time from worker startup without changing compile options', async () => {
		const harness = await createHarness();
		const options = {
			limits: { startupTimeoutMs: 100, assetTimeoutMs: 500, compileTimeoutMs: 1000 }
		};
		const task = observe(harness.compilePython('pass', options));
		await harness.started;
		await vi.advanceTimersByTimeAsync(25);
		harness.gate.resolve();
		await task.settled;
		expect(task.outcome.status).toBe('fulfilled');
		expect(harness.load.mock.calls[0][4]).toMatchObject({
			limits: { startupTimeoutMs: 75, assetTimeoutMs: 500, compileTimeoutMs: 1000 }
		});
		expect(harness.compile.mock.calls[0][1]).toMatchObject(options);
		expect(options.limits.startupTimeoutMs).toBe(100);
		expect(vi.getTimerCount()).toBe(0);
	});
});
