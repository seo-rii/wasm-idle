import { describe, expect, it, vi } from 'vitest';
import MarkdownIt from 'markdown-it';
import { TextDocument } from 'vscode-languageserver-textdocument';

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

		const diagnostics = await service.diagnostics?.(
			document('yaml', 'items: [1\n'),
			testContext
		);

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

		const diagnostics = await service.diagnostics?.(
			document('toml', 'items = [1\n'),
			testContext
		);

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

	it('uses the VS Code HTML language service without custom diagnostics', async () => {
		const service = createDocumentWorkerService();
		const testContext = context();
		await service.initialize?.({ language: 'html' }, testContext);
		const htmlDocument = document('html', '<main><h1>Hello</main>');

		const diagnostics = await service.diagnostics?.(htmlDocument, testContext);
		const completions = (await service.completion?.(
			document('html', '<'),
			{ line: 0, character: 1 },
			testContext
		)) as { items: Array<{ label: string }> };

		expect(diagnostics).toEqual([]);
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
		const hover = await service.hover?.(
			markdownDocument,
			{ line: 0, character: 2 },
			testContext
		);

		expect(diagnostics?.map((diagnostic) => diagnostic.source)).toEqual(['markdown']);
		expect(diagnostics?.[0]?.message).toContain('No heading matches #nope');
		expect(symbols[0]?.name).toBe('Intro');
		expect(hover?.contents.value).toContain('Heading level 1');
	});

	it('formats prose without changing rendered hard breaks or literal code', async () => {
		const service = createDocumentWorkerService(),
			ctx = context();
		await service.initialize?.({ language: 'markdown' }, ctx);
		const text = [
			'first  ',
			'second ',
			'',
			'~~~',
			'  literal  ',
			'~~~',
			'',
			'    indented  ',
			''
		].join('\r\n');
		const source = document('markdown', text);
		const edits = (await service.formatting?.(source, {}, ctx)) ?? [];
		const after = TextDocument.applyEdits(
			TextDocument.create(source.uri, 'markdown', 1, text),
			edits
		);
		expect(after).toBe(text.replace('second ', 'second'));
		const md = new MarkdownIt();
		expect(md.render(after)).toBe(md.render(text));
	});

	it('selects each broken destination in its own source line', async () => {
		const service = createDocumentWorkerService(),
			ctx = context();
		await service.initialize?.({ language: 'markdown' }, ctx);
		const source = document(
			'markdown',
			'Mention #lost\r\nsee [one](#lost) and [two](<#lost>)\r\nlast line'
		);
		const diagnostics = await service.diagnostics?.(source, ctx);
		expect(diagnostics?.map((d) => d.range)).toEqual([
			{ start: { line: 1, character: 10 }, end: { line: 1, character: 15 } },
			{ start: { line: 1, character: 28 }, end: { line: 1, character: 33 } }
		]);
	});

	it('resolves heading anchors from inline text and disambiguates repeated slugs', async () => {
		const service = createDocumentWorkerService(),
			ctx = context();
		await service.initialize?.({ language: 'markdown' }, ctx);
		const source = document(
			'markdown',
			'# [Project](https://example.org)\n# Intro\n# Intro-1\n# *Intro*\n\n[link](#project) [link](#intro-2) [missing](#intro-3)'
		);
		expect((await service.diagnostics?.(source, ctx))?.map((d) => d.message)).toEqual([
			'No heading matches #intro-3.'
		]);
	});

	it('reports the source spelling of Unicode anchors and reference destinations', async () => {
		const service = createDocumentWorkerService(),
			ctx = context();
		await service.initialize?.({ language: 'markdown' }, ctx);
		const source = document(
			'markdown',
			'[lost](#한글) and [ref][elsewhere]\n\n[elsewhere]: #absent'
		);
		const doc = TextDocument.create(source.uri, 'markdown', 1, source.text);
		expect(
			(await service.diagnostics?.(source, ctx))?.map(({ range }) => doc.getText(range))
		).toEqual(['#한글', '#absent']);
	});
});
