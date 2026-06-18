import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const mockState = vi.hoisted(() => {
	const install = vi.fn();
	const start = vi.fn();
	const stop = vi.fn();
	const serverDispose = vi.fn();

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

	const getGleamLanguageServer = vi.fn(async (options: any) => {
		options.onStatus?.({ state: 'loading', stage: 'load-gleam-compiler' });
		options.onStatus?.({ state: 'ready' });
		return {
			transport: {
				reader: new MockReader('gleam'),
				writer: new MockWriter('gleam')
			},
			dispose: serverDispose
		};
	});

	return {
		install,
		start,
		stop,
		MockLanguageClient,
		MockReader,
		MockWriter,
		getGleamLanguageServer,
		serverDispose
	};
});

vi.mock('@hancomac/monaco-languageclient', () => ({
	CloseAction: { DoNotRestart: 'DoNotRestart' },
	ErrorAction: { Continue: 'Continue' },
	MonacoLanguageClient: mockState.MockLanguageClient,
	MonacoServices: { install: mockState.install }
}));

vi.mock('@wasm-idle/lsp', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/lsp')>()),
	getGleamLanguageServer: mockState.getGleamLanguageServer
}));

import { GleamLspSession } from '$lib/lsp/gleamSession';

describe('GleamLspSession', () => {
	beforeEach(() => {
		mockState.install.mockClear();
		mockState.start.mockClear();
		mockState.stop.mockClear();
		mockState.getGleamLanguageServer.mockClear();
		mockState.serverDispose.mockClear();
	});

	it('creates a stable Gleam model and starts the compiler-backed language client', async () => {
		const previousModel = { dispose: vi.fn() };
		const createModel = vi.fn((value, language, uri) => ({
			value,
			language,
			uri,
			dispose: vi.fn()
		}));
		const parse = vi.fn((value: string) => ({ value }));
		const status = vi.fn();
		const Monaco = {
			Uri: { parse },
			editor: {
				getModel: vi.fn(() => previousModel),
				createModel
			}
		};

		const session = new GleamLspSession(
			Monaco as any,
			'https://example.com/wasm-gleam/',
			'https://example.com/wasm-gleam/source-manifest.v1.json?v=1',
			status
		);
		session.createModel('pub fn main() { Nil }');
		await session.start();

		expect(previousModel.dispose).toHaveBeenCalledTimes(1);
		expect(createModel).toHaveBeenCalledWith(
			'pub fn main() { Nil }',
			'gleam',
			expect.objectContaining({ value: 'file:///workspace/main.gleam' })
		);
		expect(mockState.install).toHaveBeenCalledTimes(1);
		expect(status).toHaveBeenCalledWith({ state: 'loading' });
		expect(status).toHaveBeenCalledWith({
			state: 'loading',
			stage: 'load-gleam-compiler'
		});
		expect(status).toHaveBeenCalledWith({ state: 'ready' });
		expect(mockState.start).toHaveBeenCalledTimes(1);
		expect(mockState.getGleamLanguageServer).toHaveBeenCalledWith({
			currentUrl: 'http://localhost:3000/',
			gleam: {
				baseUrl: 'https://example.com/wasm-gleam/',
				manifestUrl: 'https://example.com/wasm-gleam/source-manifest.v1.json?v=1'
			},
			onStatus: status
		});

		session.dispose();
		expect(mockState.stop).toHaveBeenCalledTimes(1);
		expect(mockState.serverDispose).toHaveBeenCalledTimes(1);
	});
});
