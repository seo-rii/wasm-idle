// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import { isStdinEditorReady } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { syncWasmDartAssets } from '../../../scripts/sync-wasm-dart.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_DART === '1';
const meta = { browser: true, requiredBrowser: enabled };

describe.skipIf(!enabled)('official Dart 3.14 compiler in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		await syncWasmDartAssets();
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4997',
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
		'runs original language features, stdin/EOF, program arguments, workspace imports and lifecycle recovery',
		{ timeout: 240_000, meta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			page.setDefaultTimeout(180_000);
			const base = server.browserUrl.replace(/\/?$/u, '/');
			await page.route(base + 'dart-runtime-harness', (route) =>
				route.fulfill({
					contentType: 'text/html',
					body: '<!doctype html><title>Dart runtime</title>',
					headers: {
						'Cross-Origin-Opener-Policy': 'same-origin',
						'Cross-Origin-Embedder-Policy': 'require-corp'
					}
				})
			);
			try {
				await page.goto(base + 'dart-runtime-harness');
				await page.addScriptTag({
					type: 'module',
					content: `import Dart from ${JSON.stringify(base + 'src/lib/playground/dart.ts')}; globalThis.__Dart = Dart;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__Dart));
				const results = await page.evaluate(async (base) => {
					const runtime = new (globalThis as any).__Dart();
					const run = async (
						source: string,
						options: Record<string, unknown> = {},
						delayed?: string[],
						abort?: AbortController
					) => {
						await runtime.load({ rootUrl: new URL(base).pathname.replace(/\/$/u, '') });
						let output = '';
						runtime.output = (text: string) => {
							output += text;
						};
						let started = false;
						const timers: ReturnType<typeof setTimeout>[] = [];
						const later = (callback: () => void, delay: number) =>
							timers.push(setTimeout(callback, delay));
						try {
							const value = await runtime.run(
								source,
								false,
								false,
								{
									report(event: { kind?: string; reason?: string }) {
										if (event.kind !== 'ready' || started) return;
										started = true;
										if (abort) later(() => abort.abort(), 30);
										if (delayed) {
											delayed.forEach((text, i) =>
												later(() => runtime.write(text), (i + 1) * 30)
											);
											later(() => runtime.eof(), (delayed.length + 1) * 30);
										}
									}
								},
								[],
								options
							);
							return { value, output, started, code: '' };
						} catch (error) {
							return {
								value: false,
								output,
								started,
								code: String((error as { code?: string }).code || ''),
								error: String(error)
							};
						} finally {
							for (const timer of timers) clearTimeout(timer);
						}
					};
					try {
						const basic = await run('void main() { print(6 * 7); }', {
							stdin: '',
							limits: { compileTimeoutMs: 15000, runTimeoutMs: 3000 }
						});
						const input = await run(
							"import 'dart:io'; void main() { stdout.write(stdin.readLineSync()); }",
							{ stdin: '한글 🦀\n' }
						);
						const partial = await run(
							"import 'dart:io'; void main() { print(stdin.readLineSync()); print(stdin.readLineSync()); }",
							{ stdin: 'partial' }
						);
						const delayed = await run(
							"import 'dart:io'; void main() { print(stdin.readLineSync()); }",
							{},
							['지연 ', '입력\n']
						);
						const argumentsResult = await run(
							'void main(List<String> args) { print(args.join("|")); }',
							{ stdin: '', programArgs: ['first', '한글'] }
						);
						const imports = await run(
							"import 'helper.dart'; void main() { print(answer); }",
							{
								stdin: '',
								activePath: 'src/main.dart',
								workspaceFiles: [
									{ path: 'src/helper.dart', content: 'const answer = 17;' }
								]
							}
						);
						const features = await run(
							'Future<void> main() async { await Future.delayed(Duration(milliseconds: 2)); final values = <int>[1,2,3]; final (a,b) = (values.first, values.last); print("${a+b}"); }',
							{ stdin: '' }
						);
						const asyncInput = await run(
							"import 'dart:io'; import 'dart:convert'; Future<void> main() async { print(await stdin.transform(utf8.decoder).join()); }",
							{ stdin: 'stream input' }
						);
						const firstChunk = await run(
							"import 'dart:io'; import 'dart:convert'; Future<void> main() async { print(await stdin.transform(utf8.decoder).first); }",
							{},
							['first chunk']
						);
						const pendingTimer = await run(
							'void main() { Future.delayed(Duration(milliseconds: 10), () { print("timer completed"); }); }',
							{ stdin: '' }
						);
						const invalid = await run('void main() { MissingName; }', { stdin: '' });
						const exit = await run("import 'dart:io'; void main() { exit(7); }", {
							stdin: ''
						});
						const limited = await run('void main() { print("x" * 100); }', {
							stdin: '',
							limits: { maxOutputBytes: 16 }
						});
						const controller = new AbortController();
						const cancelled = await run(
							"import 'dart:io'; void main() { stdin.readLineSync(); }",
							{ signal: controller.signal },
							undefined,
							controller
						);
						const timeout = await run(
							"import 'dart:io'; void main() { stdin.readLineSync(); }",
							{ limits: { runTimeoutMs: 200, compileTimeoutMs: 60000 } }
						);
						const recovered = await run('void main() { print("recovered"); }', {
							stdin: ''
						});
						return {
							firstChunk,
							pendingTimer,
							basic,
							input,
							partial,
							delayed,
							argumentsResult,
							imports,
							features,
							asyncInput,
							invalid,
							exit,
							limited,
							cancelled,
							timeout,
							recovered
						};
					} finally {
						await runtime.dispose();
					}
				}, base);
				expect(results.basic).toMatchObject({ value: true, output: '42\n' });
				expect(results.input).toMatchObject({ value: true, output: '한글 🦀' });
				expect(results.partial).toMatchObject({ value: true, output: 'partial\nnull\n' });
				expect(results.delayed).toMatchObject({ value: true, output: '지연 입력\n' });
				expect(results.argumentsResult).toMatchObject({
					value: true,
					output: 'first|한글\n'
				});
				expect(results.imports).toMatchObject({ value: true, output: '17\n' });
				expect(results.features).toMatchObject({ value: true, output: '4\n' });
				expect(results.asyncInput).toMatchObject({ value: true, output: 'stream input\n' });
				expect(results.firstChunk).toMatchObject({ value: true, output: 'first chunk\n' });
				expect(results.pendingTimer).toMatchObject({
					value: true,
					output: 'timer completed\n'
				});
				expect(results.invalid.value).toBe(false);
				expect(results.exit.value).toBe(false);
				expect(results.limited.code).toBe('output-limit');
				expect(results.cancelled.code).toBe('cancelled');
				expect(results.timeout.code).toBe('timeout');
				expect(results.recovered).toMatchObject({ value: true, output: 'recovered\n' });
			} finally {
				await context.close();
			}
		}
	);
	it(
		'runs the unchanged default example through the actual selector, Run and terminal input',
		{ timeout: 180_000, meta: meta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			await disableBrowserPrewarm(context);
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			const requests: string[] = [];
			context.on('request', (request) => {
				if (new URL(request.url()).pathname.includes('/wasm-dart/'))
					requests.push(request.url());
			});
			try {
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(isStdinEditorReady, '');
				await page.waitForFunction(() => crossOriginIsolated);
				expect(requests).toEqual([]);
				await page.locator('#language-select').selectOption('DART');
				await page.waitForFunction(isStdinEditorReady, 'DART');
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
					editorDefaults.dart
				);
				const previousId = await page.evaluate(
					() => (window as any).__wasmIdleDebug.getExecutionState().id
				);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction((id) => {
					const state = (window as any).__wasmIdleDebug.getExecutionState();
					return state.id > id && !['idle', 'preparing'].includes(state.status);
				}, previousId);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('hello Dart\n', false);
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
				await page.waitForFunction((id) => {
					const state = (window as any).__wasmIdleDebug.getExecutionState();
					return state.id > id && state.endedAt !== null;
				}, previousId);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({
					language: 'DART',
					status: 'completed',
					exitCode: 0
				});
				expect(
					(
						await page.locator('[data-testid="terminal-debug-output"]').textContent()
					)?.replaceAll('\r', '')
				).toContain('hello Dart\n');
				expect(requests.length).toBeGreaterThan(0);
			} finally {
				await context.close();
			}
		}
	);

	it(
		'executes pinned gzip-only compiler assets without a service worker',
		{ timeout: 120_000, meta },
		async () => {
			const context = await browser.newContext({ serviceWorkers: 'block' });
			await addBrowserTestCookies(context, server.browserUrl);
			const base = server.browserUrl.replace(/\/?$/u, '/');
			const compressed = ['worker.wasm', 'sdk.tar', 'dart_sdk.js'];
			const gzipRequests: string[] = [];
			await context.route('**/wasm-dart/*', async (route) => {
				const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
				if (compressed.includes(name)) {
					await route.fulfill({ status: 404, body: 'compressed delivery only' });
					return;
				}
				if (name.endsWith('.gz') && compressed.includes(name.slice(0, -3))) {
					gzipRequests.push(name);
					await route.fulfill({
						contentType: 'application/gzip',
						body: gzipSync(await readFile(`static/wasm-dart/${name.slice(0, -3)}`))
					});
					return;
				}
				await route.continue();
			});
			const page = await context.newPage();
			await page.route(base + 'dart-compressed-harness', (route) =>
				route.fulfill({
					contentType: 'text/html',
					body: '<!doctype html><title>Dart compressed</title>',
					headers: {
						'Cross-Origin-Opener-Policy': 'same-origin',
						'Cross-Origin-Embedder-Policy': 'require-corp'
					}
				})
			);
			try {
				await page.goto(base + 'dart-compressed-harness');
				await page.addScriptTag({
					type: 'module',
					content: `import Dart from ${JSON.stringify(base + 'src/lib/playground/dart.ts')}; globalThis.__Dart = Dart;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__Dart));
				const result = await page.evaluate(async (base) => {
					const runtime = new (globalThis as any).__Dart();
					let output = '';
					runtime.output = (text: string) => {
						output += text;
					};
					try {
						await runtime.load({ rootUrl: new URL(base).pathname.replace(/\/$/u, '') });
						const value = await runtime.run(
							"import 'dart:io'; void main() { print(stdin.readLineSync()); }",
							false,
							false,
							undefined,
							[],
							{ stdin: 'gzip input\n' }
						);
						return { value, output };
					} finally {
						await runtime.dispose();
					}
				}, base);
				expect(result).toEqual({ value: true, output: 'gzip input\n' });
				expect(gzipRequests.sort()).toEqual(compressed.map((name) => `${name}.gz`).sort());
			} finally {
				await context.close();
			}
		}
	);
});
