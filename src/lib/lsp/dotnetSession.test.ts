import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const mockState = vi.hoisted(() => {
	const install = vi.fn();

	return {
		install
	};
});

vi.mock('@hancomac/monaco-languageclient', () => ({
	MonacoServices: { install: mockState.install }
}));

import { DotnetLspSession } from '$lib/lsp/dotnetSession';

describe('DotnetLspSession', () => {
	beforeEach(() => {
		mockState.install.mockClear();
		vi.useRealTimers();
	});

	it('creates a stable F# model and publishes wasm-dotnet compiler diagnostics', async () => {
		vi.useFakeTimers();
		const previousModel = { dispose: vi.fn() };
		const changeListener = vi.fn();
		const setModelMarkers = vi.fn();
		const createModel = vi.fn((value, language, uri) => ({
			value,
			language,
			uri,
			dispose: vi.fn(),
			getValue: vi.fn(() => 'printfn "ok"'),
			onDidChangeContent: vi.fn((listener) => {
				changeListener.mockImplementation(listener);
				return { dispose: vi.fn() };
			})
		}));
		const parse = vi.fn((value: string) => ({ value }));
		const status = vi.fn();
		const compile = vi.fn(async () => ({
			success: false,
			diagnostics: [
				{
					lineNumber: 2,
					columnNumber: 3,
					endColumnNumber: 7,
					severity: 'error' as const,
					message: 'FS0001: type mismatch'
				}
			]
		}));
		const loadModule = vi.fn(async () => ({
			createDotnetCompiler: vi.fn(() => ({ compile }))
		}));
		const Monaco = {
			MarkerSeverity: {
				Error: 8,
				Warning: 4,
				Info: 2
			},
			Uri: { parse },
			editor: {
				getModel: vi.fn(() => previousModel),
				createModel,
				setModelMarkers
			}
		};

		const session = new DotnetLspSession(
			Monaco as any,
			'https://example.com/wasm-dotnet/index.js?v=1',
			'fsharp',
			status,
			loadModule
		);
		session.createModel('printfn "ok"');
		await session.start();
		await vi.runOnlyPendingTimersAsync();

		expect(previousModel.dispose).toHaveBeenCalledTimes(1);
		expect(createModel).toHaveBeenCalledWith(
			'printfn "ok"',
			'fsharp',
			expect.objectContaining({ value: 'file:///workspace/Program.fs' })
		);
		expect(mockState.install).toHaveBeenCalledTimes(1);
		expect(status).toHaveBeenCalledWith({
			state: 'loading',
			stage: 'load-dotnet-runtime'
		});
		expect(status).toHaveBeenCalledWith({ state: 'ready' });
		expect(loadModule).toHaveBeenCalledWith('https://example.com/wasm-dotnet/index.js?v=1');
		expect(compile).toHaveBeenCalledWith({
			code: 'printfn "ok"',
			language: 'fsharp',
			target: 'browser-wasm',
			prepare: true,
			onProgress: expect.any(Function)
		});
		expect(setModelMarkers).toHaveBeenCalledWith(
			expect.any(Object),
			'fsharp',
			expect.arrayContaining([
				expect.objectContaining({
					startLineNumber: 2,
					startColumn: 3,
					endColumn: 7,
					severity: 8,
					source: 'fsharp',
					message: 'FS0001: type mismatch'
				})
			])
		);

		session.dispose();
		expect(setModelMarkers).toHaveBeenLastCalledWith(expect.any(Object), 'fsharp', []);
	});
});
