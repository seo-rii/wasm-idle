import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
	const workers: FakeWorker[] = [];
	const readers: MockReader[] = [];
	const writers: MockWriter[] = [];

	class FakeWorker {
		listeners = {
			message: new Set<(event: MessageEvent<unknown>) => void>(),
			error: new Set<(event: ErrorEvent) => void>()
		};
		messages: unknown[] = [];
		terminateCalls = 0;

		constructor() {
			workers.push(this);
		}

		addEventListener(
			type: 'message' | 'error',
			handler: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
		) {
			if (type === 'message') {
				this.listeners.message.add(handler as (event: MessageEvent<unknown>) => void);
			} else {
				this.listeners.error.add(handler as (event: ErrorEvent) => void);
			}
		}

		removeEventListener(
			type: 'message' | 'error',
			handler: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
		) {
			if (type === 'message') {
				this.listeners.message.delete(handler as (event: MessageEvent<unknown>) => void);
			} else {
				this.listeners.error.delete(handler as (event: ErrorEvent) => void);
			}
		}

		postMessage(message: { type?: string }) {
			this.messages.push(message);
			if (message.type !== 'init') return;
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'ready' } } as MessageEvent<unknown>);
			}
		}

		terminate() {
			this.terminateCalls += 1;
		}
	}

	class MockReader {
		onError = undefined;
		onClose = undefined;
		onPartialMessage = undefined;
		disposeCalls = 0;

		constructor(public worker: unknown) {
			readers.push(this);
		}

		listen() {
			return { dispose() {} };
		}

		dispose() {
			this.disposeCalls += 1;
		}
	}

	class MockWriter {
		disposeCalls = 0;

		constructor(public worker: unknown) {
			writers.push(this);
		}

		dispose() {
			this.disposeCalls += 1;
		}
	}

	return { workers, readers, writers, FakeWorker, MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import { editorLanguageServerProviders } from '../src/registry.js';
import type { EditorLanguageServerRuntimeOptions } from '../src/types.js';

const createProviderOptions = (): EditorLanguageServerRuntimeOptions => ({
	rootUrl: 'https://assets.example.com/wasm-idle',
	currentUrl: 'https://app.example.com/wasm-idle/',
	createWorker: () => new mockState.FakeWorker() as unknown as Worker,
	cpp: {
		baseUrl: 'https://assets.example.com/wasm-idle/clangd/',
		loader: async () => Uint8Array.of(0)
	},
	typescript: {
		libUrl: 'https://assets.example.com/wasm-idle/typescript-libs.json.gz'
	},
	javascript: {
		libUrl: 'https://assets.example.com/wasm-idle/typescript-libs.json.gz'
	}
});

describe('registered LSP provider lifecycle contract', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
		mockState.readers.splice(0, mockState.readers.length);
		mockState.writers.splice(0, mockState.writers.length);
	});

	it.each(editorLanguageServerProviders)(
		'$id initializes and disposes idempotently',
		async (provider) => {
			const handle = await provider.create(createProviderOptions());
			const worker = mockState.workers[0];

			expect(worker, provider.id).toBeDefined();
			expect(worker?.messages[0], provider.id).toMatchObject({ type: 'init' });
			expect(handle.transport.reader, provider.id).toBeDefined();
			expect(handle.transport.writer, provider.id).toBeDefined();

			handle.dispose();
			handle.dispose();

			expect(worker?.terminateCalls, provider.id).toBe(1);
			expect(mockState.readers[0]?.disposeCalls, provider.id).toBe(1);
			expect(mockState.writers[0]?.disposeCalls, provider.id).toBe(1);
		}
	);
});
