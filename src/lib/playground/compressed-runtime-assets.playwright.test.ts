// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

const compressedRuntimeAssetSamples = [
	'pyodide/pyodide.asm.wasm',
	'wasm-dotnet/runtime/FSharp.Compiler.Service.wasm',
	'wasm-elixir/bundle.avm',
	'wasm-lisp/vendor/jco/obj/js-component-bindgen-component.core.wasm',
	'wasm-octave/runtime/bin/octave-cli.wasm',
	'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-opt.browser.js',
	'wasm-tinygo/tools/tinygo-compiler.wasm',
	'wasm-tinygo/vendor/emception/04de61a8a0f85ee15beb.a',
	'wasm-zig/zig_small.wasm',
	'webr/5da864032a1d2d4e/R.wasm'
] as const;

async function expectedAssetMetadata(assetPath: string) {
	const bytes = gunzipSync(
		await readFile(new URL(`../../../build/${assetPath}.gz`, import.meta.url))
	);
	return {
		byteLength: bytes.byteLength,
		path: assetPath,
		prefix: Array.from(bytes.subarray(0, 4))
	};
}

async function discoverBuildAssetSamples() {
	const manifest = JSON.parse(
		await readFile(
			new URL('../../../build/compressed-runtime-assets.v1.json', import.meta.url),
			'utf8'
		)
	) as { assets?: string[] };
	const assets = manifest.assets || [];
	return [
		/^_app\/immutable\/workers\/assets\/icu-.*\.dat$/,
		/^_app\/immutable\/workers\/assets\/intl-.*\.so$/,
		/^_app\/immutable\/workers\/assets\/php_8_5-.*\.wasm$/,
		/^_app\/immutable\/workers\/assets\/ruby_stdlib-.*\.wasm$/,
		/^_app\/immutable\/workers\/chunks\/.*\.js$/
	].map((pattern) => {
		const asset = assets.find((entry) => pattern.test(entry));
		if (!asset) throw new Error(`compressed build asset sample not found for ${pattern}`);
		return asset;
	});
}

describe('compressed runtime assets', () => {
	it('serves gzip-only runtime assets through their original URLs', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_COMPRESSED_ASSETS !== '1') {
			return;
		}

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(['build:preview', 'compress:build-runtimes']);
			}
			const previewServer = reuseProvidedBrowserUrl
				? {
						origin: new URL(configuredBrowserUrl).origin,
						browserUrl: configuredBrowserUrl,
						close: async () => {}
					}
				: await startBrowserPreviewServer(
						configuredBrowserUrl
							? {
									origin: new URL(configuredBrowserUrl).origin,
									basePath: new URL(configuredBrowserUrl).pathname,
									serverMode
								}
							: { origin: 'http://localhost:4583', serverMode }
					);
			const browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable(
					process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
				)
			});
			const context = await browser.newContext();
			await context.addCookies([
				{
					name: 'dev_bypass_waf',
					value: 'seorii_bypass_token_is_this',
					url: new URL(previewServer.browserUrl).origin
				}
			]);
			await context.setExtraHTTPHeaders({
				Cookie: 'dev_bypass_waf=seorii_bypass_token_is_this'
			});
			const page = await context.newPage();
			page.setDefaultTimeout(
				Number(process.env.WASM_IDLE_COMPRESSED_ASSET_TIMEOUT_MS || '120000')
			);

			try {
				await page.goto(previewServer.browserUrl, { waitUntil: 'domcontentloaded' });
				for (let attempt = 0; attempt < 4; attempt += 1) {
					const ready = await page.evaluate(
						() =>
							crossOriginIsolated &&
							typeof SharedArrayBuffer !== 'undefined' &&
							!!navigator.serviceWorker?.controller
					);
					if (ready) break;
					await page.evaluate(async () => {
						if (!navigator.serviceWorker) return;
						await Promise.race([
							navigator.serviceWorker.ready,
							new Promise((resolve) => setTimeout(resolve, 1_500))
						]);
					});
					await page.goto(previewServer.browserUrl, { waitUntil: 'domcontentloaded' });
					await page.waitForTimeout(2_000 + attempt * 500);
				}

				const expectedAssets = await Promise.all(
					[...compressedRuntimeAssetSamples, ...(await discoverBuildAssetSamples())].map(
						(assetPath) => expectedAssetMetadata(assetPath)
					)
				);
				const responses = await page.evaluate(async (assets) => {
					return await Promise.all(
						assets.map(async (asset) => {
							const response = await fetch(new URL(asset.path, location.href));
							const bytes = new Uint8Array(await response.arrayBuffer());
							return {
								byteLength: bytes.byteLength,
								contentType: response.headers.get('content-type') || '',
								ok: response.ok,
								path: asset.path,
								prefix: Array.from(bytes.subarray(0, 4)),
								status: response.status
							};
						})
					);
				}, expectedAssets);

				expect(responses).toEqual(
					expectedAssets.map((asset) =>
						expect.objectContaining({
							byteLength: asset.byteLength,
							ok: true,
							path: asset.path,
							prefix: asset.prefix,
							status: 200
						})
					)
				);
				for (const response of responses) {
					if (response.path.endsWith('.wasm')) {
						expect(response.contentType).toContain('application/wasm');
					}
					if (response.path.endsWith('.js')) {
						expect(['application/javascript', 'text/javascript']).toContain(
							response.contentType.split(';')[0]
						);
					}
				}

				const aliasResponses = await page.evaluate(async () => {
					async function digest(bytes: ArrayBuffer) {
						return Array.from(
							new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
						)
							.map((value) => value.toString(16).padStart(2, '0'))
							.join('');
					}
					return await Promise.all(
						[
							[
								'wasm-tinygo/vendor/wasm-rust-runtime/runtime-manifest.v3.json',
								'wasm-rust/runtime/runtime-manifest.v3.json'
							],
							[
								'wasm-tinygo/vendor/wasm-rust-runtime/rustc/rustc.wasm.gz',
								'wasm-rust/runtime/rustc/rustc.wasm.gz'
							]
						].map(async ([aliasPath, canonicalPath]) => {
							const aliasResponse = await fetch(new URL(aliasPath, location.href));
							const canonicalResponse = await fetch(
								new URL(canonicalPath, location.href)
							);
							const aliasBytes = await aliasResponse.arrayBuffer();
							const canonicalBytes = await canonicalResponse.arrayBuffer();
							return {
								aliasDigest: await digest(aliasBytes),
								aliasOk: aliasResponse.ok,
								aliasPath,
								aliasStatus: aliasResponse.status,
								byteLength: aliasBytes.byteLength,
								canonicalDigest: await digest(canonicalBytes),
								canonicalOk: canonicalResponse.ok,
								canonicalPath,
								canonicalStatus: canonicalResponse.status,
								canonicalByteLength: canonicalBytes.byteLength
							};
						})
					);
				});

				expect(aliasResponses).toEqual(
					aliasResponses.map((response) =>
						expect.objectContaining({
							aliasDigest: response.canonicalDigest,
							aliasOk: true,
							aliasStatus: 200,
							byteLength: response.canonicalByteLength,
							canonicalOk: true,
							canonicalStatus: 200
						})
					)
				);
			} finally {
				await context.close();
				await browser.close();
				await previewServer.close();
			}
		});
	}, 240_000);
});
