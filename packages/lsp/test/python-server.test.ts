import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
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
				handler({ data: { type: 'progress', stage: 'load-pyodide' } } as MessageEvent<any>);
			}
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'ready' } } as MessageEvent<any>);
			}
		}

		terminate() {
			this.terminated = true;
		}
	}

	class MockReader {
		constructor(public worker: any) {}

		dispose = vi.fn();
	}

	class MockWriter {
		constructor(public worker: any) {}

		dispose = vi.fn();
	}

	return { workers, FakeWorker, MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import { getPythonLanguageServer } from '../src/index.js';

describe('getPythonLanguageServer', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
	});

	it('starts the Pyodide-backed Python LSP worker', async () => {
		const status = vi.fn();
		const handle = await getPythonLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker,
			onStatus: status
		});
		const worker = mockState.workers[0];

		expect(worker?.messages[0]).toEqual({
			type: 'init',
			pyodideBaseUrl: 'https://static.example.com/repl_20240807/pyodide/'
		});
		expect(status).toHaveBeenCalledWith({ state: 'loading' });
		expect(status).toHaveBeenCalledWith({ state: 'loading', stage: 'load-pyodide' });
		expect(status).toHaveBeenCalledWith({ state: 'ready' });

		handle.dispose();
		expect(worker?.terminated).toBe(true);
		expect(status).toHaveBeenCalledWith({ state: 'disabled' });
	});
});
