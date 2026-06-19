import { describe, expect, it, vi } from 'vitest';

import { createPhpWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';

describe('createPhpWorkerService', () => {
	it('provides lightweight PHP diagnostics, completion, hover, and document symbols', async () => {
		const service = createPhpWorkerService();
		const document: LspDocument = {
			uri: 'file:///workspace/main.php',
			languageId: 'php',
			version: 1,
			text: '<?php\nfunction greet($name) {\n    echo strlen($name);\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.({ version: '8.4' }, context);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 2, character: 8 },
			context
		);
		const hover = await service.hover?.(document, { line: 2, character: 12 }, context);
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
			kind: number;
		}>;

		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 22 },
					end: { line: 1, character: 23 }
				},
				severity: 1,
				source: 'php',
				message: "Unclosed '{', expected '}'"
			}
		]);
		expect(completions?.items.some((item) => item.label === 'strlen')).toBe(true);
		expect(hover?.contents.value).toContain('Returns the length of a string');
		expect(symbols).toEqual([expect.objectContaining({ name: 'greet', kind: 12 })]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-php-language-service');
	});
});
