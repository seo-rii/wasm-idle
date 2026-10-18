// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { installBrowserRuntimeDelivery } from '../../../scripts/browser-runtime-delivery.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_LLVM_COMPILER_CACHE === '1';
const meta = { browser: true, requiredBrowser: enabled };

describe.skipIf(!enabled)('C3 and LFortran immutable compiler modules in Chromium', () => {
	let server: { browserUrl: string; close(): Promise<void> };
	let browser: Browser;
	beforeAll(async () => {
		server = process.env.WASM_IDLE_BROWSER_URL
			? { browserUrl: process.env.WASM_IDLE_BROWSER_URL, close: async () => {} }
			: await startBrowserPreviewServer({
					origin: 'http://127.0.0.1:4975',
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

	it.each(['C3', 'LFORTRAN'] as const)(
		'%s reuses compiler modules while replacing workers, files and input',
		{ timeout: 240_000, meta },
		async (language) => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			const base = `${server.browserUrl.replace(/\/$/, '')}/`;
			const fixtureUrl = `${base}compiler-cache-harness`;
			try {
				await context.route(fixtureUrl, (route) =>
					route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>Compiler module cache</title>',
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
import C3 from ${JSON.stringify(base + 'src/lib/playground/c3.ts')};
import LFortran from ${JSON.stringify(base + 'src/lib/playground/lfortran.ts')};
import { RuntimeAssetCache } from ${JSON.stringify(base + 'src/lib/playground/runtimeAssetCache.ts')};
globalThis.__compilerCacheFixture = { C3, LFortran, RuntimeAssetCache };
`
				});
				await page.waitForFunction(() =>
					Boolean((globalThis as any).__compilerCacheFixture)
				);
				const report = await page.evaluate(
					async ({ language, base }) => {
						const fixture = (globalThis as any).__compilerCacheFixture;
						const Runtime = language === 'C3' ? fixture.C3 : fixture.LFortran;
						const cache = new fixture.RuntimeAssetCache();
						const rootUrl = new URL(base).pathname.replace(/\/$/, '');
						let nativeCompiles = 0;
						const compile = WebAssembly.compile;
						WebAssembly.compile = function (bytes: BufferSource) {
							// Count host compiler modules, excluding the small feature-detection probe.
							if (bytes.byteLength > 1024 * 1024) nativeCompiles++;
							return compile.call(WebAssembly, bytes);
						};
						const workerReferences: Worker[] = [];
						const results: Array<Record<string, any>> = [];
						const c3Source = `module main; import helper;
extern fn int read_byte() @wasm("env", "readByte");
extern fn void write_byte(int value) @wasm("env", "writeByte");
fn void main() @wasm("main") {
  while (true) { int value = read_byte(); if (value < 0) break; write_byte(helper::adjust(value)); }
}`;
						const fortranSource = `program main
  implicit none
  include 'value.inc'
  integer :: input
  read(*,*) input
  print '(I0)', value + input
end program`;
						async function run(index: number, extra: boolean, alternateCap = false) {
							const sandbox = new Runtime();
							sandbox.setRuntimeAssetCache(cache);
							let output = '';
							sandbox.output = (text: string) => (output += text);
							let portKeys: string[] = [];
							const limits = {
								compileTimeoutMs: 120_000,
								runTimeoutMs: 30_000,
								maxWasmMemoryBytes:
									language === 'C3'
										? (alternateCap ? 1280 : 1024) * 1024 ** 2
										: 256 * 1024 ** 2
							};
							try {
								await sandbox.load({ rootUrl }, '', false, [], { limits });
								const worker = sandbox.worker as Worker;
								workerReferences.push(worker);
								const post = worker.postMessage.bind(worker);
								worker.postMessage = ((message: any, transfer: Transferable[]) => {
									if (message.run)
										portKeys = Object.keys(
											message.runtimeWasmModulePorts ?? {}
										);
									return post(message, transfer);
								}) as Worker['postMessage'];
								const workspaceFiles = extra
									? language === 'C3'
										? [
												{
													path: 'helper.c3',
													content: `module helper; fn int adjust(int n) { return n + ${index}; }`
												}
											]
										: [
												{
													path: 'value.inc',
													content: `integer, parameter :: value=${index === 0 ? 7 : 19}\n`
												}
											]
									: [];
								const value = await sandbox.run(
									language === 'C3' ? c3Source : fortranSource,
									false,
									false,
									undefined,
									[],
									{
										stdin:
											language === 'C3' ? 'ABC' : `${index === 0 ? 3 : 5}\n`,
										workspaceFiles,
										limits
									}
								);
								return {
									value,
									output,
									portKeys,
									nativeCompiles,
									stats: cache.stats(),
									evidence: sandbox.memoryEvidence.current
								};
							} catch (error) {
								return {
									error: String(error),
									output,
									portKeys,
									nativeCompiles,
									stats: cache.stats()
								};
							} finally {
								await sandbox.dispose();
							}
						}
						try {
							results.push(await run(0, true));
							results.push(await run(1, true));
							if (language === 'C3') results.push(await run(2, true, true));
							results.push(await run(0, false));
							return {
								isolated: crossOriginIsolated,
								results,
								freshWorkers:
									new Set(workerReferences).size === workerReferences.length,
								cacheAlive: !cache.stats().disposed
							};
						} finally {
							WebAssembly.compile = compile;
							cache.dispose();
						}
					},
					{ language, base }
				);
				expect(report.isolated).toBe(true);
				expect(report.freshWorkers).toBe(true);
				expect(report.cacheAlive).toBe(true);
				const first = report.results[0],
					second = report.results[1];
				expect(first.error, JSON.stringify(first)).toBeUndefined();
				expect(second.error, JSON.stringify(second)).toBeUndefined();
				expect(first.portKeys).toEqual(['compiler']);
				expect(second.portKeys).toEqual(['compiler']);
				expect(first.nativeCompiles).toBe(1);
				expect(second.nativeCompiles).toBe(1);
				expect(second.stats.hits).toBeGreaterThan(first.stats.hits);
				expect(first.output.trim()).toBe(language === 'C3' ? 'ABC' : '10');
				expect(second.output.trim()).toBe(language === 'C3' ? 'BCD' : '24');
				const missingFiles = report.results.at(-1)!;
				expect(
					Boolean(missingFiles.error) || missingFiles.value === false,
					JSON.stringify(missingFiles)
				).toBe(true);
				expect(missingFiles.portKeys).toEqual(['compiler']);
				if (language === 'C3') {
					const otherCap = report.results[2];
					expect(otherCap.error, JSON.stringify(otherCap)).toBeUndefined();
					expect(otherCap.output.trim()).toBe('CDE');
					expect(otherCap.nativeCompiles).toBe(2);
					expect(otherCap.evidence.compiler.maximumBytes).toBeGreaterThan(
						first.evidence.compiler.maximumBytes
					);
				}
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		}
	);
});
