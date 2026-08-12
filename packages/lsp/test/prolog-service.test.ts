import { describe, expect, it, vi } from 'vitest';

import {
	createPrologWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

const manifestFingerprint = 'a'.repeat(64);
const workerReceipt = { bytes: 123, sha256: 'b'.repeat(64) };
const workerOptions = {
	baseUrl: '/wasm-prolog/',
	workerUrl: '/wasm-prolog/runner-worker.js',
	manifestUrl: '/wasm-prolog/runtime-manifest.v2.json',
	manifestFingerprint,
	workerReceipt
};
const document: LspDocument = {
	uri: 'file:///workspace/main.prolog',
	languageId: 'prolog',
	version: 1,
	text: 'main :-\n  writeln().\n'
};
const contextFor = (): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createPrologWorkerService', () => {
	it('consults through the configured SWI-Prolog worker and returns diagnostics', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'ERROR: /main.prolog:2:3: Syntax error: Operator expected'
		}));
		const service = createPrologWorkerService(runDiagnostics);
		const context = contextFor();

		await service.initialize?.(workerOptions, context);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		);

		expect(runDiagnostics).toHaveBeenCalledWith({
			...workerOptions,
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

	it('requires a pinned manifest and a valid worker receipt', () => {
		const service = createPrologWorkerService(vi.fn(async () => ({})));
		const context = contextFor();

		expect(() =>
			service.initialize?.({ ...workerOptions, manifestFingerprint: 'not-a-digest' }, context)
		).toThrow('Prolog language server requires a manifest URL and fingerprint');
		expect(() =>
			service.initialize?.(
				{ ...workerOptions, workerReceipt: { bytes: 0, sha256: 'B'.repeat(64) } },
				context
			)
		).toThrow('Prolog language server requires a valid worker receipt');
	});

	it('invalidates cached diagnostics when either trust pin changes', async () => {
		const runDiagnostics = vi.fn(async () => ({}));
		const service = createPrologWorkerService(runDiagnostics);
		const context = contextFor();

		await service.initialize?.(workerOptions, context);
		await service.diagnostics?.(document, context);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(1);

		await service.initialize?.(
			{ ...workerOptions, manifestFingerprint: 'c'.repeat(64) },
			context
		);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(2);

		await service.initialize?.(
			{
				...workerOptions,
				manifestFingerprint: 'c'.repeat(64),
				workerReceipt: { bytes: 456, sha256: 'd'.repeat(64) }
			},
			context
		);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(3);
	});

	it('retries a failed integrity load and caches only the successful diagnostics', async () => {
		const runDiagnostics = vi
			.fn()
			.mockRejectedValueOnce(new Error('worker integrity verification failed'))
			.mockResolvedValueOnce({});
		const service = createPrologWorkerService(runDiagnostics);
		const context = contextFor();

		await service.initialize?.(workerOptions, context);
		await expect(service.diagnostics?.(document, context)).rejects.toThrow(
			'worker integrity verification failed'
		);
		await expect(service.diagnostics?.(document, context)).resolves.toEqual([]);
		await expect(service.diagnostics?.(document, context)).resolves.toEqual([]);

		expect(runDiagnostics).toHaveBeenCalledTimes(2);
	});

	it('shares one pending verified run between concurrent requests for the same document', async () => {
		let resolveRun!: (result: { error?: string }) => void;
		const runDiagnostics = vi.fn(
			() =>
				new Promise<{ error?: string }>((resolve) => {
					resolveRun = resolve;
				})
		);
		const service = createPrologWorkerService(runDiagnostics);
		const context = contextFor();

		await service.initialize?.(workerOptions, context);
		const first = service.diagnostics?.(document, context);
		const second = service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(1);

		resolveRun({ error: 'ERROR: /main.prolog:2:3: Syntax error: Operator expected' });
		const [firstDiagnostics, secondDiagnostics] = await Promise.all([first, second]);

		expect(firstDiagnostics).toEqual(secondDiagnostics);
		expect(firstDiagnostics).toHaveLength(1);
		await expect(service.diagnostics?.(document, context)).resolves.toEqual(firstDiagnostics);
		expect(runDiagnostics).toHaveBeenCalledTimes(1);
	});
});
