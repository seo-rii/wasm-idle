// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chromium, type Page } from 'playwright-core';
import { runC3BrowserProbe } from '../../../scripts/c3-browser-probe.mjs';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_C3 === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

describe.skipIf(!enabled)('real C3 browser consumer', () => {
	it(
		'compiles C3 sources and enforces byte I/O, cancellation and limits in Chromium',
		{ timeout: 240_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			expect(await runC3BrowserProbe()).toBeDefined();
		}
	);

	it(
		'runs the default sample through the language selector with delayed terminal input and the C3 memory default',
		{ timeout: 240_000, meta: browserMeta },
		async () => {
			expect.hasAssertions();
			const server = process.env.WASM_IDLE_BROWSER_URL
				? { browserUrl: process.env.WASM_IDLE_BROWSER_URL, close: async () => {} }
				: await startBrowserPreviewServer({
						origin: 'http://127.0.0.1:4974',
						serverMode: 'dev'
					});
			const browser = await chromium.launch({
				headless: true,
				executablePath: await resolveChromiumExecutable()
			});
			let page: Page | undefined;
			const consoleMessages: string[] = [];
			const requestFailures: string[] = [];
			const pageErrors: string[] = [];
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
				page.setDefaultTimeout(60_000);
				page.setDefaultNavigationTimeout(180_000);
				page.on('console', (message) => consoleMessages.push(message.text()));
				page.on('pageerror', (error) => pageErrors.push(error.message));
				page.on('requestfailed', (request) =>
					requestFailures.push(`${request.failure()?.errorText}: ${request.url()}`)
				);
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				let activeState = await page.evaluate(() => ({
					crossOriginIsolated,
					serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
					sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined'
				}));
				for (let attempt = 0; attempt < 4; attempt += 1) {
					if (
						activeState.crossOriginIsolated &&
						activeState.serviceWorkerControlled &&
						activeState.sharedArrayBuffer
					) {
						break;
					}
					await page
						.evaluate(async () => {
							if (!navigator.serviceWorker) return;
							await Promise.race([
								navigator.serviceWorker.ready,
								new Promise((resolve) => setTimeout(resolve, 1_500))
							]);
						})
						.catch(() => {});
					await page
						.goto(server.browserUrl, { waitUntil: 'domcontentloaded' })
						.catch(() => null);
					await page.waitForTimeout(2_000 + attempt * 500);
					activeState = await page.evaluate(() => ({
						crossOriginIsolated,
						serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
						sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined'
					}));
				}
				expect(activeState).toEqual({
					crossOriginIsolated: true,
					serviceWorkerControlled: true,
					sharedArrayBuffer: true
				});
				await page.waitForFunction(() =>
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
				await page.waitForFunction(
					() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({ status: 'completed', exitCode: 0 });
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
						pageErrors,
						requestFailures: requestFailures.slice(-20),
						state: await page?.evaluate(() => ({
							crossOriginIsolated,
							serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
							sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
							debugHook: Object.keys((window as any).__wasmIdleDebug || {}),
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
		}
	);
});
