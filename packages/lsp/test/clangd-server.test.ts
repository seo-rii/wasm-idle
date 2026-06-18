import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
	const workers: FakeWorker[] = [];

	class FakeWorker {
		listeners = {
			message: new Set<(event: MessageEvent<any>) => void>(),
			error: new Set<(event: ErrorEvent) => void>()
		};
		messages: any[] = [];
		transfers: Transferable[][] = [];
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

		postMessage(message: any, transfer: Transferable[] = []) {
			this.messages.push(message);
			this.transfers.push(transfer);
			if (message.type !== 'init') return;
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'progress', value: 2, max: 3 } } as MessageEvent<any>);
			}
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'ready', value: 64 } } as MessageEvent<any>);
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

import { getCppLanguageServer } from '../src/index.js';

describe('getCppLanguageServer', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
	});

	it('starts clangd with a resolved base URL and sync hook', async () => {
		const status = vi.fn();
		const handle = await getCppLanguageServer({
			rootUrl: 'https://static.example.com/repl_20240807',
			currentUrl: 'https://app.example.com/editor',
			createWorker: () => new mockState.FakeWorker() as unknown as Worker,
			onStatus: status
		});
		const worker = mockState.workers[0];

		expect(worker?.messages[0]).toEqual({
			type: 'init',
			baseUrl: 'https://static.example.com/repl_20240807/clangd/'
		});
		expect(status).toHaveBeenCalledWith({ state: 'loading' });
		expect(status).toHaveBeenCalledWith({ state: 'loading', loaded: 2, total: 3 });
		expect(status).toHaveBeenCalledWith({ state: 'ready' });

		handle.syncFile?.('/workspace/problem.cpp');

		expect(worker?.messages[1]).toEqual({
			type: 'sync-file',
			name: '/workspace/problem.cpp'
		});

		handle.dispose();
		expect(worker?.terminated).toBe(true);
		expect(status).toHaveBeenCalledWith({ state: 'disabled' });
	});

	it('preloads clangd assets through the configured loader before worker init', async () => {
		const loader = vi.fn(async ({ asset }: { asset: string }) =>
			asset === 'clangd.js'
				? { data: 'export default async () => ({})' }
				: new Uint8Array([0x1f, 0x8b, 0x08])
		);
		await getCppLanguageServer({
			cpp: {
				baseUrl: 'https://cdn.example.com/clangd',
				loader
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});
		const worker = mockState.workers[0];

		expect(loader).toHaveBeenCalledTimes(2);
		expect(worker?.messages[0]).toMatchObject({
			type: 'init',
			baseUrl: 'https://cdn.example.com/clangd/',
			assets: {
				clangdJs: expect.any(ArrayBuffer),
				clangdWasmGz: expect.any(ArrayBuffer)
			}
		});
		expect(worker?.transfers[0]).toHaveLength(2);
	});
});
