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

vi.mock('$lib/playground/worker/ruby?worker', () => ({
	default: MockWorker
}));

import Ruby from './ruby';

describe('Ruby execution message limits', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('terminates output before exceeding the cumulative UTF-8 byte limit', async () => {
		const sandbox = new Ruby();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('puts "ok"', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const staleHandler = retiredWorker.onmessage;

		retiredWorker.emit({ output: 'é' });
		retiredWorker.emit({ output: '🙂', results: true });

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'RUBY',
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
		const retry = sandbox.run('puts "retry"', false);
		replacementWorker.emit({ results: true });
		await expect(retry).resolves.toBe(true);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
	});

	it('counts diagnostics even when no callback is registered', async () => {
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('invalid ruby', false, true, undefined, [], {
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
			runtimeId: 'RUBY',
			actual: 2,
			limit: 1
		});
		expect(onDiagnostic).not.toHaveBeenCalled();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		await sandbox.load('/assets');
		const replacementWorker = workerInstances[1];
		const retry = sandbox.run('puts "retry"', false);
		replacementWorker.emit({ results: true });
		await expect(retry).resolves.toBe(true);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
	});

	it('retires the quota owner before signal cleanup can start a replacement', async () => {
		const sandbox = new Ruby();
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
				if (listenerRemovals === 2) {
					replacement = sandbox.load({
						ruby: {
							moduleUrl: '/replacement/ruby.mjs',
							wasmUrl: '/replacement/ruby.wasm'
						}
					});
				}
			}
		} as unknown as AbortSignal;
		const running = sandbox.run('puts "large"', false, true, undefined, [], {
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
			runtimeId: 'RUBY'
		});
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(workerInstances).toHaveLength(2);
		const replacementWorker = workerInstances[1];
		expect(sandbox.worker).toBe(replacementWorker);
		expect(replacementWorker.terminate).not.toHaveBeenCalled();
		expect(replacementWorker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				load: true,
				moduleUrl: 'http://localhost:3000/replacement/ruby.mjs',
				wasmUrl: 'http://localhost:3000/replacement/ruby.wasm'
			})
		);

		const retry = sandbox.run('puts "retry"', false);
		replacementWorker.emit({ results: true });
		await expect(retry).resolves.toBe(true);
	});
});
