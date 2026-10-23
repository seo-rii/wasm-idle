// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createContainerWorkerClient } from './client.js';
import { CONTAINER_WORKER_PROTOCOL, type ContainerWorkerInitialization } from './protocol.js';

class OwnerFixture extends EventTarget {
	messages: unknown[] = [];
	terminated = false;
	terminations = 0;
	postMessage(message: unknown) {
		this.messages.push(message);
	}
	terminate() {
		this.terminated = true;
		this.terminations++;
	}
	reply(id: number, value?: unknown) {
		const { channel } = this.messages[0] as { channel: string };
		this.dispatchEvent(
			new MessageEvent('message', {
				data: { version: CONTAINER_WORKER_PROTOCOL, channel, id, type: 'result', value }
			})
		);
	}
	ready() {
		const { channel } = this.messages[0] as { channel: string };
		this.dispatchEvent(
			new MessageEvent('message', {
				data: {
					version: CONTAINER_WORKER_PROTOCOL,
					channel,
					id: 0,
					type: 'result',
					value: undefined
				}
			})
		);
	}
	fail(error: Error) {
		this.dispatchEvent(Object.assign(new Event('error'), { error, message: error.message }));
	}
}
function fixture(options: { initializationTimeoutMs?: number; cleanupDeadlineMs?: number } = {}) {
	const worker = new OwnerFixture();
	const client = createContainerWorkerClient({
		runtimeAssets: {} as ContainerWorkerInitialization['runtimeAssets'],
		applicationRootURL: 'http://localhost/wasm-idle/',
		workspaceId: 'startup-error-preservation',
		workerFactory: () => worker,
		...options
	});
	return { client, worker };
}

describe('container owner retirement cause', () => {
	it('preserves the actual worker error for pending and later calls', async () => {
		const { client, worker } = fixture();
		worker.ready();
		const pending = client.call('inspect');
		const original = new Error('Worker module could not import the pinned SDK');
		worker.fail(original);
		await expect(pending).rejects.toBe(original);
		await expect(client.call('shellWrite', ['hello'])).rejects.toBe(original);
		expect(worker.terminated).toBe(true);
		await client.dispose();
	});

	it('keeps a message decoding failure distinct after startup retirement', async () => {
		const { client, worker } = fixture();
		worker.dispatchEvent(new Event('messageerror'));
		await expect(client.call('inspect')).rejects.toThrow('message could not be decoded');
		await client.dispose();
	});
});

describe('container owner cancellation and late initialization', () => {
	it('retires a pending initialization during disposal and ignores a late ready event', async () => {
		vi.useFakeTimers();
		try {
			const { client, worker } = fixture({ cleanupDeadlineMs: 20 });
			const disposing = client.dispose();
			await vi.advanceTimersByTimeAsync(20);
			await disposing;
			worker.ready();
			await expect(client.call('inspect')).rejects.toThrow('disposal deadline expired');
			expect(worker.terminations).toBe(1);
			expect(worker.messages).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('terminates once after acknowledged cleanup and makes disposal idempotent', async () => {
		const { client, worker } = fixture();
		worker.ready();
		const first = client.dispose();
		const second = client.dispose();
		expect(first).toBe(second);
		await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
		const request = worker.messages[1] as { id: number; method: string };
		expect(request.method).toBe('dispose');
		worker.reply(request.id);
		await first;
		expect(worker.terminations).toBe(1);
	});

	it('snapshots queued files before owner initialization finishes', async () => {
		const { client, worker } = fixture();
		const files = [{ path: 'main.py', content: 'print(1)' }];
		const pending = client.call('syncWorkspace', ['PYTHON3', files]);
		files[0].content = 'print(2)';
		worker.ready();
		await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
		const request = worker.messages[1] as { id: number; args: unknown[] };
		expect(request.args).toEqual(['PYTHON3', [{ path: 'main.py', content: 'print(1)' }]]);
		worker.reply(request.id);
		await pending;
		worker.fail(new Error('fixture finished'));
		await client.dispose();
	});

	it('sends cancellation separately and rejects a late successful result after abort', async () => {
		const { client, worker } = fixture();
		worker.ready();
		const abort = new AbortController();
		const pending = client.call('run', ['PYTHON3', 'input()'], { signal: abort.signal });
		const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		await vi.waitFor(() => expect(worker.messages).toHaveLength(2));
		const request = worker.messages[1] as { id: number };
		abort.abort();
		expect(worker.messages[2]).toMatchObject({ type: 'cancel', id: request.id });
		worker.reply(request.id, true);
		await rejected;
		worker.fail(new Error('fixture finished'));
		await client.dispose();
	});

	it('reclaims the owner when cancelled execution misses its cleanup deadline', async () => {
		vi.useFakeTimers();
		try {
			const { client, worker } = fixture({ cleanupDeadlineMs: 20 });
			worker.ready();
			const abort = new AbortController();
			const pending = client.call('run', [], { signal: abort.signal });
			const rejected = expect(pending).rejects.toThrow('did not finish cancellation');
			await vi.advanceTimersByTimeAsync(0);
			abort.abort();
			await vi.advanceTimersByTimeAsync(20);
			await rejected;
			expect(worker.terminations).toBe(1);
			await expect(client.call('inspect')).rejects.toThrow('did not finish cancellation');
			await client.dispose();
		} finally {
			vi.useRealTimers();
		}
	});
});
