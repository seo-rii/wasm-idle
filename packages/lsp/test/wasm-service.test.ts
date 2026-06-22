import { describe, expect, it, vi } from 'vitest';

import {
	createWasmWorkerService,
	decodeWasmSource,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

const wasmAnswerBase64 = 'AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoGAQQAQSoL';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createWasmWorkerService', () => {
	it('validates WebAssembly binaries through the browser WebAssembly runtime', async () => {
		const service = createWasmWorkerService();
		const document: LspDocument = {
			uri: 'file:///workspace/main.wasm',
			languageId: 'wasm',
			version: 1,
			text: `base64:${wasmAnswerBase64}`
		};
		const context = contextFor(document);

		await service.initialize?.({}, context);
		const diagnostics = await service.diagnostics?.(document, context);
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;
		const completions = (await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		)) as { items: Array<{ label: string }> };
		const hover = await service.hover?.(document, { line: 0, character: 3 }, context);

		expect(diagnostics).toEqual([]);
		expect(symbols).toEqual([expect.objectContaining({ name: 'export answer' })]);
		expect(
			completions.items.some((item) => item.label === 'data:application/wasm;base64,')
		).toBe(true);
		expect(hover?.contents.value).toContain('base64 WebAssembly binary');
		expect(context.reportProgress).toHaveBeenCalledWith('load-webassembly-runtime');
	});

	it('reports invalid binary input and accepts hex input matching the runtime decoder', async () => {
		const service = createWasmWorkerService();
		const invalidDocument: LspDocument = {
			uri: 'file:///workspace/main.wasm',
			languageId: 'wasm',
			version: 1,
			text: 'base64:not-wasm'
		};
		const validBytes = decodeWasmSource(`wasm:${wasmAnswerBase64}`);
		const validHex = `0x${Array.from(validBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
		const validDocument: LspDocument = {
			uri: 'file:///workspace/main.wasm',
			languageId: 'wasm',
			version: 2,
			text: validHex
		};
		const context = contextFor(invalidDocument);

		const diagnostics = await service.diagnostics?.(invalidDocument, context);
		const validDiagnostics = await service.diagnostics?.(validDocument, context);

		expect(diagnostics).toEqual([
			expect.objectContaining({
				severity: 1,
				source: 'webassembly'
			})
		]);
		expect(validDiagnostics).toEqual([]);
	});
});
