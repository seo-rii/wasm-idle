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

describe('shared workspace fragment navigation', () => {
	const key = 'wasm-idle:example-workspace:v3';
	const snapshot = (content: string) => ({
		version: 6,
		language: 'CPP',
		activePath: 'main.cpp',
		files: [{ path: 'main.cpp', content }],
		lspEnabled: false
	});
	const sharedUrl = (base: string) => {
		const target = new URL(base);
		target.hash =
			'workspace=' + Buffer.from(JSON.stringify(snapshot('// shared'))).toString('base64url');
		return target.href;
	};
	const value = (page: Page) =>
		page.evaluate(() => (window as any).__wasmIdleDebug?.getEditorValue());

	it(
		'restores the local URL when an invalid share supersedes a queued fragment',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, _context, browserUrl) => {
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page
					.locator('#language-select[data-workspace-ready="true"]')
					.waitFor({ state: 'attached' });
				const original = '// local before fragment changes';
				await page.evaluate(
					(text) => (window as any).__wasmIdleDebug.setEditorValue(text),
					original
				);
				await expect
					.poll(() =>
						page.evaluate(
							(key) =>
								JSON.parse(localStorage.getItem(key) || 'null')?.files[0]?.content,
							key
						)
					)
					.toBe(original);
				await page.evaluate(
					(hash) => {
						location.hash = hash;
						location.hash = 'workspace=broken';
					},
					new URL(sharedUrl(browserUrl)).hash
				);
				await page.getByText('Invalid share URL', { exact: true }).waitFor();
				expect(page.url()).toBe(browserUrl);
				await page.reload({ waitUntil: 'domcontentloaded' });
				await expect.poll(() => value(page), { timeout: 30_000 }).toBe(original);
			});
		}
	);

	it(
		'opens a shared fragment in this tab after persisting the current edit and preserves browser history',
		{ ...browserOptions, timeout: 180_000 },
		async () => {
			await withWorkspacePage(async (page, _context, browserUrl) => {
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page
					.locator('#language-select[data-workspace-ready="true"]')
					.waitFor({ state: 'attached' });
				const invalid = new URL(browserUrl);
				invalid.hash = 'workspace=broken';
				await page.goto(invalid.href, { waitUntil: 'domcontentloaded' });
				await page.getByText('Invalid share URL', { exact: true }).waitFor();
				expect(page.url()).toBe(browserUrl);
				await page.evaluate(() =>
					(window as any).__wasmIdleDebug.setEditorValue('// edit before navigation')
				);
				await page.goto(sharedUrl(browserUrl), { waitUntil: 'domcontentloaded' });
				await page.waitForURL((url) => !url.hash && !!url.searchParams.get('workspace'), {
					timeout: 60_000
				});
				await expect.poll(() => value(page), { timeout: 30_000 }).toBe('// shared');
				const editableUrl = page.url();
				expect(
					await page.evaluate(
						(key) => JSON.parse(localStorage.getItem(key)!).files[0].content,
						key
					)
				).toBe('// edit before navigation');
				await page.goBack({ waitUntil: 'domcontentloaded' });
				await expect
					.poll(() => value(page), { timeout: 45_000 })
					.toBe('// edit before navigation');
				await page.goForward({ waitUntil: 'domcontentloaded' });
				await expect.poll(() => value(page), { timeout: 45_000 }).toBe('// shared');
				expect(page.url()).toBe(editableUrl);
			});
		}
	);

	it(
		'keeps a conflicting workspace open when a share cannot safely replace it',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				const other = await context.newPage();
				try {
					await other.goto(browserUrl, { waitUntil: 'domcontentloaded' });
					await other.locator('[data-workspace-save-state="saved"]').waitFor();
					await other.evaluate(() =>
						(window as any).__wasmIdleDebug.setEditorValue('// saved in other tab')
					);
					await page.locator('[data-workspace-save-state="conflict"]').waitFor();
					await page.evaluate(() =>
						(window as any).__wasmIdleDebug.setEditorValue('// keep this local edit')
					);
					await page.goto(sharedUrl(browserUrl), { waitUntil: 'domcontentloaded' });
					await expect.poll(() => page.url(), { timeout: 12_000 }).toBe(browserUrl);
					expect(await value(page)).toBe('// keep this local edit');
					expect(
						await page.evaluate(
							(key) => JSON.parse(localStorage.getItem(key)!).files[0].content,
							key
						)
					).toBe('// saved in other tab');
					await page.locator('[data-workspace-save-state="conflict"]').waitFor();
				} finally {
					await other.close();
				}
			});
		}
	);
});
