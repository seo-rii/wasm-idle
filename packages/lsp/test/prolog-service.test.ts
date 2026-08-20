import { describe, expect, it, vi } from 'vitest';

import {
	PROLOG_MAX_ASSET_BYTES,
	PROLOG_PREFLIGHT_PROTOCOL,
	PROLOG_PREFLIGHT_PROTOCOL_VERSION,
	type PrologRuntimePreflightPayload
} from '@wasm-idle/core';
import {
	createPrologWorkerService,
	type LspDocument,
	type LspDocumentContext,
	type PrologWorkerOptions
} from '../src/index.js';

const runnerWorkerBytes = new TextEncoder().encode('self.onmessage = () => undefined;');
const workerReceipt = { bytes: runnerWorkerBytes.byteLength, sha256: 'b'.repeat(64) };

const createRuntimePreflight = (
	overrides: Partial<PrologRuntimePreflightPayload> = {}
): PrologRuntimePreflightPayload => ({
	protocol: PROLOG_PREFLIGHT_PROTOCOL,
	protocolVersion: PROLOG_PREFLIGHT_PROTOCOL_VERSION,
	profileId: 'swipl-wasm-test',
	packageRevision: '1'.repeat(40),
	swiplRevision: '2'.repeat(40),
	manifestFingerprint: 'a'.repeat(64),
	manifestBytes: Uint8Array.of(1),
	javascriptBytes: Uint8Array.of(2),
	wasmBytes: Uint8Array.of(3),
	dataBytes: Uint8Array.of(4),
	...overrides
});

const createWorkerOptions = (
	overrides: Partial<PrologWorkerOptions> = {}
): PrologWorkerOptions => ({
	workerReceipt,
	runnerWorkerBytes,
	runtimePreflight: createRuntimePreflight(),
	maxAssetBytes: PROLOG_MAX_ASSET_BYTES,
	...overrides
});

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
	it('forwards only verified bytes and the strict preflight payload to diagnostics', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'ERROR: /main.prolog:2:3: Syntax error: Operator expected'
		}));
		const service = createPrologWorkerService(runDiagnostics);
		const context = contextFor();
		const workerOptions = createWorkerOptions();

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

	it('strictly rejects missing, extra, malformed, and over-limit initialization data', () => {
		const context = contextFor();
		const initialize = (value: unknown) =>
			createPrologWorkerService(vi.fn(async () => ({}))).initialize?.(value, context);
		const workerOptions = createWorkerOptions();

		expect(() => initialize({ ...workerOptions, unexpected: true })).toThrow(
			'exact verified runtime configuration'
		);
		expect(() =>
			initialize({ ...workerOptions, workerReceipt: { bytes: 0, sha256: 'B'.repeat(64) } })
		).toThrow('valid runner receipt');
		expect(() => initialize({ ...workerOptions, runnerWorkerBytes: Uint8Array.of(1) })).toThrow(
			'receipt-sized runner bytes'
		);
		expect(() =>
			initialize({
				...workerOptions,
				runtimePreflight: { ...workerOptions.runtimePreflight, unexpected: true }
			})
		).toThrow('strict runtime preflight payload');
		expect(() => initialize({ ...workerOptions, maxAssetBytes: 0 })).toThrow(
			'valid maxAssetBytes limit'
		);
		expect(() =>
			initialize({
				...workerOptions,
				maxAssetBytes: 1,
				workerReceipt: { bytes: 1, sha256: 'c'.repeat(64) },
				runnerWorkerBytes: Uint8Array.of(1),
				runtimePreflight: createRuntimePreflight({ javascriptBytes: Uint8Array.of(1, 2) })
			})
		).toThrow('runtime preflight exceeds maxAssetBytes');
	});

	it('invalidates cached diagnostics when compact profile or runner identity changes', async () => {
		const runDiagnostics = vi.fn(async () => ({}));
		const service = createPrologWorkerService(runDiagnostics);
		const context = contextFor();
		const workerOptions = createWorkerOptions();

		await service.initialize?.(workerOptions, context);
		await service.diagnostics?.(document, context);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(1);

		await service.initialize?.(
			createWorkerOptions({
				runtimePreflight: createRuntimePreflight({ manifestFingerprint: 'c'.repeat(64) })
			}),
			context
		);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(2);

		await service.initialize?.(
			createWorkerOptions({
				runtimePreflight: createRuntimePreflight({ manifestFingerprint: 'c'.repeat(64) }),
				workerReceipt: { ...workerReceipt, sha256: 'd'.repeat(64) }
			}),
			context
		);
		await service.diagnostics?.(document, context);
		expect(runDiagnostics).toHaveBeenCalledTimes(3);
	});

	it('retries a failed verified run and caches only successful diagnostics', async () => {
		const runDiagnostics = vi
			.fn()
			.mockRejectedValueOnce(new Error('worker integrity verification failed'))
			.mockResolvedValueOnce({});
		const service = createPrologWorkerService(runDiagnostics);
		const context = contextFor();

		await service.initialize?.(createWorkerOptions(), context);
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

		await service.initialize?.(createWorkerOptions(), context);
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
