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
				handler({
					data: { type: 'progress', stage: 'load-go-compiler' }
				} as MessageEvent<any>);
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

import { getGoLanguageServer } from '../src/index.js';

describe('getGoLanguageServer', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
	});

	it('starts the wasm-go-backed Go LSP worker', async () => {
		const status = vi.fn();
		const handle = await getGoLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			go: {
				target: 'wasip2/wasm'
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker,
			onStatus: status
		});
		const worker = mockState.workers[0];

		expect(worker?.messages[0]).toEqual({
			type: 'init',
			persistentAssets: expect.objectContaining({
				persistentCache: expect.objectContaining({ enabled: true })
			}),
			options: {
				compilerUrl: 'https://static.example.com/repl_20240807/wasm-go/index.js',
				target: 'wasip2/wasm'
			}
		});
		expect(status).toHaveBeenCalledWith({
			state: 'loading',
			stage: 'startup',
			loaded: 0,
			total: 1
		});
		expect(status).toHaveBeenCalledWith({
			state: 'loading',
			stage: 'load-go-compiler',
			loaded: 0.45,
			total: 1
		});
		expect(status).toHaveBeenCalledWith({ state: 'ready' });

		handle.dispose();
		expect(worker?.terminated).toBe(true);
		expect(status).toHaveBeenCalledWith({ state: 'disabled' });
	});

	it('shares the runtime manifest and hands the lock root to the worker', async () => {
		const handle = await getGoLanguageServer({
			rootUrl: 'https://app.example.com/wasm-idle/',
			currentUrl: 'https://app.example.com/wasm-idle/editor',
			go: {
				compilerUrl: '/wasm-idle/wasm-go/index.js?v=7',
				runtimeManifestUrl: '/wasm-idle/wasm-go/runtime/runtime-manifest.v1.json?v=7'
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		expect(mockState.workers[0]?.messages[0]).toMatchObject({
			persistentAssets: { assetRoot: 'https://app.example.com/wasm-idle/' },
			options: {
				compilerUrl: 'https://app.example.com/wasm-idle/wasm-go/index.js?v=7',
				runtimeManifestUrl:
					'https://app.example.com/wasm-idle/wasm-go/runtime/runtime-manifest.v1.json?v=7'
			}
		});
		handle.dispose();
	});
});
