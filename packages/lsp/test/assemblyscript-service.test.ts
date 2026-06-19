import { describe, expect, it, vi } from 'vitest';

import {
	createAssemblyScriptWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

describe('createAssemblyScriptWorkerService', () => {
	it('invokes asc and maps AssemblyScript diagnostics to LSP ranges', async () => {
		const main = vi.fn(async (args, io) => {
			expect(args).toEqual(['assembly/index.ts', '--noEmit', '--runtime', 'stub']);
			expect(io.readFile?.('assembly/index.ts')).toContain('return missing');
			expect(io.readFile?.('/workspace/helper.ts')).toContain('export const helper');
			io.stderr?.write(
				"ERROR TS2304: Cannot find name 'missing'.\n" +
					'    return missing;\n' +
					'           ~~~~~~~\n' +
					' └─ in assembly/index.ts(2,12)\n'
			);
			return { error: new Error('compile failed') };
		});
		const service = createAssemblyScriptWorkerService(async () => ({ main }));
		const context: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const document: LspDocument = {
			uri: 'file:///workspace/assembly/index.ts',
			languageId: 'assemblyscript',
			version: 1,
			text: 'export function run(): i32 {\n  return missing;\n}\n'
		};

		await service.initialize?.(
			{
				extraFiles: {
					'/workspace/helper.ts': 'export const helper = 1;\n'
				}
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(document, { line: 0, character: 24 }, context);
		const hover = await service.hover?.(document, { line: 0, character: 23 }, context);

		expect(main).toHaveBeenCalledOnce();
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 11 },
					end: { line: 1, character: 12 }
				},
				severity: 1,
				code: 'TS2304',
				source: 'assemblyscript',
				message: "Cannot find name 'missing'."
			}
		]);
		expect(completions?.items.some((item) => item.label === 'i32')).toBe(true);
		expect(hover?.contents.value).toContain('Signed 32-bit integer');
		expect(context.reportProgress).toHaveBeenCalledWith('load-assemblyscript');
	});
});
