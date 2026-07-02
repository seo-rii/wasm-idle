import { describe, expect, it, vi } from 'vitest';

import { createWatWorkerService, type LspDocument, type LspDocumentContext } from '../src/index.js';

describe('createWatWorkerService', () => {
	it('uses wabt for diagnostics, formatting, completion, and hover', async () => {
		const context: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const service = createWatWorkerService();

		await service.initialize?.({ features: { mutable_globals: true } }, context);

		const invalidDocument: LspDocument = {
			uri: 'file:///workspace/main.wat',
			languageId: 'wat',
			version: 1,
			text: '(module (func (result i32) i32.add))'
		};
		const diagnostics = await service.diagnostics?.(invalidDocument, context);

		expect(diagnostics?.[0]).toMatchObject({
			severity: 1,
			source: 'wabt'
		});
		expect(Number.isFinite(diagnostics?.[0]?.range.start.line)).toBe(true);
		expect(Number.isFinite(diagnostics?.[0]?.range.start.character)).toBe(true);

		const document: LspDocument = {
			uri: 'file:///workspace/main.wat',
			languageId: 'wat',
			version: 2,
			text: '(module (func (export "answer") (result i32) (i32.const 42)))'
		};
		const formatting = await service.formatting?.(
			document,
			{ tabSize: 2, insertSpaces: true },
			context
		);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 1 },
			context
		);
		const hover = await service.hover?.(document, { line: 0, character: 3 }, context);

		expect(formatting?.[0]?.newText).toContain('i32.const 42');
		expect(completions?.items.some((item) => item.label === 'local.get')).toBe(true);
		expect(hover?.contents.value).toContain('Defines a WebAssembly module');
		expect(context.reportProgress).toHaveBeenCalledWith('load-wabt');
	});
});
