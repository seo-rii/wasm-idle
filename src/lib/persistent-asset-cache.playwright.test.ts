// @vitest-environment node

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';
import type {
	RuntimeAssetCacheOptions,
	RuntimePersistentAssetIdentity
} from '../../packages/core/src/persistent-asset-cache';
import {
	RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
	type RuntimeRegistryManifest
} from '../../packages/core/src/runtime-manifest';

declare global {
	interface Window {
		persistentAssetCache: typeof import('../../packages/core/src/persistent-asset-cache');
		pinnedAssetFetch: typeof import('../../packages/core/src/pinned-asset-fetch');
		preflightRuntimeAssets: typeof import('../../packages/core/src/runtime-preflight').preflightRuntimeAssets;
		compileVerifiedWasmAsset: typeof import('../../packages/llvm-core/runtime/core/src/verified-wasm').compileVerifiedWasmAsset;
		StaticWorkerRuntimeSandbox: typeof import('./playground/staticWorkerRuntime').StaticWorkerRuntimeSandbox;
	}
}

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_ASSET_CACHE === '1';
const wasmBytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const payloads = new Map([
	['/asset-a', Buffer.from('compiler-a-fixture')],
	['/asset-b', Buffer.from('compiler-b-fixture')],
	['/module.wasm.gz', gzipSync(wasmBytes)],
	['/preflight/compiler.bin', Buffer.from('preflight-compiler-fixture')],
	[
		'/runner-worker.js',
		Buffer.from(
			'self.onmessage = ({data}) => self.postMessage({runId: data.runId, results: true});'
		)
	]
]);

