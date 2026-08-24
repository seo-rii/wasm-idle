import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushQueuedStdin, readBufferedStdin } from './stdinBuffer';
import { createRubyRuntimeTestPreflightPayload } from './rubyTestPreflight';

const preflightMocks = vi.hoisted(() => ({
	preflightVerifiedRubyRuntimeAssets: vi.fn()
}));

vi.mock('$lib/playground/rubyAssets', async (importOriginal) => ({
	...(await importOriginal<typeof import('./rubyAssets')>()),
	preflightVerifiedRubyRuntimeAssets: preflightMocks.preflightVerifiedRubyRuntimeAssets
}));

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const workerInstances: MockWorker[] = [];
let autoResolveRun = true;
let runDispatchError: unknown;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (!message.load && runDispatchError) throw runDispatchError;
		queueMicrotask(() => {
			if (message.load) {
				this.resolveLoad();
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

vi.mock('$lib/playground/worker/ruby?worker', () => ({
	default: MockWorker
}));

import Ruby from './ruby';

describe('Ruby stdin isolation', () => {
	beforeEach(() => {
		preflightMocks.preflightVerifiedRubyRuntimeAssets
			.mockReset()
			.mockImplementation(async () => createRubyRuntimeTestPreflightPayload());
		workerInstances.length = 0;
		autoResolveRun = true;
		runDispatchError = undefined;
	});

	it('treats empty explicit stdin as authoritative and isolates the following buffered run', async () => {
		autoResolveRun = false;
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		flushQueuedStdin(['stale shared input\n'], sandbox.buffer);
		sandbox.write('queued before explicit input\n');
		sandbox.eof();

		const explicitRun = sandbox.run('puts STDIN.read', false, true, undefined, [], {
			stdin: ''
		});
		expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ stdin: '' }));
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		worker.emit({ buffer: true });
		expect(sandbox.waitingForInput).toBe(false);
		sandbox.write('queued during explicit input\n');
		sandbox.eof();
		worker.resolveRun();
		await expect(explicitRun).resolves.toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		const bufferedRun = sandbox.run('puts STDIN.gets', false);
		worker.emit({ buffer: true });
		expect(sandbox.waitingForInput).toBe(true);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		sandbox.write('fresh buffered input\n');
		expect(readBufferedStdin(sandbox.buffer)).toBe('fresh buffered input\n');
		worker.resolveRun();
		await expect(bufferedRun).resolves.toBe(true);
	});

	it('cleans explicit stdin after worker and dispatch failures', async () => {
		autoResolveRun = false;
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const worker = workerInstances[0];

		const workerFailure = sandbox.run('raise "failure"', false, true, undefined, [], {
			stdin: 'fixed input\n'
		});
		sandbox.write('queued before worker failure\n');
		worker.emit({ error: 'Ruby failed' });
		await expect(workerFailure).rejects.toBe('Ruby failed');
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		runDispatchError = new Error('Ruby dispatch failed');
		sandbox.write('queued before dispatch failure\n');
		await expect(
			sandbox.run('puts 1', false, true, undefined, [], { stdin: 'fixed input\n' })
		).rejects.toBe(runDispatchError);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
	});

	it('preserves prequeued buffered input and EOF in order for the accepted run', async () => {
		autoResolveRun = false;
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		sandbox.write('prequeued input\n');
		sandbox.eof();

		const running = sandbox.run('puts STDIN.read', false);
		worker.emit({ buffer: true });
		expect(readBufferedStdin(sandbox.buffer)).toBe('prequeued input\n');
		expect(sandbox.pendingEof).toBe(true);
		worker.emit({ buffer: true });
		expect(readBufferedStdin(sandbox.buffer)).toBeNull();
		expect(sandbox.pendingEof).toBe(false);
		worker.resolveRun();
		await expect(running).resolves.toBe(true);
	});

	it('does not let cancellation finalization erase input queued after cancellation', async () => {
		autoResolveRun = false;
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const controller = new AbortController();
		const reason = new Error('cancel Ruby explicit stdin');
		const running = sandbox.run('puts STDIN.read', false, true, undefined, [], {
			signal: controller.signal,
			stdin: 'fixed input\n'
		});
		sandbox.write('owned by cancelled run\n');

		controller.abort(reason);
		sandbox.write('queued after cancellation\n');
		await expect(running).rejects.toBe(reason);
		expect(sandbox.pendingInput).toEqual(['queued after cancellation\n']);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
	});

	it('preserves queued and shared input when validation rejects explicit stdin', async () => {
		const sandbox = new Ruby();
		await sandbox.load('/assets');
		const worker = workerInstances[0];
		const handler = worker.onmessage;
		flushQueuedStdin(['shared input\n'], sandbox.buffer);
		sandbox.write('queued input\n');
		sandbox.eof();

		await expect(
			sandbox.run('puts 1', false, true, undefined, [], {
				activePath: '../main.rb',
				stdin: 'fixed input\n'
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'invalid-path'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.pendingEof).toBe(true);
		expect(readBufferedStdin(sandbox.buffer)).toBe('shared input\n');

		await expect(
			sandbox.run('puts 1', false, true, undefined, [], {
				stdin: null as unknown as string
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'execute',
			runtimeId: 'RUBY'
		});
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBe(handler);
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.pendingEof).toBe(true);
		expect(readBufferedStdin(sandbox.buffer)).toBe('shared input\n');
	});
});
