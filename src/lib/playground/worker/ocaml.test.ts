import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import { flushBufferedEof, flushQueuedStdin } from '$lib/playground/stdinBuffer';

const manifestUrl =
	'https://example.test/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json';
const bundleRoot = '/wasm-of-js-of-ocaml/browser-native-bundle';
const manifestAsset = (url: string, bytes: number, digestCharacter: string) => ({
	url,
	bytes,
	sha256: digestCharacter.repeat(64)
});
const manifest = {
	version: 1,
	generatedAt: '2026-04-10T00:00:00.000Z',
	switchPrefix: '/static/toolchain',
	findlibConf: manifestAsset(`${bundleRoot}/findlib.conf`, 181, '1'),
	tools: {
		ocamlc: manifestAsset(`${bundleRoot}/tools/ocamlc.byte.browser.js`, 2_328_856, '2'),
		js_of_ocaml: manifestAsset(`${bundleRoot}/tools/js_of_ocaml.bc.browser.js`, 4_783_689, '3'),
		wasm_of_ocaml: manifestAsset(
			`${bundleRoot}/tools/wasm_of_ocaml.bc.browser.js`,
			6_250_420,
			'4'
		)
	},
	binaryenTools: {
		wasm_opt: manifestAsset(`${bundleRoot}/tools/wasm-opt.browser.js`, 10_601_940, '5'),
		wasm_merge: manifestAsset(`${bundleRoot}/tools/wasm-merge.browser.js`, 9_560_005, '6'),
		wasm_metadce: manifestAsset(`${bundleRoot}/tools/wasm-metadce.browser.js`, 9_599_667, '7')
	},
	runtimePack: {
		format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-v1',
		asset: `${bundleRoot}/browser-native-runtime-pack.v1.bin.gz`,
		index: `${bundleRoot}/browser-native-runtime-pack.v1.index.json`,
		fileCount: 2,
		totalBytes: 30
	},
	ocamlLibFiles: [
		{
			path: '/static/toolchain/lib/ocaml/stdlib.cma',
			url: `${bundleRoot}/lib/ocaml/stdlib.cma`,
			size: 10
		}
	],
	packages: [
		{
			name: 'yojson',
			rootPath: '/static/toolchain/lib/yojson',
			requires: [],
			files: [
				{
					path: '/static/toolchain/lib/yojson/yojson.cma',
					url: `${bundleRoot}/lib/yojson/yojson.cma`,
					size: 20
				}
			]
		}
	]
};
const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
const receipt = (bytes: Uint8Array) => ({
	bytes: bytes.byteLength,
	sha256: createHash('sha256').update(bytes).digest('hex')
});
const compilerModules = new Map<
	string,
	{ bytes: Uint8Array; importUrl: string; moduleReceipt: ReturnType<typeof receipt> }
>();
const createdCompilerBlobs: Blob[] = [];
let pendingCompilerImportUrl = '';
let compilerModuleSequence = 0;

function manifestResponse(data: Uint8Array<ArrayBufferLike> = manifestBytes, url = manifestUrl) {
	return {
		async arrayBuffer() {
			return Uint8Array.from(data).buffer;
		},
		body: null,
		headers: new Headers({ 'content-length': String(data.byteLength) }),
		ok: true,
		status: 200,
		url
	};
}

async function createMockOcamlCompilerModule(source: string) {
	const bytes = new TextEncoder().encode(source);
	const moduleUrl = `https://example.test/ocaml-runtime-${++compilerModuleSequence}/index.js`;
	compilerModules.set(moduleUrl, {
		bytes,
		importUrl: `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`,
		moduleReceipt: receipt(bytes)
	});
	return moduleUrl;
}

