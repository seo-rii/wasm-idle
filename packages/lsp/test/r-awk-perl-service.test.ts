import { describe, expect, it, vi } from 'vitest';

import {
	createAwkWorkerService,
	createPerlWorkerService,
	createRWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createRWorkerService', () => {
	it('uses WebR-backed parser hooks and exposes R editor features', async () => {
		const parser = {
			parse: vi.fn(async () => [
				{
					lineNumber: 2,
					columnNumber: 4,
					message: '<text>:2:4: unexpected end of input'
				}
			]),
			dispose: vi.fn()
		};
		const loadParser = vi.fn(async () => parser);
		const service = createRWorkerService(loadParser);
		const document: LspDocument = {
			uri: 'file:///workspace/main.R',
			languageId: 'r',
			version: 1,
			text: 'main <- function() {\n  print(\n'
		};
		const context = contextFor(document);

		await service.initialize?.({ baseUrl: '/webr/0.6.0/' }, context);
		const diagnostics = await service.diagnostics?.(document, context);
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;
		const hover = await service.hover?.(document, { line: 0, character: 9 }, context);
		await service.dispose?.();

		expect(loadParser).toHaveBeenCalledWith({ baseUrl: '/webr/0.6.0/' });
		expect(parser.parse).toHaveBeenCalledWith(document.text);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'r',
				message: '<text>:2:4: unexpected end of input',
				range: {
					start: { line: 1, character: 3 },
					end: { line: 1, character: 4 }
				}
			})
		]);
		expect(symbols).toEqual([expect.objectContaining({ name: 'main' })]);
		expect(hover?.contents.value).toContain('Defines an R function');
		expect(parser.dispose).toHaveBeenCalled();
		expect(context.reportProgress).toHaveBeenCalledWith('load-r-runtime');
	});
});

describe('createAwkWorkerService', () => {
	it('checks syntax through the configured GoAWK worker and exposes AWK symbols', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'parse error at 2:5: unexpected newline'
		}));
		const service = createAwkWorkerService(runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.awk',
			languageId: 'awk',
			version: 1,
			text: 'function total(x) {\n  print(\n}\n'
		};
		const context = contextFor(document);

		await service.initialize?.(
			{ baseUrl: '/wasm-awk/', workerUrl: '/wasm-awk/runner-worker.js' },
			context
		);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = (await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		)) as { items: Array<{ label: string }> };
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;

		expect(runDiagnostics).toHaveBeenCalledWith({
			baseUrl: '/wasm-awk/',
			workerUrl: '/wasm-awk/runner-worker.js',
			code: document.text,
			activePath: 'main.awk'
		});
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'awk',
				message: 'parse error at 2:5: unexpected newline',
				range: {
					start: { line: 1, character: 4 },
					end: { line: 1, character: 5 }
				}
			})
		]);
		expect(completions.items.some((item) => item.label === 'BEGIN')).toBe(true);
		expect(symbols).toEqual([expect.objectContaining({ name: 'total' })]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-awk-runtime');
	});
});

describe('createPerlWorkerService', () => {
	it('checks syntax through the configured WebPerl worker and exposes Perl symbols', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'Perl exited with status 255.',
			output: 'syntax error at main.pl line 2, near "print("\\n'
		}));
		const service = createPerlWorkerService(runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.pl',
			languageId: 'perl',
			version: 1,
			text: 'sub main {\n  print(\n}\n'
		};
		const context = contextFor(document);

		await service.initialize?.(
			{ baseUrl: '/wasm-perl/', workerUrl: '/wasm-perl/runner-worker.js' },
			context
		);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = (await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		)) as { items: Array<{ label: string }> };
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;

		expect(runDiagnostics).toHaveBeenCalledWith({
			baseUrl: '/wasm-perl/',
			workerUrl: '/wasm-perl/runner-worker.js',
			code: document.text,
			activePath: 'main.pl'
		});
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'perl',
				message: 'syntax error at main.pl line 2, near "print("\\n',
				range: {
					start: { line: 1, character: 0 },
					end: { line: 1, character: 1 }
				}
			})
		]);
		expect(completions.items.some((item) => item.label === 'sub')).toBe(true);
		expect(symbols).toEqual([expect.objectContaining({ name: 'main' })]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-perl-runtime');
	});
});
