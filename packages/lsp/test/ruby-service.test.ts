import { afterEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
	requireRubyRuntimePreflightPayload: vi.fn((value: unknown) => value),
	verifyRubyRuntimePreflightPayload: vi.fn(async () => {})
}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	RUBY_MAX_ASSET_BYTES: 40 * 1024 * 1024,
	RUBY_MAX_LOGICAL_BYTES: 40 * 1024 * 1024,
	RUBY_MAX_MANIFEST_BYTES: 64 * 1024,
	RUBY_MAX_MODULE_BYTES: 1024 * 1024,
	requireRubyRuntimePreflightPayload: coreMocks.requireRubyRuntimePreflightPayload,
	verifyRubyRuntimePreflightPayload: coreMocks.verifyRubyRuntimePreflightPayload
}));

import { RUBY_RUNTIME_ASSET_PATH, RUBY_RUNTIME_VERIFIED_WASM_URL } from '@wasm-idle/core';
import {
	createRubyWorkerService,
	type LspDocument,
	type LspDocumentContext,
	type RubyRuntimePreflightPayload,
	type RubySyntaxChecker,
	type RubyWorkerOptions
} from '../src/index.js';

const RUNTIME_STATE_KEY = '__wasmIdleRubyLspRuntimeState';
const VERIFIED_WASM_SENTINEL = RUBY_RUNTIME_VERIFIED_WASM_URL;

const runtimeModuleSource = (tag: string) => `
const rubyStdlibWasmUrl = new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)}, import.meta.url).href;
globalThis.${RUNTIME_STATE_KEY}.rewrittenUrl = rubyStdlibWasmUrl;
globalThis.${RUNTIME_STATE_KEY}.tag = ${JSON.stringify(tag)};
export const RubyVM = {
  async instantiateModule(options) {
    globalThis.${RUNTIME_STATE_KEY}.compiledModule = options.module;
    return {
      vm: {
        eval(code) { globalThis.${RUNTIME_STATE_KEY}.evaluated = code; }
      }
    };
  }
};
export function consolePrinter() {
  return { addToImports() {}, setMemory() {} };
}
class File { constructor(data) { this.data = data; } }
class OpenFile { constructor(file) { this.file = file; } }
class WASI {
  constructor() { this.wasiImport = {}; }
  initialize() {}
}
export const wasiShim = { File, OpenFile, WASI };
`;

const createPayload = (tag = 'fixture'): RubyRuntimePreflightPayload => ({
	protocol: 'wasm-idle-ruby-preflight',
	protocolVersion: 1,
	profileId: 'ruby-3.4.1-ruby-wasm-2.9.3-2.9.4',
	artifactRevision: 'a'.repeat(40),
	rubyVersion: '3.4.1',
	rubyRevision: 'b'.repeat(40),
	rubyWasmVersion: '2.9.3-2.9.4',
	rubyWasmRevision: 'a'.repeat(40),
	wasiSdkVersion: '22.0',
	manifestFingerprint: 'd'.repeat(64),
	manifestBytes: new TextEncoder().encode('{"schemaVersion":2}'),
	moduleJavaScriptBytes: new TextEncoder().encode(runtimeModuleSource(tag)),
	wasmBytes: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)
});

const fixture = (tag = 'fixture'): RubyWorkerOptions => ({
	runtimePreflight: createPayload(tag)
});

const document: LspDocument = {
	uri: 'file:///workspace/main.rb',
	languageId: 'ruby',
	version: 1,
	text: 'def main\n  puts :ok\nend\n'
};

const context = (): LspDocumentContext => ({
	documents: new Map([[document.uri, document]]),
	publishDiagnostics: vi.fn(),
	reportProgress: vi.fn()
});

const rewrittenModuleSource = (source: string) =>
	source.replace(
		`new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)}, import.meta.url)`,
		`new URL(${JSON.stringify(VERIFIED_WASM_SENTINEL)}, import.meta.url)`
	);

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(globalThis, RUNTIME_STATE_KEY);
	coreMocks.requireRubyRuntimePreflightPayload.mockReset();
	coreMocks.requireRubyRuntimePreflightPayload.mockImplementation((value: unknown) => value);
	coreMocks.verifyRubyRuntimePreflightPayload.mockReset();
	coreMocks.verifyRubyRuntimePreflightPayload.mockResolvedValue(undefined);
});

