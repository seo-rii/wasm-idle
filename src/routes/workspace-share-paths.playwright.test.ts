// @vitest-environment node

import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_BACKUP_FORMAT } from './workspaceBackup';
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

describe('strict shared workspace paths', () => {
	it.each([
		{ name: 'traversal', files: [{ path: '../bad.cpp', content: 'int bad_share;' }] },
		{
			name: 'normalized duplicates',
			files: [
				{ path: 'prior.cpp', content: 'int bad_share;' },
				{ path: './prior.cpp', content: 'int duplicate_share;' }
			]
		}
	])('refuses $name and restores the local editor', browserOptions, async ({ files }) => {
		await withWorkspacePage(async (page, context, browserUrl) => {
			await context.addInitScript(() =>
				localStorage.setItem(
					'wasm-idle:example-workspace:v3',
					JSON.stringify({
						version: 6,
						language: 'CPP',
						activePath: 'prior.cpp',
						files: [{ path: 'prior.cpp', content: 'int retained_local = 17;' }],
						lspEnabled: false
					})
				)
			);
			const share = new URL(browserUrl);
			share.hash =
				'workspace=' +
				Buffer.from(
					JSON.stringify({
						version: 6,
						language: 'CPP',
						activePath: files[0].path,
						files,
						lspEnabled: false
					})
				).toString('base64url');
			await page.goto(share.toString(), { waitUntil: 'domcontentloaded' });
			await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
			await page.waitForFunction(
				() =>
					(window as any).__wasmIdleDebug.getEditorValue() === 'int retained_local = 17;'
			);
			expect(new URL(page.url()).searchParams.has('workspace')).toBe(false);
			expect(await page.getByText('Internal Error', { exact: true }).count()).toBe(0);
			expect(
				await page.evaluate(
					() =>
						JSON.parse(localStorage.getItem('wasm-idle:example-workspace:v3')!).files[0]
							.content
				)
			).toBe('int retained_local = 17;');
		});
	});
});

describe('binary workspace JSON boundary', () => {
	it.each([
		{ source: 'share', content: 'data:application/octet-stream;base64,A' },
		{ source: 'backup', content: 'not a data URL' }
	])(
		'refuses malformed binary $source input and preserves local work',
		browserOptions,
		async ({ source, content }) => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				const local = {
					version: 6,
					language: 'CPP',
					activePath: 'prior.cpp',
					files: [{ path: 'prior.cpp', content: 'int retained_binary_boundary = 19;' }],
					lspEnabled: false,
					sidebarOpen: true
				};
				await context.addInitScript(
					(value) =>
						localStorage.setItem(
							'wasm-idle:example-workspace:v3',
							JSON.stringify(value)
						),
					local
				);
				const invalid = {
					version: 6,
					language: 'CPP',
					activePath: 'payload.bin',
					files: [{ path: 'payload.bin', content, encoding: 'data-url' }]
				};
				const url = new URL(browserUrl);
				if (source === 'share') {
					url.hash =
						'workspace=' + Buffer.from(JSON.stringify(invalid)).toString('base64url');
				}
				await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.waitForFunction(
					() =>
						(window as any).__wasmIdleDebug?.getEditorValue() ===
						'int retained_binary_boundary = 19;'
				);
				if (source === 'backup') {
					await page.locator('[data-workspace-save-state="saved"]').waitFor();
					const before = await page.evaluate(() =>
						localStorage.getItem('wasm-idle:example-workspace:v3')
					);
					await page.locator('input[type="file"]').setInputFiles({
						name: 'malformed-workspace.json',
						mimeType: 'application/json',
						buffer: Buffer.from(
							JSON.stringify({ format: WORKSPACE_BACKUP_FORMAT, snapshot: invalid })
						)
					});
					await page.getByText(/^Import failed:.*files\[\]\.content/u).waitFor();
					expect(await page.locator('input[type="file"]').inputValue()).toBe('');
					expect(
						await page.evaluate(() =>
							localStorage.getItem('wasm-idle:example-workspace:v3')
						)
					).toBe(before);
				}
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(local.files[0].content);
				expect(await page.locator('button[title="payload.bin"]').count()).toBe(0);
				expect(new URL(page.url()).searchParams.has('workspace')).toBe(false);
				expect(await page.getByText('Internal Error', { exact: true }).count()).toBe(0);
			});
		}
	);
});
