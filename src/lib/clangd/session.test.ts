import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const mockState = vi.hoisted(() => {
	const install = vi.fn();
	const start = vi.fn();
	const stop = vi.fn();
	const serverDispose = vi.fn();
	const serverSyncFile = vi.fn();

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

	const getCppLanguageServer = vi.fn(async (options: any) => {
		options.onStatus?.({ state: 'loading', loaded: 32, total: 64 });
		options.onStatus?.({ state: 'ready' });
		return {
			transport: {
				reader: new MockReader('clangd'),
				writer: new MockWriter('clangd')
			},
			syncFile: serverSyncFile,
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
		getCppLanguageServer,
		serverDispose,
		serverSyncFile
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
	getCppLanguageServer: mockState.getCppLanguageServer
}));

import { ClangdSession } from '$lib/clangd/session';

describe('ClangdSession', () => {
	beforeEach(() => {
		mockState.install.mockClear();
		mockState.start.mockClear();
		mockState.stop.mockClear();
		mockState.getCppLanguageServer.mockClear();
		mockState.serverDispose.mockClear();
		mockState.serverSyncFile.mockClear();
	});

	it('creates a stable cpp model and starts the worker-backed language client', async () => {
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

		const session = new ClangdSession(Monaco as any, 'https://example.com/wasm/', status);
		session.createModel('int main() {}');
		await session.start();

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
		expect(mockState.getCppLanguageServer).toHaveBeenCalledWith({
			cpp: { baseUrl: 'https://example.com/wasm/' },
			currentUrl: 'http://localhost:3000/',
			onStatus: status
		});

		session.dispose();
		expect(mockState.stop).toHaveBeenCalledTimes(1);
		expect(mockState.serverDispose).toHaveBeenCalledTimes(1);
	});
});
