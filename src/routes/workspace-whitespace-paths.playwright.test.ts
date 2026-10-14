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

describe('whitespace-only workspace names', () => {
	it(
		'rejects blank names before creation or rename and retains a restorable snapshot',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				await context.addInitScript(() =>
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							version: 6,
							language: 'CPP',
							activePath: 'main.cpp',
							files: [{ path: 'main.cpp', content: 'int retained_name = 17;' }],
							lspEnabled: false,
							sidebarOpen: true
						})
					)
				);
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				page.once('dialog', (dialog) => dialog.accept('   '));
				await page.getByRole('button', { name: 'New file', exact: true }).click();
				await page
					.getByText('Workspace path cannot contain only whitespace', { exact: true })
					.waitFor();
				page.once('dialog', (dialog) => dialog.accept('\t '));
				await page.getByRole('button', { name: 'Rename', exact: true }).click();
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				const names = await page.evaluate(() =>
					JSON.parse(localStorage.getItem('wasm-idle:example-workspace:v3')!).files.map(
						(file: { path: string }) => file.path
					)
				);
				expect(names).toEqual(['main.cpp']);
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.waitForFunction(
					() =>
						(window as any).__wasmIdleDebug.getEditorValue() ===
						'int retained_name = 17;'
				);
				expect(await page.locator('[data-workspace-recovery]').count()).toBe(0);
			});
		}
	);
});
