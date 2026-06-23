import { describe, expect, it, vi } from 'vitest';

import {
	createFortranWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

describe('createFortranWorkerService', () => {
	it('uses the configured analyzer and exposes symbols', async () => {
		const loadAnalyzer = vi.fn(async () => ({
			analyze: vi.fn(() => [
				{
					lineNumber: 2,
					columnNumber: 7,
					message: 'Expected expression'
				}
			])
		}));
		const service = createFortranWorkerService(loadAnalyzer);
		const document: LspDocument = {
			uri: 'file:///workspace/main.f90',
			languageId: 'fortran',
			version: 1,
			text: 'program main\nprint *,\nend program main\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.({ analyzerUrl: '/wasm-fortran/analyzer.js' }, context);
		const diagnostics = await service.diagnostics?.(document, context);
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);

		expect(loadAnalyzer).toHaveBeenCalledWith({ analyzerUrl: '/wasm-fortran/analyzer.js' });
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'fortran',
				message: 'Expected expression',
				range: {
					start: { line: 1, character: 6 },
					end: { line: 1, character: 7 }
				}
			})
		]);
		expect(symbols).toEqual([expect.objectContaining({ name: 'main' })]);
		expect(completions?.items.some((item) => item.label === 'program')).toBe(true);
		expect(context.reportProgress).toHaveBeenCalledWith('load-fortran-analyzer');
	});

	it('requires an external analyzer instead of falling back to a bundled parser', async () => {
		const service = createFortranWorkerService();
		const context: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await expect(service.initialize?.({}, context)).rejects.toThrow(
			'Fortran language server requires analyzerUrl'
		);

		expect(context.reportProgress).toHaveBeenCalledWith('load-fortran-analyzer');
	});
});
