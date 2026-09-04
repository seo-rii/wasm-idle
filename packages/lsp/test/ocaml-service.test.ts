import { describe, expect, it, vi } from 'vitest';

import {
	createOcamlWorkerService,
	type LspDocument,
	type LspDocumentContext
} from '../src/index.js';

describe('createOcamlWorkerService', () => {
	it('loads the default compiler manifest through the bounded asset boundary', async () => {
		const moduleUrl = `data:text/javascript,${encodeURIComponent(`
			export async function compile() { return { success: true }; }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`)}`;
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						ocamlLibFiles: [],
						packages: []
					})
				)
		);
		vi.stubGlobal('fetch', fetchMock);
		const service = createOcamlWorkerService();
		const context: LspDocumentContext = {
			documents: new Map(),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		try {
			await service.initialize?.(
				{
					moduleUrl,
					manifestUrl: 'https://static.example.com/ocaml/manifest.json'
				},
				context
			);

			expect(fetchMock).toHaveBeenCalledWith(
				'https://static.example.com/ocaml/manifest.json',
				expect.objectContaining({
					cache: 'no-store',
					credentials: 'omit',
					redirect: 'error',
					referrerPolicy: 'no-referrer'
				})
			);
			expect(context.reportProgress).toHaveBeenCalledWith('load-ocaml-manifest');
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('preserves asset descriptors when rebasing the default compiler manifest', async () => {
		const captureManifest = vi.fn();
		vi.stubGlobal('__captureOcamlManifest', captureManifest);
		const moduleUrl = `data:text/javascript,${encodeURIComponent(`
			export async function compile() {
				return { success: true, diagnostics: [] };
			}
			export function createBrowserWorkerSystemDispatcher(options) {
				globalThis.__captureOcamlManifest(options.manifest);
				return {};
			}
		`)}`;
		const asset = (url: string, bytes: number, sha256: string) => ({ url, bytes, sha256 });
		const manifest = {
			findlibConf: asset(
				'/wasm-of-js-of-ocaml/browser-native-bundle/findlib.conf',
				181,
				'a'.repeat(64)
			),
			tools: {
				ocamlc: asset(
					'/wasm-of-js-of-ocaml/browser-native-bundle/tools/ocamlc.byte.browser.js',
					101,
					'b'.repeat(64)
				),
				js_of_ocaml: asset(
					'/wasm-of-js-of-ocaml/browser-native-bundle/tools/js_of_ocaml.bc.browser.js',
					102,
					'c'.repeat(64)
				),
				wasm_of_ocaml: asset(
					'/wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm_of_ocaml.bc.browser.js',
					103,
					'd'.repeat(64)
				)
			},
			binaryenTools: {
				wasm_opt: asset(
					'/wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-opt.browser.js',
					201,
					'e'.repeat(64)
				),
				wasm_merge: asset(
					'/wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-merge.browser.js',
					202,
					'f'.repeat(64)
				),
				wasm_metadce: asset(
					'/wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-metadce.browser.js',
					203,
					'0'.repeat(64)
				)
			},
			ocamlLibFiles: [],
			packages: []
		};
		const fetchMock = vi.fn(async () => new Response(JSON.stringify(manifest)));
		vi.stubGlobal('fetch', fetchMock);
		const service = createOcamlWorkerService();
		const document: LspDocument = {
			uri: 'file:///workspace/main.ml',
			languageId: 'ocaml',
			version: 1,
			text: 'let answer = 42\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([[document.uri, document]]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};
		const manifestUrl =
			'https://static.example.com/absproxy/5173/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json';

		try {
			await service.initialize?.({ moduleUrl, manifestUrl }, context);
			await service.diagnostics?.(document, context);

			expect(captureManifest).toHaveBeenCalledOnce();
			const rewrittenManifest = captureManifest.mock.calls[0]?.[0];
			expect(rewrittenManifest).toEqual({
				...manifest,
				findlibConf: {
					...manifest.findlibConf,
					url: `https://static.example.com/absproxy/5173${manifest.findlibConf.url}`
				},
				tools: Object.fromEntries(
					Object.entries(manifest.tools).map(([name, descriptor]) => [
						name,
						{
							...descriptor,
							url: `https://static.example.com/absproxy/5173${descriptor.url}`
						}
					])
				),
				binaryenTools: Object.fromEntries(
					Object.entries(manifest.binaryenTools).map(([name, descriptor]) => [
						name,
						{
							...descriptor,
							url: `https://static.example.com/absproxy/5173${descriptor.url}`
						}
					])
				)
			});
			expect(JSON.stringify(rewrittenManifest)).not.toContain('[object Object]');
			expect(JSON.stringify(rewrittenManifest)).not.toContain('object%20Object');
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('uses wasm-of-js-of-ocaml for diagnostics, completion, and hover', async () => {
		const compile = vi.fn(async () => ({
			success: false,
			diagnostics: [
				{
					file: 'src/main.ml',
					line: 2,
					column: 5,
					severity: 'error' as const,
					message:
						'This expression has type string but an expression was expected of type int'
				}
			],
			stderr: 'File "src/main.ml", line 2, characters 4-5:'
		}));
		const service = createOcamlWorkerService(async () => ({ compile }));
		const document: LspDocument = {
			uri: 'file:///workspace/src/main.ml',
			languageId: 'ocaml',
			version: 1,
			text: 'let value : int =\n    "hello"\n'
		};
		const context: LspDocumentContext = {
			documents: new Map([
				[document.uri, document],
				[
					'file:///workspace/src/helper.ml',
					{
						uri: 'file:///workspace/src/helper.ml',
						languageId: 'ocaml',
						version: 1,
						text: 'let helper = 1\n'
					}
				]
			]),
			publishDiagnostics: vi.fn(),
			reportProgress: vi.fn()
		};

		await service.initialize?.(
			{
				moduleUrl:
					'https://static.example.com/wasm-of-js-of-ocaml/browser-native/src/index.js',
				manifestUrl:
					'https://static.example.com/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
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

		expect(compile).toHaveBeenCalledWith({
			activePath: 'src/main.ml',
			workspaceFiles: [
				{ path: 'src/helper.ml', content: 'let helper = 1\n' },
				{ path: 'src/main.ml', content: document.text }
			],
			target: 'js',
			effectsMode: 'cps',
			wasmBinaryenMode: 'fast',
			packages: []
		});
		expect(diagnostics).toEqual([
			{
				range: {
					start: { line: 1, character: 4 },
					end: { line: 1, character: 5 }
				},
				severity: 1,
				source: 'ocaml',
				message:
					'This expression has type string but an expression was expected of type int'
			}
		]);
		expect(completions?.items.some((item) => item.label === 'let')).toBe(true);
		expect(hover?.contents.value).toContain('Binds a value or function');
		expect(context.reportProgress).toHaveBeenCalledWith('ocaml-diagnostics');
	});
});
