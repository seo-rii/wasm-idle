// @vitest-environment node

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from 'vitest';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_ASSET_CACHE === '1';
const receipt = (bytes: Uint8Array) => ({
	bytes: bytes.length,
	sha256: createHash('sha256').update(bytes).digest('hex')
});
// The real native-tool worker requires the producer's mount patch marker.
const tool = Buffer.from(
	'function Mount(a){this.content={};this.root=a;} print("nested compiler fixture");'
);
const runtimePath = '/static/toolchain/lib/ocaml/fixture.cmi';
const payload = Buffer.from('runtime-pack-fixture');
const compressed = gzipSync(payload);
const index = Buffer.from(
	JSON.stringify({
		format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-index-v1',
		fileCount: 1,
		totalBytes: payload.length,
		entries: [{ runtimePath, offset: 0, length: payload.length }]
	})
);

describe.skipIf(!enabled)('OCaml nested worker persistent downloads in Chromium', () => {
	let browser: Browser;
	let server: Server;
	let origin: string;
	let context: BrowserContext;
	let page: Page;
	const requests = new Map<string, number>();
	let rejectPayloads = false;
	const bodies = new Map([
		['/tool-fixture.js', tool],
		['/pack.index.json', index],
		['/pack.bin.gz', compressed],
		['/custom-preload.txt', Buffer.from('unpinned custom preload')]
	]);

	beforeAll(async () => {
		const producerRoot = './runtimes/wasm-of-js-of-ocaml';
		const [owner, nested] = await Promise.all([
			build({
				stdin: {
					contents: `
					import { createRuntimeAssetCacheBackend, configureRuntimeAssetCache, getRuntimeAssetCacheStats } from './packages/core/src/persistent-asset-cache.ts';
					import { loadBrowserNativeRuntimePack, runBrowserNativeTool } from '${producerRoot}/runtime/system-dispatch-browser-worker.ts';
					self.onmessage = async ({data}) => {
						try {
							configureRuntimeAssetCache(false);
							const persistentCache = data.enabled ? createRuntimeAssetCacheBackend({enabled:true,storageReserveBytes:0,namespace:'ocaml-nested',version:data.version}) : undefined;
							const loaded = await loadBrowserNativeRuntimePack(data.manifest, {persistentCache});
							const result = await runBrowserNativeTool({tool:data.tool,argv:[],env:{},outputPrefixes:[],preloadFiles:data.preloadFiles,persistentCache});
							self.postMessage({result,pack:Array.from(loaded.bytes),stats:await getRuntimeAssetCacheStats({enabled:true,storageReserveBytes:0,namespace:'ocaml-nested',version:data.version})});
						} catch (error) { self.postMessage({error:String(error)}); }
					};`,
					resolveDir: process.cwd()
				},
				bundle: true,
				platform: 'browser',
				format: 'esm',
				write: false
			}),
			build({
				entryPoints: [resolve(`${producerRoot}/browser-harness/native-tool-worker.ts`)],
				bundle: true,
				platform: 'browser',
				format: 'esm',
				write: false
			})
		]);
		server = createServer((request, response) => {
			const path = new URL(request.url || '/', 'http://fixture.test').pathname;
			response.setHeader('Cache-Control', 'no-store');
			if (path === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end('<!doctype html><title>OCaml cache fixture</title>');
			} else if (
				path === '/owner-worker.js' ||
				path === '/browser-harness/native-tool-worker.js'
			) {
				response.setHeader('Content-Type', 'text/javascript');
				response.end((path === '/owner-worker.js' ? owner : nested).outputFiles[0].text);
			} else if (bodies.has(path)) {
				requests.set(path, (requests.get(path) ?? 0) + 1);
				if (rejectPayloads) {
					response.statusCode = 503;
					response.end();
				} else {
					response.setHeader('Content-Type', 'application/octet-stream');
					response.end(bodies.get(path));
				}
			} else {
				response.statusCode = 404;
				response.end();
			}
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
		origin = `http://127.0.0.1:${address.port}`;
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
	}, 30_000);

	beforeEach(async () => {
		requests.clear();
		rejectPayloads = false;
		context = await browser.newContext();
		page = await context.newPage();
		await page.goto(origin);
	});
	afterEach(async () => {
		await context?.close();
	});
	afterAll(async () => {
		await browser?.close();
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	async function run(
		options: { enabled?: boolean; version?: string; customPreload?: boolean } = {}
	) {
		const asset = { url: `${origin}/tool-fixture.js`, ...receipt(tool) };
		return page.evaluate(
			async (data) => {
				const worker = new Worker('/owner-worker.js', { type: 'module' });
				try {
					return await new Promise<any>((resolve, reject) => {
						worker.onmessage = ({ data }) =>
							data.error ? reject(new Error(data.error)) : resolve(data);
						worker.onerror = (event) => reject(new Error(event.message));
						worker.postMessage(data);
					});
				} finally {
					worker.terminate();
				}
			},
			{
				enabled: options.enabled ?? true,
				version: options.version ?? '1.0.0',
				tool: asset,
				preloadFiles: options.customPreload
					? [{ path: '/custom.txt', url: `${origin}/custom-preload.txt` }]
					: [],
				manifest: {
					version: 1,
					generatedAt: 'fixture',
					switchPrefix: '/switch',
					findlibConf: asset,
					tools: { ocamlc: asset, js_of_ocaml: asset, wasm_of_ocaml: asset },
					packages: [],
					ocamlLibFiles: [{ path: runtimePath, size: payload.length }],
					runtimePack: {
						format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-v1',
						asset: `${origin}/pack.bin.gz`,
						index: `${origin}/pack.index.json`,
						indexBytes: index.length,
						indexSha256: receipt(index).sha256,
						compressedBytes: compressed.length,
						compressedSha256: receipt(compressed).sha256,
						fileCount: 1,
						totalBytes: payload.length,
						uncompressedSha256: receipt(payload).sha256
					}
				}
			}
		);
	}

	it('reuses pack and compiler bytes after both worker levels and the page are recreated', async () => {
		const first = await run();
		expect(first.result, first.result.thrown).toMatchObject({
			exitCode: 0,
			stdout: 'nested compiler fixture'
		});
		expect(first.pack).toEqual([...payload]);
		expect(first.stats.entries).toBe(3);
		await page.reload();
		rejectPayloads = true;
		const warm = await run();
		expect(warm.result).toMatchObject({ exitCode: 0, stdout: 'nested compiler fixture' });
		expect(Object.fromEntries(requests)).toEqual({
			'/pack.index.json': 1,
			'/pack.bin.gz': 1,
			'/tool-fixture.js': 1
		});
	});

	it('disabled calls do not read or write storage and an explicit enable restores it', async () => {
		for (let attempt = 0; attempt < 2; attempt++) {
			const result = await run({ enabled: false });
			expect(result.result.exitCode).toBe(0);
			expect(result.stats.entries).toBe(0);
		}
		await run();
		await run({ enabled: false });
		await run();
		expect(Object.fromEntries(requests)).toEqual({
			'/pack.index.json': 4,
			'/pack.bin.gz': 4,
			'/tool-fixture.js': 4
		});
	});

	it('unpinned custom preloads bypass persistence while receipt-pinned tools still reuse', async () => {
		await run({ customPreload: true });
		const result = await run({ customPreload: true });
		expect(result.result.exitCode).toBe(0);
		expect(result.stats.entries).toBe(3);
		expect(requests.get('/custom-preload.txt')).toBe(2);
		expect(requests.get('/tool-fixture.js')).toBe(1);
	});
});
