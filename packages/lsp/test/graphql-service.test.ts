import { describe, expect, it, vi } from 'vitest';

import { createGraphqlWorkerService, type LspDocumentContext } from '../src/index.js';

describe('createGraphqlWorkerService', () => {
	it('selects only parsed declarations at their actual name positions', async () => {
		const text = [
			'"""',
			'type Example { x: Int }',
			'"""',
			'type Query { hello: String }',
			'',
			'',
			'type Book { title: String }'
		].join('\r\n');
		const document = { uri: 'file:///schema.graphql', version: 1, languageId: 'graphql', text };
		const service = createGraphqlWorkerService();
		const context = {
			documents: new Map(),
			reportProgress: vi.fn(),
			publishDiagnostics: vi.fn()
		};
		const symbols = await service.documentSymbols?.(document, context);
		expect(symbols).toEqual([
			expect.objectContaining({
				name: 'Query',
				selectionRange: {
					start: { line: 3, character: 5 },
					end: { line: 3, character: 10 }
				}
			}),
			expect.objectContaining({
				name: 'Book',
				range: { start: { line: 6, character: 0 }, end: { line: 6, character: 27 } },
				selectionRange: { start: { line: 6, character: 5 }, end: { line: 6, character: 9 } }
			})
		]);
		expect(await service.documentSymbols?.({ ...document, text: 'query {' }, context)).toEqual(
			[]
		);
	});

	it('validates workspace queries against inline, sibling or root schemas in that order', async () => {
		const service = createGraphqlWorkerService();
		const ctx: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		await service.initialize?.(
			{
				workspaceFiles: [
					{ path: 'schema.graphql', content: 'type Query { root: String }' },
					{ path: 'nested/schema.graphql', content: 'type Query { nested: String }' }
				]
			},
			ctx
		);
		const diagnose = (path: string, text: string) =>
			service.diagnostics?.(
				{
					uri: 'file:///workspace/' + path,
					languageId: 'graphql',
					version: 1,
					text
				},
				ctx
			);
		expect(await diagnose('nested/q.graphql', '{ nested }')).toEqual([]);
		expect(await diagnose('q.graphql', '{ root }')).toEqual([]);
		expect(await diagnose('nested/q.graphql', '{ root }')).toEqual([
			expect.objectContaining({
				message: expect.stringContaining('Cannot query field "root"')
			})
		]);
		expect(
			await diagnose('nested/q.graphql', 'type Query { own: String } query { own }')
		).toEqual([]);
		expect(await diagnose('schema.graphql', 'type Query { root: String }')).toEqual([]);
	});

	it('uses the GraphQL parser and schema validator for diagnostics', async () => {
		const service = createGraphqlWorkerService();
		const context: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		await service.initialize?.({ schema: 'type Query { hello: String }' }, context);

		const diagnostics = service.diagnostics?.(
			{
				uri: 'file:///workspace/main.graphql',
				languageId: 'graphql',
				version: 1,
				text: 'query Main { missing }'
			},
			context
		);
		const parseDiagnostics = service.diagnostics?.(
			{
				uri: 'file:///workspace/broken.graphql',
				languageId: 'graphql',
				version: 1,
				text: 'query {'
			},
			context
		);
		const completions = service.completion?.(
			{
				uri: 'file:///workspace/main.graphql',
				languageId: 'graphql',
				version: 1,
				text: ''
			},
			{ line: 0, character: 0 },
			context
		);

		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'graphql',
				message: expect.stringContaining('Cannot query field "missing"')
			})
		]);
		expect(parseDiagnostics).toEqual([
			expect.objectContaining({
				source: 'graphql',
				message: expect.stringContaining('Syntax Error')
			})
		]);
		expect(completions?.items.some((item) => item.label === 'query')).toBe(true);
		expect(context.reportProgress).toHaveBeenCalledWith('load-graphql-language-service');
	});
});
