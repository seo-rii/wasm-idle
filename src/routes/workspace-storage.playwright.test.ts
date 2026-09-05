// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

async function withWorkspacePage(
	test: (page: Page, context: BrowserContext, browserUrl: string) => Promise<void>
) {
	if (process.env.WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_ARCHIVE !== '1') return;

	await runWithBrowserProbeSessionLock(async () => {
		const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
		if (!reuseProvidedBrowserUrl) {
			await runBrowserPreparationScripts(['build:preview']);
		}
		const previewServer = reuseProvidedBrowserUrl
			? {
					origin: new URL(configuredBrowserUrl).origin,
					browserUrl: configuredBrowserUrl,
					close: async () => {}
				}
			: await startBrowserPreviewServer({
					origin: 'http://127.0.0.1:4588',
					serverMode: 'preview'
				});
		const browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
		const context = await browser.newContext();
		await addBrowserTestCookies(context, previewServer.browserUrl);
		const page = await context.newPage();
		const pageErrors: string[] = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));

		try {
			await test(page, context, previewServer.browserUrl);
			expect(pageErrors).toEqual([]);
		} finally {
			await context.close();
			await browser.close();
			await previewServer.close();
		}
	});
}

describe('workspace storage browser integration', () => {
	it('shows failed saves, preserves the last snapshot, shares, exports, and retries', async () => {
		await withWorkspacePage(async (page, context, browserUrl) => {
			await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
			await page.getByRole('button', { name: 'Save', exact: true }).click();
			await page.locator('[data-workspace-save-state="saved"]').waitFor();
			const previous = await page.evaluate(() =>
				localStorage.getItem('wasm-idle:example-workspace:v3')
			);
			await page.evaluate(() => {
				const target = window as any;
				target.__originalSetItem = Storage.prototype.setItem;
				Storage.prototype.setItem = function () {
					throw new DOMException('Quota full', 'QuotaExceededError');
				};
			});
			await page.locator('input[type="file"]').setInputFiles({
				name: 'unsaved.txt',
				mimeType: 'text/plain',
				buffer: Buffer.from('latest unsaved content')
			});
			await page.getByRole('alert').filter({ hasText: 'Not saved locally' }).waitFor();
			expect(
				await page.evaluate(() => localStorage.getItem('wasm-idle:example-workspace:v3'))
			).toBe(previous);
			// Sharing must serialize current edits even while local writes fail.
			await context.grantPermissions(['clipboard-write', 'clipboard-read']);
			await page.getByRole('button', { name: 'Share', exact: true }).click();
			await page.waitForFunction(() => location.hash.startsWith('#workspace='));
			expect(
				await page.getByRole('alert').filter({ hasText: 'Not saved locally' }).isVisible()
			).toBe(true);
			const backupDownload = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Export workspace', exact: true }).click();
			const backupPath = await (await backupDownload).path();
			if (!backupPath) throw new Error('Missing workspace backup');
			const backupBytes = await readFile(backupPath);
			expect(JSON.parse(backupBytes.toString()).files).toContainEqual({
				path: 'unsaved.txt',
				content: 'latest unsaved content',
				encoding: 'utf-8'
			});
			await page.evaluate(() => {
				Storage.prototype.setItem = (window as any).__originalSetItem;
			});
			await page.getByRole('button', { name: 'Retry save', exact: true }).click();
			await page.locator('[data-workspace-save-state="saved"]').waitFor();
			expect(
				await page.getByRole('alert').filter({ hasText: 'Not saved locally' }).count()
			).toBe(0);
			expect(
				await page.evaluate(() => localStorage.getItem('wasm-idle:example-workspace:v3'))
			).toBe(backupBytes.toString());
			await page.evaluate(() => history.replaceState(null, '', location.pathname));
			await page.reload({ waitUntil: 'domcontentloaded' });
			await page.locator('button[title="unsaved.txt"]').waitFor();
		});
	}, 300_000);

	it('preserves the saved snapshot when unloading before the editor has initialized', async () => {
		await withWorkspacePage(async (page, context, browserUrl) => {
			const previous = JSON.stringify({
				version: 6,
				language: 'CPP',
				activePath: 'prior.cc',
				files: [{ path: 'prior.cc', content: 'int saved_before_reload = 73;' }],
				openTabs: ['prior.cc']
			});
			await context.addInitScript((snapshot) => {
				localStorage.setItem('wasm-idle:example-workspace:v3', snapshot);
			}, previous);
			const manifest = JSON.parse(
				await readFile(
					new URL('../../.svelte-kit/output/client/.vite/manifest.json', import.meta.url),
					'utf8'
				)
			) as Record<string, { file: string }>;
			const monacoModule = Object.entries(manifest).find(([path]) =>
				path.endsWith('/@seorii/monaco/dist/index.js')
			)?.[1].file;
			if (!monacoModule) throw new Error('Built Monaco module is missing from the manifest');
			const isMonacoModule = (url: URL) =>
				url.pathname.endsWith(`/${monacoModule}`) ||
				decodeURIComponent(url.pathname).endsWith('/@seorii/monaco/dist/index.js');
			let releaseModule!: () => void;
			const released = new Promise<void>((resolve) => (releaseModule = resolve));
			await page.route(isMonacoModule, async (route) => {
				await released;
				await route.continue();
			});
			const moduleRequested = page.waitForRequest((request) =>
				isMonacoModule(new URL(request.url()))
			);
			try {
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await moduleRequested;
				// This hook is installed by the hydrated page's effect, after its window
				// handlers exist. The editor import is still pending, so restoration has not run.
				await page.waitForFunction(
					() => typeof (window as any).__wasmIdleDebug?.getEditorValue === 'function'
				);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe('');
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				const afterUnload = await page.evaluate(() => {
					window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
					return localStorage.getItem('wasm-idle:example-workspace:v3');
				});
				expect(afterUnload).toBe(previous);
			} finally {
				releaseModule();
			}
			await page.locator('button[title="prior.cc"]').waitFor();
			expect(
				await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
			).toBe('int saved_before_reload = 73;');
		});
	}, 300_000);
});
