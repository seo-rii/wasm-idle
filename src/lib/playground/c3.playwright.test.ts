// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chromium, type Page } from 'playwright-core';
import { runC3BrowserProbe } from '../../../scripts/c3-browser-probe.mjs';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

describe.skipIf(process.env.WASM_IDLE_RUN_REAL_BROWSER_C3 !== '1')(
	'real C3 browser consumer',
	() => {
		it('compiles C3 sources and enforces byte I/O, cancellation and limits in Chromium', async () => {
			await runC3BrowserProbe();
		}, 240_000);

		it('runs the default sample through the language selector with delayed terminal input and the C3 memory default', async () => {
			const server = await startBrowserPreviewServer({
				origin: 'http://127.0.0.1:4974',
				serverMode: 'dev'
			});
			const browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable()
			});
			let page: Page | undefined;
			const consoleMessages: string[] = [];
			try {
				const context = await browser.newContext();
				await addBrowserTestCookies(context, server.browserUrl);
				await context.addInitScript(() => {
					const target = window as any;
					target.__c3ConsumerRuns = [];
					target.__c3ConsumerEvidence = [];
					const BrowserWorker = Worker;
					target.Worker = class extends BrowserWorker {
						constructor(url: string | URL, options?: WorkerOptions) {
							super(url, options);
							this.addEventListener('message', ({ data }) => {
								if (data.evidence?.kind === 'c3-memory-limits')
									target.__c3ConsumerEvidence.push(data.evidence);
							});
						}
						postMessage(message: any, transfer: any = []) {
							if (message.run && message.baseUrl?.includes('/wasm-c3/'))
								target.__c3ConsumerRuns.push({
									limits: message.limits,
									code: message.code
								});
							super.postMessage(message, transfer);
						}
					};
				});
				page = await context.newPage();
				page.on('console', (message) => consoleMessages.push(message.text()));
				const pageErrors: string[] = [];
				page.on('pageerror', (error) => pageErrors.push(error.message));
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(
					() =>
						crossOriginIsolated &&
						Boolean((window as any).__wasmIdleDebug?.getEditorValue)
				);
				await page.locator('#language-select').selectOption('C3');
				await page.waitForFunction(() =>
					(window as any).__wasmIdleDebug
						.getEditorValue()
						.includes('extern fn int read_byte()')
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(editorDefaults.c3);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction(() =>
					(window as any).__c3ConsumerEvidence.some((event: any) => event.guest)
				);
				await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('UI 입력 🦀\n', false);
				});
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('UI 입력 🦀')
				);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('Process finished after')
				);
				const evidence = await page.evaluate(() => ({
					runs: (window as any).__c3ConsumerRuns,
					memory: (window as any).__c3ConsumerEvidence.at(-1),
					transcript: document.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent
				}));
				expect(evidence.runs).toHaveLength(1);
				expect(evidence.runs[0].limits.maxWasmMemoryBytes).toBe(1024 ** 3);
				expect(
					evidence.memory.compiler.maximumBytes + evidence.memory.guest.maximumBytes
				).toBe(1024 ** 3);
				expect(evidence.transcript).toContain('UI 입력 🦀');
				expect(pageErrors).toEqual([]);
				console.info('C3 UI acceptance:', JSON.stringify(evidence));
			} catch (error) {
				console.info(
					'C3 UI failure:',
					JSON.stringify({
						console: consoleMessages.slice(-20),
						state: await page?.evaluate(() => ({
							transcript: document.querySelector(
								'[data-testid="terminal-debug-output"]'
							)?.textContent,
							runs: (window as any).__c3ConsumerRuns,
							memory: (window as any).__c3ConsumerEvidence,
							url: location.href
						}))
					})
				);
				throw error;
			} finally {
				await browser.close();
				await server.close();
			}
		}, 180_000);
	}
);
