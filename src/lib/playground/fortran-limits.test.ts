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

vi.mock('$lib/playground/worker/fortran?worker', () => ({
	default: MockWorker
}));

import Fortran from './fortran';

describe('Fortran execution message limits', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('terminates output before exceeding the cumulative UTF-8 byte limit', async () => {
		const sandbox = new Fortran();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('      END', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const staleHandler = retiredWorker.onmessage;

		retiredWorker.emit({ output: 'é' });
		retiredWorker.emit({ output: '🙂', results: true });

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'FORTRAN',
			actual: 6,
			limit: 5
		});
		expect(output).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith('é');
		expect(output).not.toHaveBeenCalledWith('🙂');
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.assetBridge).toBeNull();

		staleHandler?.({ data: { output: 'stale output', results: true } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalledWith('stale output');

		await sandbox.load('/assets');
		const replacementWorker = workerInstances[1];
		const retry = sandbox.run('      END', false);
		replacementWorker.emit({ results: true });
		await expect(retry).resolves.toBe(true);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
	});

	it('retires the quota owner before signal cleanup starts a replacement', async () => {
		const sandbox = new Fortran();
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		let replacement: Promise<void> | undefined;
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(),
			removeEventListener() {
				replacement = sandbox.load('/replacement');
			}
		} as unknown as AbortSignal;
		const running = sandbox.run('      END', false, true, undefined, [], {
			signal,
			stdin: 'fixed input\n',
			limits: { maxOutputBytes: 1 }
		});
		sandbox.write('discard after quota failure\n');
		sandbox.eof();

		retiredWorker.emit({ output: 'too large' });

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			runtimeId: 'FORTRAN'
		});
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(workerInstances).toHaveLength(2);
		const replacementWorker = workerInstances[1];
		expect(sandbox.worker).toBe(replacementWorker);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();

		const retry = sandbox.run('      END', false);
		replacementWorker.emit({ results: true });
		await expect(retry).resolves.toBe(true);
	});
});
