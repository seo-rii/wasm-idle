import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PythonCompileOptions, PythonCompileResult } from './pythonCompiler';

const workers: CompilerWorker[] = [];
let pendingLoad = false;
let pendingCompilation = false;
let loadError: string | undefined;
let compileError: string | undefined;
let result: PythonCompileResult;

class CompilerWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: (() => void) | null = null;
	terminate = vi.fn();
	postMessage = vi.fn((message: Record<string, unknown>) => {
		queueMicrotask(() => {
			if (message.load && !pendingLoad)
				this.emit(loadError ? { error: loadError } : { load: true });
			else if (message.compile && !pendingCompilation) {
				this.emit(compileError ? { error: compileError } : { compiled: result });
			}
		});
	});
	constructor() {
		workers.push(this);
	}
	emit(data: unknown) {
		this.onmessage?.({ data } as MessageEvent);
	}
}

import { compilePython } from './pythonCompiler';
import Python from './playground/python';

beforeEach(() => {
	vi.stubGlobal('Worker', CompilerWorker);
	workers.length = 0;
	pendingLoad = false;
	pendingCompilation = false;
	loadError = compileError = undefined;
	result = {
		path: 'main.pyc',
		data: new Uint8Array(32),
		pythonVersion: '3.14.2',
		cacheTag: 'cpython-314',
		magicNumber: '2b0e0d0a'
	};
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('compilePython', () => {
	it('accepts uppercase Python extensions consistently with the playground', async () => {
		await expect(compilePython('pass', { fileName: 'main.PY' })).resolves.toEqual(result);
		expect(workers[0].postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({ fileName: 'main.PY' })
		);
	});
	it('returns bytecode metadata and disposes its dedicated worker without running source', async () => {
		result.path = '패키지/main.pyc';
		await expect(
			compilePython('raise RuntimeError("never run")', {
				fileName: '패키지/main.py',
				optimize: 2,
				runtimeAssets: '/assets/',
				limits: { maxOutputBytes: 64 }
			})
		).resolves.toEqual(result);
		expect(workers).toHaveLength(1);
		expect(workers[0].postMessage.mock.calls.map(([message]) => message)).toEqual([
			expect.objectContaining({ load: true }),
			{
				compile: true,
				language: 'python',
				code: 'raise RuntimeError("never run")',
				fileName: '패키지/main.py',
				optimize: 2,
				invalidationMode: 'checked-hash',
				timestamp: undefined,
				maxArtifactBytes: 64
			}
		]);
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});

	it.each([
		[{ invalidationMode: 'checked-hash' }, 'checked-hash', undefined],
		[{ invalidationMode: 'unchecked-hash' }, 'unchecked-hash', undefined],
		[{ invalidationMode: 'timestamp' }, 'timestamp', 0],
		[{ invalidationMode: 'timestamp', timestamp: 0 }, 'timestamp', 0],
		[{ invalidationMode: 'timestamp', timestamp: 1_700_000_000 }, 'timestamp', 1_700_000_000],
		[{ invalidationMode: 'timestamp', timestamp: 0xffff_ffff }, 'timestamp', 0xffff_ffff]
	] as const)(
		'forwards resolved bytecode options to its worker: %j',
		async (options, invalidationMode, timestamp) => {
			await expect(compilePython('pass', options)).resolves.toEqual(result);
			expect(workers[0].postMessage).toHaveBeenLastCalledWith(
				expect.objectContaining({ compile: true, invalidationMode, timestamp })
			);
			expect(workers[0].terminate).toHaveBeenCalledOnce();
		}
	);

	it.each([
		['unknown mode', { invalidationMode: 'hash' }],
		['numeric mode', { invalidationMode: 0 }],
		['null mode', { invalidationMode: null }],
		['timestamp without timestamp mode', { timestamp: 0 }],
		['checked-hash timestamp', { invalidationMode: 'checked-hash', timestamp: 0 }],
		['unchecked-hash timestamp', { invalidationMode: 'unchecked-hash', timestamp: 0 }],
		['NaN timestamp', { invalidationMode: 'timestamp', timestamp: Number.NaN }],
		[
			'infinite timestamp',
			{ invalidationMode: 'timestamp', timestamp: Number.POSITIVE_INFINITY }
		],
		['fractional timestamp', { invalidationMode: 'timestamp', timestamp: 1.5 }],
		['negative timestamp', { invalidationMode: 'timestamp', timestamp: -1 }],
		['out-of-range timestamp', { invalidationMode: 'timestamp', timestamp: 0x1_0000_0000 }],
		['string timestamp', { invalidationMode: 'timestamp', timestamp: '0' }],
		['null timestamp', { invalidationMode: 'timestamp', timestamp: null }],
		['boolean timestamp', { invalidationMode: 'timestamp', timestamp: false }]
	] as const)('rejects %s before creating a worker', async (_label, options) => {
		await expect(compilePython('pass', options as PythonCompileOptions)).rejects.toMatchObject({
			code: 'runtime-configuration'
		});
		expect(workers).toHaveLength(0);
	});

	it.each([
		{ fileName: '../main.py' },
		{ fileName: '/main.py' },
		{ fileName: 'main.txt' },
		{ optimize: 3 },
		{ limits: { compileTimeoutMs: 0 } },
		{ limits: { maxWorkspaceBytes: 1 } }
	])('rejects invalid input before creating a worker: %j', async (options) => {
		await expect(compilePython('print(42)', options as PythonCompileOptions)).rejects.toThrow();
		expect(workers).toHaveLength(0);
	});

	it('rejects an already aborted request before runtime initialization', async () => {
		const controller = new AbortController();
		const reason = new Error('cancelled before startup');
		controller.abort(reason);
		await expect(compilePython('pass', { signal: controller.signal })).rejects.toBe(reason);
		expect(workers).toHaveLength(0);
	});

	it.each(['before startup', 'load', 'compile'])(
		'preserves the original string cancellation reason during %s',
		async (phase) => {
			pendingLoad = phase === 'load';
			pendingCompilation = phase === 'compile';
			const controller = new AbortController();
			const reason = `cancelled during ${phase}`;
			if (phase === 'before startup') controller.abort(reason);
			const compiling = compilePython('pass', { signal: controller.signal });
			const rejection = expect(compiling).rejects.toBe(reason);
			if (phase === 'before startup') {
				await rejection;
				expect(workers).toHaveLength(0);
				return;
			}
			await vi.waitFor(() =>
				expect(workers[0]?.postMessage).toHaveBeenCalledTimes(phase === 'load' ? 1 : 2)
			);
			controller.abort(reason);
			await rejection;
			expect(workers[0].terminate).toHaveBeenCalledOnce();
		}
	);

	it.each(['load', 'compile'])('normalizes %s worker errors and disposes', async (phase) => {
		if (phase === 'load') loadError = 'asset failed';
		else compileError = 'SyntaxError: invalid syntax';
		const compiling = compilePython('if');
		await expect(compiling).rejects.toBeInstanceOf(Error);
		await expect(compiling).rejects.toThrow(loadError ?? compileError);
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});

	it('aborts a pending compile and releases the worker', async () => {
		pendingCompilation = true;
		const controller = new AbortController();
		const reason = new Error('cancelled compilation');
		const compiling = compilePython('pass', { signal: controller.signal });
		const rejection = expect(compiling).rejects.toBe(reason);
		await vi.waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalledTimes(2));
		controller.abort(reason);
		await rejection;
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});

	it('bounds compile time and disposes timed out workers', async () => {
		vi.useFakeTimers();
		pendingCompilation = true;
		const compiling = compilePython('pass', { limits: { compileTimeoutMs: 1000 } });
		const rejection = expect(compiling).rejects.toMatchObject({
			code: 'timeout',
			phase: 'compile'
		});
		await vi.waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalledTimes(2));
		await vi.advanceTimersByTimeAsync(1000);
		await rejection;
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});

	it('settles a crashed worker instead of waiting indefinitely', async () => {
		pendingCompilation = true;
		const compiling = compilePython('pass');
		const rejection = expect(compiling).rejects.toThrow('compiler crash');
		await vi.waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalledTimes(2));
		workers[0].onerror?.({ message: 'compiler crash' } as ErrorEvent);
		await rejection;
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});

	it('checks the binary result limit at the host boundary', async () => {
		await expect(
			compilePython('pass', { limits: { maxOutputBytes: 16 } })
		).rejects.toMatchObject({ code: 'output-limit', phase: 'compile' });
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});

	it('preserves structured worker output-limit errors', async () => {
		pendingCompilation = true;
		const compiling = compilePython('pass');
		const rejection = expect(compiling).rejects.toMatchObject({
			code: 'output-limit',
			phase: 'compile',
			actual: 200,
			limit: 100
		});
		await vi.waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalledTimes(2));
		workers[0].emit({ error: 'Bytecode too large', outputLimit: { actual: 200, limit: 100 } });
		await rejection;
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});

	it('gives concurrent requests independent workers', async () => {
		const values = await Promise.all([compilePython('a = 1'), compilePython('b = 2')]);
		expect(values).toEqual([result, result]);
		expect(workers).toHaveLength(2);
		for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce();
	});

	it('validates bytecode options at the direct adapter boundary and recovers', async () => {
		const python = new Python();
		try {
			await python.load('/');
			for (const options of [
				{ invalidationMode: 'hash' },
				{ invalidationMode: 'checked-hash', timestamp: 0 },
				{ invalidationMode: 'timestamp', timestamp: -1 }
			]) {
				await expect(
					python.compile('pass', options as PythonCompileOptions)
				).rejects.toMatchObject({ code: 'runtime-configuration' });
			}
			expect(workers[0].postMessage).toHaveBeenCalledOnce();
			await expect(
				python.compile('pass', { invalidationMode: 'timestamp', timestamp: 0 })
			).resolves.toEqual(result);
			expect(workers[0].postMessage).toHaveBeenLastCalledWith(
				expect.objectContaining({ invalidationMode: 'timestamp', timestamp: 0 })
			);
		} finally {
			await python.dispose();
		}
	});

	it('rejects overlapping direct adapter operations and recovers after compile failure', async () => {
		const python = new Python();
		try {
			await python.load('/');
			pendingCompilation = true;
			const compiling = python.compile('pass');
			const rejection = expect(compiling).rejects.toBe('SyntaxError');
			await expect(python.compile('other')).rejects.toMatchObject({ code: 'busy' });
			await expect(python.run('print(1)', false)).rejects.toMatchObject({ code: 'busy' });
			workers[0].emit({ error: 'SyntaxError' });
			await rejection;
			pendingCompilation = false;
			await expect(python.compile('pass')).resolves.toEqual(result);
		} finally {
			await python.dispose();
		}
	});
});
