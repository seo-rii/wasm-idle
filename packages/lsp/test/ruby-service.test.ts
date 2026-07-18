import { describe, expect, it, vi } from 'vitest';

import {
	createRubyWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

describe('createRubyWorkerService', () => {
	it('uses the Ruby WASM URL and shim exported by the static runtime module', async () => {
		const stateKey = '__wasmIdleRubyLspRuntimeTest';
		const state = { instantiated: false, evaluated: '' };
		(globalThis as Record<string, unknown>)[stateKey] = state;
		const moduleUrl = `data:text/javascript,${encodeURIComponent(`
			export const rubyStdlibWasmUrl = '/bundled/ruby+stdlib.wasm';
			export const RubyVM = {
				async instantiateModule() {
					globalThis.${stateKey}.instantiated = true;
					return {
						vm: {
							eval(code) { globalThis.${stateKey}.evaluated = code; }
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
		`)}`;
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			arrayBuffer: async () => new ArrayBuffer(0)
		}));
		vi.stubGlobal('fetch', fetchMock);
		const compile = vi
			.spyOn(WebAssembly, 'compile')
			.mockResolvedValue({} as WebAssembly.Module);
		const service = createRubyWorkerService();
		const document: LspDocument = {
			uri: 'file:///workspace/main.rb',
			languageId: 'ruby',
			version: 1,
			text: 'puts :ok\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		try {
			await service.initialize?.({ moduleUrl }, context);
			expect(await service.diagnostics?.(document, context)).toEqual([]);
			expect(fetchMock).toHaveBeenCalledWith('/bundled/ruby+stdlib.wasm');
			expect(state.instantiated).toBe(true);
			expect(state.evaluated).toContain('RubyVM::InstructionSequence.compile');
		} finally {
			compile.mockRestore();
			vi.unstubAllGlobals();
			Reflect.deleteProperty(globalThis, stateKey);
		}
	});

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

		await service.initialize?.(
			{
				moduleUrl: '/wasm-ruby/runtime.mjs',
				wasmUrl: '/ruby+stdlib.wasm'
			},
			context
		);
		const diagnostics = await service.diagnostics?.(document, context);
		const symbols = (await service.documentSymbols?.(document, context)) as Array<{
			name: string;
		}>;
		const hover = await service.hover?.(document, { line: 0, character: 1 }, context);

		expect(loadChecker).toHaveBeenCalledWith({
			moduleUrl: '/wasm-ruby/runtime.mjs',
			wasmUrl: '/ruby+stdlib.wasm'
		});
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
