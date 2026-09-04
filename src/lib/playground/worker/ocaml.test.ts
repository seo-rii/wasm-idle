import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function manifestResponse(data = manifestBytes, url = manifestUrl) {
	return {
		async arrayBuffer() {
			return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
		},
		body: null,
		headers: new Headers({ 'content-length': String(data.byteLength) }),
		ok: true,
		status: 200,
		url
	};
}

async function createMockOcamlCompilerModule(source: string) {
	return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

let capturedManifestIndex = 0;

async function captureDispatcherManifest() {
	const captureKey = `__ocamlDispatcherManifest${capturedManifestIndex++}`;
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
			globalThis[${JSON.stringify(captureKey)}] = options.manifest;
			return {};
		}
	`);

	await import('./ocaml');
	await (globalThis as any).self.onmessage({
		data: { load: true, moduleUrl: compilerModuleUrl, manifestUrl }
	});
	await (globalThis as any).self.onmessage({
		data: {
			code: 'let () = ()',
			prepare: true,
			target: 'wasm'
		}
	});

	const capturedManifest = (globalThis as any)[captureKey];
	delete (globalThis as any)[captureKey];
	return capturedManifest;
}

describe('OCaml worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).fetch = vi.fn(async () => manifestResponse());
	});

	it('loads the manifest through the bounded no-store asset boundary', async () => {
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: { load: true, moduleUrl: compilerModuleUrl, manifestUrl }
		});

		expect((globalThis as any).fetch).toHaveBeenCalledWith(manifestUrl, {
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
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
		(globalThis as any).fetch = vi.fn(async () => ({
			body: { cancel: bodyCancel },
			headers: new Headers({ 'content-length': String(4 * 1024 * 1024 + 1) }),
			ok: true,
			status: 200,
			url: manifestUrl
		}));
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: { load: true, moduleUrl: compilerModuleUrl, manifestUrl }
		});

		expect(bodyCancel).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: `OCaml manifest exceeds the ${4 * 1024 * 1024} byte limit`
		});
	});

	it('reports invalid manifest JSON deterministically', async () => {
		const invalidJson = new TextEncoder().encode('{invalid');
		(globalThis as any).fetch = vi.fn(async () => manifestResponse(invalidJson));
		const compilerModuleUrl = await createMockOcamlCompilerModule(`
			export async function compile() { throw new Error('not used'); }
			export function createBrowserWorkerSystemDispatcher() { return {}; }
		`);

		await import('./ocaml');
		await (globalThis as any).self.onmessage({
			data: { load: true, moduleUrl: compilerModuleUrl, manifestUrl }
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
			data: {
				load: true,
				moduleUrl: compilerModuleUrl,
				manifestUrl:
					'https://example.test/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
			}
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
			data: {
				load: true,
				moduleUrl: compilerModuleUrl,
				manifestUrl:
					'https://example.test/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
			}
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
			data: {
				load: true,
				moduleUrl: compilerModuleUrl,
				manifestUrl:
					'https://example.test/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
			}
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
			data: {
				load: true,
				moduleUrl: compilerModuleUrl,
				manifestUrl:
					'https://example.test/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
			}
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
			data: { load: true, moduleUrl: compilerModuleUrl, manifestUrl }
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
			data: {
				load: true,
				moduleUrl: compilerModuleUrl,
				manifestUrl:
					'https://example.test/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
			}
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
			data: {
				load: true,
				moduleUrl: compilerModuleUrl,
				manifestUrl:
					'https://example.test/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
			}
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
			data: {
				load: true,
				moduleUrl: compilerModuleUrl,
				manifestUrl:
					'https://example.test/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
			}
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
