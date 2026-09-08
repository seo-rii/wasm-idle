import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
	class MockReader {
		onError = undefined;
		onClose = undefined;
		onPartialMessage = undefined;

		listen() {
			return { dispose() {} };
		}

		dispose() {}
	}

	class MockWriter {
		dispose() {}
	}

	return { MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import {
	getCSharpLanguageServer,
	resolveDotnetLanguageServerModuleUrl
} from '../src/dotnet/server.js';
import { LanguageServerAssetConfigurationError } from '../src/runtime.js';

describe('dotnet language server', () => {
	it('requires an explicit module URL or deployment root', () => {
		expect(() =>
			resolveDotnetLanguageServerModuleUrl(undefined, 'https://app.example.com/editor')
		).toThrow(LanguageServerAssetConfigurationError);
		expect(
			resolveDotnetLanguageServerModuleUrl(
				{ rootUrl: '/wasm-idle' },
				'https://app.example.com/editor'
			)
		).toBe('https://app.example.com/wasm-idle/wasm-dotnet/index.js');
	});

	afterEach(() => vi.unstubAllGlobals());

	it('runs diagnostics in a dedicated module Worker that is terminated on disposal', async () => {
		const workers: MockWorker[] = [];
		class MockWorker extends EventTarget {
			terminate = vi.fn();
			postMessage = vi.fn(() =>
				queueMicrotask(() =>
					this.dispatchEvent(new MessageEvent('message', { data: { type: 'ready' } }))
				)
			);
			constructor(
				readonly url: URL,
				readonly options: WorkerOptions
			) {
				super();
				workers.push(this);
			}
		}
		vi.stubGlobal('Worker', MockWorker);
		const statuses: string[] = [];
		const handle = await getCSharpLanguageServer({
			currentUrl: 'https://app.example.com/editor',
			dotnet: { moduleUrl: 'https://static.example.com/wasm-dotnet/index.js' },
			onStatus: (status) => statuses.push(status.state)
		});
		expect(workers).toHaveLength(1);
		expect(workers[0].url.pathname).toMatch(/dotnet\/worker\.js$/);
		expect(workers[0].options).toEqual({ type: 'module' });
		expect(workers[0].postMessage).toHaveBeenCalledWith({
			type: 'init',
			options: {
				language: 'csharp',
				moduleUrl: 'https://static.example.com/wasm-dotnet/index.js',
				debug: false
			}
		});
		expect(statuses).toContain('ready');
		handle.dispose();
		expect(workers[0].terminate).toHaveBeenCalledOnce();
		expect(statuses.at(-1)).toBe('disabled');
	});
});
