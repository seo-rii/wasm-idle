// @vitest-environment node

import { strToU8, zipSync } from 'fflate';
import { chromium, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_ARCHIVE === '1';
const browserOptions = {
	skip: !enabled,
	timeout: 300_000,
	meta: { browser: true, requiredBrowser: enabled }
};

async function withImportPage(run: (page: Page) => Promise<void>) {
	await runWithBrowserProbeSessionLock(async () => {
		const browserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
		const reuse = shouldReuseProvidedBrowserUrl(browserUrl);
		if (!reuse) await runBrowserPreparationScripts(['build:preview']);
		const server = reuse
			? { browserUrl, close: async () => {} }
			: await startBrowserPreviewServer({
					origin: 'http://127.0.0.1:4589',
					serverMode: 'preview'
				});
		const browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
		const context = await browser.newContext();
		await addBrowserTestCookies(context, server.browserUrl);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		try {
			await page.goto(server.browserUrl + '?prewarm=0&lsp=0', {
				waitUntil: 'domcontentloaded'
			});
			await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
			await run(page);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
			await browser.close();
			await server.close();
		}
	});
}

describe('workspace import browser integration', () => {
	it(
		'rejects traversal in new and renamed file paths without changing the workspace',
		browserOptions,
		async () => {
			await withImportPage(async (page) => {
				page.once('dialog', (dialog) => dialog.accept('a/../b.py'));
				await page.getByRole('button', { name: 'New', exact: true }).click();
				await page.getByText(/cannot traverse directories/u).waitFor();
				expect(await page.locator('button[title="a/b.py"]').count()).toBe(0);
				expect(await page.locator('button[title="b.py"]').count()).toBe(0);
				page.once('dialog', (dialog) => dialog.accept('../renamed.cpp'));
				await page.getByRole('button', { name: 'Rename', exact: true }).click();
				await page.getByText(/cannot traverse directories/u).waitFor();
				expect(await page.locator('button[title="renamed.cpp"]').count()).toBe(0);
				expect(await page.locator('button[title="main.cpp"]').count()).toBeGreaterThan(0);
			});
		}
	);
	it.each(['file', 'zip'] as const)(
		'cancels a delayed %s import when the language changes',
		browserOptions,
		async (kind) => {
			await withImportPage(async (page) => {
				const name = kind === 'zip' ? 'delayed.zip' : 'delayed.txt';
				await page.evaluate((name) => {
					const target = window as typeof window & {
						importReadStarted?: boolean;
						releaseImportRead?: () => void;
					};
					const original = File.prototype.arrayBuffer;
					File.prototype.arrayBuffer = async function () {
						if (this.name === name) {
							target.importReadStarted = true;
							await new Promise<void>((resolve) => {
								target.releaseImportRead = resolve;
							});
						}
						return original.call(this);
					};
				}, name);
				await page.locator('input[type="file"]').setInputFiles({
					name,
					mimeType: kind === 'zip' ? 'application/zip' : 'text/plain',
					buffer:
						kind === 'zip'
							? Buffer.from(zipSync({ 'delayed.txt': strToU8('delayed content') }))
							: Buffer.from('delayed content')
				});
				await page.waitForFunction(
					() =>
						(window as typeof window & { importReadStarted?: boolean })
							.importReadStarted
				);
				await page.locator('#language-select').selectOption('PYTHON');
				await page.evaluate(() =>
					(
						window as typeof window & { releaseImportRead?: () => void }
					).releaseImportRead?.()
				);
				await page
					.getByText('Import cancelled because the workspace changed', { exact: true })
					.waitFor();
				expect(await page.locator('button[title="delayed.txt"]').count()).toBe(0);
				await page.locator('#language-select').selectOption('CPP');
				expect(await page.locator('button[title="delayed.txt"]').count()).toBe(0);
			});
		}
	);
});
