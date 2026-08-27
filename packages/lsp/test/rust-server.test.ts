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
					data: { type: 'progress', stage: 'load-rust-compiler' }
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

import { getRustLanguageServer } from '../src/index.js';

describe('getRustLanguageServer', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
	});

	it('starts the wasm-rust-backed Rust LSP worker', async () => {
		const status = vi.fn();
		const compilerUrl = 'blob:https://app.example/verified-rust-entry';
		const runtimeProfile = {
			profileId: 'rust-runtime-v1',
			protocolVersion: 1 as const,
			manifestPath: 'runtime/runtime-manifest.v3.json' as const,
			manifestFingerprint: 'b'.repeat(64),
			manifestReceipt: { bytes: 42, sha256: 'c'.repeat(64) },
			moduleUrl: `https://static.example.com/wasm-rust/index.js?v=${'b'.repeat(64)}`
		};
		const handle = await getRustLanguageServer({
			currentUrl: 'https://app.example.com/editor',
			rust: {
				compilerUrl,
				expectedNetworkModuleUrls: [runtimeProfile.moduleUrl],
				verifiedModuleUrls: { [runtimeProfile.moduleUrl]: compilerUrl },
				graphFingerprint: 'a'.repeat(64),
				runtimeProfile,
				targetTriple: 'wasm32-wasip2'
			},
			createWorker: () => new mockState.FakeWorker() as unknown as Worker,
			onStatus: status
		});
		const worker = mockState.workers[0];

		expect(worker?.messages[0]).toEqual({
			type: 'init',
			options: {
				compilerUrl,
				expectedNetworkModuleUrls: [runtimeProfile.moduleUrl],
				verifiedModuleUrls: { [runtimeProfile.moduleUrl]: compilerUrl },
				graphFingerprint: 'a'.repeat(64),
				runtimeProfile,
				targetTriple: 'wasm32-wasip2',
				edition: undefined
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
			stage: 'load-rust-compiler',
			loaded: 0.45,
			total: 1
		});
		expect(status).toHaveBeenCalledWith({ state: 'ready' });

		handle.dispose();
		expect(worker?.terminated).toBe(true);
		expect(status).toHaveBeenCalledWith({ state: 'disabled' });
	});

	it('rejects missing verified executable graph configuration before creating a worker', async () => {
		await expect(
			getRustLanguageServer({
				rust: { compilerUrl: 'https://static.example.com/wasm-rust/index.js' },
				createWorker: () => new mockState.FakeWorker() as unknown as Worker
			})
		).rejects.toThrow('verified executable graph configuration');
		expect(mockState.workers).toHaveLength(0);
	});
});
