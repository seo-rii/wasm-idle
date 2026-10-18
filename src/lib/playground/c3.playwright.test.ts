// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { chromium, type Page } from 'playwright-core';
import { runC3BrowserProbe } from '../../../scripts/c3-browser-probe.mjs';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import {
	prepareContainerRuntimePage,
	observeContainerRuntimeWorkers
} from '../../../scripts/container-runtime-browser-observer.mjs';
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
			let runtimeObservation:
				| Awaited<ReturnType<typeof observeContainerRuntimeWorkers>>
				| undefined;
			const consoleMessages: string[] = [];
			const requestFailures: string[] = [];
			const pageErrors: string[] = [];
			try {
				const context = await browser.newContext();
				await addBrowserTestCookies(context, server.browserUrl);
				page = await context.newPage();
				page.setDefaultTimeout(60_000);
				page.setDefaultNavigationTimeout(180_000);
				page.on('console', (message) => consoleMessages.push(message.text()));
				page.on('requestfailed', (request) =>
					requestFailures.push(`${request.failure()?.errorText}: ${request.url()}`)
				);
				await prepareContainerRuntimePage(page, server.browserUrl);
				page.on('pageerror', (error) => pageErrors.push(error.message));
				const activeState = await page.evaluate(() => ({
					crossOriginIsolated,
					serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
					sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined'
				}));
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
				runtimeObservation = await observeContainerRuntimeWorkers(page, {
					runtimePath: '/wasm-c3/',
					evidenceKind: 'c3-memory-limits'
				});
				await page.locator('button.action-button--run').first().click();
				await expect
					.poll(
						async () =>
							(await runtimeObservation!.read()).evidence.some((event: any) => event.guest),
						{ timeout: 60_000 }
					)
					.toBe(true);
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
				const observed = await runtimeObservation.read();
				const evidence = {
					runs: observed.runs,
					memory: observed.evidence.at(-1),
					transcript: await page
						.locator('[data-testid="terminal-debug-output"]')
						.textContent()
				};
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
						ownerObservation: await runtimeObservation?.read().catch(() => null),
						state: await page?.evaluate(() => ({
							crossOriginIsolated,
							serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
							sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
							debugHook: Object.keys((window as any).__wasmIdleDebug || {}),
							transcript: document.querySelector(
								'[data-testid="terminal-debug-output"]'
							)?.textContent,
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
