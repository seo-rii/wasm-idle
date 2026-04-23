import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

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

vi.mock('./main.worker?worker', () => ({
	default: mockState.FakeWorker
}));

vi.mock('$lib/utils/vscodeJsonrpcBrowser', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import { getPythonLanguageServer } from './server';

describe('getPythonLanguageServer', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
	});

	it('starts the shared python LSP worker with the resolved pyodide base URL', async () => {
		const handle = await getPythonLanguageServer('https://static.example.com/repl_20240807');
		const worker = mockState.workers[0];

		expect(worker?.messages[0]).toEqual({
			type: 'init',
			pyodideBaseUrl: 'https://static.example.com/repl_20240807/pyodide/'
		});

		handle.dispose();
		expect(worker?.terminated).toBe(true);
	});
});
