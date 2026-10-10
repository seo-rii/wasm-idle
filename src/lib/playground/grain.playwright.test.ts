// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const sumSource = `module Main

from "buffer" include Buffer
from "bytes" include Bytes
from "list" include List
from "number" include Number
from "string" include String
from "wasi/file" include File

let readLine = () => {
  let line = Buffer.make(16)
  let mut reading = true
  let mut sawInput = false
  while (reading) {
    match (File.fdRead(File.stdin, 1)) {
      Ok((bytes, 1)) => {
        sawInput = true
        if (Bytes.getUint8(0, bytes) == 10us) {
          reading = false
        } else {
          Buffer.addBytes(bytes, line)
        }
      },
      _ => reading = false,
    }
  }
  if (sawInput) Some(Buffer.toString(line)) else None
}

print("count?")
let count = match (readLine()) {
  Some(line) => match (Number.parseInt(String.trim(line), 10)) {
    Ok(value) => value,
    Err(_) => 0,
  },
  None => 0,
}
print("values?")
let values = match (readLine()) {
  Some(line) => String.split(" ", String.trim(line)),
  None => [>],
}
let mut sum = 0
for (let mut index = 0; index < count; index += 1) {
  match (Number.parseInt(values[index], 10)) {
    Ok(value) => sum += value,
    Err(_) => void,
  }
}
print("sum=" ++ toString(sum))
`;

// The adapter checks load Vite's real source module; the UI check uses the normal language
// selector, Monaco editor, terminal, and streaming stdin path.
const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_GRAIN === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

describe.skipIf(!enabled)('real Grain compiler in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4983',
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
		'compiles Grain, streams delayed stdin and EOF, reports diagnostics and enforces limits/cancellation',
		{ timeout: 480_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			const pageLog: string[] = [];
			page.on('console', (message) => pageLog.push(message.text()));
			page.on('pageerror', (error) => pageLog.push(error.message));
			try {
				// Load the real adapter module inside the application page, so SvelteKit's public
				// environment and the page's cross-origin isolation are the ones users get.
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(
					() =>
						crossOriginIsolated &&
						Boolean((window as any).__wasmIdleDebug?.getEditorValue)
				);
				const base = `${server.browserUrl.replace(/\/$/, '')}/`;
				await page.addScriptTag({
					type: 'module',
					content: `import Grain from ${JSON.stringify(base + 'src/lib/playground/grain.ts')}; globalThis.__grainSandbox = Grain;`
				});
				await page
					.waitForFunction(() => Boolean((globalThis as any).__grainSandbox))
					.catch((error) => {
						throw new Error(
							`Grain sandbox module failed to load: ${pageLog.join('\n')}`,
							{
								cause: error
							}
						);
					});
				const result = await page.evaluate(
					async ({ source, defaultSource, base }) => {
						const Grain = (globalThis as any).__grainSandbox;
						const sandbox = new Grain();
						const rootUrl = new URL(base).pathname.replace(/\/$/, '');
						await sandbox.load({ rootUrl });
						const reports: Record<string, unknown> = { isolated: crossOriginIsolated };
						async function run(
							code: string,
							options: Record<string, unknown> = {},
							onOutput?: (output: string) => void
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
								const value = await sandbox.run(code, false, true, undefined, [], {
									activePath: 'main.gr',
									limits: { compileTimeoutMs: 120_000, runTimeoutMs: 20_000 },
									...options
								});
								return {
									value,
									output,
									diagnostics,
									evidence: sandbox.memoryEvidence.current,
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
									sandbox.write('3\n');
									setTimeout(() => {
										sandbox.write('10 20 30\n');
										sandbox.eof();
									}, 150);
								}, 150);
							});
							reports.prebuffered = await run(defaultSource, {
								stdin: 'Ada Lovelace 世界\n'
							});
							reports.eof = await run(defaultSource, {}, (output) => {
								if (output.includes('What is your name?'))
									setTimeout(() => sandbox.eof(), 100);
							});
							reports.workspace = await run(
								'module Main\n\nfrom "./greeting.gr" include Greeting\n\nprint(Greeting.message)\n',
								{
									stdin: '',
									workspaceFiles: [
										{
											path: 'greeting.gr',
											content:
												'module Greeting\n\nprovide let message = "from workspace"\n'
										}
									]
								}
							);
							reports.args = await run(
								'module Main\n\nfrom "array" include Array\nfrom "wasi/process" include Process\n\nmatch (Process.argv()) {\n  Ok(args) => print(Array.length(args)),\n  Err(_) => print("no args"),\n}\n',
								{ stdin: '', programArgs: ['one', 'two'] }
							);
							reports.invalid = await run(
								'module Main\n\nlet value: Number = "text"\nprint(value)\n',
								{ stdin: '' }
							);
							reports.exitCode = await run(
								'module Main\n\nfrom "wasi/process" include Process\n\nprint("bye")\nProcess.exit(3)\n',
								{ stdin: '' }
							);
							const controller = new AbortController();
							reports.cancel = await run(
								source,
								{ signal: controller.signal },
								(output) => {
									if (output.includes('count?'))
										controller.abort('cancel blocked read');
								}
							);
							reports.afterCancel = await run(
								'module Main\n\nprint("fresh-worker")\n',
								{ stdin: '' }
							);
							reports.outputLimit = await run(
								'module Main\n\nfor (let mut index = 0; index < 10000; index += 1) {\n  print("many-bytes")\n}\n',
								{ stdin: '', limits: { maxOutputBytes: 64 } }
							);
							reports.memoryLimit = await run(
								'module Main\n\nfrom "array" include Array\n\nlet values = Array.make(4000000, 1)\nprint(Array.length(values))\n',
								{ stdin: '', limits: { maxWasmMemoryBytes: 8 * 1024 * 1024 } }
							);
							reports.timeout = await run(
								'module Main\n\nlet mut value = 0\nwhile (true) {\n  value += 1\n}\n',
								{
									stdin: '',
									limits: { compileTimeoutMs: 120_000, runTimeoutMs: 1000 }
								}
							);
							return reports;
						} finally {
							await sandbox.dispose();
						}
					},
					{
						source: sumSource,
						defaultSource: editorDefaults.grain,
						base: `${server.browserUrl.replace(/\/$/, '')}/`
					}
				);
				process.stdout.write(`Grain adapter results: ${JSON.stringify(result)}\n`);
				expect(result.isolated).toBe(true);
				expect(result.delayed).toMatchObject({
					value: true,
					output: 'count?\nvalues?\nsum=60\n',
					evidence: {
						protocol: 'wasm-idle-grain-evidence-v1',
						maximumMemoryBytes: 512 * 1024 * 1024,
						exitCode: 0
					}
				});
				expect(result.prebuffered).toMatchObject({
					value: true,
					output: 'What is your name?\nHello, Ada Lovelace 世界!\n'
				});
				expect(result.eof).toMatchObject({
					value: true,
					output: 'What is your name?\nHello, stranger!\n'
				});
				expect(result.workspace).toMatchObject({ value: true, output: 'from workspace\n' });
				expect(result.args).toMatchObject({ value: true, output: '3\n' });
				expect(result.invalid).toMatchObject({
					value: false,
					diagnostics: [
						{ fileName: 'main.gr', lineNumber: 3, columnNumber: 21, severity: 'error' }
					]
				});
				expect((result.invalid as { output: string }).output).toContain(
					'This expression has type String'
				);
				expect(result.exitCode).toMatchObject({
					value: false,
					output: 'bye\n',
					evidence: { exitCode: 3 }
				});
				expect(result.cancel).toMatchObject({ error: 'cancelled' });
				expect(result.afterCancel).toMatchObject({ value: true, output: 'fresh-worker\n' });
				expect(result.outputLimit).toMatchObject({ error: 'output-limit' });
				expect(result.memoryLimit).toMatchObject({ error: 'resource-limit' });
				expect(result.timeout).toMatchObject({ error: 'timeout' });
			} finally {
				await context.close();
			}
		}
	);

	it(
		'runs the default sample from the language selector with delayed terminal input',
		{ timeout: 240_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			const browserUrl = process.env.WASM_IDLE_BROWSER_URL || server.browserUrl;
			const context = await browser.newContext();
			await addBrowserTestCookies(context, browserUrl);
			await context.addInitScript(() => {
				const target = window as any;
				target.__grainRuns = [];
				const BrowserWorker = Worker;
				target.Worker = class extends BrowserWorker {
					postMessage(message: any, transfer: any = []) {
						if (message?.run && message.baseUrl?.includes('/wasm-grain/'))
							target.__grainRuns.push({ code: message.code, limits: message.limits });
						super.postMessage(message, transfer);
					}
				};
			});
			const page = await context.newPage();
			const pageErrors: string[] = [];
			page.setDefaultTimeout(120_000);
			page.on('pageerror', (error) => pageErrors.push(error.message));
			try {
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(
					() =>
						crossOriginIsolated &&
						Boolean((window as any).__wasmIdleDebug?.getEditorValue)
				);
				await page.locator('#language-select').selectOption('GRAIN');
				await page.waitForFunction(() =>
					(window as any).__wasmIdleDebug.getEditorValue().includes('What is your name?')
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(editorDefaults.grain);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('What is your name?')
				);
				await page.waitForTimeout(200);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput(
						'Grace Hopper\n',
						false
					);
				});
				await page.waitForFunction(
					() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({ status: 'completed', exitCode: 0 });
				const evidence = await page.evaluate(() => ({
					runs: (window as any).__grainRuns,
					transcript: document.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent
				}));
				expect(evidence.runs).toHaveLength(1);
				expect(evidence.runs[0].code).toBe(editorDefaults.grain);
				expect(evidence.transcript).toContain('Hello, Grace Hopper!');
				expect(pageErrors).toEqual([]);
			} finally {
				await context.close();
			}
		}
	);
});
