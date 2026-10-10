// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { installBrowserRuntimeDelivery } from '../../../scripts/browser-runtime-delivery.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const promptSource = `def main : IO Unit := do
  let stdin ← IO.getStdin
  IO.println "count?"
  let count := (← stdin.getLine).trimAscii.toString.toNat!
  let mut total := 0
  for _ in [0:count] do
    total := total + (← stdin.getLine).trimAscii.toString.toInt!
  IO.println s!"sum={total} 안녕"`;

// The adapter checks load Vite's real Lean 4 module; the UI check uses the normal language
// selector, Monaco editor, terminal and streaming stdin path. Assets come from sync:wasm-lean4.
const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_LEAN4 === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

describe.skipIf(!enabled)('real Lean 4 runtime in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4987',
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
		'elaborates and interprets programs with delayed stdin, arguments, diagnostics and cancellation',
		{ timeout: 600_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			const consoleMessages: string[] = [];
			page.on('console', (message) => consoleMessages.push(message.text()));
			try {
				const harnessUrl = `${server.browserUrl.replace(/\/$/, '')}/lean4-runtime-harness`;
				await context.route(harnessUrl, (route) =>
					route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>Lean 4 runtime test</title>',
						headers: {
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						}
					})
				);
				await page.goto(harnessUrl, { waitUntil: 'domcontentloaded' });
				const base = `${server.browserUrl.replace(/\/$/, '')}/`;
				await installBrowserRuntimeDelivery(page, base);
				await page.addScriptTag({
					type: 'module',
					content: `import Lean4 from ${JSON.stringify(base + 'src/lib/playground/lean4.ts')}; globalThis.__lean4Sandbox = Lean4;`
				});
				await page.waitForFunction(() => Boolean((globalThis as any).__lean4Sandbox));
				const result = await page.evaluate(
					async ({ source, base }) => {
						const Lean4 = (globalThis as any).__lean4Sandbox;
						const sandbox = new Lean4();
						const rootUrl = new URL(base).pathname.replace(/\/$/, '');
						await sandbox.load({ rootUrl });
						const reports: Record<string, unknown> = { isolated: crossOriginIsolated };
						async function run(
							code: string,
							options: Record<string, unknown> = {},
							onOutput?: (output: string) => void,
							args: string[] = []
						) {
							let output = '';
							const diagnostics: unknown[] = [];
							sandbox.output = (text: string) => {
								output += text;
								onOutput?.(output);
							};
							sandbox.oncompilerdiagnostic = (diagnostic: unknown) =>
								diagnostics.push(diagnostic);
							const started = performance.now();
							try {
								const value = await sandbox.run(
									code,
									false,
									true,
									undefined,
									args,
									{
										activePath: 'Main.lean',
										limits: { compileTimeoutMs: 120000, runTimeoutMs: 120000 },
										...options
									}
								);
								return {
									value,
									output,
									diagnostics,
									evidence: sandbox.evidence.current,
									ms: Math.round(performance.now() - started)
								};
							} catch (error) {
								return {
									error: (error as { code?: string }).code,
									message: String(error),
									output,
									diagnostics
								};
							}
						}
						try {
							let sent = false;
							reports.delayed = await run(source, {}, (output) => {
								if (sent || !output.includes('count?')) return;
								sent = true;
								setTimeout(() => {
									sandbox.write('2\n');
									setTimeout(() => {
										sandbox.write('40\n2\n');
										sandbox.eof();
									}, 200);
								}, 200);
							});
							reports.prebuffered = await run(source, { stdin: '3\n1\n-2\n10\n' });
							reports.args = await run(
								'def main (args : List String) : IO UInt32 := do\n  IO.println s!"args={args}"\n  pure 3',
								{ stdin: '' },
								undefined,
								['a b', 'c']
							);
							reports.boundedMemory = await run(
								'def main : IO Unit := IO.println "bounded"',
								{
									stdin: '',
									limits: {
										compileTimeoutMs: 120000,
										runTimeoutMs: 120000,
										maxWasmMemoryBytes: 512 * 1024 * 1024
									}
								}
							);
							reports.invalid = await run(
								'def main : IO Unit := do\n  IO.println (1 + "two")',
								{ stdin: '' }
							);
							const controller = new AbortController();
							reports.cancel = await run(
								source,
								{ signal: controller.signal },
								(output) => {
									if (output.includes('count?'))
										controller.abort('cancel blocked getLine');
								}
							);
							reports.afterCancel = await run(
								'def main : IO Unit := IO.println "fresh-worker"',
								{ stdin: '' }
							);
							return reports;
						} finally {
							await sandbox.dispose();
						}
					},
					{ source: promptSource, base: `${server.browserUrl.replace(/\/$/, '')}/` }
				);
				process.stdout.write(`Lean 4 adapter result: ${JSON.stringify(result)}\n`);
				expect(result.isolated).toBe(true);
				expect(result.delayed).toMatchObject({
					value: true,
					output: 'count?\nsum=42 안녕\n',
					evidence: {
						protocol: 'wasm-idle-lean4-evidence-v1',
						leanVersion: '4.34.1',
						exitCode: 0
					}
				});
				expect(result.prebuffered).toMatchObject({
					value: true,
					output: 'count?\nsum=9 안녕\n'
				});
				expect(result.args).toMatchObject({
					value: false,
					output: 'args=[a b, c]\n',
					evidence: { exitCode: 3 }
				});
				expect(result.boundedMemory).toMatchObject({ value: true, output: 'bounded\n' });
				expect(result.invalid).toMatchObject({
					value: false,
					diagnostics: [
						{
							fileName: 'Main.lean',
							lineNumber: 2,
							columnNumber: 15,
							severity: 'error'
						}
					]
				});
				expect((result.invalid as any).diagnostics[0].message).toContain('HAdd Nat String');
				expect(String(result.invalid && (result.invalid as any).output)).toContain(
					'Main.lean:2:14: error'
				);
				expect(result.cancel).toMatchObject({ error: 'cancelled' });
				expect(result.afterCancel).toMatchObject({ value: true, output: 'fresh-worker\n' });
			} catch (error) {
				process.stdout.write(
					`Lean 4 console: ${JSON.stringify(consoleMessages.slice(-20))}\n`
				);
				throw error;
			} finally {
				await context.close();
			}
		}
	);

	it(
		'runs the default sample from the language selector with delayed terminal input',
		{ timeout: 600_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			const browserUrl = process.env.WASM_IDLE_BROWSER_URL || server.browserUrl;
			const context = await browser.newContext();
			await addBrowserTestCookies(context, browserUrl);
			const page = await context.newPage();
			const pageErrors: string[] = [];
			page.setDefaultTimeout(240_000);
			page.on('pageerror', (error) => pageErrors.push(error.message));
			try {
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(
					() =>
						crossOriginIsolated &&
						Boolean((window as any).__wasmIdleDebug?.getEditorValue)
				);
				await page.locator('#language-select').selectOption('LEAN4');
				await page.waitForFunction(() =>
					(window as any).__wasmIdleDebug.getEditorValue().includes('What is your name?')
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(editorDefaults.lean4);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('What is your name?')
				);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('Lean\n', false);
				});
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('Enter numbers separated by spaces:')
				);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('1 2 3 4\n', false);
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
				await page.waitForFunction(
					() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({ status: 'completed', exitCode: 0 });
				const transcript = await page.evaluate(
					() =>
						document.querySelector('[data-testid="terminal-debug-output"]')?.textContent
				);
				process.stdout.write(`Lean 4 UI transcript: ${JSON.stringify(transcript)}\n`);
				expect(transcript).toContain('Hello, Lean!');
				expect(transcript).toContain('sum = 10');
				expect(pageErrors).toEqual([]);
			} finally {
				await context.close();
			}
		}
	);
});
