// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';
import { extractWorkspaceArchive } from './workspaceArchive.worker';

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
			await addBrowserTestCookies(context, previewServer.browserUrl);
			const page = await context.newPage();
			const pageErrors: string[] = [];
			page.on('pageerror', (error) => pageErrors.push(error.message));

			try {
				await page.goto(previewServer.browserUrl, { waitUntil: 'domcontentloaded' });
				const wasmBytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
				const binaryBytes = Buffer.from([255, 254, 0, 128, 13, 10]);
				const fixtureFiles = [
					{ path: 'nested/hello.txt', content: 'archive worker\n' },
					{ path: 'unicode.txt', content: '안녕하세요\n' }
				];
				await page.locator('input[type="file"]').setInputFiles({
					name: 'workspace.zip',
					mimeType: 'application/zip',
					buffer: Buffer.from(
						zipSync({
							...Object.fromEntries(
								fixtureFiles.map((file) => [file.path, strToU8(file.content)])
							),
							'module.wasm': wasmBytes,
							'data.bin': binaryBytes
						})
					)
				});
				await page.getByText('4 files imported', { exact: true }).waitFor();
				await page.locator('button[title="nested/hello.txt"]').waitFor();
				await page.locator('button[title="unicode.txt"]').waitFor();

				const downloadPromise = page.waitForEvent('download');
				await page.getByRole('button', { name: 'ZIP', exact: true }).click();
				const download = await downloadPromise;
				expect(download.suggestedFilename()).toBe('wasm-idle-workspace.zip');
				const downloadPath = await download.path();
				if (!downloadPath)
					throw new Error('Playwright did not expose the ZIP download path');
				const archiveBytes = await readFile(downloadPath);
				const exported = extractWorkspaceArchive(archiveBytes);
				expect(exported).toEqual(
					expect.arrayContaining(
						fixtureFiles.map((file) => ({ ...file, encoding: 'utf-8' }))
					)
				);
				const entries = unzipSync(archiveBytes);
				expect(Buffer.from(entries['module.wasm'])).toEqual(wasmBytes);
				expect(Buffer.from(entries['data.bin'])).toEqual(binaryBytes);
				await page.locator('button[title="module.wasm"]').click();
				const wasmDownload = page.waitForEvent('download');
				await page.getByRole('button', { name: 'Download', exact: true }).click();
				const wasmPath = await (await wasmDownload).path();
				if (!wasmPath) throw new Error('Missing WASM download');
				const downloadedWasm = await readFile(wasmPath);
				expect(downloadedWasm).toEqual(wasmBytes);
				expect(WebAssembly.validate(downloadedWasm)).toBe(true);
				expect(pageErrors).toEqual([]);
			} finally {
				await context.close();
				await browser.close();
				await previewServer.close();
			}
		});
	}, 300_000);
});