function loadRequest(
	compilerModuleUrl: string,
	overrides: Partial<{
		manifestUrl: string;
		moduleReceipt: ReturnType<typeof receipt>;
		manifestReceipt: ReturnType<typeof receipt>;
		maxAssetBytes: number;
	}> = {}
) {
	const registered = compilerModules.get(compilerModuleUrl);
	if (!registered) throw new Error(`unregistered OCaml compiler module: ${compilerModuleUrl}`);
	return {
		load: true as const,
		moduleUrl: compilerModuleUrl,
		manifestUrl,
		moduleReceipt: registered.moduleReceipt,
		manifestReceipt: receipt(manifestBytes),
		...overrides
	};
}

function registeredCompilerResponse(url: string) {
	const registered = compilerModules.get(url);
	if (!registered) return undefined;
	pendingCompilerImportUrl = registered.importUrl;
	return manifestResponse(registered.bytes, url);
}

let capturedManifestIndex = 0;

async function captureDispatcherOptions(maxAssetBytes?: number) {
	const captureKey = `__ocamlDispatcherOptions${capturedManifestIndex++}`;
	const compilerModuleUrl = await createMockOcamlCompilerModule(`
		export async function compile() {
			return {
				success: true,
				stdout: '',
				stderr: '',
				diagnostics: [],
				artifacts: []
			};
		}

		export function createBrowserWorkerSystemDispatcher(options) {
			globalThis[${JSON.stringify(captureKey)}] = options;
			return {};
		}
	`);

	await import('./ocaml');
	await (globalThis as any).self.onmessage({
		data: loadRequest(compilerModuleUrl, { maxAssetBytes })
	});
	await (globalThis as any).self.onmessage({
		data: {
			code: 'let () = ()',
			prepare: true,
			target: 'wasm'
		}
	});

	const capturedOptions = (globalThis as any)[captureKey];
	delete (globalThis as any)[captureKey];
	return capturedOptions;
}

async function captureDispatcherManifest() {
	return (await captureDispatcherOptions()).manifest;
}

