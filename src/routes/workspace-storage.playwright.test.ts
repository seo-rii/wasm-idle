// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { editorDefaults } from './editor-defaults';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

const browserEnabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_ARCHIVE === '1';
const browserOptions = {
	skip: !browserEnabled,
	timeout: 300_000,
	meta: { browser: true, requiredBrowser: browserEnabled }
};

async function withWorkspacePage(
	test: (page: Page, context: BrowserContext, browserUrl: string) => Promise<void>
) {
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
	it(
		'rejects malformed shares and repairs duplicate or incomplete tab lists',
		browserOptions,
		async () => {
			expect.hasAssertions();
			await withWorkspacePage(async (page, context, browserUrl) => {
				const stored = {
					version: 6,
					language: 'CPP',
					activePath: 'main.cpp',
					files: [
						{ path: 'main.cpp', content: 'int saved_local = 73;' },
						{ path: 'helper.h', content: '#pragma once' }
					],
					openTabs: ['helper.h', 'helper.h', 'missing.cpp']
				};
				await context.addInitScript((snapshot) => {
					localStorage.setItem('wasm-idle:example-workspace:v3', snapshot);
				}, JSON.stringify(stored));
				const url = new URL(browserUrl);
				url.hash = `workspace=${Buffer.from(
					JSON.stringify({
						...stored,
						openTabs: 'main.cpp'
					})
				).toString('base64url')}`;
				await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.waitForFunction(
					() =>
						(window as any).__wasmIdleDebug.getEditorValue() === 'int saved_local = 73;'
				);
				expect(
					await page
						.getByRole('navigation', { name: 'Open files' })
						.locator('.file-tab')
						.count()
				).toBe(2);
				await page.getByRole('button', { name: /^save\s+Save$/ }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				expect(
					await page.evaluate(
						() =>
							JSON.parse(localStorage.getItem('wasm-idle:example-workspace:v3')!)
								.openTabs
					)
				).toEqual(['helper.h', 'main.cpp']);
			});
		}
	);

	it(
		'preserves helper source across restore, save, language changes, and reload',
		browserOptions,
		async () => {
			expect.hasAssertions();
			await withWorkspacePage(async (page, context, browserUrl) => {
				const main = { path: 'main.cpp', content: 'int user_entry = 1;' };
				const helper = { path: 'helper.py', content: editorDefaults.python };
				const stored = JSON.stringify({
					version: 6,
					sidebarOpen: true,
					language: 'CPP',
					activePath: main.path,
					files: [main, helper],
					openTabs: [main.path]
				});
				await context.addInitScript((snapshot) => {
					if (sessionStorage.getItem('wid05-seeded')) return;
					localStorage.setItem('wasm-idle:example-workspace:v3', snapshot);
					sessionStorage.setItem('wid05-seeded', '1');
				}, stored);
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.getByRole('button', { name: /^save\s+Save$/ }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				await page.locator('#language-select').selectOption('PYTHON');
				await page.locator('#language-select').selectOption('CPP');
				await page.getByRole('button', { name: /^save\s+Save$/ }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				const saved = await page.evaluate(
					() => JSON.parse(localStorage.getItem('wasm-idle:example-workspace:v3')!).files
				);
				expect(saved).toContainEqual(helper);
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.evaluate(() => {
					Storage.prototype.setItem = () => {
						throw new DOMException('Quota full', 'QuotaExceededError');
					};
				});
				await page.getByRole('button', { name: /^save\s+Save$/ }).click();
				await page.getByRole('alert').filter({ hasText: 'Not saved locally' }).waitFor();
				const [backupDownload] = await Promise.all([
					page.waitForEvent('download'),
					page.getByRole('button', { name: 'Export workspace', exact: true }).click()
				]);
				const backupPath = await backupDownload.path();
				if (!backupPath) throw new Error('Missing workspace backup');
				expect(JSON.parse(await readFile(backupPath, 'utf8')).files).toContainEqual(helper);
			});
		}
	);

	it(
		'opens shares separately while preserving the original local workspace',
		browserOptions,
		async () => {
			expect.hasAssertions();
			await withWorkspacePage(async (page, _context, browserUrl) => {
				const previous = JSON.stringify({
					version: 6,
					language: 'CPP',
					activePath: 'prior.cpp',
					files: [{ path: 'prior.cpp', content: 'int prior_local_work = 73;' }],
					openTabs: ['prior.cpp']
				});
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				await page.evaluate((snapshot) => {
					localStorage.setItem('wasm-idle:example-workspace:v3', snapshot);
				}, previous);
				const share = new URL(browserUrl);
				share.hash = `workspace=${Buffer.from(
					JSON.stringify({
						version: 6,
						language: 'CPP',
						activePath: 'shared.cpp',
						files: [{ path: 'shared.cpp', content: 'int separate_shared_work = 1;' }],
						openTabs: ['shared.cpp']
					})
				).toString('base64url')}`;
				// A new page avoids the original page's beforeunload save changing the fixture.
				const sharedPage = await page.context().newPage();
				try {
					await sharedPage.goto(share.toString(), { waitUntil: 'domcontentloaded' });
					await sharedPage
						.locator('#language-select[data-workspace-ready="true"]')
						.waitFor();
					await sharedPage.getByRole('button', { name: /^save\s+Save$/ }).click();
					await sharedPage.locator('[data-workspace-save-state="saved"]').waitFor();
					const workspaceId = new URL(sharedPage.url()).searchParams.get('workspace');
					expect(workspaceId).toBeTruthy();
					expect(
						await sharedPage.evaluate(() =>
							localStorage.getItem('wasm-idle:example-workspace:v3')
						)
					).toBe(previous);
					await sharedPage.reload({ waitUntil: 'domcontentloaded' });
					await sharedPage
						.locator('#language-select[data-workspace-ready="true"]')
						.waitFor();
					expect(new URL(sharedPage.url()).searchParams.get('workspace')).toBe(
						workspaceId
					);
					await sharedPage.waitForFunction(
						() =>
							(window as any).__wasmIdleDebug.getEditorValue() ===
							'int separate_shared_work = 1;'
					);
					expect(
						await sharedPage.evaluate(() =>
							(window as any).__wasmIdleDebug.getEditorValue()
						)
					).toBe('int separate_shared_work = 1;');
					await sharedPage
						.getByRole('link', { name: 'Local workspace', exact: true })
						.click();
					await sharedPage.locator('button[title="prior.cpp"]').waitFor();
					await sharedPage.waitForFunction(
						() =>
							(window as any).__wasmIdleDebug.getEditorValue() ===
							'int prior_local_work = 73;'
					);
					expect(
						await sharedPage.evaluate(() =>
							(window as any).__wasmIdleDebug.getEditorValue()
						)
					).toBe('int prior_local_work = 73;');
				} finally {
					await sharedPage.close();
				}
			});
		}
	);

	it('keeps edited shared code after a reload and sharing again', browserOptions, async () => {
		expect.hasAssertions();
		await withWorkspacePage(async (page, context, browserUrl) => {
			const shared = {
				version: 6,
				language: 'CPP',
				activePath: 'main.cpp',
				files: [{ path: 'main.cpp', content: 'int shared_original = 1;' }],
				openTabs: ['main.cpp']
			};
			const url = new URL(browserUrl);
			url.hash = `workspace=${Buffer.from(JSON.stringify(shared)).toString('base64url')}`;
			await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
			await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
			await page.waitForFunction(() => location.hash === '');
			expect(
				await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
			).toBe('int shared_original = 1;');
			await page.evaluate(() =>
				(window as any).__wasmIdleDebug.setEditorValue('int shared_edited = 222;')
			);
			await page.getByRole('button', { name: /^save\s+Save$/ }).click();
			await page.locator('[data-workspace-save-state="saved"]').waitFor();
			await page.reload({ waitUntil: 'domcontentloaded' });
			await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
			expect(
				await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
			).toBe('int shared_edited = 222;');
			await context.grantPermissions(['clipboard-write', 'clipboard-read']);
			await page.getByRole('button', { name: /^share\s+Share$/ }).click();
			await page.getByText('Share URL copied', { exact: true }).waitFor();
			expect(new URL(await page.evaluate(() => navigator.clipboard.readText())).hash).toMatch(
				/^#workspace=/
			);
			expect(new URL(page.url()).hash).toBe('');
			await page.evaluate(() =>
				(window as any).__wasmIdleDebug.setEditorValue('int shared_newer = 333;')
			);
			await page.getByRole('button', { name: /^save\s+Save$/ }).click();
			await page.locator('[data-workspace-save-state="saved"]').waitFor();
			await page.reload({ waitUntil: 'domcontentloaded' });
			await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
			expect(
				await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
			).toBe('int shared_newer = 333;');
		});
	});

	it(
		'shows failed saves, preserves the last snapshot, shares, exports, and retries',
		browserOptions,
		async () => {
			expect.hasAssertions();
			await withWorkspacePage(async (page, context, browserUrl) => {
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.getByRole('button', { name: /^save\s+Save$/ }).click();
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
					await page.evaluate(() =>
						localStorage.getItem('wasm-idle:example-workspace:v3')
					)
				).toBe(previous);
				// Sharing must serialize current edits even while local writes fail.
				await context.grantPermissions(['clipboard-write', 'clipboard-read']);
				await page.getByRole('button', { name: /^share\s+Share$/ }).click();
				await page.getByText('Share URL copied', { exact: true }).waitFor();
				const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
				expect(new URL(shareUrl).hash).toMatch(/^#workspace=/);
				expect(new URL(page.url()).hash).toBe('');
				expect(
					await page
						.getByRole('alert')
						.filter({ hasText: 'Not saved locally' })
						.isVisible()
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
					await page.evaluate(() =>
						localStorage.getItem('wasm-idle:example-workspace:v3')
					)
				).toBe(backupBytes.toString());
				await page.evaluate(() => history.replaceState(null, '', location.pathname));
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('button[title="unsaved.txt"]').waitFor();
			});
		}
	);

	it(
		'preserves the saved snapshot when unloading before the editor has initialized',
		browserOptions,
		async () => {
			expect.hasAssertions();
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
						new URL(
							'../../.svelte-kit/output/client/.vite/manifest.json',
							import.meta.url
						),
						'utf8'
					)
				) as Record<string, { file: string }>;
				const monacoModule = Object.entries(manifest).find(([path]) =>
					path.endsWith('/@seorii/monaco/dist/index.js')
				)?.[1].file;
				if (!monacoModule)
					throw new Error('Built Monaco module is missing from the manifest');
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
					await page.getByRole('button', { name: /^save\s+Save$/ }).click();
					const afterUnload = await page.evaluate(() => {
						window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
						return localStorage.getItem('wasm-idle:example-workspace:v3');
					});
					expect(afterUnload).toBe(previous);
				} finally {
					releaseModule();
				}
				await page.locator('button[title="prior.cc"]').waitFor();
				await page.waitForFunction(
					() =>
						(window as any).__wasmIdleDebug.getEditorValue() ===
						'int saved_before_reload = 73;'
				);
			});
		}
	);
});
