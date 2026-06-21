import { describe, expect, it, vi } from 'vitest';

import {
	createRubyWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

describe('createRubyWorkerService', () => {
	it('uses the Ruby syntax checker and exposes Ruby editor features', async () => {
		const loadChecker = vi.fn(async () => ({
			check: vi.fn(() => [
				{
					lineNumber: 2,
					columnNumber: 5,
					message: 'syntax error, unexpected end-of-input'
				}
			])
		}));
		const service = createRubyWorkerService(loadChecker);
		const document: LspDocument = {
			uri: 'file:///workspace/main.rb',
			languageId: 'ruby',
			version: 1,
			text: 'def main\nputs(\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.({ wasmUrl: '/ruby+stdlib.wasm' }, context);
		const diagnostics = await service.diagnostics?.(document, context);
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;
		const hover = await service.hover?.(document, { line: 0, character: 1 }, context);

		expect(loadChecker).toHaveBeenCalledWith({ wasmUrl: '/ruby+stdlib.wasm' });
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'ruby',
				message: 'syntax error, unexpected end-of-input',
				range: {
					start: { line: 1, character: 4 },
					end: { line: 1, character: 5 }
				}
			})
		]);
		expect(symbols).toEqual([expect.objectContaining({ name: 'main' })]);
		expect(hover?.contents.value).toContain('Defines a method');
		expect(context.reportProgress).toHaveBeenCalledWith('load-ruby-runtime');
	});
});
