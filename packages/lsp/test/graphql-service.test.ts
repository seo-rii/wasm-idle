import { describe, expect, it, vi } from 'vitest';

import { createGraphqlWorkerService, type LspDocumentContext } from '../src/index.js';

describe('createGraphqlWorkerService', () => {
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
