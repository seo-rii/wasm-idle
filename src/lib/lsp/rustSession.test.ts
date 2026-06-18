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

	const getRustLanguageServer = vi.fn(async (options: any) => {
		options.onStatus?.({ state: 'loading', stage: 'load-rust-compiler' });
		options.onStatus?.({ state: 'ready' });
		return {
			transport: {
				reader: new MockReader('rust'),
				writer: new MockWriter('rust')
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
		getRustLanguageServer,
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
	getRustLanguageServer: mockState.getRustLanguageServer
}));

import { RustLspSession } from '$lib/lsp/rustSession';

describe('RustLspSession', () => {
	beforeEach(() => {
		mockState.install.mockClear();
		mockState.start.mockClear();
		mockState.stop.mockClear();
		mockState.getRustLanguageServer.mockClear();
		mockState.serverDispose.mockClear();
	});

	it('creates a stable rust model and starts the compiler-backed language client', async () => {
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

		const session = new RustLspSession(
			Monaco as any,
			'https://example.com/wasm-rust/index.js?v=1',
			'wasm32-wasip2',
			status
		);
		session.createModel('fn main() {}');
		await session.start();

		expect(previousModel.dispose).toHaveBeenCalledTimes(1);
		expect(createModel).toHaveBeenCalledWith(
			'fn main() {}',
			'rust',
			expect.objectContaining({ value: 'file:///workspace/main.rs' })
		);
		expect(mockState.install).toHaveBeenCalledTimes(1);
		expect(status).toHaveBeenCalledWith({ state: 'loading' });
		expect(status).toHaveBeenCalledWith({
			state: 'loading',
			stage: 'load-rust-compiler'
		});
		expect(status).toHaveBeenCalledWith({ state: 'ready' });
		expect(mockState.start).toHaveBeenCalledTimes(1);
		expect(mockState.getRustLanguageServer).toHaveBeenCalledWith({
			currentUrl: 'http://localhost:3000/',
			rust: {
				compilerUrl: 'https://example.com/wasm-rust/index.js?v=1',
				targetTriple: 'wasm32-wasip2'
			},
			onStatus: status
		});

		session.dispose();
		expect(mockState.stop).toHaveBeenCalledTimes(1);
		expect(mockState.serverDispose).toHaveBeenCalledTimes(1);
	});
});