describe('createRubyWorkerService', () => {
	it('re-verifies transferred bytes and imports only a fixed-sentinel Blob module without fetching', async () => {
		const config = fixture('verified-runtime');
		const payload = config.runtimePreflight;
		const state: Record<string, unknown> = {};
		(globalThis as unknown as Record<string, unknown>)[RUNTIME_STATE_KEY] = state;

		let importedBlob: Blob | undefined;
		const importedSource = rewrittenModuleSource(
			new TextDecoder().decode(payload.moduleJavaScriptBytes)
		);
		const importedUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(importedSource)}`;
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			importedBlob = blob;
			return importedUrl;
		});
		const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const compiledModule = {} as WebAssembly.Module;
		const compile = vi.spyOn(WebAssembly, 'compile').mockResolvedValue(compiledModule);
		const fetchMock = vi.fn(() => {
			throw new Error('Ruby LSP worker must not fetch runtime assets');
		});
		vi.stubGlobal('fetch', fetchMock);

		const service = createRubyWorkerService();
		await expect(service.initialize?.(config, context())).resolves.toBeUndefined();

		expect(coreMocks.requireRubyRuntimePreflightPayload).toHaveBeenCalledWith(payload);
		expect(coreMocks.verifyRubyRuntimePreflightPayload).toHaveBeenCalledWith(payload);
		expect(compile).toHaveBeenCalledOnce();
		expect(compile.mock.calls[0][0]).toBe(payload.wasmBytes);
		expect(await importedBlob?.text()).toContain(JSON.stringify(VERIFIED_WASM_SENTINEL));
		expect(await importedBlob?.text()).not.toContain(
			`new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)}, import.meta.url)`
		);
		expect(revokeObjectUrl).toHaveBeenCalledWith(importedUrl);
		expect(fetchMock).not.toHaveBeenCalled();

		expect(await service.diagnostics?.(document, context())).toEqual([]);
		expect(state).toMatchObject({
			rewrittenUrl: VERIFIED_WASM_SENTINEL,
			tag: 'verified-runtime',
			compiledModule
		});
		expect(state.evaluated).toContain('RubyVM::InstructionSequence.compile');
	});

	it('rejects invalid preflight bytes before compiling or evaluating runtime code', async () => {
		const config = fixture('corrupt');
		const failure = Object.assign(new Error('Ruby runtime asset hash mismatch'), {
			code: 'asset-integrity',
			runtimeId: 'ruby-lsp'
		});
		coreMocks.verifyRubyRuntimePreflightPayload.mockRejectedValueOnce(failure);
		const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
		const compile = vi.spyOn(WebAssembly, 'compile');
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(createRubyWorkerService().initialize?.(config, context())).rejects.toBe(
			failure
		);

		expect(createObjectUrl).not.toHaveBeenCalled();
		expect(compile).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('requires one exact config key and owned, unique, whole preflight buffers', async () => {
		const loadChecker = vi.fn<() => Promise<RubySyntaxChecker>>();
		const service = createRubyWorkerService(loadChecker);

		await expect(
			service.initialize?.(
				{ ...fixture(), moduleUrl: 'https://unexpected.invalid/' },
				context()
			)
		).rejects.toThrow('exact verified runtime configuration');
		await expect(service.initialize?.({}, context())).rejects.toThrow(
			'exact verified runtime configuration'
		);

		const partialView = fixture('partial');
		const backing = new Uint8Array(
			partialView.runtimePreflight.moduleJavaScriptBytes.length + 1
		);
		backing.set(partialView.runtimePreflight.moduleJavaScriptBytes, 1);
		(
			partialView.runtimePreflight as { moduleJavaScriptBytes: Uint8Array }
		).moduleJavaScriptBytes = backing.subarray(1);
		await expect(service.initialize?.(partialView, context())).rejects.toThrow(
			'owned runtime preflight bytes'
		);

		const aliased = fixture('aliased');
		const shared = Uint8Array.of(1, 2, 3);
		(aliased.runtimePreflight as { manifestBytes: Uint8Array }).manifestBytes = shared;
		(aliased.runtimePreflight as { moduleJavaScriptBytes: Uint8Array }).moduleJavaScriptBytes =
			shared;
		await expect(service.initialize?.(aliased, context())).rejects.toThrow(
			'unique owned preflight buffers'
		);

		expect(loadChecker).not.toHaveBeenCalled();
	});

	it('preserves the active checker and diagnostic cache after failed reinitialization', async () => {
		const firstCheck = vi.fn(() => [
			{ lineNumber: 2, columnNumber: 3, message: 'first checker' }
		]);
		const firstDispose = vi.fn();
		const secondCheck = vi.fn(() => [
			{ lineNumber: 1, columnNumber: 1, message: 'second checker' }
		]);
		const firstChecker: RubySyntaxChecker = { check: firstCheck, dispose: firstDispose };
		const secondChecker: RubySyntaxChecker = { check: secondCheck };
		const loadChecker = vi
			.fn<(options: RubyWorkerOptions) => Promise<RubySyntaxChecker>>()
			.mockResolvedValueOnce(firstChecker)
			.mockRejectedValueOnce(new Error('replacement failed'))
			.mockResolvedValueOnce(secondChecker);
		const service = createRubyWorkerService(loadChecker);

		await service.initialize?.(fixture('first'), context());
		expect(await service.diagnostics?.(document, context())).toEqual([
			expect.objectContaining({ message: 'first checker' })
		]);
		await expect(service.initialize?.(fixture('failed'), context())).rejects.toThrow(
			'replacement failed'
		);
		expect(await service.diagnostics?.(document, context())).toEqual([
			expect.objectContaining({ message: 'first checker' })
		]);
		expect(firstCheck).toHaveBeenCalledOnce();
		expect(firstDispose).not.toHaveBeenCalled();

		await service.initialize?.(fixture('second'), context());
		expect(firstDispose).toHaveBeenCalledOnce();
		expect(await service.diagnostics?.(document, context())).toEqual([
			expect.objectContaining({ message: 'second checker' })
		]);
		expect(secondCheck).toHaveBeenCalledOnce();
	});

	it('revokes failed Blob imports and can retry initialization cleanly', async () => {
		const config = fixture('retry');
		const source = rewrittenModuleSource(
			new TextDecoder().decode(config.runtimePreflight.moduleJavaScriptBytes)
		);
		const goodModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
		const badModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(
			'throw new Error("import failed")'
		)}`;
		(globalThis as unknown as Record<string, unknown>)[RUNTIME_STATE_KEY] = {};
		vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
		vi.spyOn(URL, 'createObjectURL')
			.mockReturnValueOnce(badModuleUrl)
			.mockReturnValueOnce(goodModuleUrl);
		const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const service = createRubyWorkerService();

		await expect(service.initialize?.(config, context())).rejects.toThrow('import failed');
		await expect(service.initialize?.(config, context())).resolves.toBeUndefined();

		expect(revokeObjectUrl).toHaveBeenNthCalledWith(1, badModuleUrl);
		expect(revokeObjectUrl).toHaveBeenNthCalledWith(2, goodModuleUrl);
	});

	it('uses an injected checker and exposes Ruby editor features', async () => {
		const check = vi.fn(() => [
			{
				lineNumber: 2,
				columnNumber: 5,
				message: 'syntax error, unexpected end-of-input'
			}
		]);
		const loadChecker = vi.fn(async () => ({ check }));
		const service = createRubyWorkerService(loadChecker);
		const serviceContext = context();

		await service.initialize?.(fixture('features'), serviceContext);
		const diagnostics = await service.diagnostics?.(document, serviceContext);
		const symbols = (await service.documentSymbols?.(document, serviceContext)) as Array<{
			name: string;
		}>;
		const hover = await service.hover?.(document, { line: 0, character: 1 }, serviceContext);

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
		expect(serviceContext.reportProgress).toHaveBeenCalledWith('load-ruby-runtime');
	});
});
