import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
	const workers: FakeWorker[] = [];

	class FakeWorker {
		listeners = {
			message: new Set<(event: MessageEvent<unknown>) => void>(),
			error: new Set<(event: ErrorEvent) => void>()
		};
		messages: unknown[] = [];
		terminated = false;

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
			this.terminated = true;
		}
	}

	class MockReader {
		constructor(public worker: unknown) {}
		dispose = vi.fn();
	}

	class MockWriter {
		constructor(public worker: unknown) {}
		dispose = vi.fn();
	}

	return { workers, FakeWorker, MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import { LanguageServerAssetConfigurationError } from '../src/runtime.js';
import {
	getJavaScriptLanguageServer,
	getTypeScriptLanguageServer
} from '../src/typescript/server.js';

describe('TypeScript language server host assets', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
	});

	it.each([
		['typescript', getTypeScriptLanguageServer],
		['javascript', getJavaScriptLanguageServer]
	] as const)(
		'rejects missing %s standard-library assets before creating a worker',
		async (_, load) => {
			await expect(
				load({ createWorker: () => new mockState.FakeWorker() as unknown as Worker })
			).rejects.toBeInstanceOf(LanguageServerAssetConfigurationError);
			expect(mockState.workers).toHaveLength(0);
		}
	);

	it('resolves an explicitly configured library URL before worker initialization', async () => {
		const handle = await getTypeScriptLanguageServer({
			currentUrl: 'https://app.example.com/editor/',
			typescript: { libUrl: '../assets/typescript-libs.json.gz' },
			createWorker: () => new mockState.FakeWorker() as unknown as Worker
		});

		expect(mockState.workers[0]?.messages[0]).toEqual({
			type: 'init',
			options: {
				language: 'typescript',
				compilerOptions: undefined,
				extraLibs: undefined,
				libUrl: 'https://app.example.com/assets/typescript-libs.json.gz'
			}
		});

		handle.dispose();
		expect(mockState.workers[0]?.terminated).toBe(true);
	});
});
