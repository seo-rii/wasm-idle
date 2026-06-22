import { describe, expect, it, vi } from 'vitest';

import { createDocumentWorkerService, type LspDocumentContext } from '../src/index.js';
import type { LspDocument } from '../src/lsp.js';

const context = (): LspDocumentContext => ({
	documents: new Map(),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

const document = (languageId: string, text: string): LspDocument => ({
	uri: `file:///workspace/main.${languageId === 'markdown' ? 'md' : languageId}`,
	languageId,
	version: 1,
	text
});

describe('document language worker service', () => {
	it('uses the VS Code JSON language service for diagnostics and completions', async () => {
		const service = createDocumentWorkerService();
		const testContext = context();
		await service.initialize?.({ language: 'json' }, testContext);
		const invalid = document('json', '{ "name": 1, }');
		const completions = (await service.completion?.(
			document('json', '{ "name": '),
			{ line: 0, character: 10 },
			testContext
		)) as { items: Array<{ label: string }> };

		const diagnostics = await service.diagnostics?.(invalid, testContext);

		expect(diagnostics?.some((diagnostic) => diagnostic.source === 'json')).toBe(true);
		expect(Array.isArray(completions.items)).toBe(true);
		expect(testContext.reportProgress).toHaveBeenCalledWith('load-json-language-service');
	});

	it('reports YAML parser diagnostics', async () => {
		const service = createDocumentWorkerService();
		const testContext = context();
		await service.initialize?.({ language: 'yaml' }, testContext);

		const diagnostics = await service.diagnostics?.(document('yaml', 'items: [1\n'), testContext);

		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'yaml',
				message: expect.stringContaining('Flow sequence')
			})
		]);
	});

	it('reports TOML parser diagnostics', async () => {
		const service = createDocumentWorkerService();
		const testContext = context();
		await service.initialize?.({ language: 'toml' }, testContext);

		const diagnostics = await service.diagnostics?.(document('toml', 'items = [1\n'), testContext);

		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'toml',
				message: expect.stringContaining('Invalid TOML')
			})
		]);
	});

	it('uses the VS Code CSS language service for diagnostics and hover', async () => {
		const service = createDocumentWorkerService();
		const testContext = context();
		await service.initialize?.({ language: 'css' }, testContext);
		const cssDocument = document('css', '.main {\n  color: ;\n}\n');

		const diagnostics = await service.diagnostics?.(cssDocument, testContext);
		const hover = await service.hover?.(cssDocument, { line: 1, character: 3 }, testContext);

		expect(diagnostics?.some((diagnostic) => diagnostic.source === 'css')).toBe(true);
		expect(hover).toBeTruthy();
	});

	it('uses the VS Code HTML language service and reports unbalanced tags', async () => {
		const service = createDocumentWorkerService();
		const testContext = context();
		await service.initialize?.({ language: 'html' }, testContext);
		const htmlDocument = document('html', '<main><h1>Hello</main>');

		const diagnostics = await service.diagnostics?.(htmlDocument, testContext);
		const balancedDiagnostics = await service.diagnostics?.(
			document('html', '<main><br/></main>'),
			testContext
		);
		const completions = (await service.completion?.(
			document('html', '<'),
			{ line: 0, character: 1 },
			testContext
		)) as { items: Array<{ label: string }> };

		expect(diagnostics?.some((diagnostic) => diagnostic.source === 'html')).toBe(true);
		expect(balancedDiagnostics).toEqual([]);
		expect(completions.items.some((item) => item.label === 'html')).toBe(true);
	});

	it('reports Markdown reference diagnostics and heading symbols', async () => {
		const service = createDocumentWorkerService();
		const testContext = context();
		await service.initialize?.({ language: 'markdown' }, testContext);
		const markdownDocument = document(
			'markdown',
			'# Intro\n\n[link](#nope)\n\n[ref]: /one\n[ref]: /two\n'
		);

		const diagnostics = await service.diagnostics?.(markdownDocument, testContext);
		const symbols = (await service.documentSymbols?.(markdownDocument, testContext)) as Array<{
			name: string;
		}>;
		const hover = await service.hover?.(markdownDocument, { line: 0, character: 2 }, testContext);

		expect(diagnostics?.map((diagnostic) => diagnostic.source)).toEqual(['markdown']);
		expect(diagnostics?.[0]?.message).toContain('No heading matches #nope');
		expect(symbols[0]?.name).toBe('Intro');
		expect(hover?.contents.value).toContain('Heading level 1');
	});
});
