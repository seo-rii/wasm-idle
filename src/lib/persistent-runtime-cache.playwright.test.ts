// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import {
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';
import { withWallClockTimeout } from '../../scripts/stdin-browser-probe-lib.mjs';
import { RUST_NON_DEBUG_RESOURCE_REQUIREMENTS } from './playground/rustWorkerLimits';

type Language = 'RUST' | 'OCAML';
type Receipt = { bytes: number; sha256: string };
type ExpectedAsset = { path: string; representations: Receipt[] };

declare global {
	interface Window {
		__realRuntimeCacheSandbox: import('./playground/sandbox').Sandbox;
		__realRuntimeCacheAssets: import('./playground/assets').PlaygroundRuntimeAssets;
		__realRuntimeCacheImportError?: string;
	}
}

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_RUNTIME_CACHE === '1';
const runTimeoutMs = 300_000;

async function expectedAssets(language: Language): Promise<ExpectedAsset[]> {
	if (language === 'RUST') {
		const manifest = JSON.parse(
			await readFile('static/wasm-rust/runtime/runtime-manifest.v3.json', 'utf8')
		) as {
			assetReceipts: Record<
				string,
				Receipt & { uncompressedBytes: number; uncompressedSha256: string }
			>;
		};
		return [
			'wasm-rust/runtime/rustc/rustc.wasm.gz',
			'wasm-rust/runtime/packs/sysroot/wasm32-wasip1.pack.gz'
		].map((path) => {
			const receipt = manifest.assetReceipts[path];
			return {
				path,
				representations: [
					{ bytes: receipt.bytes, sha256: receipt.sha256 },
					{ bytes: receipt.uncompressedBytes, sha256: receipt.uncompressedSha256 }
				]
			};
		});
	}
	const manifest = JSON.parse(
		await readFile(
			'static/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json',
			'utf8'
		)
	) as {
		runtimePack: {
			asset: string;
			compressedBytes: number;
			compressedSha256: string;
			totalBytes: number;
			uncompressedSha256: string;
		};
		tools: Record<'ocamlc' | 'wasm_of_ocaml', Receipt & { url: string }>;
		binaryenTools: { wasm_merge: Receipt & { url: string } };
	};
	return [
		{
			path: manifest.runtimePack.asset.replace(/^\//u, ''),
			representations: [
				{
					bytes: manifest.runtimePack.compressedBytes,
					sha256: manifest.runtimePack.compressedSha256
				},
				{
					bytes: manifest.runtimePack.totalBytes,
					sha256: manifest.runtimePack.uncompressedSha256
				}
			]
		},
		...[
			manifest.tools.ocamlc,
			manifest.tools.wasm_of_ocaml,
			manifest.binaryenTools.wasm_merge
		].map((asset) => ({
			path: asset.url.replace(/^\//u, ''),
			representations: [{ bytes: asset.bytes, sha256: asset.sha256 }]
		}))
	];
}

async function executeRealRuntime(
	page: Page,
	language: Language,
	baseUrl: string,
	namespace: string
) {
	const sourceUrl = new URL('src/lib/playground/index.ts', baseUrl).href;
	const assetsUrl = new URL('src/lib/playground/applicationAssets.ts', baseUrl).href;
	// Keep the native browser import outside Vitest's SSR-transformed callback.
	await page.addScriptTag({
		type: 'module',
		content: `Promise.all([import(${JSON.stringify(sourceUrl)}), import(${JSON.stringify(assetsUrl)})]).then(async ([{default: playground}, {createApplicationRuntimeAssets}]) => {
			window.__realRuntimeCacheAssets = createApplicationRuntimeAssets(${JSON.stringify(new URL(baseUrl).pathname)});
			window.__realRuntimeCacheSandbox = await playground(${JSON.stringify(language)});
		}).catch(error => { window.__realRuntimeCacheImportError = String(error); });`
	});
	await page.waitForFunction(
		() =>
			typeof window.__realRuntimeCacheSandbox?.load === 'function' ||
			window.__realRuntimeCacheImportError,
		undefined,
		{ timeout: 60_000 }
	);
	const importError = await page.evaluate(() => window.__realRuntimeCacheImportError);
	if (importError) throw new Error(`Actual playground source import failed: ${importError}`);
	return await withWallClockTimeout(
		page.evaluate(
			async ({ language, namespace, runTimeoutMs, rustLimits }) => {
				const sandbox = window.__realRuntimeCacheSandbox;
				const output: string[] = [];
				sandbox.output = (chunk) => output.push(chunk);
				const controller = new AbortController();
				const timer = setTimeout(
					() => controller.abort(new Error('Real runtime cache test timed out')),
					runTimeoutMs
				);
				const code =
					language === 'RUST'
						? 'fn main() { println!("persistent-RUST-42"); }'
						: 'let () = print_endline "persistent-OCAML-42"';
				const options = {
					signal: controller.signal,
					rustTargetTriple: 'wasm32-wasip1' as const,
					ocamlBackend: 'wasm' as const,
					ocamlWasmBinaryenMode: 'fast' as const,
					limits: {
						...(language === 'RUST' ? rustLimits : {}),
						assetTimeoutMs: 180_000,
						startupTimeoutMs: 180_000,
						compileTimeoutMs: 180_000,
						runTimeoutMs: 30_000,
						maxAssetBytes: 1024 ** 3
					}
				};
				try {
					await sandbox.load(
						{
							...window.__realRuntimeCacheAssets,
							persistentCache: {
								enabled: true,
								namespace,
								maxBytes: 2 * 1024 ** 3,
								maxEntryBytes: 1024 ** 3
							}
						},
						code,
						false,
						[],
						options
					);
					const prepared = await sandbox.run(code, true, false, undefined, [], options);
					if (prepared !== true)
						throw new Error(
							`Compilation failed: ${String(prepared)} ${output.join('')}`
						);
					const result = await sandbox.run(code, false, false, undefined, [], options);
					return { result, output: output.join('') };
				} finally {
					clearTimeout(timer);
					await sandbox.dispose?.();
				}
			},
			{ language, namespace, runTimeoutMs, rustLimits: RUST_NON_DEBUG_RESOURCE_REQUIREMENTS }
		),
		runTimeoutMs + 10_000,
		`${language} real runtime compilation and execution`
	);
}

async function storedRepresentations(page: Page, namespace: string, assets: ExpectedAsset[]) {
	return await page.evaluate(
		async ({ namespace, assets }) => {
			const name = `wasm-idle-assets-v1:${namespace}`;
			if (!(await caches.has(name))) return assets.map(() => []);
			const cache = await caches.open(name);
			return await Promise.all(
				assets.map(async (asset) => {
					const matches: Receipt[] = [];
					for (const receipt of asset.representations) {
						const response = await cache.match(
							`https://wasm-idle.invalid/.runtime-assets/${namespace}/${receipt.sha256}`
						);
						if (response)
							matches.push({
								sha256: receipt.sha256,
								bytes: Number(response.headers.get('Content-Length'))
							});
					}
					return matches;
				})
			);
		},
		{ namespace, assets }
	);
}

describe('real runtime persistent cache after page reload', () => {
	for (const language of ['RUST', 'OCAML'] as const) {
		it(
			`reuses ${language} compiler and runtime bodies without a second HTTP download`,
			{
				skip: !enabled,
				meta: { browser: true, requiredBrowser: enabled },
				timeout: 720_000
			},
			async () => {
				await runWithBrowserProbeSessionLock(
					async () => {
						const configuredUrl = process.env.WASM_IDLE_BROWSER_URL || '';
						// Source imports deliberately exercise the real Vite worker entry points.
						// Preparation/sync is explicit outside this test, never triggered by a cold/warm run.
						const server = shouldReuseProvidedBrowserUrl(configuredUrl)
							? { browserUrl: configuredUrl, close: async () => {} }
							: await startBrowserPreviewServer({
									origin: configuredUrl
										? new URL(configuredUrl).origin
										: 'http://127.0.0.1:4773',
									...(configuredUrl
										? { basePath: new URL(configuredUrl).pathname }
										: {}),
									serverMode: 'dev'
								});
						let browser: Browser | undefined;
						try {
							browser = await chromium.launch({
								headless: true,
								executablePath: await resolveChromiumExecutable(
									process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
								)
							});
							const context = await browser.newContext();
							await addBrowserTestCookies(context, server.browserUrl);
							const baseUrl = server.browserUrl.replace(/\/?$/u, '/');
							const harnessUrl = new URL('__persistent-runtime-cache-test__', baseUrl)
								.href;
							// Preserve SvelteKit's real public-env/base bootstrap without mounting
							// the UI (whose automatic CPP prewarm competes with the real compiler).
							const application = await context.request.get(baseUrl);
							if (!application.ok())
								throw new Error(
									`Application bootstrap returned HTTP ${application.status()}`
								);
							const bootstrap = (await application.text()).match(
								/\b__sveltekit_[a-zA-Z0-9_]+\s*=\s*\{[\s\S]*?\n\s*\};/u
							)?.[0];
							if (!bootstrap)
								throw new Error(
									'Application SvelteKit bootstrap assignment was not found'
								);
							// Only this empty document is synthetic. Every imported module, compiler,
							// pack and Worker below is the actual application implementation.
							// Routing also disables Chromium's ordinary HTTP cache for Worker requests.
							await context.route('**/*', async (route) => {
								if (route.request().url() !== harnessUrl)
									return await route.continue();
								await route.fulfill({
									status: 200,
									headers: {
										'Content-Type': 'text/html',
										'Cache-Control': 'no-store',
										'Cross-Origin-Opener-Policy': 'same-origin',
										'Cross-Origin-Embedder-Policy': 'require-corp'
									},
									body: `<!doctype html><title>Real runtime persistent cache verification</title><script>${bootstrap}</script>`
								});
							});
							const assets = await expectedAssets(language);
							const assetPaths = assets.map(
								(asset) => new URL(asset.path, baseUrl).pathname
							);
							const deliveryPaths = new Set(
								assetPaths.flatMap((path) =>
									path.endsWith('.gz') ? [path] : [path, `${path}.gz`]
								)
							);
							const requests: string[][] = [[], []];
							let phase = 0;
							context.on('request', (request) => {
								const pathname = new URL(request.url()).pathname;
								if (deliveryPaths.has(pathname)) requests[phase].push(pathname);
							});
							const page = await context.newPage();
							const cdp = await context.newCDPSession(page);
							await cdp.send('Network.enable');
							await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
							const errors: string[] = [];
							page.on('pageerror', (error) => errors.push(error.message));
							await page.goto(harnessUrl);
							expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
							// The unchanged application worker supplies gzip delivery in the checked-in
							// deployment layout. It does not persist compiler/pack payload bodies.
							await withWallClockTimeout(
								page.evaluate(
									async ({ workerUrl, scope }) => {
										await navigator.serviceWorker.register(workerUrl, {
											scope
										});
										await navigator.serviceWorker.ready;
									},
									{
										workerUrl: new URL('worker.js', baseUrl).href,
										scope: new URL(baseUrl).pathname
									}
								),
								30_000,
								'application service worker registration'
							);
							await page.waitForFunction(
								() => navigator.serviceWorker.controller !== null,
								undefined,
								{ timeout: 30_000 }
							);
							const namespace = `runtime-${language.toLowerCase()}-${randomUUID()}`;
							const cold = await executeRealRuntime(
								page,
								language,
								baseUrl,
								namespace
							);
							expect(cold.result, cold.output).toBe(true);
							expect(cold.output).toContain(`persistent-${language}-42`);
							for (const path of assetPaths)
								expect(requests[0], `cold request for ${path}`).toContain(path);
							const stored = await storedRepresentations(page, namespace, assets);
							for (let index = 0; index < assets.length; index += 1) {
								expect(
									stored[index],
									`one stored representation of ${assets[index].path}`
								).toHaveLength(1);
								expect(assets[index].representations).toContainEqual(
									stored[index][0]
								);
								expect(stored[index][0].bytes).toBeGreaterThan(1024 ** 2);
							}
							phase = 1;
							// New page globals and new real Workers; only origin storage survives.
							await page.reload();
							const warm = await executeRealRuntime(
								page,
								language,
								baseUrl,
								namespace
							);
							expect(warm.result, warm.output).toBe(true);
							expect(warm.output).toContain(`persistent-${language}-42`);
							expect(
								requests[1],
								'large compiler/pack bodies must not reach HTTP on warm reload'
							).toEqual([]);
							expect(await storedRepresentations(page, namespace, assets)).toEqual(
								stored
							);
							expect(errors).toEqual([]);
							console.info(
								JSON.stringify({
									language,
									coldRequests: requests[0],
									warmRequests: requests[1],
									stored
								})
							);
						} finally {
							try {
								await browser?.close();
							} finally {
								await server.close();
							}
						}
					},
					{ timeoutMs: 900_000 }
				);
			}
		);
	}
});
