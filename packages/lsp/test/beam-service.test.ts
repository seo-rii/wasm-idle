import { describe, expect, it, vi } from 'vitest';

import {
	BUNDLED_ELIXIR_ASSET_RECEIPTS,
	createBeamWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

const contextFor = (document: LspDocument): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

describe('createBeamWorkerService', () => {
	it('checks Elixir through the configured AtomVM worker and exposes Elixir symbols', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: '** (TokenMissingError) nofile:3:1: missing terminator: end'
		}));
		const service = createBeamWorkerService('elixir', runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.exs',
			languageId: 'elixir',
			version: 1,
			text: 'defmodule Main do\n  def run, do: :ok\n'
		};
		const context = contextFor(document);

		await service.initialize?.(
			{
				bundleUrl: '/wasm-elixir/bundle.avm',
				workerUrl: '/assets/elixir-worker.js',
				integrity: BUNDLED_ELIXIR_ASSET_RECEIPTS
			},
			context
		);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = (await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		)) as { items: Array<{ label: string }> };
		const hover = await service.hover?.(document, { line: 0, character: 4 }, context);
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;

		expect(runDiagnostics).toHaveBeenCalledWith({
			language: 'elixir',
			bundleUrl: '/wasm-elixir/bundle.avm',
			workerUrl: '/assets/elixir-worker.js',
			integrity: BUNDLED_ELIXIR_ASSET_RECEIPTS,
			code: document.text,
			activePath: 'main.exs'
		});
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'elixir',
				range: {
					start: { line: 2, character: 0 },
					end: { line: 2, character: 1 }
				}
			})
		]);
		expect(completions.items.some((item) => item.label === 'defmodule')).toBe(true);
		expect(hover?.contents.value).toContain('Defines an Elixir module');
		expect(symbols).toEqual([
			expect.objectContaining({ name: 'Main' }),
			expect.objectContaining({ name: 'run' })
		]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-elixir-runtime');
	});

	it('checks Erlang through the configured AtomVM worker and exposes Erlang symbols', async () => {
		const runDiagnostics = vi.fn(async () => ({
			error: 'main.erl:4:1: syntax error before: end'
		}));
		const service = createBeamWorkerService('erlang', runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.erl',
			languageId: 'erlang',
			version: 1,
			text: '-module(main).\n-export([main/0]).\nmain() ->\n'
		};
		const context = contextFor(document);

		await service.initialize?.(
			{
				bundleUrl: '/wasm-elixir/bundle.avm',
				workerUrl: '/assets/elixir-worker.js',
				integrity: BUNDLED_ELIXIR_ASSET_RECEIPTS
			},
			context
		);
		const diagnostics = await service.diagnostics?.(document, context);
		const completions = (await service.completion?.(
			document,
			{ line: 0, character: 0 },
			context
		)) as { items: Array<{ label: string }> };
		const hover = await service.hover?.(document, { line: 0, character: 3 }, context);
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;

		expect(runDiagnostics).toHaveBeenCalledWith({
			language: 'erlang',
			bundleUrl: '/wasm-elixir/bundle.avm',
			workerUrl: '/assets/elixir-worker.js',
			integrity: BUNDLED_ELIXIR_ASSET_RECEIPTS,
			code: document.text,
			activePath: 'main.erl'
		});
		expect(diagnostics).toEqual([
			expect.objectContaining({
				source: 'erlang',
				range: {
					start: { line: 3, character: 0 },
					end: { line: 3, character: 1 }
				}
			})
		]);
		expect(completions.items.some((item) => item.label === '-export')).toBe(true);
		expect(hover?.contents.value).toContain('Declares the Erlang module name');
		expect(symbols).toEqual([
			expect.objectContaining({ name: 'main', kind: 2 }),
			expect.objectContaining({ name: 'main', kind: 12 })
		]);
		expect(context.reportProgress).toHaveBeenCalledWith('load-erlang-runtime');
	});

	it('snapshots receipts and invalidates cached diagnostics when the trust root changes', async () => {
		const runDiagnostics = vi.fn(async () => ({}));
		const service = createBeamWorkerService('elixir', runDiagnostics);
		const document: LspDocument = {
			uri: 'file:///workspace/main.exs',
			languageId: 'elixir',
			version: 1,
			text: 'IO.puts("hello")'
		};
		const context = contextFor(document);
		const firstIntegrity = structuredClone(BUNDLED_ELIXIR_ASSET_RECEIPTS);

		await service.initialize?.(
			{
				bundleUrl: '/wasm-elixir/bundle.avm',
				workerUrl: '/assets/elixir-worker.js',
				integrity: firstIntegrity
			},
			context
		);
		firstIntegrity['bundle.avm'].uncompressedBytes = 1;
		await service.diagnostics?.(document, context);

		const nextIntegrity = structuredClone(BUNDLED_ELIXIR_ASSET_RECEIPTS);
		nextIntegrity['bundle.avm'].uncompressedSha256 = 'a'.repeat(64);
		await service.initialize?.(
			{
				bundleUrl: '/wasm-elixir/bundle.avm',
				workerUrl: '/assets/elixir-worker.js',
				integrity: nextIntegrity
			},
			context
		);
		await service.diagnostics?.(document, context);

		expect(runDiagnostics).toHaveBeenCalledTimes(2);
		expect(runDiagnostics.mock.calls[0]?.[0].integrity['bundle.avm'].uncompressedBytes).toBe(
			BUNDLED_ELIXIR_ASSET_RECEIPTS['bundle.avm'].uncompressedBytes
		);
		expect(runDiagnostics.mock.calls[0]?.[0].integrity).not.toBe(firstIntegrity);
		expect(Object.isFrozen(runDiagnostics.mock.calls[0]?.[0].integrity)).toBe(true);
	});

	it('rejects incomplete receipt sets at the public service boundary', async () => {
		const service = createBeamWorkerService('elixir');
		const document: LspDocument = {
			uri: 'file:///workspace/main.exs',
			languageId: 'elixir',
			version: 1,
			text: ''
		};

		expect(() =>
			service.initialize?.(
				{
					bundleUrl: '/wasm-elixir/bundle.avm',
					workerUrl: '/assets/elixir-worker.js',
					integrity: { 'bundle.avm': BUNDLED_ELIXIR_ASSET_RECEIPTS['bundle.avm'] }
				},
				contextFor(document)
			)
		).toThrow('requires exactly three asset receipts');
	});
});
