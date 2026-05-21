import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
	const install = vi.fn();
	const start = vi.fn();
	const stop = vi.fn();

	class MockLanguageClient {
		constructor(public options: any) {}

		start = start;
		stop = stop;
	}

	class MockReader {
		constructor(public worker: any) {}

		onClose = vi.fn(() => ({ dispose() {} }));
	}

	class MockWriter {
		constructor(public worker: any) {}
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
		install,
		start,
		stop,
		workers,
		MockLanguageClient,
		MockReader,
		MockWriter,
		FakeWorker
	};
});

vi.mock('@hancomac/monaco-languageclient', () => ({
	CloseAction: { DoNotRestart: 'DoNotRestart' },
	ErrorAction: { Continue: 'Continue' },
	MonacoLanguageClient: mockState.MockLanguageClient,
	MonacoServices: { install: mockState.install }
}));

vi.mock('vscode-jsonrpc/lib/browser/main.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import { ClangdSession } from '../src/clangd/index.js';

describe('ClangdSession', () => {
	beforeEach(() => {
		mockState.install.mockClear();
		mockState.start.mockClear();
		mockState.stop.mockClear();
		mockState.workers.splice(0, mockState.workers.length);
	});

	it('creates a stable cpp model and starts the worker-backed language client', async () => {
		const previousModel = { dispose: vi.fn() };
		const createModel = vi.fn((value, language, uri) => ({ value, language, uri, dispose: vi.fn() }));
		const parse = vi.fn((value: string) => ({ value }));
		const status = vi.fn();
		const Monaco = {
			Uri: { parse },
			editor: {
				getModel: vi.fn(() => previousModel),
				createModel
			}
		};

		const session = new ClangdSession(
			Monaco as any,
			'https://example.com/runtime/',
			status,
			() => new mockState.FakeWorker() as unknown as Worker
		);
		session.createModel('int main() {}');
		await session.start();
		session.syncFile('workspace/example.cpp');

		expect(previousModel.dispose).toHaveBeenCalledTimes(1);
		expect(createModel).toHaveBeenCalledWith(
			'int main() {}',
			'cpp',
			expect.objectContaining({ value: 'file:///workspace/main.cpp' })
		);
		expect(mockState.install).toHaveBeenCalledTimes(1);
		expect(status).toHaveBeenCalledWith({ state: 'loading' });
		expect(status).toHaveBeenCalledWith({ state: 'loading', loaded: 32, total: 64 });
		expect(status).toHaveBeenCalledWith({ state: 'ready' });
		expect(mockState.start).toHaveBeenCalledTimes(1);
		expect(mockState.workers[0]?.messages).toEqual([
			{ type: 'init', baseUrl: 'https://example.com/runtime' },
			{ type: 'sync-file', name: 'workspace/example.cpp' }
		]);

		session.dispose();
		expect(mockState.stop).toHaveBeenCalledTimes(1);
		expect(mockState.workers[0]?.terminated).toBe(true);
	});
});
