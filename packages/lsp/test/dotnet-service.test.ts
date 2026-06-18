import { describe, expect, it, vi } from 'vitest';

import { createDotnetWorkerService } from '../src/index.js';

describe('createDotnetWorkerService', () => {
	it('uses the wasm-dotnet F# compiler path for diagnostics', async () => {
		const compile = vi.fn(async (request) => {
			request.onProgress?.({ stage: 'fsharp-compile', completed: 1, total: 3 });
			return {
				success: false,
				diagnostics: [
					{
						lineNumber: 2,
						columnNumber: 5,
						endColumnNumber: 10,
						severity: 'error',
						message: 'The value or constructor is not defined'
					}
				]
			};
		});
		const service = createDotnetWorkerService('fsharp', async () => ({
			createDotnetCompiler: () => ({ compile })
		}));
		const reportProgress = vi.fn();
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress
		};

		await service.initialize?.(
			{
				language: 'fsharp',
				moduleUrl: 'https://static.example.com/wasm-dotnet/index.js'
			},
			context
		);
		const diagnostics = await service.diagnostics?.(
			{
				uri: 'file:///workspace/Program.fs',
				languageId: 'fsharp',
				version: 1,
				text: 'printfn "%d" missing\n'
			},
			context
		);
		const completions = (await service.completion?.(
			{
				uri: 'file:///workspace/Program.fs',
				languageId: 'fsharp',
				version: 1,
				text: ''
			},
			{ line: 0, character: 0 },
			context
		)) as { items: Array<{ label: string }> };

		expect(compile).toHaveBeenCalledWith(
			expect.objectContaining({
				code: 'printfn "%d" missing\n',
				language: 'fsharp',
				target: 'browser-wasm',
				prepare: true
			})
		);
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 4 },
					end: { line: 1, character: 9 }
				},
				severity: 1,
				source: 'fsharp',
				message: 'The value or constructor is not defined'
			}
		]);
		expect(completions.items.some((item) => item.label === 'let')).toBe(true);
		expect(reportProgress).toHaveBeenCalledWith('load-dotnet-runtime');
		expect(reportProgress).toHaveBeenCalledWith('fsharp-compile', 1, 3);
	});
});
