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

describe('optional workspace banner layout', () => {
	it(
		'keeps recovery and manual-share controls above the workbench and clickable',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				await context.addInitScript(() =>
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							files: [{ path: 'main.cpp', content: 'int recoverable;' }],
							openTabs: 'broken'
						})
					)
				);
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.locator('[data-workspace-recovery]').waitFor();
				await page.evaluate(() =>
					Object.defineProperty(navigator, 'clipboard', {
						configurable: true,
						value: {
							writeText: async () => {
								throw new Error('Clipboard unavailable');
							}
						}
					})
				);
				await page.getByRole('button', { name: 'Share', exact: true }).click();
				const input = page.getByRole('textbox', { name: 'Share URL', exact: true });
				await input.waitFor();
				const rows = await page.evaluate(() => {
					const recovery = document
						.querySelector('[data-workspace-recovery]')!
						.getBoundingClientRect();
					const share = document
						.querySelector('.workspace-share')!
						.getBoundingClientRect();
					const workbench = document.querySelector('.workbench')!.getBoundingClientRect();
					const footer = document.querySelector('.statusbar')!.getBoundingClientRect();
					return {
						recoveryBottom: recovery.bottom,
						shareTop: share.top,
						shareBottom: share.bottom,
						workbenchTop: workbench.top,
						footerBottom: footer.bottom,
						viewportHeight: innerHeight
					};
				});
				expect(rows.recoveryBottom).toBeLessThanOrEqual(rows.shareTop);
				expect(rows.shareBottom).toBeLessThanOrEqual(rows.workbenchTop);
				expect(rows.footerBottom).toBeLessThanOrEqual(rows.viewportHeight);
				await input.click();
				expect(
					await input.evaluate(
						(element: HTMLInputElement) =>
							element.selectionStart === 0 &&
							element.selectionEnd === element.value.length
					)
				).toBe(true);
				await page.getByRole('button', { name: 'Close share URL', exact: true }).click();
				await page
					.getByRole('button', { name: 'Start new workspace', exact: true })
					.click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				expect(await page.locator('[data-workspace-recovery]').count()).toBe(0);
				expect(await input.count()).toBe(0);
			});
		}
	);
});
