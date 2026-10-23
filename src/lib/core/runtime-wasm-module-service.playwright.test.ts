// @vitest-environment node

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';

describe('shared compiler modules in Chromium', () => {
	it(
		'reuses verified modules after replacing workers and isolates compiler profiles',
		{
			skip: process.env.WASM_IDLE_RUN_SHARED_MODULE_BROWSER !== '1',
			timeout: 60_000,
			meta: {
				browser: true,
				requiredBrowser: process.env.WASM_IDLE_RUN_SHARED_MODULE_BROWSER === '1'
			}
		},
		async () => {
			const modules = new Map<string, string>(
				await Promise.all(
					['runtime-wasm-module-service.js', 'session-asset-cache.js'].map(
						async (name) =>
							[
								`/core/${name}`,
								await readFile(resolve('packages/core/dist', name), 'utf8')
							] as const
					)
				)
			);
			const server = createServer((request, response) => {
				response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
				response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
				const source = modules.get(request.url || '');
				if (source !== undefined) {
					response.setHeader('Content-Type', 'application/javascript');
					response.end(source);
				} else if (request.url === '/') {
					response.setHeader('Content-Type', 'text/html');
					response.end('<!doctype html><title>Compiler module ownership test</title>');
				} else {
					response.writeHead(404).end();
				}
			});
			await new Promise<void>((accept, reject) => {
				server.once('error', reject);
				server.listen(0, '127.0.0.1', accept);
			});
			const address = server.address();
			if (!address || typeof address === 'string')
				throw new Error('Missing test server address');
			const origin = `http://127.0.0.1:${address.port}`;
			let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
			try {
				browser = await chromium.launch({
					headless: true,
					executablePath: await resolveChromiumExecutable(
						process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
					)
				});
				const context = await browser.newContext();
				await addBrowserTestCookies(context, origin);
				const page = await context.newPage();
				await page.goto(origin);
				await page.addScriptTag({
					type: 'module',
					content: `import { createRuntimeWasmModuleService, createPreparedRuntimeWasmModuleService } from '/core/runtime-wasm-module-service.js';
import { RuntimeAssetCache } from '/core/session-asset-cache.js';
window.sharedCompilerTest = { createRuntimeWasmModuleService, createPreparedRuntimeWasmModuleService, RuntimeAssetCache };`
				});
				await page.waitForFunction(() => 'sharedCompilerTest' in window);
				const bytes = [0, 97, 115, 109, 1, 0, 0, 0];
				const receipt = {
					bytes: bytes.length,
					sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
				};
				const summary = await page.evaluate(
					async ({ bytes, receipt }) => {
						const serviceUrl = new URL(
							'/core/runtime-wasm-module-service.js',
							location.href
						).href;
						const { createRuntimeWasmModuleService, createPreparedRuntimeWasmModuleService, RuntimeAssetCache } = (
							window as unknown as {
								sharedCompilerTest: Pick<
									typeof import('@wasm-idle/core'),
									'createRuntimeWasmModuleService' | 'createPreparedRuntimeWasmModuleService' | 'RuntimeAssetCache'
								>;
							}
						).sharedCompilerTest;
						const cache = new RuntimeAssetCache(4096, 8);
						let compiled = 0;
						let retired = 0;
						const compile = async (ownedBytes: Uint8Array<ArrayBuffer>) => {
							compiled++;
							return WebAssembly.compile(ownedBytes);
						};
						const workerSource = `import { requestRuntimeWasmModule, requestPreparedRuntimeWasmModule } from ${JSON.stringify(serviceUrl)};
self.onmessage = async ({data}) => {
  try {
    const module = data.prepared
      ? await requestPreparedRuntimeWasmModule(data.port, { ...data.expected, timeoutMs: 5000 })
      : await requestRuntimeWasmModule(new Uint8Array(data.bytes), data.port, { timeoutMs: 5000 });
    const instance = await WebAssembly.instantiate(module, {});
    self.postMessage({ ready: instance instanceof WebAssembly.Instance });
  } catch (error) { self.postMessage({ error: String(error) }); }
};`;
						const workerUrl = URL.createObjectURL(
							new Blob([workerSource], { type: 'text/javascript' })
						);
						const run = async (identity: string, compileKey: string, prepared = false) => {
							const expected = { receipt, identity, compileKey, maxAssetBytes: 64 };
							const service = prepared ? createPreparedRuntimeWasmModuleService({ ...expected, cache, compile, bytes: new Uint8Array(bytes) }) : createRuntimeWasmModuleService({
								cache,
								receipt,
								identity,
								compileKey,
								maxAssetBytes: 64,
								compile
							});
							const worker = new Worker(workerUrl, { type: 'module' });
							try {
								return await new Promise<boolean>((accept, reject) => {
									worker.onerror = (event) => reject(new Error(event.message));
									worker.onmessage = (event) =>
										event.data.error
											? reject(new Error(event.data.error))
											: accept(event.data.ready);
									worker.postMessage(prepared ? { prepared, expected, port: service.port } : { bytes, port: service.port }, [
										service.port
									]);
								});
							} finally {
								worker.terminate();
								service.close();
								retired++;
							}
						};
						try {
							const results = [];
							for (const [identity, compileKey] of [
								['clang-profile', 'native-v1'],
								['rust-profile', 'native-v1'],
								['clang-profile', 'native-v1'],
								['tinygo-profile', 'cap-v1:16MiB'],
								['tinygo-profile', 'cap-v1:16MiB'],
								['tinygo-profile', 'cap-v1:32MiB']
							])
								results.push(await run(identity, compileKey));
							results.push(await run('prepared-clang-profile', 'native-v1', true));
							results.push(await run('prepared-clang-profile', 'native-v1', true));
							const stats = cache.stats();
							cache.dispose();
							return {
								results,
								compiled,
								retired,
								stats,
								disposed: cache.stats().disposed
							};
						} finally {
							URL.revokeObjectURL(workerUrl);
							cache.dispose();
						}
					},
					{ bytes, receipt }
				);
				expect(summary.results).toEqual(Array(8).fill(true));
				expect(summary.compiled).toBe(5);
				expect(summary.retired).toBe(8);
				expect(summary.stats).toMatchObject({ entries: 5, disposed: false, inFlight: 0 });
				expect(summary.disposed).toBe(true);
			} finally {
				await browser?.close();
				await new Promise<void>((accept, reject) =>
					server.close((error) => (error ? reject(error) : accept()))
				);
			}
		}
	);
});
