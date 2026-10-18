// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { installBrowserRuntimeDelivery } from '../../../scripts/browser-runtime-delivery.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_D_MODULE_CACHE === '1';

describe.skipIf(!enabled)('D shared compiler modules in Chromium', () => {
	let server: { browserUrl: string; close(): Promise<void> };
	let browser: Browser;
	beforeAll(async () => {
		server = process.env.WASM_IDLE_BROWSER_URL
			? { browserUrl: process.env.WASM_IDLE_BROWSER_URL, close: async () => {} }
			: await startBrowserPreviewServer({
					origin: 'http://127.0.0.1:4977',
					serverMode: 'dev'
				});
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
	}, 120_000);

	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	it(
		'clones cached LDC/LLD modules into fresh workers with isolated stdin and filesystem',
		{
			timeout: 240_000,
			meta: { browser: true, requiredBrowser: enabled }
		},
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			const base = `${server.browserUrl.replace(/\/$/, '')}/`;
			const fixtureUrl = `${base}d-module-cache-harness`;
			try {
				await context.route(fixtureUrl, (route) =>
					route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>D compiler cache</title>',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						}
					})
				);
				await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
				await installBrowserRuntimeDelivery(page, base);
				await page.addScriptTag({
					type: 'module',
					content: `
import D from ${JSON.stringify(base + 'src/lib/playground/d.ts')};
import { RuntimeAssetCache } from ${JSON.stringify(base + 'src/lib/playground/runtimeAssetCache.ts')};
globalThis.__dModuleCacheFixture = { D, RuntimeAssetCache };
`
				});
				await page.waitForFunction(() => !!(globalThis as any).__dModuleCacheFixture);
				const report = await page.evaluate(async (base) => {
					const { D, RuntimeAssetCache } = (globalThis as any).__dModuleCacheFixture;
					const cache = new RuntimeAssetCache();
					const originalCompile = WebAssembly.compile;
					let nativeCompiles = 0;
					WebAssembly.compile = function (bytes: BufferSource) {
						if (bytes.byteLength > 1_000_000) nativeCompiles++;
						return originalCompile.call(WebAssembly, bytes);
					};
					const runtimeAssets = { rootUrl: new URL(base).pathname.replace(/\/$/, '') };
					const workers: Worker[] = [];
					const runtimes: any[] = [];
					const results: Array<Record<string, any>> = [];
					const create = () => {
						const sandbox = new D();
						sandbox.setRuntimeAssetCache(cache);
						runtimes.push(sandbox);
						return sandbox;
					};
					async function run(sandbox: any, input: string, index: number) {
						let output = '';
						let portKeys: string[] = [];
						sandbox.output = (chunk: string) => (output += chunk);
						await sandbox.load(runtimeAssets, '', false);
						const worker = sandbox.worker as Worker;
						workers.push(worker);
						const post = worker.postMessage.bind(worker);
						worker.postMessage = ((message: any, transfer?: Transferable[]) => {
							if (message.code)
								portKeys = Object.keys(message.compilerModulePorts ?? {});
							return transfer ? post(message, transfer) : post(message);
						}) as Worker['postMessage'];
						const code = `import std.stdio;
import std.string;
import std.file;
void main() {
    auto line = stdin.readln().chomp();
    auto prior = exists("/tmp/d-session-state") ? readText("/tmp/d-session-state") : "none";
    std.file.write("/tmp/d-session-state", line);
    writeln("phase=${index},prior=", prior, ",echo=", line);
}`;
						try {
							const value = await sandbox.run(code, false, false, undefined, [], {
								stdin: `${input}\n`,
								limits: { compileTimeoutMs: 120_000, runTimeoutMs: 30_000 }
							});
							return {
								value,
								output,
								portKeys,
								nativeCompiles,
								retired: !sandbox.worker,
								stats: cache.stats()
							};
						} catch (error) {
							return {
								error: String(error),
								output,
								portKeys,
								nativeCompiles,
								stats: cache.stats()
							};
						}
					}
					try {
						const first = create();
						results.push(await run(first, 'alpha', 1));
						results.push(await run(first, 'beta', 2));
						await first.dispose();
						results.push(await run(create(), 'gamma', 3));
						return {
							isolated: crossOriginIsolated,
							results,
							freshWorkers: new Set(workers).size === 3,
							cacheAlive: !cache.stats().disposed
						};
					} finally {
						await Promise.all(runtimes.map((runtime) => runtime.dispose()));
						cache.dispose();
						WebAssembly.compile = originalCompile;
					}
				}, base);
				expect(report.isolated).toBe(true);
				expect(report.freshWorkers).toBe(true);
				expect(report.cacheAlive).toBe(true);
				for (const [index, result] of report.results.entries()) {
					expect(result.error, JSON.stringify(result)).toBeUndefined();
					expect(result.value).toBe(true);
					expect(result.portKeys).toEqual(['ldc2', 'lld']);
					expect(result.nativeCompiles).toBe(2);
					expect(result.retired).toBe(true);
					expect(result.output.trim()).toBe(
						`phase=${index + 1},prior=none,echo=${['alpha', 'beta', 'gamma'][index]}`
					);
				}
				expect(report.results[2].stats.hits).toBeGreaterThan(report.results[0].stats.hits);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		}
	);
});
