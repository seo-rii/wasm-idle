// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { editorDefaults } from './editor-defaults';
import { WORKSPACE_BACKUP_FORMAT } from './workspaceBackup';

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
	it.each(['unavailable', 'denied'])(
		'offers manual sharing when the clipboard is %s',
		browserOptions,
		async (mode) => {
			expect.hasAssertions();
			await withWorkspacePage(async (page, context, browserUrl) => {
				await context.addInitScript((mode) => {
					Object.defineProperty(navigator, 'clipboard', {
						configurable: true,
						value:
							mode === 'unavailable'
								? undefined
								: {
										writeText: async () => {
											throw new DOMException(
												'Permission denied',
												'NotAllowedError'
											);
										}
									}
					});
				}, mode);
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.evaluate(() =>
					(window as any).__wasmIdleDebug.setEditorValue('int manual_shared_work = 5;')
				);
				await page.getByRole('button', { name: 'Share', exact: true }).click();
				const shareInput = page.getByRole('textbox', { name: 'Share URL', exact: true });
				await shareInput.waitFor();
				expect(await page.getByText(/Share URL copied/).count()).toBe(0);
				const shareUrl = new URL(await shareInput.inputValue());
				expect(new URL(page.url()).hash).toBe('');
				const snapshot = JSON.parse(
					Buffer.from(shareUrl.hash.slice('#workspace='.length), 'base64url').toString()
				);
				expect(snapshot.files).toContainEqual({
					path: 'main.cpp',
					content: 'int manual_shared_work = 5;'
				});
				await shareInput.click();
				expect(
					await shareInput.evaluate(
						(input: HTMLInputElement) =>
							input.selectionStart === 0 && input.selectionEnd === input.value.length
					)
				).toBe(true);
				await page.getByRole('button', { name: 'Close share URL', exact: true }).click();
				expect(await shareInput.count()).toBe(0);
			});
		}
	);

	it.each(['plain', 'base64', 'empty base64'])(
		'opens explicit %s URL inputs before existing saved work',
		browserOptions,
		async (format) => {
			expect.hasAssertions();
			await withWorkspacePage(async (page, context, browserUrl) => {
				const original = JSON.stringify({
					version: 6,
					language: 'CPP',
					activePath: 'original.cpp',
					files: [{ path: 'original.cpp', content: 'int original_local = 73;' }],
					openTabs: ['original.cpp']
				});
				await context.addInitScript((snapshot) => {
					localStorage.setItem('wasm-idle:example-workspace:v3', snapshot);
					localStorage.setItem('code', 'stale legacy code');
					localStorage.setItem('language', 'CPP');
					localStorage.setItem('argsInput', 'stale legacy arguments');
				}, original);
				const url = new URL(browserUrl);
				const source = format === 'empty base64' ? '' : 'print("url_workspace_한글")';
				const args = format === 'empty base64' ? '' : '--name "URL visitor"';
				url.searchParams.set('lang', 'python');
				url.searchParams.set(
					format === 'plain' ? 'code' : 'code64',
					format === 'plain' ? source : Buffer.from(source).toString('base64url')
				);
				url.searchParams.set(
					format === 'plain' ? 'args' : 'args64',
					format === 'plain' ? args : Buffer.from(args).toString('base64url')
				);
				await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				expect(await page.locator('#language-select').inputValue()).toBe('PYTHON');
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
					source
				);
				const editableUrl = new URL(page.url());
				expect(editableUrl.searchParams.get('workspace')).toBeTruthy();
				expect(editableUrl.searchParams.has('lang')).toBe(false);
				expect(editableUrl.searchParams.has('code')).toBe(false);
				expect(editableUrl.searchParams.has('code64')).toBe(false);
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				const storageKey = `wasm-idle:example-workspace:v3:${editableUrl.searchParams.get('workspace')}`;
				expect(
					await page.evaluate(
						(key) => JSON.parse(localStorage.getItem(key)!).files[0].content,
						storageKey
					)
				).toBe(source);
				expect(
					await page.evaluate(
						(key) => JSON.parse(localStorage.getItem(key)!).argsInput,
						storageKey
					)
				).toBe(args);
				expect(
					await page.evaluate(() =>
						localStorage.getItem('wasm-idle:example-workspace:v3')
					)
				).toBe(original);
				await page.evaluate(() =>
					(window as any).__wasmIdleDebug.setEditorValue('print("edited_workspace")')
				);
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.waitForFunction(
					() =>
						(window as any).__wasmIdleDebug.getEditorValue() ===
						'print("edited_workspace")'
				);
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				expect(
					await page.evaluate(
						(key) => JSON.parse(localStorage.getItem(key)!).argsInput,
						storageKey
					)
				).toBe(args);
				expect(
					await page.evaluate(() =>
						localStorage.getItem('wasm-idle:example-workspace:v3')
					)
				).toBe(original);
			});
		}
	);

	it(
		'recovers failed isolated snapshots under their own storage key',
		browserOptions,
		async () => {
			expect.hasAssertions();
			await withWorkspacePage(async (page, context, browserUrl) => {
				const primary = JSON.stringify({
					version: 6,
					language: 'CPP',
					files: [{ path: 'main.cpp', content: 'int original_local = 73;' }]
				});
				const raw = JSON.stringify({
					version: 6,
					files: [{ path: 'main.cpp', content: 'int recoverable_shared = 1;' }],
					openTabs: 'broken'
				});
				const id = '11111111-2222-3333-4444-555555555555';
				const key = `wasm-idle:example-workspace:v3:${id}`;
				await context.addInitScript(
					({ primary, raw, key }) => {
						localStorage.setItem('wasm-idle:example-workspace:v3', primary);
						localStorage.setItem(key, raw);
					},
					{ primary, raw, key }
				);
				const url = new URL(browserUrl);
				url.searchParams.set('workspace', id);
				await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
				await page.locator('[data-workspace-recovery]').waitFor();
				expect(
					await page.evaluate(
						(key) =>
							Object.keys(localStorage)
								.filter((item) => item.startsWith(`${key}:recovery:`))
								.map((item) => localStorage.getItem(item)),
						key
					)
				).toEqual([raw]);
				await page
					.getByRole('button', { name: 'Start new workspace', exact: true })
					.click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				expect(
					await page.evaluate(() =>
						localStorage.getItem('wasm-idle:example-workspace:v3')
					)
				).toBe(primary);
				expect(await page.evaluate((key) => localStorage.getItem(key), key)).not.toBe(raw);
			});
		}
	);

	it.each([false, true])(
		'preserves failed restore input until recovery is chosen (backup write fails: %s)',
		browserOptions,
		async (failRecoveryWrite) => {
			expect.hasAssertions();
			await withWorkspacePage(async (page, context, browserUrl) => {
				const original = JSON.stringify({
					version: 6,
					language: 'CPP',
					activePath: 'main.cpp',
					files: [{ path: 'main.cpp', content: 'int recoverable_original = 73;' }],
					openTabs: 'main.cpp'
				});
				await context.addInitScript(
					({ original, failRecoveryWrite }) => {
						localStorage.setItem('wasm-idle:example-workspace:v3', original);
						if (failRecoveryWrite) {
							const originalSetItem = Storage.prototype.setItem;
							Storage.prototype.setItem = function (key, value) {
								if (key.includes(':recovery:'))
									throw new DOMException('Quota full', 'QuotaExceededError');
								originalSetItem.call(this, key, value);
							};
						}
					},
					{ original, failRecoveryWrite }
				);
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('[data-workspace-recovery]').waitFor();
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				expect(
					await page.evaluate(() =>
						(window as any).__wasmIdleDebug.setEditorValue(
							'int recovered_new_work = 42;'
						)
					)
				).toBe(true);
				await page.waitForTimeout(700);
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				expect(
					await page.evaluate(() =>
						localStorage.getItem('wasm-idle:example-workspace:v3')
					)
				).toBe(original);
				if (failRecoveryWrite) {
					await page
						.getByRole('button', { name: 'Start new workspace', exact: true })
						.click();
					expect(
						await page.evaluate(() =>
							localStorage.getItem('wasm-idle:example-workspace:v3')
						)
					).toBe(original);
					await page.locator('[data-workspace-recovery]').waitFor();
				}
				const [download] = await Promise.all([
					page.waitForEvent('download'),
					page
						.getByRole('button', { name: 'Download original snapshot', exact: true })
						.click()
				]);
				const downloadedPath = await download.path();
				if (!downloadedPath) throw new Error('Missing original snapshot download');
				expect(await readFile(downloadedPath, 'utf8')).toBe(original);
				await page
					.getByRole('button', { name: 'Start new workspace', exact: true })
					.click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				expect(await page.locator('[data-workspace-recovery]').count()).toBe(0);
				expect(
					await page.evaluate(
						() =>
							JSON.parse(localStorage.getItem('wasm-idle:example-workspace:v3')!)
								.files[0].content
					)
				).toBe('int recovered_new_work = 42;');
				if (!failRecoveryWrite) {
					expect(
						await page.evaluate(() =>
							Object.keys(localStorage)
								.filter((key) =>
									key.startsWith('wasm-idle:example-workspace:v3:recovery:')
								)
								.map((key) => localStorage.getItem(key))
						)
					).toEqual([original]);
				}
			});
		}
	);

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
				await page.getByRole('button', { name: 'Save', exact: true }).click();
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
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				await page.locator('#language-select').selectOption('PYTHON');
				await page.locator('#language-select').selectOption('CPP');
				await page.getByRole('button', { name: 'Save', exact: true }).click();
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
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.getByRole('alert').filter({ hasText: 'Not saved locally' }).waitFor();
				const [backupDownload] = await Promise.all([
					page.waitForEvent('download'),
					page.getByRole('button', { name: 'Export workspace', exact: true }).click()
				]);
				const backupPath = await backupDownload.path();
				if (!backupPath) throw new Error('Missing workspace backup');
				const backup = JSON.parse(await readFile(backupPath, 'utf8'));
				expect(backup.format).toBe(WORKSPACE_BACKUP_FORMAT);
				// Backup serialization preserves the file metadata, including omitted legacy encoding.
				expect(backup.snapshot.files).toContainEqual(helper);
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
					await sharedPage.getByRole('button', { name: 'Save', exact: true }).click();
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
			await page.getByRole('button', { name: 'Save', exact: true }).click();
			await page.locator('[data-workspace-save-state="saved"]').waitFor();
			await page.reload({ waitUntil: 'domcontentloaded' });
			await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
			expect(
				await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
			).toBe('int shared_edited = 222;');
			await context.grantPermissions(['clipboard-write', 'clipboard-read']);
			await page.getByRole('button', { name: 'Share', exact: true }).click();
			await page.getByText('Share URL copied', { exact: true }).waitFor();
			expect(new URL(await page.evaluate(() => navigator.clipboard.readText())).hash).toMatch(
				/^#workspace=/
			);
			expect(new URL(page.url()).hash).toBe('');
			await page.evaluate(() =>
				(window as any).__wasmIdleDebug.setEditorValue('int shared_newer = 333;')
			);
			await page.getByRole('button', { name: 'Save', exact: true }).click();
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
				// The imported plain-text file tests storage recovery, independently of LSP.
				await context.addInitScript((code) => {
					if (localStorage.getItem('wasm-idle:example-workspace:v3') !== null) return;
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							version: 6,
							language: 'CPP',
							activePath: 'main.cpp',
							files: [{ path: 'main.cpp', content: code }],
							openTabs: ['main.cpp'],
							lspEnabled: false
						})
					);
				}, editorDefaults.cpp);
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
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
					await page.evaluate(() =>
						localStorage.getItem('wasm-idle:example-workspace:v3')
					)
				).toBe(previous);
				// Sharing must serialize current edits even while local writes fail.
				await context.grantPermissions(['clipboard-write', 'clipboard-read']);
				await page.getByRole('button', { name: 'Share', exact: true }).click();
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
				const backup = JSON.parse(backupBytes.toString());
				expect(backup.format).toBe(WORKSPACE_BACKUP_FORMAT);
				expect(backup.snapshot.files).toContainEqual({
					path: 'unsaved.txt',
					content: 'latest unsaved content',
					encoding: 'utf-8'
				});
				// Keep autosave failing until the actual Retry click is delivered.
				await page
					.getByRole('button', { name: 'Retry save', exact: true })
					.evaluate((button) => {
						button.addEventListener(
							'click',
							() => {
								Storage.prototype.setItem = (window as any).__originalSetItem;
							},
							{ capture: true, once: true }
						);
					});
				await page.getByRole('button', { name: 'Retry save', exact: true }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				expect(
					await page.getByRole('alert').filter({ hasText: 'Not saved locally' }).count()
				).toBe(0);
				expect(
					await page.evaluate(() =>
						JSON.parse(localStorage.getItem('wasm-idle:example-workspace:v3')!)
					)
				).toEqual(backup.snapshot);
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
				const manifestText = await readFile(
					new URL('../../.svelte-kit/output/client/.vite/manifest.json', import.meta.url),
					'utf8'
				).catch((error) => {
					if (error.code !== 'ENOENT') throw error;
					return null;
				});
				const manifest = manifestText
					? (JSON.parse(manifestText) as Record<string, { file: string }>)
					: null;
				const monacoModule = Object.entries(manifest || {}).find(([path]) =>
					path.endsWith('/@seorii/monaco/dist/index.js')
				)?.[1].file;
				if (manifest && !monacoModule)
					throw new Error('Built Monaco module is missing from the manifest');
				const isMonacoModule = (url: URL) =>
					(monacoModule !== undefined && url.pathname.endsWith(`/${monacoModule}`)) ||
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
					// handlers exist. The saved selection is restored, but editor readiness and saving
					// must still wait for the pending editor import.
					await page.waitForFunction(
						() => typeof (window as any).__wasmIdleDebug?.getEditorValue === 'function'
					);
					expect(
						await page.locator('#language-select').getAttribute('data-workspace-ready')
					).toBe('false');
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
				await page.waitForFunction(
					() =>
						(window as any).__wasmIdleDebug.getEditorValue() ===
						'int saved_before_reload = 73;'
				);
			});
		}
	);
});
