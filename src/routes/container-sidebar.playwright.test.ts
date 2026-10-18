// @vitest-environment node
import { chromium, type Browser } from 'playwright-core';
import { expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../scripts/browser-test-prewarm.mjs';
import {
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

const enabled = process.env.WASM_IDLE_RUN_CONTAINER_WEBSITE_BROWSER === '1';
type SiteWindow = typeof globalThis & {
	__wasmIdleContainer?: unknown;
	__wasmIdleDebug?: {
		writeTerminalInput(text: string, eof: boolean): Promise<void>;
		getEditorValue(): string;
	};
};

it(
	'shows real Bash redirections after a language change without manually refreshing files',
	{ skip: !enabled, timeout: 180_000, meta: { browser: true, requiredBrowser: enabled } },
	async () => {
		await runWithBrowserProbeSessionLock(async () => {
			const provided = process.env.WASM_IDLE_BROWSER_URL;
			const server =
				provided && shouldReuseProvidedBrowserUrl(provided)
					? { browserUrl: provided, close: async () => {} }
					: await startBrowserPreviewServer({
							origin: 'http://127.0.0.1:4678',
							serverMode: 'preview'
						});
			let browser: Browser | undefined;
			try {
				browser = await chromium.launch({
					executablePath: await resolveChromiumExecutable(
						process.env.WASM_IDLE_CHROMIUM_EXECUTABLE
					),
					headless: true,
					args: ['--no-sandbox']
				});
				const context = await browser.newContext({ serviceWorkers: 'allow' });
				await addBrowserTestCookies(context, server.browserUrl);
				await disableBrowserPrewarm(context);
				const page = await context.newPage();
				page.setDefaultTimeout(30_000);
				const errors: string[] = [];
				page.on('pageerror', (error) => errors.push(error.message));
				const url = new URL(server.browserUrl);
				url.searchParams.set('lsp-test', '1');
				await page.goto(url.href, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(
					() =>
						crossOriginIsolated &&
						!!(globalThis as SiteWindow).__wasmIdleContainer &&
						!!(globalThis as SiteWindow).__wasmIdleDebug,
					undefined,
					{ timeout: 90_000 }
				);
				if (await page.locator('#lsp-toggle').isChecked())
					await page.locator('#lsp-toggle').uncheck();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				const initial = await page.locator('#language-select').inputValue();
				expect(initial).toBe('CPP');
				await page.evaluate(async () => {
					await (globalThis as SiteWindow).__wasmIdleDebug!.writeTerminalInput(
						"printf 'SIDEBAR-%s\\n' READY\n",
						false
					);
				});
				await page.waitForFunction(() =>
					document
						.querySelector('[data-testid="terminal-debug-output"]')
						?.textContent?.includes('SIDEBAR-READY')
				);
				await page.locator('#language-select').selectOption('BASH');
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				await page.locator('.terminal-shell .xterm-helper-textarea').focus();
				await page.keyboard.type('echo 1 >> hi.txt');
				await page.keyboard.press('Enter');
				const file = page.locator('[data-container-path="CPP/hi.txt"]');
				await file.waitFor();
				expect(await page.locator('#language-select').inputValue()).toBe('BASH');
				await file.click();
				await page.waitForFunction(
					() => (globalThis as SiteWindow).__wasmIdleDebug!.getEditorValue() === '1\n'
				);
				expect(await page.locator('#language-select').inputValue()).toBe('CPP');
				await page.locator('.terminal-shell .xterm-helper-textarea').focus();
				await page.keyboard.type('echo 2 >> hi.txt');
				await page.keyboard.press('Enter');
				await page.waitForFunction(
					() => (globalThis as SiteWindow).__wasmIdleDebug!.getEditorValue() === '1\n2\n'
				);
				expect(errors).toEqual([]);
			} finally {
				await browser?.close();
				await server.close();
			}
		});
	}
);
