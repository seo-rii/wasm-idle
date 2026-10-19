// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createContainerWorkerClient } from './client';
import { CONTAINER_WORKER_PROTOCOL, type ContainerWorkerInitialization } from './protocol';

class OwnerFixture extends EventTarget {
	messages: unknown[] = [];
	terminated = false;
	postMessage(message: unknown) {
		this.messages.push(message);
	}
	terminate() {
		this.terminated = true;
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
function fixture() {
	const worker = new OwnerFixture();
	const client = createContainerWorkerClient({
		runtimeAssets: {} as ContainerWorkerInitialization['runtimeAssets'],
		applicationRootURL: 'http://localhost/wasm-idle/',
		workspaceId: 'startup-error-preservation',
		workerFactory: () => worker
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
