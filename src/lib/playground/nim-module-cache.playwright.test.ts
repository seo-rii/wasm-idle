// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { installBrowserRuntimeDelivery } from '../../../scripts/browser-runtime-delivery.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_LLVM_COMPILER_CACHE === '1';

describe.skipIf(!enabled)('Nim compiler module sharing in Chromium', () => {
	it(
		'reuses all four compiler modules across fresh Nim and nested Clang workers',
		{
			timeout: 240_000,
			meta: { browser: true, requiredBrowser: enabled }
		},
		async () => {
			const server = await startBrowserPreviewServer({
				origin: 'http://127.0.0.1:4976',
				serverMode: 'dev'
			});
			const browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable()
			});
			try {
				const context = await browser.newContext();
				await addBrowserTestCookies(context, server.browserUrl);
				const page = await context.newPage();
				const errors: string[] = [];
				page.on('pageerror', (error) => errors.push(error.message));
				const base = server.browserUrl.replace(/\/$/, '') + '/';
				const fixture = base + 'nim-module-cache-harness';
				await context.route(fixture, (route) =>
					route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>Nim cache</title>',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						}
					})
				);
				await page.goto(fixture, { waitUntil: 'domcontentloaded' });
				await installBrowserRuntimeDelivery(page, base);
				await page.addScriptTag({
					type: 'module',
					content: `
import Nim from ${JSON.stringify(base + 'src/lib/playground/nim.ts')};
import {RuntimeAssetCache} from ${JSON.stringify(base + 'src/lib/playground/runtimeAssetCache.ts')};
import {WASM_NIM_RUNTIME_PROFILE} from ${JSON.stringify(base + 'src/lib/playground/wasmNimVersion.ts')};
globalThis.__nimCacheFixture = {Nim,RuntimeAssetCache,profile:WASM_NIM_RUNTIME_PROFILE};
`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__nimCacheFixture));
				const report = await page.evaluate(async (base) => {
					const { Nim, RuntimeAssetCache, profile } = (globalThis as any)
						.__nimCacheFixture;
					const cache = new RuntimeAssetCache();
					const compilerSizes = new Set(
						[
							profile.nimWasmReceipt,
							profile.clangWasmReceipt,
							profile.lldWasmReceipt,
							profile.memfsWasmReceipt
						].map((r) => r.uncompressedBytes)
					);
					const nativeCompile = WebAssembly.compile;
					const BrowserWorker = Worker;
					let compilerCompiles = 0;
					WebAssembly.compile = function (bytes: BufferSource) {
						if (compilerSizes.has(bytes.byteLength)) compilerCompiles++;
						return nativeCompile.call(WebAssembly, bytes);
					};
					const workers: Worker[] = [];
					const results: any[] = [];
					try {
						for (let index = 0; index < 2; index++) {
							const sandbox = new Nim();
							sandbox.setRuntimeAssetCache(cache);
							let output = '';
							let ports: string[] = [];
							sandbox.output = (text: string) => (output += text);
							const limits = { compileTimeoutMs: 120_000, runTimeoutMs: 30_000 };
							try {
								globalThis.Worker = class extends BrowserWorker {
									postMessage(
										message: any,
										transfer: Transferable[] | StructuredSerializeOptions = []
									) {
										if (message.run) {
											workers.push(this);
											ports = Object.keys(
												message.runtimeWasmModulePorts ?? {}
											).sort();
										}
										return Array.isArray(transfer)
											? super.postMessage(message, transfer)
											: super.postMessage(message, transfer);
									}
								};
								await sandbox.load(
									{ rootUrl: new URL(base).pathname.replace(/\/$/, '') },
									'',
									false,
									[],
									{ limits }
								);

								const value = await sandbox.run(
									`echo "run${index}:" & stdin.readLine()`,
									false,
									false,
									undefined,
									[],
									{ stdin: index ? 'world\n' : 'hello\n', limits }
								);
								results.push({
									value,
									output,
									ports,
									compilerCompiles,
									stats: cache.stats()
								});
							} catch (error) {
								results.push({
									error: String(error),
									output,
									ports,
									compilerCompiles,
									stats: cache.stats()
								});
							} finally {
								await sandbox.dispose();
							}
						}
						return {
							results,
							freshWorkers: new Set(workers).size === 2,
							cacheAlive: !cache.stats().disposed
						};
					} finally {
						WebAssembly.compile = nativeCompile;
						globalThis.Worker = BrowserWorker;
						cache.dispose();
					}
				}, base);
				expect(report.freshWorkers, JSON.stringify(report)).toBe(true);
				expect(report.cacheAlive).toBe(true);
				for (const result of report.results) {
					expect(result.error, JSON.stringify(result)).toBeUndefined();
					expect(result.ports).toEqual(['clang', 'lld', 'memfs', 'nim']);
					expect(result.compilerCompiles).toBe(4);
				}
				expect(report.results[0].output.trim()).toBe('run0:hello');
				expect(report.results[1].output.trim()).toBe('run1:world');
				expect(report.results[1].stats.hits).toBeGreaterThanOrEqual(
					report.results[0].stats.hits + 4
				);
				expect(errors).toEqual([]);
			} finally {
				await browser.close();
				await server.close();
			}
		}
	);
});
