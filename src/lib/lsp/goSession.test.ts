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

	const getGoLanguageServer = vi.fn(async (options: any) => {
		options.onStatus?.({ state: 'loading', stage: 'load-go-compiler' });
		options.onStatus?.({ state: 'ready' });
		return {
			transport: {
				reader: new MockReader('go'),
				writer: new MockWriter('go')
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
		getGoLanguageServer,
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
	getGoLanguageServer: mockState.getGoLanguageServer
}));

import { GoLspSession } from '$lib/lsp/goSession';

describe('GoLspSession', () => {
	beforeEach(() => {
		mockState.install.mockClear();
		mockState.start.mockClear();
		mockState.stop.mockClear();
		mockState.getGoLanguageServer.mockClear();
		mockState.serverDispose.mockClear();
	});

	it('creates a stable go model and starts the compiler-backed language client', async () => {
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

		const session = new GoLspSession(
			Monaco as any,
			'https://example.com/wasm-go/index.js?v=1',
			'wasip2/wasm',
			status
		);
		session.createModel('package main\nfunc main() {}');
		await session.start();

		expect(previousModel.dispose).toHaveBeenCalledTimes(1);
		expect(createModel).toHaveBeenCalledWith(
			'package main\nfunc main() {}',
			'go',
			expect.objectContaining({ value: 'file:///workspace/main.go' })
		);
		expect(mockState.install).toHaveBeenCalledTimes(1);
		expect(status).toHaveBeenCalledWith({ state: 'loading' });
		expect(status).toHaveBeenCalledWith({
			state: 'loading',
			stage: 'load-go-compiler'
		});
		expect(status).toHaveBeenCalledWith({ state: 'ready' });
		expect(mockState.start).toHaveBeenCalledTimes(1);
		expect(mockState.getGoLanguageServer).toHaveBeenCalledWith({
			currentUrl: 'http://localhost:3000/',
			go: {
				compilerUrl: 'https://example.com/wasm-go/index.js?v=1',
				target: 'wasip2/wasm'
			},
			onStatus: status
		});

		session.dispose();
		expect(mockState.stop).toHaveBeenCalledTimes(1);
		expect(mockState.serverDispose).toHaveBeenCalledTimes(1);
	});
});
