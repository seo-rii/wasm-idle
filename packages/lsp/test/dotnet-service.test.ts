import { describe, expect, it, vi } from 'vitest';

import { createDotnetWorkerService, type DotnetLanguage } from '../src/dotnet/service.js';

describe('createDotnetWorkerService', () => {
	it('continues the diagnostics queue after a compilation rejection', async () => {
		const compile = vi
			.fn()
			.mockRejectedValueOnce(new Error('compiler failed'))
			.mockResolvedValue({ success: true, diagnostics: [] });
		const service = createDotnetWorkerService('csharp', async () => ({
			createDotnetCompiler: () => ({ compile })
		}));
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		await service.initialize?.({ language: 'csharp', moduleUrl: '/dotnet.js' }, context);
		const document = {
			uri: 'file:///Program.cs',
			languageId: 'csharp',
			version: 1,
			text: 'first'
		};
		await expect(service.diagnostics!(document, context)).rejects.toThrow('compiler failed');
		await expect(
			service.diagnostics!({ ...document, version: 2, text: 'second' }, context)
		).resolves.toEqual([]);
		expect(compile).toHaveBeenCalledTimes(2);
	});

	it('serializes compilation, coalesces duplicate diagnostics, and skips superseded queued versions', async () => {
		let release!: (value: { success: boolean; diagnostics: [] }) => void;
		const compile = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = resolve;
					})
			)
			.mockResolvedValue({ success: true, diagnostics: [] });
		const service = createDotnetWorkerService('csharp', async () => ({
			createDotnetCompiler: () => ({ compile })
		}));
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		await service.initialize?.({ language: 'csharp', moduleUrl: '/dotnet.js' }, context);
		const doc = (version: number) => ({
			uri: 'file:///Program.cs',
			languageId: 'csharp',
			version,
			text: `version ${version}`
		});
		const first = service.diagnostics!(doc(1), context);
		const duplicate = service.diagnostics!(doc(1), context);
		await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
		const second = service.diagnostics!(doc(2), context);
		const third = service.diagnostics!(doc(3), context);
		expect(compile).toHaveBeenCalledOnce();
		release({ success: true, diagnostics: [] });
		await Promise.all([first, duplicate, second, third]);
		expect(compile.mock.calls.map(([request]) => request.code)).toEqual([
			'version 1',
			'version 3'
		]);
	});

	it.each([
		{
			language: 'csharp',
			uri: 'file:///workspace/Program.cs',
			code: 'public class Program { static void Main() { Missing(); } }\n',
			keyword: 'class',
			source: 'roslyn-csharp'
		},
		{
			language: 'vbnet',
			uri: 'file:///workspace/Program.vb',
			code: 'Module Program\nSub Main()\nMissing()\nEnd Sub\nEnd Module\n',
			keyword: 'Dim',
			source: 'roslyn-vb'
		}
	] satisfies Array<{
		language: DotnetLanguage;
		uri: string;
		code: string;
		keyword: string;
		source: string;
	}>)('uses the wasm-dotnet $language compiler path for diagnostics', async (case_) => {
		const compile = vi.fn(async () => ({
			success: false,
			diagnostics: [
				{
					lineNumber: 2,
					columnNumber: 3,
					endColumnNumber: 10,
					severity: 'error' as const,
					message: 'The name Missing does not exist in the current context'
				}
			]
		}));
		const service = createDotnetWorkerService(case_.language, async () => ({
			createDotnetCompiler: () => ({ compile })
		}));
		const context = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.(
			{
				language: case_.language,
				moduleUrl: 'https://static.example.com/wasm-dotnet/index.js'
			},
			context
		);
		const diagnostics = await service.diagnostics?.(
			{
				uri: case_.uri,
				languageId: case_.language,
				version: 1,
				text: case_.code
			},
			context
		);
		const completions = (await service.completion?.(
			{
				uri: case_.uri,
				languageId: case_.language,
				version: 1,
				text: ''
			},
			{ line: 0, character: 0 },
			context
		)) as { items: Array<{ label: string }> };

		expect(compile).toHaveBeenCalledWith(
			expect.objectContaining({
				code: case_.code,
				language: case_.language,
				target: 'browser-wasm',
				prepare: true
			})
		);
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 2 },
					end: { line: 1, character: 9 }
				},
				severity: 1,
				source: case_.source,
				message: 'The name Missing does not exist in the current context'
			}
		]);
		expect(completions.items.some((item) => item.label === case_.keyword)).toBe(true);
		expect(context.reportProgress).toHaveBeenCalledWith('load-dotnet-runtime');
	});

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