describe.skipIf(!enabled)('persistent runtime assets in real Chromium', () => {
	let browser: Browser;
	let server: Server;
	let origin: string;
	let context: BrowserContext;
	let page: Page;
	const requests = new Map<string, number>();

	beforeAll(async () => {
		const bundled = await build({
			stdin: {
				contents: `
					import * as cache from './packages/core/src/persistent-asset-cache.ts';
					import * as pinnedAssetFetch from './packages/core/src/pinned-asset-fetch.ts';
					import { preflightRuntimeAssets } from './packages/core/src/runtime-preflight.ts';
					import { compileVerifiedWasmAsset } from './packages/llvm-core/runtime/core/src/verified-wasm.ts';
					import { StaticWorkerRuntimeSandbox } from './src/lib/playground/staticWorkerRuntime.ts';
					Object.assign(window, {persistentAssetCache: cache, pinnedAssetFetch, preflightRuntimeAssets, compileVerifiedWasmAsset, StaticWorkerRuntimeSandbox});`,
				resolveDir: process.cwd()
			},
			bundle: true,
			alias: {
				'@wasm-idle/core': resolve('packages/core/src/index.ts'),
				$lib: resolve('src/lib')
			},
			platform: 'browser',
			format: 'iife',
			write: false
		});
		const script = bundled.outputFiles[0].text;
		server = createServer((request, response) => {
			const pathname = new URL(request.url || '/', 'http://fixture.test').pathname;
			response.setHeader('Cache-Control', 'no-store');
			if (pathname === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end('<!doctype html><script src="/harness.js"></script>');
			} else if (pathname === '/harness.js') {
				response.setHeader('Content-Type', 'text/javascript');
				response.end(script);
			} else if (payloads.has(pathname)) {
				requests.set(pathname, (requests.get(pathname) ?? 0) + 1);
				response.setHeader('Content-Type', 'application/octet-stream');
				response.end(payloads.get(pathname));
			} else {
				response.statusCode = 404;
				response.end();
			}
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('Fixture server failed to listen');
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

	function identity(asset = '/asset-a', version = '1.0.0'): RuntimePersistentAssetIdentity {
		const bytes = payloads.get(asset)!;
		return {
			url: `${origin}${asset}`,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			bytes: bytes.byteLength,
			version
		};
	}

	async function load(target = page, asset = identity(), cache?: RuntimeAssetCacheOptions) {
		return await target.evaluate(
			async ({ asset, cache }) => {
				const bytes = await window.persistentAssetCache.loadPersistentRuntimeAsset({
					identity: asset,
					cache,
					load: async () =>
						new Uint8Array(
							await (await fetch(asset.url, { cache: 'no-store' })).arrayBuffer()
						)
				});
				return new TextDecoder().decode(bytes);
			},
			{ asset, cache }
		);
	}

	it('reuses verified bytes after page reload and with network disabled', async () => {
		expect(await load()).toBe('compiler-a-fixture');
		expect(requests.get('/asset-a')).toBe(1);
		await page.reload();
		await context.setOffline(true);
		expect(await load()).toBe('compiler-a-fixture');
		expect(requests.get('/asset-a')).toBe(1);
		const stats = await page.evaluate(() =>
			window.persistentAssetCache.getRuntimeAssetCacheStats()
		);
		expect(stats).toMatchObject({
			available: true,
			entries: 1,
			bytes: payloads.get('/asset-a')!.length
		});
	});

	it('preflights pinned registry assets offline after reload without reusing weaker URL-policy provenance', async () => {
		const asset = identity('/preflight/compiler.bin');
		const manifest: RuntimeRegistryManifest = {
			schemaVersion: RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
			manifestId: 'wasm-idle/persistent-preflight-fixture',
			revision: 'fixture-v1',
			runtimes: [
				{
					runtimeId: 'fortran/cache-fixture',
					identity: {
						languageId: 'FORTRAN',
						implementationId: 'cache-fixture',
						implementationVersion: '1.0.0',
						profile: {
							profileId: 'cache-fixture-v1',
							manifestSchemaVersion: 1,
							manifestSha256: 'a'.repeat(64),
							protocolVersion: 1,
							trustProfileId: 'restricted-browser-worker-v1',
							trustProfileSchemaVersion: 1
						}
					},
					capabilities: {
						stdin: 'prebuffered',
						workspace: false,
						abort: true,
						artifacts: false,
						streamingOutput: true
					},
					workerLifetime: { mode: 'per-run' },
					requiredBrowserFeatures: ['wasm'],
					assetRoot: 'preflight',
					assets: [
						{
							key: 'compiler',
							path: 'compiler.bin',
							compressedSha256: asset.sha256,
							uncompressedSha256: asset.sha256,
							compressedBytes: asset.bytes!,
							uncompressedBytes: asset.bytes!,
							mediaType: 'application/octet-stream',
							encoding: 'identity'
						}
					],
					contracts: {
						routeId: 'fortran',
						runtimeAssetKey: 'fortran',
						documentationId: 'FORTRAN'
					}
				}
			]
		};
		const preflight = (requireExactResponseUrl: boolean) =>
			page.evaluate(
				async ({ manifest, origin, requireExactResponseUrl }) => {
					try {
						const result = await window.preflightRuntimeAssets({
							manifest,
							rootUrl: `${origin}/`,
							runtimeId: 'fortran/cache-fixture',
							cache: 'no-store',
							requireExactResponseUrl,
							persistentCache: {
								namespace: 'preflight-fixture',
								version: 'fixture-v1'
							},
							limits: { assetTimeoutMs: 2000 }
						});
						const loaded = result.assets.compiler!;
						return {
							ok: true,
							url: loaded.url,
							text: new TextDecoder().decode(loaded.bytes),
							sha256: loaded.deliveryIntegrity.sha256,
							runtimeSha256: loaded.runtimeIntegrity?.sha256
						};
					} catch (error) {
						return {
							ok: false,
							error: error instanceof Error ? error.message : String(error)
						};
					}
				},
				{ manifest, origin, requireExactResponseUrl }
			);

		const cold = await preflight(false);
		expect(cold).toEqual({
			ok: true,
			url: asset.url,
			text: 'preflight-compiler-fixture',
			sha256: asset.sha256,
			runtimeSha256: asset.sha256
		});
		expect(requests.get('/preflight/compiler.bin')).toBe(1);
		await page.reload();
		await context.setOffline(true);
		expect(await preflight(false)).toEqual(cold);
		// A native successful response admitted under the weaker policy is not proof that
		// the stricter policy was checked. That miss must fail offline, not silently hit.
		expect(await preflight(true)).toMatchObject({
			ok: false,
			error: expect.stringMatching(/fetch|load/i)
		});
		expect(requests.get('/preflight/compiler.bin')).toBe(1);
		await context.setOffline(false);
		expect(await preflight(true)).toEqual(cold);
		expect(requests.get('/preflight/compiler.bin')).toBe(2);
		await page.reload();
		await context.setOffline(true);
		expect(await preflight(true)).toEqual(cold);
		expect(requests.get('/preflight/compiler.bin')).toBe(2);
		expect(
			await page.evaluate(() =>
				window.persistentAssetCache.getRuntimeAssetCacheStats({
					namespace: 'preflight-fixture'
				})
			)
		).toMatchObject({
			available: true,
			entries: 1,
			bytes: asset.bytes,
			versions: ['fixture-v1']
		});
	});

	it('compiles a receipt-verified gzip Wasm again offline without downloading or storing decoded bytes', async () => {
		const asset = identity('/module.wasm.gz');
		const receipt = {
			bytes: asset.bytes!,
			sha256: asset.sha256,
			uncompressedBytes: wasmBytes.byteLength,
			uncompressedSha256: createHash('sha256').update(wasmBytes).digest('hex')
		};
		const compile = () =>
			page.evaluate(
				async ({ url, receipt }) => {
					const module = await window.compileVerifiedWasmAsset(url, receipt, {
						fetch: globalThis.fetch.bind(globalThis),
						maxAssetBytes: 1024
					});
					return new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
				},
				{ url: asset.url, receipt }
			);
		expect(await compile()).toBe(true);
		await page.reload();
		await context.setOffline(true);
		expect(await compile()).toBe(true);
		expect(requests.get('/module.wasm.gz')).toBe(1);
		const stats = await page.evaluate(() =>
			window.persistentAssetCache.getRuntimeAssetCacheStats()
		);
		expect(stats).toMatchObject({ entries: 1, bytes: asset.bytes });
	});

	it('starts an inline receipt-verified runtime worker from disk after reload while offline', async () => {
		const asset = identity('/runner-worker.js');
		const run = () =>
			page.evaluate(async (asset) => {
				const sandbox = new window.StaticWorkerRuntimeSandbox({
					languageId: 'CACHE_FIXTURE',
					displayName: 'Cache fixture',
					defaultActivePath: 'main.txt',
					inlineVerifiedWorker: true,
					requireExactWorkerResponseUrl: true,
					stdin: { mode: 'none' },
					resolveRuntimeAssets: () => ({
						baseUrl: new URL('.', asset.url).href,
						workerUrl: asset.url,
						workerReceipt: { bytes: asset.bytes!, sha256: asset.sha256 }
					})
				});
				try {
					await sandbox.load();
					return await sandbox.run('fixture', false, true);
				} finally {
					await sandbox.dispose();
				}
			}, asset);
		expect(await run()).toBe(true);
		await page.reload();
		await context.setOffline(true);
		expect(await run()).toBe(true);
		expect(requests.get('/runner-worker.js')).toBe(1);
	});

	it('honors global disabling and function-level opt-in or opt-out', async () => {
		await page.evaluate(() => window.persistentAssetCache.configureRuntimeAssetCache(false));
		await load();
		await load();
		expect(requests.get('/asset-a')).toBe(2);
		await load(page, identity(), { enabled: true });
		await load(page, identity(), { enabled: true });
		expect(requests.get('/asset-a')).toBe(3);
		await load(page, identity(), false);
		expect(requests.get('/asset-a')).toBe(4);
	});

	it('public pinned fetch binds native fetch and accepts decoded MIME on raw gzip receipts', async () => {
		const asset = identity('/module.wasm.gz');
		const receipt = {
			sha256: asset.sha256,
			bytes: asset.bytes!,
			mediaType: 'application/wasm',
			uncompressedSha256: createHash('sha256').update(wasmBytes).digest('hex'),
			uncompressedBytes: wasmBytes.byteLength
		};
		const received = await page.evaluate(
			async ({ url, receipt }) => {
				return (
					await window.pinnedAssetFetch.fetchPinnedRuntimeAsset({
						url,
						receipt,
						fetch: globalThis.fetch
					})
				).byteLength;
			},
			{ url: asset.url, receipt }
		);
		expect(received).toBe(asset.bytes);
		expect(requests.get('/module.wasm.gz')).toBe(1);
	});

	it('public prefetch reports a verified download without claiming a failed quota write was stored', async () => {
		const first = identity('/asset-a');
		const second = identity('/asset-b');
		const prefetch = (asset: RuntimePersistentAssetIdentity) =>
			page.evaluate(async (asset) => {
				return await window.pinnedAssetFetch.prefetchRuntimeAssets({
					assets: [
						{ url: asset.url, receipt: { sha256: asset.sha256, bytes: asset.bytes } }
					]
				});
			}, asset);
		expect(await prefetch(first)).toEqual({ completed: 1, stored: 1, skipped: false });
		expect(await prefetch(first)).toEqual({ completed: 1, stored: 1, skipped: false });
		expect(requests.get('/asset-a')).toBe(1);
		await page.evaluate(() => {
			Cache.prototype.put = async () => {
				throw new DOMException('fixture quota exhausted', 'QuotaExceededError');
			};
		});
		expect(await prefetch(second)).toEqual({ completed: 1, stored: 0, skipped: false });
		expect(requests.get('/asset-b')).toBe(1);
	});

	it('shares content across versions and tabs without version cleanup deleting live references', async () => {
		const other = await context.newPage();
		await other.goto(origin);
		await load(page, identity('/asset-a', '1.0.0'));
		await load(other, { ...identity('/asset-a', '1.0.1'), url: `${origin}/asset-a?v=1.0.1` });
		expect(requests.get('/asset-a')).toBe(1);
		await page.evaluate(() =>
			window.persistentAssetCache.clearRuntimeAssetCache({ version: '1.0.0' })
		);
		await context.setOffline(true);
		expect(await load(other, identity('/asset-a', '1.0.1'))).toBe('compiler-a-fixture');
		const stats = await other.evaluate(() =>
			window.persistentAssetCache.getRuntimeAssetCacheStats()
		);
		expect(stats).toMatchObject({ entries: 1, versions: ['1.0.1'] });
	});

	it('enforces a byte/entry budget and redownloads evicted entries', async () => {
		const cache = {
			maxBytes: payloads.get('/asset-a')!.length,
			maxEntries: 1,
			storageReserveBytes: 0
		};
		await load(page, identity('/asset-a'), cache);
		await load(page, identity('/asset-b'), cache);
		const stats = await page.evaluate(
			(cache) => window.persistentAssetCache.getRuntimeAssetCacheStats(cache),
			cache
		);
		expect(stats.entries).toBe(1);
		expect(stats.bytes).toBeLessThanOrEqual(cache.maxBytes);
		await load(page, identity('/asset-a'), cache);
		expect(requests.get('/asset-a')).toBe(2);
	});

	it('continues downloading successfully when the browser rejects storage writes', async () => {
		await page.evaluate(() => {
			Cache.prototype.put = async () => {
				throw new DOMException('fixture quota exhausted', 'QuotaExceededError');
			};
		});
		expect(await load()).toBe('compiler-a-fixture');
		expect(await load()).toBe('compiler-a-fixture');
		expect(requests.get('/asset-a')).toBe(2);
		const stats = await page.evaluate(() =>
			window.persistentAssetCache.getRuntimeAssetCacheStats()
		);
		expect(stats.entries).toBe(0);
	});

	it('discards corrupt local payloads instead of executing them', async () => {
		await load();
		await page.evaluate(async () => {
			for (const name of await caches.keys()) {
				const cache = await caches.open(name);
				for (const key of await cache.keys()) await cache.put(key, new Response('corrupt'));
			}
		});
		expect(await load()).toBe('compiler-a-fixture');
		expect(requests.get('/asset-a')).toBe(2);
	});
});
