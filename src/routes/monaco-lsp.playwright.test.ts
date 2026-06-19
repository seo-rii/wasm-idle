// @vitest-environment node

import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

describe('Monaco LSP browser integration', () => {
	it('loads the TypeScript LSP assets and renders browser diagnostics', async () => {
		if (process.env.WASM_IDLE_RUN_REAL_BROWSER_LSP !== '1') {
			return;
		}

		await runWithBrowserProbeSessionLock(async () => {
			const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
			const serverMode =
				process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
			const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
			if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
				await runBrowserPreparationScripts(['build:preview']);
			}
			const previewServer = reuseProvidedBrowserUrl
				? {
						origin: new URL(configuredBrowserUrl).origin,
						browserUrl: configuredBrowserUrl,
						close: async () => {}
					}
				: await startBrowserPreviewServer(
						configuredBrowserUrl
							? {
									origin: new URL(configuredBrowserUrl).origin,
									basePath: new URL(configuredBrowserUrl).pathname,
									serverMode
								}
							: { origin: 'http://localhost:4593', serverMode }
					);
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
					url: new URL(previewServer.browserUrl).origin
				}
			]);
			await context.setExtraHTTPHeaders({
				Cookie: 'dev_bypass_waf=seorii_bypass_token_is_this'
			});
			const page = await context.newPage();
			page.setDefaultTimeout(
				Number(process.env.WASM_IDLE_LSP_BROWSER_TIMEOUT_MS || '120000')
			);
			const consoleMessages: string[] = [];
			const pageErrors: string[] = [];
			page.on('console', (message) => {
				consoleMessages.push(`[${message.type()}] ${message.text()}`);
			});
			page.on('pageerror', (error) => {
				pageErrors.push(error.stack || error.message);
			});
			const lspAssetRequests: string[] = [];
			page.on('request', (request) => {
				if (request.url().includes('/lsp/typescript-libs.json.gz')) {
					lspAssetRequests.push(request.url());
				}
			});

			try {
				await page.goto(previewServer.browserUrl, { waitUntil: 'domcontentloaded' });
				for (let attempt = 0; attempt < 4; attempt += 1) {
					const ready = await page.evaluate(
						() =>
							crossOriginIsolated &&
							typeof SharedArrayBuffer !== 'undefined' &&
							!!navigator.serviceWorker?.controller
					);
					if (ready) break;
					await page.evaluate(async () => {
						if (!navigator.serviceWorker) return;
						await Promise.race([
							navigator.serviceWorker.ready,
							new Promise((resolve) => setTimeout(resolve, 1_500))
						]);
					});
					await page.goto(previewServer.browserUrl, { waitUntil: 'domcontentloaded' });
					await page.waitForTimeout(1_500 + attempt * 500);
				}
				await page.locator('#language-select').selectOption('TYPESCRIPT');
				await page.waitForFunction(
					() =>
						(document.querySelector('#language-select') as HTMLSelectElement | null)
							?.value === 'TYPESCRIPT'
				);
				await page.waitForFunction(() =>
					Array.from(document.querySelectorAll('.file-tabs button')).some((button) =>
						button.textContent?.includes('main.ts')
					)
				);
				await page.waitForTimeout(1_000);
				expect(lspAssetRequests).toHaveLength(0);
				const libResponse = page
					.waitForResponse(
						(response) =>
							response.url().includes('/lsp/typescript-libs.json.gz') &&
							response.status() === 200,
						{
							timeout: Number(
								process.env.WASM_IDLE_LSP_BROWSER_TIMEOUT_MS || '120000'
							)
						}
					)
					.catch((error: unknown) => error);
				await page.locator('#lsp-toggle').check();
				await page.locator('.monaco-editor textarea').waitFor();
				await page.locator('.monaco-editor').click({
					force: true,
					position: { x: 180, y: 80 }
				});
				await page.keyboard.press('Control+A');
				await page.keyboard.type('const n: number = "not a number";\nconsole.log(n);\n');
				const response = await libResponse;
				if (response instanceof Error) throw response;
				await page.waitForFunction(
					() => document.querySelectorAll('.squiggly-error').length > 0
				);

				expect(await page.locator('.squiggly-error').count()).toBeGreaterThan(0);
			} catch (error) {
				throw new Error(
					[
						error instanceof Error ? error.message : String(error),
						'Console:',
						...consoleMessages.slice(-80),
						'Page errors:',
						...pageErrors.slice(-20)
					].join('\n')
				);
			} finally {
				await browser.close();
				await previewServer.close();
			}
		});
	}, 180_000);
});
