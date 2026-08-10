import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RUBY_RUNTIME_ASSET_PATH, type RubyRuntimeAssetReceipts } from '@wasm-idle/core';
import {
	createRubyWorkerService,
	type LspDocument,
	type LspDocumentContext,
	type RubySyntaxChecker,
	type RubyWorkerOptions
} from '../src/index.js';

const RUNTIME_STATE_KEY = '__wasmIdleRubyLspRuntimeState';
const MODULE_URL = 'https://static.example.com/wasm-ruby/runtime.mjs?v=profile';
const WASM_URL = 'https://static.example.com/wasm-ruby/assets/ruby_stdlib-C40Yu-vu.wasm?v=profile';

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

const receiptFor = (bytes: Uint8Array) => ({
	bytes: bytes.byteLength,
	sha256: createHash('sha256').update(bytes).digest('hex')
});

const fixture = (tag = 'fixture'): RubyWorkerOptions => {
	const moduleBytes = new TextEncoder().encode(runtimeModuleSource(tag));
	const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
	const integrity: RubyRuntimeAssetReceipts = {
		'runtime.mjs': receiptFor(moduleBytes),
		[RUBY_RUNTIME_ASSET_PATH]: receiptFor(wasmBytes)
	};
	return {
		moduleUrl: MODULE_URL,
		wasmUrl: WASM_URL,
		integrity,
		moduleBytes,
		wasmBytes
	};
};

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

const rewrittenModuleSource = (source: string, wasmUrl = WASM_URL) =>
	source.replace(
		`new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)}, import.meta.url)`,
		`new URL(${JSON.stringify(wasmUrl)}, import.meta.url)`
	);

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(globalThis, RUNTIME_STATE_KEY);
});

describe('createRubyWorkerService', () => {
	it('copies and re-verifies host bytes before importing a rewritten Blob module', async () => {
		const config = fixture('verified-runtime');
		const originalModuleBytes = Uint8Array.from(config.moduleBytes);
		const originalWasmBytes = Uint8Array.from(config.wasmBytes);
		const state: Record<string, unknown> = {};
		(globalThis as unknown as Record<string, unknown>)[RUNTIME_STATE_KEY] = state;

		const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
		let releaseDigest!: () => void;
		const digestGate = new Promise<void>((resolve) => {
			releaseDigest = resolve;
		});
		let markDigestStarted!: () => void;
		const digestStarted = new Promise<void>((resolve) => {
			markDigestStarted = resolve;
		});
		vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
			markDigestStarted();
			await digestGate;
			return await originalDigest(algorithm, data);
		});

		let importedBlob: Blob | undefined;
		const importedSource = rewrittenModuleSource(new TextDecoder().decode(originalModuleBytes));
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
		const initializing = service.initialize?.(config, context());
		await digestStarted;
		config.moduleBytes.fill(0);
		config.wasmBytes.fill(0);
		releaseDigest();
		await expect(initializing).resolves.toBeUndefined();

		expect(compile).toHaveBeenCalledOnce();
		expect(Array.from(compile.mock.calls[0][0] as Uint8Array)).toEqual(
			Array.from(originalWasmBytes)
		);
		expect(await importedBlob?.text()).toContain(JSON.stringify(WASM_URL));
		expect(await importedBlob?.text()).not.toContain(
			`new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)}, import.meta.url)`
		);
		expect(revokeObjectUrl).toHaveBeenCalledWith(importedUrl);
		expect(fetchMock).not.toHaveBeenCalled();

		expect(await service.diagnostics?.(document, context())).toEqual([]);
		expect(state).toMatchObject({
			rewrittenUrl: WASM_URL,
			tag: 'verified-runtime',
			compiledModule
		});
		expect(state.evaluated).toContain('RubyVM::InstructionSequence.compile');
	});

	it.each(['moduleBytes', 'wasmBytes'] as const)(
		'rejects modified %s before compiling or evaluating runtime code',
		async (asset) => {
			const config = fixture(`corrupt-${asset}`);
			config[asset][0] ^= 1;
			const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
			const compile = vi.spyOn(WebAssembly, 'compile');
			const fetchMock = vi.fn();
			vi.stubGlobal('fetch', fetchMock);

			await expect(
				createRubyWorkerService().initialize?.(config, context())
			).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'ruby-lsp' });

			expect(createObjectUrl).not.toHaveBeenCalled();
			expect(compile).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it('rejects unsafe URLs, malformed receipts, and non-byte views before loading a checker', async () => {
		const loadChecker = vi.fn<() => Promise<RubySyntaxChecker>>();
		const service = createRubyWorkerService(loadChecker);

		await expect(
			service.initialize?.(
				{ ...fixture(), moduleUrl: 'data:text/javascript,export default 1' },
				context()
			)
		).rejects.toThrow('runtime module URL is unsafe');
		await expect(
			service.initialize?.(
				{ ...fixture(), wasmUrl: 'https://static.example.com/%2fsecret.wasm' },
				context()
			)
		).rejects.toThrow('runtime Wasm URL is unsafe');
		await expect(
			service.initialize?.(
				{
					...fixture(),
					integrity: {
						...fixture().integrity,
						unexpected: receiptFor(Uint8Array.of(1))
					} as never
				},
				context()
			)
		).rejects.toThrow('must describe exactly two assets');
		await expect(
			service.initialize?.(
				{ ...fixture(), moduleBytes: new DataView(new ArrayBuffer(8)) } as never,
				context()
			)
		).rejects.toThrow('requires runtime module bytes');

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
		const firstConfig = fixture('first');

		await service.initialize?.(firstConfig, context());
		expect(loadChecker.mock.calls[0][0].moduleBytes).not.toBe(firstConfig.moduleBytes);
		expect(await service.diagnostics?.(document, context())).toEqual([
			expect.objectContaining({ message: 'first checker' })
		]);
		await expect(
			service.initialize?.(
				{ ...fixture('failed'), moduleUrl: `${MODULE_URL}&attempt=failed` },
				context()
			)
		).rejects.toThrow('replacement failed');
		expect(await service.diagnostics?.(document, context())).toEqual([
			expect.objectContaining({ message: 'first checker' })
		]);
		expect(firstCheck).toHaveBeenCalledOnce();
		expect(firstDispose).not.toHaveBeenCalled();

		await service.initialize?.(
			{ ...fixture('second'), moduleUrl: `${MODULE_URL}&attempt=second` },
			context()
		);
		expect(firstDispose).toHaveBeenCalledOnce();
		expect(await service.diagnostics?.(document, context())).toEqual([
			expect.objectContaining({ message: 'second checker' })
		]);
		expect(secondCheck).toHaveBeenCalledOnce();
	});

	it('revokes failed Blob imports and can retry initialization cleanly', async () => {
		const config = fixture('retry');
		const source = rewrittenModuleSource(new TextDecoder().decode(config.moduleBytes));
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
