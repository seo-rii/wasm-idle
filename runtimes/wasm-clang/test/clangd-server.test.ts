import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
	class MockReader {
		dispose = vi.fn();

		constructor(public worker: Worker) {}
	}

	class MockWriter {
		dispose = vi.fn();
		end = vi.fn();

		constructor(public worker: Worker) {}
	}

	const workers: FakeWorker[] = [];

	class FakeWorker {
		listeners = {
			message: new Set<(event: MessageEvent<any>) => void>(),
			error: new Set<(event: ErrorEvent) => void>()
		};
		messages: any[] = [];
		terminated = false;

		constructor() {
			workers.push(this);
		}

		addEventListener(type: 'message' | 'error', handler: any) {
			this.listeners[type].add(handler);
		}

		removeEventListener(type: 'message' | 'error', handler: any) {
			this.listeners[type].delete(handler);
		}

		postMessage(message: any) {
			this.messages.push(message);
			if (message.type !== 'init') return;
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'progress', value: 32, max: 64 } } as MessageEvent<any>);
			}
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'ready', value: 64 } } as MessageEvent<any>);
			}
		}

		terminate() {
			this.terminated = true;
		}
	}

	return {
		workers,
		MockReader,
		MockWriter,
		FakeWorker
	};
});

vi.mock('vscode-jsonrpc/lib/browser/main.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import { createClangdLanguageServer } from '../src/clangd/index.js';

describe('createClangdLanguageServer', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
	});

	it('starts the clangd worker and exposes a JSON-RPC transport handle', async () => {
		const status = vi.fn();
		const server = await createClangdLanguageServer({
			baseUrl: 'https://example.com/runtime/',
			onStatus: status,
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		server.syncFile('workspace/example.cpp');

		expect(server.transport.reader).toBeInstanceOf(mockState.MockReader);
		expect(server.transport.writer).toBeInstanceOf(mockState.MockWriter);
		expect(status).toHaveBeenCalledWith({ state: 'loading' });
		expect(status).toHaveBeenCalledWith({ state: 'loading', loaded: 32, total: 64 });
		expect(status).toHaveBeenCalledWith({ state: 'ready' });
		expect(mockState.workers[0]?.messages).toEqual([
			{ type: 'init', baseUrl: 'https://example.com/runtime' },
			{ type: 'sync-file', name: 'workspace/example.cpp' }
		]);

		server.dispose();

		expect(mockState.workers[0]?.terminated).toBe(true);
		expect(status).toHaveBeenCalledWith({ state: 'disabled' });
	});
});