describe('OCaml worker', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
		compilerModules.clear();
		createdCompilerBlobs.length = 0;
		pendingCompilerImportUrl = '';
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const compilerResponse = registeredCompilerResponse(url);
			if (compilerResponse) return compilerResponse;
			if (url === manifestUrl) return manifestResponse();
			throw new Error(`unexpected OCaml runtime request: ${url}`);
		});
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			if (!(blob instanceof Blob)) throw new TypeError('expected an OCaml runtime Blob');
			if (blob.type === 'text/javascript') {
				createdCompilerBlobs.push(blob);
				return pendingCompilerImportUrl;
			}
			return `blob:ocaml-test-asset-${createdCompilerBlobs.length}`;
		});
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
	});

	it('loads the manifest through the bounded no-store asset boundary', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl)
		});

		expect((globalThis as any).fetch).toHaveBeenCalledWith(manifestUrl, {
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
	});

	it('fetches and verifies both outer assets before importing the module through a blob URL', async () => {
		const source = `
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`;
		const moduleBytes = new TextEncoder().encode(source);
		const moduleUrl = 'https://example.test/ocaml/index.js';
		const importedUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
		const blobs: Blob[] = [];
		(globalThis as any).fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url === moduleUrl) {
				return manifestResponse(moduleBytes, moduleUrl);
			}
			if (url === manifestUrl) return manifestResponse();
			throw new Error(`unexpected URL: ${url}`);
		});
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			if (!(blob instanceof Blob)) throw new TypeError('expected an OCaml runtime Blob');
			blobs.push(blob);
			return importedUrl;
		});
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				manifestUrl,
				moduleReceipt: receipt(moduleBytes),
				manifestReceipt: receipt(manifestBytes)
			}
		});

		expect((globalThis as any).fetch).toHaveBeenCalledWith(
			moduleUrl,
			expect.objectContaining({ credentials: 'omit', redirect: 'error' })
		);
		expect(blobs).toHaveLength(1);
		expect(await blobs[0].text()).toBe(source);
		expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
	});

	it('rejects a corrupted outer module before creating its blob URL', async () => {
		const moduleUrl = await createMockOcamlCompilerModule(`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`);
		const request = loadRequest(moduleUrl);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: {
				...request,
				moduleReceipt: { ...request.moduleReceipt, sha256: '0'.repeat(64) }
			}
		});

		expect(URL.createObjectURL).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringMatching(/OCaml.*SHA-256/iu)
		});
	});

	it('rejects a corrupted outer manifest before parsing it', async () => {
		const moduleUrl = await createMockOcamlCompilerModule(`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`);
		const request = loadRequest(moduleUrl);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: {
				...request,
				manifestReceipt: { ...request.manifestReceipt, sha256: '0'.repeat(64) }
			}
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringMatching(/OCaml.*SHA-256/iu)
		});
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({ load: true });
	});

	it('restores the verified module origin for relative imports and import.meta.url', async () => {
		const source = `
			export * from './dependency.js';
			export const sourceUrl = import.meta.url;
		`;
		const moduleUrl = await createMockOcamlCompilerModule(source);
		const registered = compilerModules.get(moduleUrl)!;
		registered.importUrl = `data:text/javascript;base64,${Buffer.from(
			`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`
		).toString('base64')}`;

		await import('./ocaml');
		await (globalThis as any).self.onmessage({ data: loadRequest(moduleUrl) });

		const verifiedSource = await createdCompilerBlobs[0].text();
		expect(verifiedSource).toContain(
			`export * from '${new URL('./dependency.js', moduleUrl).href}'`
		);
		expect(verifiedSource).toContain(`export const sourceUrl = ${JSON.stringify(moduleUrl)}`);
		expect(verifiedSource).not.toContain('import.meta.url');
	});

	it('passes rewritten descriptor URLs and unchanged receipts to the compiler dispatcher', async () => {
		const rewrittenManifest = await captureDispatcherManifest();
		const expectedUrl = (url: string) => new URL(url, manifestUrl).href;
		const descriptorEntries = [
			[rewrittenManifest.findlibConf, manifest.findlibConf],
			[rewrittenManifest.tools.ocamlc, manifest.tools.ocamlc],
			[rewrittenManifest.tools.js_of_ocaml, manifest.tools.js_of_ocaml],
			[rewrittenManifest.tools.wasm_of_ocaml, manifest.tools.wasm_of_ocaml],
			[rewrittenManifest.binaryenTools.wasm_opt, manifest.binaryenTools.wasm_opt],
			[rewrittenManifest.binaryenTools.wasm_merge, manifest.binaryenTools.wasm_merge],
			[rewrittenManifest.binaryenTools.wasm_metadce, manifest.binaryenTools.wasm_metadce]
		];

		for (const [rewrittenAsset, sourceAsset] of descriptorEntries) {
			expect(rewrittenAsset).toEqual({
				...sourceAsset,
				url: expectedUrl(sourceAsset.url)
			});
		}
	});

	it('keeps runtime pack and file URLs as strings without object coercion', async () => {
		const rewrittenManifest = await captureDispatcherManifest();
		const expectedUrl = (url: string) => new URL(url, manifestUrl).href;

		expect(rewrittenManifest.runtimePack).toMatchObject({
			asset: expectedUrl(manifest.runtimePack.asset),
			index: expectedUrl(manifest.runtimePack.index)
		});
		expect(rewrittenManifest.ocamlLibFiles[0].url).toBe(
			expectedUrl(manifest.ocamlLibFiles[0].url)
		);
		expect(rewrittenManifest.packages[0].files[0].url).toBe(
			expectedUrl(manifest.packages[0].files[0].url)
		);
		expect(JSON.stringify(rewrittenManifest)).not.toMatch(/\[object(?:%20| )Object\]/u);
	});

	it('rejects an oversized manifest declaration before reading its body', async () => {
		const bodyCancel = vi.fn(async () => undefined);
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`);
		(globalThis as any).fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const compilerResponse = registeredCompilerResponse(url);
			if (compilerResponse) return compilerResponse;
			return {
				body: { cancel: bodyCancel },
				headers: new Headers({ 'content-length': String(4 * 1024 * 1024 + 1) }),
				ok: true,
				status: 200,
				url: manifestUrl
			};
		});

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl)
		});

		expect(bodyCancel).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: `OCaml manifest exceeds the ${manifestBytes.byteLength} byte limit`
		});
	});

	it('rejects a manifest receipt above the caller limit before fetching it', async () => {
		const maxAssetBytes = manifestBytes.byteLength - 1;
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl, { maxAssetBytes })
		});

		expect((globalThis as any).fetch).not.toHaveBeenCalledWith(manifestUrl, expect.anything());
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: `OCaml manifest exceeds the ${maxAssetBytes} byte limit`
		});
	});

	it('rejects a manifest receipt above the caller asset limit before compilation', async () => {
		const maxAssetBytes = 10_000_000;
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl, { maxAssetBytes })
		});

		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({
			error: `OCaml runtime asset wasm_opt exceeds the ${maxAssetBytes} byte limit`
		});
	});

	it('passes the caller asset limit to the runtime-pack dispatcher', async () => {
		const maxAssetBytes = 16 * 1024 * 1024;
		const options = await captureDispatcherOptions(maxAssetBytes);

		expect(options.runtimeAssets).toEqual({
			limits: {
				maxAssetBytes,
				maxMetadataBytes: 4 * 1024 * 1024,
				maxEntryBytes: maxAssetBytes
			}
		});
	});

	it('reports invalid manifest JSON deterministically', async () => {
		const invalidJson = new TextEncoder().encode('{invalid');
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`);
		(globalThis as any).fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			return registeredCompilerResponse(url) ?? manifestResponse(invalidJson);
		});

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl, { manifestReceipt: receipt(invalidJson) })
		});

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'OCaml manifest is not valid JSON'
		});
	});

	it('reads stdin from the shared buffer while executing browser-native js_of_ocaml output', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() {
				return {
					success: true,
					stdout: '',
					stderr: '',
					diagnostics: [],
					artifacts: [
						{
							path: '/workspace/_build/main.js',
							kind: 'js',
							data: \`
								var mc=0,aha=0,ow=0;
								function cz(){throw new Error("stdin bridge missing")}
								function a4I(a){var d=a.length,c=new Uint8Array(d),b=0;for(;b<d;b++)c[b]=a.charCodeAt(b);return c}
								class Base{}
								class Device extends Base{constructor(a,b){super();this.flags=b}read(a,b,c,d){cz(d,mc,aha,ow)}}
								globalThis.__wasm_of_js_of_ocaml_runtime_promise=Promise.resolve().then(()=>{
									const device=new Device(0,{});
									const bytes=new Uint8Array(64);
									const length=device.read(bytes,0,64,false);
									console.log(new TextDecoder().decode(bytes.slice(0,length)));
								});
							\`
						}
					]
				};
			}

			export function createBrowserWorkerSystemDispatcher() {
				return {};
			}
		`);
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				if (!flushQueuedStdin(queuedInput, buffer)) {
					flushBufferedEof(buffer);
				}
			}
		});

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl)
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = print_endline (read_line ())',
				prepare: false,
				target: 'js',
				buffer
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('treats empty explicit stdin as EOF without requesting the shared buffer', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() {
				return {
					success: true,
					stdout: '',
					stderr: '',
					diagnostics: [],
					artifacts: [
						{
							path: '/workspace/_build/main.js',
							kind: 'js',
							data: \`
								var mc=0,aha=0,ow=0;
								function cz(){throw new Error("stdin bridge missing")}
								function a4I(a){var d=a.length,c=new Uint8Array(d),b=0;for(;b<d;b++)c[b]=a.charCodeAt(b);return c}
								class Base{}
								class Device extends Base{constructor(a,b){super();this.flags=b}read(a,b,c,d){cz(d,mc,aha,ow)}}
								globalThis.__wasm_of_js_of_ocaml_runtime_promise=Promise.resolve().then(()=>{
									const device=new Device(0,{});
									const bytes=new Uint8Array(64);
									const length=device.read(bytes,0,64,false);
									if(length!==0)throw new Error('expected explicit EOF');
									console.log('explicit eof');
								});
							\`
						}
					]
				};
			}

			export function createBrowserWorkerSystemDispatcher() {
				return {};
			}
		`);
		const buffer = new SharedArrayBuffer(1024);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl)
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = ignore (read_line ())',
				prepare: false,
				target: 'js',
				buffer,
				stdin: ''
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'explicit eof\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('does not replay cached wasm compile stderr on the execution pass', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			let compileCount = 0;

			export async function compile() {
				compileCount += 1;
				return {
					success: true,
					stdout: '',
					stderr: 'binaryen bridge exit: 0\\n',
					diagnostics: [],
					artifacts: [
						{
							path: '/workspace/_build/main.js',
							kind: 'js',
							data: \`
								globalThis.__wasm_of_js_of_ocaml_runtime_promise=Promise.resolve().then(()=>{
									console.log('wasm runtime ok');
								});
							\`
						}
					]
				};
			}

			export function createBrowserWorkerSystemDispatcher() {
				return {};
			}
		`);

		const postMessage = vi.fn();
		(globalThis as any).postMessage = postMessage;

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl)
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = print_endline "ok"',
				prepare: true,
				target: 'wasm'
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = print_endline "ok"',
				prepare: false,
				target: 'wasm'
			}
		});
		await Promise.resolve();

		expect(
			postMessage.mock.calls.filter(
				([message]) => message?.output === 'binaryen bridge exit: 0\n'
			)
		).toHaveLength(1);
		expect(postMessage).toHaveBeenCalledWith({ output: 'wasm runtime ok\n' });
		expect(postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('forwards wasm Binaryen mode and includes it in the compile cache key', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			globalThis.__ocamlCompileRequests = [];

			export async function compile(request) {
				globalThis.__ocamlCompileRequests.push(request);
				return {
					success: true,
					stdout: '',
					stderr: '',
					diagnostics: [],
					artifacts: [
						{
							path: '/workspace/_build/main.js',
							kind: 'js',
							data: \`
								globalThis.__wasm_of_js_of_ocaml_runtime_promise=Promise.resolve();
							\`
						}
					]
				};
			}

			export function createBrowserWorkerSystemDispatcher() {
				return {};
			}
		`);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl)
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = print_endline "ok"',
				prepare: true,
				target: 'wasm'
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = print_endline "ok"',
				prepare: true,
				target: 'wasm',
				wasmBinaryenMode: 'full'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).__ocamlCompileRequests).toEqual([
			expect.objectContaining({
				target: 'wasm',
				wasmBinaryenMode: 'fast'
			}),
			expect.objectContaining({
				target: 'wasm',
				wasmBinaryenMode: 'full'
			})
		]);
	});

	it('forwards the OCaml workspace and invalidates the cache when a file changes', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			globalThis.__ocamlWorkspaceCompileRequests = [];

			export async function compile(request) {
				globalThis.__ocamlWorkspaceCompileRequests.push(request);
				return {
					success: true,
					stdout: '',
					stderr: '',
					diagnostics: [],
					artifacts: [
						{
							path: '/workspace/_build/main.js',
							kind: 'js',
							data: \`globalThis.__wasm_of_js_of_ocaml_runtime_promise=Promise.resolve();\`
						}
					]
				};
			}

			export function createBrowserWorkerSystemDispatcher() {
				return {};
			}
		`);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl)
		});
		const runRequest = {
			code: 'let () = Helper.print_message ()',
			prepare: true,
			target: 'wasm',
			activePath: 'src/main.ml',
			workspaceFiles: [
				{ path: 'src/helper.ml', content: 'let print_message () = print_endline "one"' }
			]
		};

		await (globalThis as any).self.onmessage({ data: runRequest });
		await (globalThis as any).self.onmessage({ data: runRequest });
		await (globalThis as any).self.onmessage({
			data: {
				...runRequest,
				workspaceFiles: [
					{
						path: 'src/helper.ml',
						content: 'let print_message () = print_endline "two"'
					}
				]
			}
		});

		expect((globalThis as any).__ocamlWorkspaceCompileRequests).toEqual([
			expect.objectContaining({
				entry: 'src/main.ml',
				files: {
					'src/helper.ml': 'let print_message () = print_endline "one"',
					'src/main.ml': 'let () = Helper.print_message ()'
				}
			}),
			expect.objectContaining({
				entry: 'src/main.ml',
				files: {
					'src/helper.ml': 'let print_message () = print_endline "two"',
					'src/main.ml': 'let () = Helper.print_message ()'
				}
			})
		]);
	});

	it('bridges wasm_of_ocaml Node-style fs.readSync stdin reads', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() {
				return {
					success: true,
					stdout: '',
					stderr: '',
					diagnostics: [],
					artifacts: [
						{
							path: '/workspace/_build/main.js',
							kind: 'js',
							data: \`
								globalThis.__wasm_of_js_of_ocaml_runtime_promise=Promise.resolve().then(()=>{
									const fs=globalThis.require('fs');
									const bytes=new Uint8Array(64);
									const length=fs.readSync(0,bytes,0,64,null);
									const secondLength=fs.readSync(0,bytes,0,64,null);
									if(secondLength!==0)throw new Error('expected repeated empty stdin read to return EOF');
									console.log(new TextDecoder().decode(bytes.slice(0,length)));
								});
							\`
						}
					]
				};
			}

			export function createBrowserWorkerSystemDispatcher() {
				return {};
			}
		`);
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['7\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				if (!flushQueuedStdin(queuedInput, buffer)) {
					flushBufferedEof(buffer);
				}
			}
		});

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl)
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = print_endline (read_line ())',
				prepare: false,
				target: 'wasm',
				buffer
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '7\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });

		(globalThis as any).postMessage.mockClear();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = print_endline (read_line ())',
				prepare: false,
				target: 'wasm',
				buffer,
				stdin: '9\n'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '9\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('rewrites local generated fs.readSync stdin reads to the browser shim', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() {
				return {
					success: true,
					stdout: '',
					stderr: '',
					diagnostics: [],
					artifacts: [
						{
							path: '/workspace/_build/main.js',
							kind: 'js',
							data: \`
								globalThis.__wasm_of_js_of_ocaml_runtime_promise=Promise.resolve().then(()=>{
									const fs=undefined;
									const bytes=new Uint8Array(64);
									const length=fs.readSync(0,bytes,0,64,null);
									console.log(new TextDecoder().decode(bytes.slice(0,length)));
								});
							\`
						}
					]
				};
			}

			export function createBrowserWorkerSystemDispatcher() {
				return {};
			}
		`);
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['8\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl)
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = print_endline (read_line ())',
				prepare: false,
				target: 'wasm',
				buffer
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '8\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('rewrites minified generated read adapters to the browser fs shim', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() {
				return {
					success: true,
					stdout: '',
					stderr: '',
					diagnostics: [],
					artifacts: [
						{
							path: '/workspace/_build/main.js',
							kind: 'js',
							data: \`
								globalThis.__wasm_of_js_of_ocaml_runtime_promise=Promise.resolve().then(()=>{
									const f=undefined;
									const adapter={read:(a,b,c,d,e)=>f.readSync(a,b,c,d,e)};
									const bytes=new Uint8Array(64);
									const length=adapter.read(0,bytes,0,64,null);
									console.log(new TextDecoder().decode(bytes.slice(0,length)));
								});
							\`
						}
					]
				};
			}

			export function createBrowserWorkerSystemDispatcher() {
				return {};
			}
		`);
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['9\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: loadRequest(compilerModuleUrl)
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'let () = print_endline (read_line ())',
				prepare: false,
				target: 'wasm',
				buffer
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '9\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});
});
