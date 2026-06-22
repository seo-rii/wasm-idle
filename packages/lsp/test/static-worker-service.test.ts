import { describe, expect, it, vi } from 'vitest';

import { createStaticWorkerDiagnostics } from '../src/static-worker-service.js';
import type { LspDocument, LspDocumentContext } from '../src/index.js';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createStaticWorkerDiagnostics', () => {
	it('validates configuration, reports progress, runs diagnostics, and caches results', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'demo error'
		}));
		const diagnostics = createStaticWorkerDiagnostics({
			languageName: 'Demo',
			loadProgressStage: 'load-demo-runtime',
			diagnosticsProgressStage: 'demo-diagnostics',
			defaultActivePath: 'main.demo',
			timeoutMessage: 'Demo diagnostics timed out',
			runDiagnostics,
			createMessage: (request) => ({
				baseUrl: request.baseUrl,
				code: request.code,
				activePath: request.activePath,
				diagnose: true
			}),
			diagnosticsFromResult: (result) =>
				result.error
					? [
							{
								range: {
									start: { line: 0, character: 0 },
									end: { line: 0, character: 1 }
								},
								severity: 1,
								source: 'demo',
								message: result.error
							}
						]
					: []
		});
		const document: LspDocument = {
			uri: 'file:///workspace/main.demo',
			languageId: 'demo',
			version: 1,
			text: 'broken\n'
		};
		const context = contextFor(document);

		expect(() =>
			diagnostics.initialize?.({ baseUrl: '/demo/' }, context)
		).toThrow('Demo language server requires baseUrl and workerUrl');

		diagnostics.initialize?.(
			{ baseUrl: '/demo/', workerUrl: '/demo/runner-worker.js' },
			context
		);
		const first = await diagnostics.diagnostics?.(document, context);
		const second = await diagnostics.diagnostics?.(document, context);

		expect(runDiagnostics).toHaveBeenCalledTimes(1);
		expect(runDiagnostics).toHaveBeenCalledWith({
			baseUrl: '/demo/',
			workerUrl: '/demo/runner-worker.js',
			code: document.text,
			activePath: 'main.demo'
		});
		expect(first).toEqual([
			expect.objectContaining({
				source: 'demo',
				message: 'demo error'
			})
		]);
		expect(second).toBe(first);
		expect(context.reportProgress).toHaveBeenCalledWith('load-demo-runtime');
		expect(context.reportProgress).toHaveBeenCalledWith('demo-diagnostics');
	});

	it('uses the fallback active path for untitled documents', async () => {
		const runDiagnostics = vi.fn(async () => ({}));
		const diagnostics = createStaticWorkerDiagnostics({
			languageName: 'Demo',
			loadProgressStage: 'load-demo-runtime',
			defaultActivePath: 'main.demo',
			timeoutMessage: 'Demo diagnostics timed out',
			runDiagnostics,
			createMessage: () => ({}),
			diagnosticsFromResult: () => []
		});
		const document: LspDocument = {
			uri: '',
			languageId: 'demo',
			version: 1,
			text: 'ok\n'
		};
		const context = contextFor(document);

		diagnostics.initialize?.(
			{ baseUrl: '/demo/', workerUrl: '/demo/runner-worker.js' },
			context
		);
		await diagnostics.diagnostics?.(document, context);

		expect(runDiagnostics).toHaveBeenCalledWith(
			expect.objectContaining({ activePath: 'main.demo' })
		);
	});
});
