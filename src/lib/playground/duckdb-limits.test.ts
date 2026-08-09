import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

const workerInstances: MockWorker[] = [];

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) queueMicrotask(() => this.emit({ load: true }));
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}

	emit(data: Record<string, unknown>) {
		this.onmessage?.({ data } as MessageEvent<any>);
	}
}

vi.mock('$lib/playground/worker/duckdb?worker', () => ({
	default: MockWorker
}));

import DuckDB from './duckdb';

describe('DuckDB execution message limits', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('terminates output before exceeding the cumulative UTF-8 byte limit', async () => {
		const sandbox = new DuckDB();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('select 1;', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const staleHandler = retiredWorker.onmessage;

		retiredWorker.emit({ output: 'é' });
		retiredWorker.emit({ output: '🙂', results: true });

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'DUCKDB',
			actual: 6,
			limit: 5
		});
		expect(output).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith('é');
		expect(output).not.toHaveBeenCalledWith('🙂');
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleHandler?.({ data: { output: 'stale output', results: true } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalledWith('stale output');

		await sandbox.load('/assets');
		const replacementWorker = workerInstances[1];
		const retry = sandbox.run('select 2;', false);
		replacementWorker.emit({ results: true });
		await expect(retry).resolves.toBe(true);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
	});

	it('counts diagnostics even when no callback is registered', async () => {
		const sandbox = new DuckDB();
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('select broken;', false, true, undefined, [], {
			limits: { maxDiagnostics: 1 }
		});

		retiredWorker.emit({ diagnostic: { message: 'first diagnostic' } });
		const onDiagnostic = vi.fn();
		sandbox.oncompilerdiagnostic = onDiagnostic;
		retiredWorker.emit({
			diagnostic: { message: 'second diagnostic' },
			results: true
		});

		await expect(running).rejects.toMatchObject({
			name: 'DiagnosticLimitError',
			code: 'diagnostic-limit',
			phase: 'execute',
			runtimeId: 'DUCKDB',
			actual: 2,
			limit: 1
		});
		expect(onDiagnostic).not.toHaveBeenCalled();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		await sandbox.load('/assets');
		const replacementWorker = workerInstances[1];
		const retry = sandbox.run('select 2;', false);
		replacementWorker.emit({ results: true });
		await expect(retry).resolves.toBe(true);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
	});

	it('retires the quota owner before signal cleanup can start a replacement', async () => {
		const sandbox = new DuckDB();
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		let replacement: Promise<void> | undefined;
		let listenerRemovals = 0;
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(),
			removeEventListener() {
				listenerRemovals += 1;
				if (listenerRemovals === 2) replacement = sandbox.load('/replacement');
			}
		} as unknown as AbortSignal;
		const running = sandbox.run('select 1;', false, true, undefined, [], {
			signal,
			limits: { maxOutputBytes: 1 }
		});

		retiredWorker.emit({ output: 'too large' });

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			runtimeId: 'DUCKDB'
		});
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		const replacementWorker = workerInstances[1];
		expect(sandbox.worker).toBe(replacementWorker);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();

		const retry = sandbox.run('select 2;', false);
		replacementWorker.emit({ results: true });
		await expect(retry).resolves.toBe(true);
	});
});
