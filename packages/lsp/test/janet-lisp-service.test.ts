import { describe, expect, it, vi } from 'vitest';

import {
	createJanetWorkerService,
	createLispWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createJanetWorkerService', () => {
	it('uses the Janet worker for diagnostics, completion, hover, and symbols', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'main.janet:2:8: parse error: unexpected )'
		}));
		const service = createJanetWorkerService(runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.janet',
			languageId: 'janet',
			version: 1,
			text: '(defn main []\n  (print ))\n'
		};
		const context = contextFor(document);

		await service.initialize?.(
			{
				baseUrl: 'https://static.example.com/wasm-janet/',
				workerUrl: 'https://static.example.com/wasm-janet/runner-worker.js'
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 0, character: 2 }, context);
		const symbols = await service.documentSymbols?.(document, context);

		expect(runDiagnostics).toHaveBeenCalledWith({
			baseUrl: 'https://static.example.com/wasm-janet/',
			workerUrl: 'https://static.example.com/wasm-janet/runner-worker.js',
			code: document.text,
			activePath: 'main.janet'
		});
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 7 },
					end: { line: 1, character: 8 }
				},
				severity: 1,
				source: 'janet',
				message: 'main.janet:2:8: parse error: unexpected )'
			}
		]);
		expect(completions?.items.some((item) => item.label === 'defn')).toBe(true);
		expect(hover?.contents.value).toContain('Defines a named Janet function');
		expect(symbols).toEqual([
			expect.objectContaining({
				name: 'main',
				kind: 12
			})
		]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-janet-runtime');
		expect(context.reportProgress).toHaveBeenCalledWith('janet-diagnostics');
	});
});

describe('createLispWorkerService', () => {
	it('uses the wasm-lisp compiler for diagnostics, completion, hover, and symbols', async () => {
		const compile = vi.fn(async () => ({
			success: false,
			diagnostics: [
				{
					lineNumber: 2,
					columnNumber: 4,
					endColumnNumber: 9,
					severity: 'error' as const,
					message: 'unexpected right paren'
				}
			]
		}));
		const service = createLispWorkerService(async () => ({ compile }));
		const document: LspDocument = {
			uri: 'file:///workspace/main.scm',
			languageId: 'lisp',
			version: 1,
			text: '(define (main)\n  (display ))\n'
		};
		const context = contextFor(document);

		await service.initialize?.(
			{
				moduleUrl: 'https://static.example.com/wasm-lisp/index.js'
			},
			context
		);

		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);
		const hover = await service.hover?.(document, { line: 1, character: 5 }, context);
		const symbols = await service.documentSymbols?.(document, context);

		expect(compile).toHaveBeenCalledWith({
			code: document.text,
			fileName: 'main.scm',
			files: [],
			log: false
		});
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 3 },
					end: { line: 1, character: 8 }
				},
				severity: 1,
				source: 'lisp',
				message: 'unexpected right paren'
			}
		]);
		expect(completions?.items.some((item) => item.label === 'define')).toBe(true);
		expect(hover?.contents.value).toContain('Writes a value to the current output port');
		expect(symbols).toEqual([
			expect.objectContaining({
				name: 'main',
				kind: 12
			})
		]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-lisp-compiler');
		expect(context.reportProgress).toHaveBeenCalledWith('lisp-diagnostics');
	});
});
