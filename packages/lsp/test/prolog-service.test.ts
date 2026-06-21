import { describe, expect, it, vi } from 'vitest';

import {
	createPrologWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

describe('createPrologWorkerService', () => {
	it('consults through the configured SWI-Prolog worker and returns diagnostics', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'ERROR: /main.prolog:2:3: Syntax error: Operator expected'
		}));
		const service = createPrologWorkerService(runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.prolog',
			languageId: 'prolog',
			version: 1,
			text: 'main :-\n  writeln().\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.(
			{ baseUrl: '/wasm-prolog/', workerUrl: '/wasm-prolog/runner-worker.js' },
			context
		);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);

		expect(runDiagnostics).toHaveBeenCalledWith({
			baseUrl: '/wasm-prolog/',
			workerUrl: '/wasm-prolog/runner-worker.js',
			code: document.text,
			activePath: 'main.prolog'
		});
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'prolog',
				message: 'ERROR: /main.prolog:2:3: Syntax error: Operator expected'
			})
		]);
		expect(completions?.items.some((item) => item.label === 'findall')).toBe(true);
		expect(context.reportProgress).toHaveBeenCalledWith('load-prolog-runtime');
	});
});
