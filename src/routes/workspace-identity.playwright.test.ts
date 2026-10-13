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

describe('ZIP workspace storage identity', () => {
	it(
		'persists a second identical ZIP under its new URL before reloading',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				const { strToU8, zipSync } = await import('fflate');
				await context.addInitScript(() => {
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							version: 6,
							language: 'CPP',
							activePath: 'main.cpp',
							files: [{ path: 'main.cpp', content: 'int original_local = 73;' }],
							lspEnabled: false
						})
					);
				});
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				const source = 'int repeated_zip_marker = 42;\n';
				const upload = {
					name: 'same.zip',
					mimeType: 'application/zip',
					buffer: Buffer.from(zipSync({ 'main.cpp': strToU8(source) }))
				};
				await page.locator('input[type="file"]').setInputFiles(upload);
				await page.getByText('1 file imported', { exact: true }).waitFor();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				const firstId = new URL(page.url()).searchParams.get('workspace');
				expect(firstId).toBeTruthy();
				await page.locator('input[type="file"]').setInputFiles(upload);
				await page.waitForFunction(
					(previousId) =>
						new URL(location.href).searchParams.get('workspace') !== previousId,
					firstId
				);
				const secondId = new URL(page.url()).searchParams.get('workspace');
				expect(secondId).toBeTruthy();
				const key = `wasm-idle:example-workspace:v3:${secondId}`;
				await page.waitForFunction((key) => localStorage.getItem(key) !== null, key);
				expect(
					await page.evaluate(
						(key) => JSON.parse(localStorage.getItem(key)!).files[0].content,
						key
					)
				).toBe(source);
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
					source
				);
				expect(new URL(page.url()).searchParams.get('workspace')).toBe(secondId);
				expect(
					await page.evaluate(
						() =>
							JSON.parse(localStorage.getItem('wasm-idle:example-workspace:v3')!)
								.files[0].content
					)
				).toBe('int original_local = 73;');
			});
		}
	);
});
