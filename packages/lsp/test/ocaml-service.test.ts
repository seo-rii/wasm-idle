import { describe, expect, it, vi } from 'vitest';

import {
	createOcamlWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

describe('createOcamlWorkerService', () => {
	it('uses wasm-of-js-of-ocaml for diagnostics, completion, and hover', async () => {
		const compile = vi.fn(async () => ({
			success: false,
			diagnostics: [
				{
					file: 'src/main.ml',
					line: 2,
					column: 5,
					severity: 'error' as const,
					message:
						'This expression has type string but an expression was expected of type int'
				}
			],
			stderr: 'File "src/main.ml", line 2, characters 4-5:'
		}));
		const service = createOcamlWorkerService(async () => ({ compile }));
		const document: LspDocument = {
			uri: 'file:///workspace/src/main.ml',
			languageId: 'ocaml',
			version: 1,
			text: 'let value : int =\n    "hello"\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([
				[document.uri, document],
				[
					'file:///workspace/src/helper.ml',
					{
						uri: 'file:///workspace/src/helper.ml',
						languageId: 'ocaml',
						version: 1,
						text: 'let helper = 1\n'
					}
				]
			]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.(
			{
				moduleUrl:
					'https://static.example.com/wasm-of-js-of-ocaml/browser-native/src/index.js',
				manifestUrl:
					'https://static.example.com/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 0, character: 2 }, context);

		expect(compile).toHaveBeenCalledWith({
			activePath: 'src/main.ml',
			workspaceFiles: [
				{ path: 'src/helper.ml', content: 'let helper = 1\n' },
				{ path: 'src/main.ml', content: document.text }
			],
			target: 'js',
			effectsMode: 'cps',
			wasmBinaryenMode: 'fast',
			packages: []
		});
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 4 },
					end: { line: 1, character: 5 }
				},
				severity: 1,
				source: 'ocaml',
				message:
					'This expression has type string but an expression was expected of type int'
			}
		]);
		expect(completions?.items.some((item) => item.label === 'let')).toBe(true);
		expect(hover?.contents.value).toContain('Binds a value or function');
		expect(context.reportProgress).toHaveBeenCalledWith('ocaml-diagnostics');
	});
});
