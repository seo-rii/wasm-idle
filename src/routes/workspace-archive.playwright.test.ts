// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';
import { createWorkspaceArchive, extractWorkspaceArchive } from './workspaceArchive.worker';

describe('workspace ZIP browser integration', () => {
	it('imports and exports workspace files through the lazy archive worker', async () => {
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
			await context.addCookies([
				{
					name: 'dev_bypass_waf',
					value: 'seorii_bypass_token_is_this',
					url: previewServer.origin
				}
			]);
			await context.setExtraHTTPHeaders({
				Cookie: 'dev_bypass_waf=seorii_bypass_token_is_this'
			});
			const page = await context.newPage();
			const pageErrors: string[] = [];
			page.on('pageerror', (error) => pageErrors.push(error.message));

			try {
				await page.goto(previewServer.browserUrl, { waitUntil: 'domcontentloaded' });
				const fixtureFiles = [
					{ path: 'nested/hello.txt', content: 'archive worker\n' },
					{ path: 'unicode.txt', content: '안녕하세요\n' }
				];
				await page.locator('input[type="file"]').setInputFiles({
					name: 'workspace.zip',
					mimeType: 'application/zip',
					buffer: Buffer.from(createWorkspaceArchive(fixtureFiles))
				});
				await page.getByText('2 files imported', { exact: true }).waitFor();
				await page.locator('button[title="nested/hello.txt"]').waitFor();
				await page.locator('button[title="unicode.txt"]').waitFor();

				const downloadPromise = page.waitForEvent('download');
				await page.getByRole('button', { name: 'ZIP', exact: true }).click();
				const download = await downloadPromise;
				expect(download.suggestedFilename()).toBe('wasm-idle-workspace.zip');
				const downloadPath = await download.path();
				if (!downloadPath)
					throw new Error('Playwright did not expose the ZIP download path');
				const exported = extractWorkspaceArchive(await readFile(downloadPath));
				expect(exported).toEqual(expect.arrayContaining(fixtureFiles));
				expect(pageErrors).toEqual([]);
			} finally {
				await context.close();
				await browser.close();
				await previewServer.close();
			}
		});
	}, 300_000);
});
