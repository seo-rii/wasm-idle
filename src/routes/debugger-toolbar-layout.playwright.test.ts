// @vitest-environment node

import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import {
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_REGRESSIONS === '1';
const browserOptions = {
	skip: !enabled,
	timeout: 120_000,
	meta: { browser: true, requiredBrowser: enabled }
};

async function withWorkspacePage(
	run: (page: Page, context: BrowserContext, browserUrl: string) => Promise<void>
) {
	await runWithBrowserProbeSessionLock(async () => {
		const providedUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		const server = shouldReuseProvidedBrowserUrl(providedUrl)
			? { browserUrl: providedUrl, close: async () => {} }
			: await startBrowserPreviewServer({
					origin: 'http://127.0.0.1:4809',
					serverMode: 'dev'
				});
		const browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
		const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
		await addBrowserTestCookies(context, server.browserUrl);
		const page = await context.newPage();
		page.setDefaultTimeout(60_000);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		try {
			await run(page, context, server.browserUrl);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
			await browser.close();
			await server.close();
		}
	});
}

describe('narrow paused debugger controls', () => {
	it(
		'keeps every debugger action inside the clipped shell at a 300px pane width',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				await context.addInitScript(() =>
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							version: 6,
							language: 'PYTHON',
							activePath: 'main.py',
							files: [
								{
									path: 'main.py',
									content: 'value = 1\nprint("debug-layout", value)\n'
								}
							],
							lspEnabled: false,
							sidebarOpen: true
						})
					)
				);
				await page.setViewportSize({ width: 961, height: 960 });
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.waitForFunction(() =>
					(window as any).__wasmIdleDebug?.getEditorValue().includes('debug-layout')
				);
				await page.evaluate(() => (window as any).__wasmIdleDebug.setBreakpoints([2]));
				await page.getByRole('button', { name: 'Debug', exact: true }).click();
				await page.waitForFunction(
					() => (window as any).__wasmIdleDebug?.getDebugState().paused,
					undefined,
					{ timeout: 60_000 }
				);
				for (const width of [961, 1000]) {
					await page.setViewportSize({ width, height: 960 });
					const showFiles = page.getByRole('button', { name: 'Show files', exact: true });
					if (await showFiles.count()) await showFiles.click();
					await page.waitForTimeout(100);
					const controls = await page.evaluate(() => {
						const shell = document
							.querySelector('.debug-shell')!
							.getBoundingClientRect();
						const pane = document
							.querySelector('.terminal-pane')!
							.getBoundingClientRect();
						return {
							paneWidth: pane.width,
							actions: [...document.querySelectorAll('.debug-controls button')].map(
								(button) => {
									const rect = button.getBoundingClientRect();
									const hit = document.elementFromPoint(
										rect.x + rect.width / 2,
										rect.y + rect.height / 2
									);
									return {
										name: button.getAttribute('aria-label'),
										insideShell:
											rect.left >= shell.left && rect.right <= shell.right,
										receivesPointer: hit === button || button.contains(hit)
									};
								}
							)
						};
					});
					expect(controls.paneWidth).toBeLessThanOrEqual(304);
					expect(controls.actions).toHaveLength(6);
					for (const action of controls.actions) {
						expect(action.insideShell, action.name || '').toBe(true);
						expect(action.receivesPointer, action.name || '').toBe(true);
					}
				}
				await page.getByRole('button', { name: /Stop Debug/ }).click();
			});
		}
	);
});
