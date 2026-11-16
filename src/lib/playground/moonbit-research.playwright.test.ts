// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { syncWasmMoonbitAssets } from '../../../scripts/sync-wasm-moonbit.mjs';

const enabled =
	process.env.WASM_IDLE_RUN_REAL_BROWSER_MOONBIT_RESEARCH === '1' &&
	process.env.WASM_IDLE_MOONBIT_LOCAL_RESEARCH === '1';
const meta = { browser: true, requiredBrowser: enabled };

describe.skipIf(!enabled)('original MoonBit compiler in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		await syncWasmMoonbitAssets({ localResearchOnly: true, check: true });
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4998',
			serverMode: 'dev'
		});
		browser = await chromium.launch({
			headless: true,
			args: ['--disk-cache-size=1', '--media-cache-size=1'],
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
	}, 300_000);
	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	it(
		'compiles arbitrary original source, arrays, UTF-8 FFI input, workspace, errors and lifecycle recovery',
		{ timeout: 240_000, meta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage(),
				base = server.browserUrl.replace(/\/?$/u, '/');
			await page.route(base + 'moonbit-runtime-harness', (route) =>
				route.fulfill({
					contentType: 'text/html',
					body: '<!doctype html><title>MoonBit compiler</title>',
					headers: {
						'Cross-Origin-Opener-Policy': 'same-origin',
						'Cross-Origin-Embedder-Policy': 'require-corp'
					}
				})
			);
			try {
				await page.goto(base + 'moonbit-runtime-harness');
				await page.addScriptTag({
					type: 'module',
					content: `import Moonbit from ${JSON.stringify(base + 'src/lib/playground/moonbit.ts')}; globalThis.__Moonbit = Moonbit;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__Moonbit));
				const results = await page.evaluate(async (base) => {
					const runtime = new (globalThis as any).__Moonbit({ localResearchOnly: true });
					const run = async (
						source: string,
						options: Record<string, unknown> = {},
						delayed?: string[],
						abort?: AbortController
					) => {
						await runtime.load({ rootUrl: new URL(base).pathname.replace(/\/$/u, '') });
						let output = '',
							started = false,
							sentEof = false,
							outputBeforeEof = false;
						const timers: ReturnType<typeof setTimeout>[] = [];
						runtime.output = (text: string) => {
							output += text;
							if (output.includes('지연') && !sentEof) outputBeforeEof = true;
						};
						try {
							const value = await runtime.run(
								source,
								false,
								false,
								{
									report(event: { kind?: string; reason?: string }) {
										if (
											event.kind !== 'ready' ||
											event.reason !== 'started' ||
											started
										)
											return;
										started = true;
										if (abort) timers.push(setTimeout(() => abort.abort(), 30));
										if (delayed) {
											delayed.forEach((text, index) =>
												timers.push(
													setTimeout(
														() => runtime.write(text),
														(index + 1) * 60
													)
												)
											);
											timers.push(
												setTimeout(
													() => {
														sentEof = true;
														runtime.eof();
													},
													(delayed.length + 1) * 60
												)
											);
										}
									}
								},
								[],
								options
							);
							return { value, output, started, outputBeforeEof, code: '' };
						} catch (error) {
							return {
								value: false,
								output,
								started,
								outputBeforeEof,
								code: String((error as { code?: string }).code || ''),
								error: String(error)
							};
						} finally {
							for (const timer of timers) clearTimeout(timer);
						}
					};
					const echo =
						'extern "wasm" fn read_char() -> Int = "wasm_idle" "read_char"\nextern "wasm" fn write_char(code : Int) -> Unit = "wasm_idle" "write_char"\nfn main { while true { let code = read_char(); if code < 0 { break }; write_char(code) } }';
					try {
						const functions = await run(
							'fn twice(value : Int) -> Int { value * 2 }\nfn main { println([1, 2, 3].map(twice)) }',
							{ stdin: '' }
						);
						const enums = await run(
							'enum Shape { Box(Int, Int) }\nfn area(shape : Shape) -> Int { match shape { Box(width, height) => width * height } }\nfn main { println(area(Box(6, 7))) }',
							{ stdin: '' }
						);
						const utf8 = await run(echo, { stdin: '한글😀' });
						const raw = await run(
							'extern "wasm" fn read_byte() -> Int = "wasm_idle" "read_byte"\nfn main { let mut count = 0; while true { if read_byte() < 0 { break }; count = count + 1 }; println(count) }',
							{ stdin: 'é😀' }
						);
						const eof = await run(
							'extern "wasm" fn read_byte() -> Int = "wasm_idle" "read_byte"\nfn main { println(read_byte()) }',
							{ stdin: '' }
						);
						const delayed = await run(echo, {}, ['지연 ', '😀']);
						const args = await run('fn main { println(@env.args()) }', {
							stdin: '',
							programArgs: ['first', '한글'],
							workspaceFiles: [
								{
									path: 'moon.pkg.json',
									content: '{"import":["moonbitlang/core/env"]}'
								}
							]
						});
						const workspace = await run('fn main { println(compute(6)) }', {
							stdin: '',
							activePath: 'src/main.mbt',
							workspaceFiles: [
								{
									path: 'src/helper.mbt',
									content: 'fn compute(value : Int) -> Int { value * 7 }'
								}
							]
						});
						const math = await run(
							'fn main { println(@math.pow(3.0, 2.0).to_int()) }',
							{
								stdin: '',
								workspaceFiles: [
									{
										path: 'moon.pkg.json',
										content: '{"import":["moonbitlang/core/math"]}'
									}
								]
							}
						);
						const typeError = await run(
							'fn main { let value : Int = "wrong"; println(value) }',
							{ stdin: '' }
						);
						const syntaxError = await run('fn main {', { stdin: '' });
						const runtimeError = await run(
							'extern "wasm" fn read_byte() -> Int = "wasm_idle" "read_byte"\nfn main { println(1 / read_byte()) }',
							{ stdin: '\0' }
						);
						const exit = await run(
							'extern "wasm" fn stop(code : Int) -> Unit = "wasm_idle" "exit"\nfn main { stop(7) }',
							{ stdin: '' }
						);
						const outputLimit = await run(
							'fn main { while true { println("0123456789abcdef") } }',
							{ stdin: '', limits: { maxOutputBytes: 2048 } }
						);
						const timeout = await run('fn main { while true {} }', {
							stdin: '',
							limits: { compileTimeoutMs: 30000, runTimeoutMs: 100 }
						});
						const abort = new AbortController();
						const cancel = await run(echo, { signal: abort.signal }, undefined, abort);
						const recovery = await run('fn main { println(17) }', { stdin: '' });
						return {
							functions,
							enums,
							utf8,
							raw,
							eof,
							delayed,
							args,
							workspace,
							math,
							typeError,
							syntaxError,
							runtimeError,
							exit,
							outputLimit,
							timeout,
							cancel,
							recovery
						};
					} finally {
						runtime.terminate();
					}
				}, base);
				expect.soft(results.functions.value, JSON.stringify(results)).toBe(true);
				expect.soft(results.functions.output).toContain('[2, 4, 6]\n');
				expect.soft(results.enums).toMatchObject({ value: true, started: true });
				expect.soft(results.enums.output).toContain('42\n');
				expect.soft(results.utf8).toMatchObject({
					value: true,
					output: '한글😀',
					started: true
				});
				expect.soft(results.raw.value).toBe(true);
				expect.soft(results.raw.output).toContain('6\n');
				expect.soft(results.eof.value).toBe(true);
				expect.soft(results.eof.output).toContain('-1\n');
				expect.soft(results.delayed).toMatchObject({
					value: true,
					output: '지연 😀',
					started: true,
					outputBeforeEof: true
				});
				expect.soft(results.args.value).toBe(true);
				expect.soft(results.args.output).toContain('[main.mbt, first, 한글]');
				expect.soft(results.workspace.value).toBe(true);
				expect.soft(results.workspace.output).toContain('42\n');
				expect.soft(results.math.value, JSON.stringify(results.math)).toBe(true);
				expect.soft(results.math.output).toContain('9\n');
				expect.soft(results.typeError.value).toBe(false);
				expect.soft(results.typeError.output).toContain('E4014');
				expect.soft(results.syntaxError.value).toBe(false);
				expect.soft(results.syntaxError.output).toMatch(/Parse error|E3002/u);
				expect.soft(results.runtimeError.value).toBe(false);
				expect.soft(results.runtimeError.output).toMatch(/divide|zero|unreachable/u);
				expect.soft(results.exit.value).toBe(false);
				expect.soft(results.exit.output).toContain('exited with code 7');
				expect.soft(results.outputLimit.code).toBe('output-limit');
				expect.soft(results.timeout.code).toBe('timeout');
				expect.soft(results.timeout.started).toBe(true);
				expect.soft(results.cancel.code).toBe('cancelled');
				expect.soft(results.cancel.started).toBe(true);
				expect.soft(results.recovery.value).toBe(true);
				expect.soft(results.recovery.output).toContain('17\n');
			} finally {
				await context.close();
			}
		}
	);

	it(
		'runs verified gzip-only payloads without a service worker',
		{ timeout: 120_000, meta },
		async () => {
			const context = await browser.newContext({ serviceWorkers: 'block' });
			await addBrowserTestCookies(context, server.browserUrl);
			const base = server.browserUrl.replace(/\/?$/u, '/'),
				compressed = ['moonc.assets/code-172607e03e4760bd9001.wasm', 'stdlib.tar'],
				requests: string[] = [];
			await context.route('**/wasm-moonbit/**', async (route) => {
				const name = new URL(route.request().url()).pathname.split('/wasm-moonbit/')[1];
				if (compressed.includes(name)) {
					await route.fulfill({ status: 404, body: 'compressed delivery only' });
					return;
				}
				if (name.endsWith('.gz') && compressed.includes(name.slice(0, -3))) {
					requests.push(name);
					await route.fulfill({
						contentType: 'application/gzip',
						body: gzipSync(await readFile('static/wasm-moonbit/' + name.slice(0, -3)))
					});
					return;
				}
				await route.continue();
			});
			const page = await context.newPage();
			await page.route(base + 'moonbit-compressed-harness', (route) =>
				route.fulfill({
					contentType: 'text/html',
					body: '<!doctype html><title>MoonBit gzip</title>',
					headers: {
						'Cross-Origin-Opener-Policy': 'same-origin',
						'Cross-Origin-Embedder-Policy': 'require-corp'
					}
				})
			);
			try {
				await page.goto(base + 'moonbit-compressed-harness');
				await page.addScriptTag({
					type: 'module',
					content: `import Moonbit from ${JSON.stringify(base + 'src/lib/playground/moonbit.ts')}; globalThis.__Moonbit = Moonbit;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__Moonbit));
				const result = await page.evaluate(async (base) => {
					const runtime = new (globalThis as any).__Moonbit({ localResearchOnly: true });
					let output = '';
					runtime.output = (text: string) => {
						output += text;
					};
					try {
						await runtime.load({ rootUrl: new URL(base).pathname.replace(/\/$/u, '') });
						return {
							value: await runtime.run(
								'fn main { println(42) }',
								false,
								false,
								undefined,
								[],
								{ stdin: '' }
							),
							output
						};
					} finally {
						runtime.terminate();
					}
				}, base);
				expect(result.value).toBe(true);
				expect(result.output).toContain('42\n');
				expect(requests.sort()).toEqual(compressed.map((name) => name + '.gz').sort());
			} finally {
				await context.close();
			}
		}
	);
});
