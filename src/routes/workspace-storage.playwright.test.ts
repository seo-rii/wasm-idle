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
import { disableBrowserPrewarm } from '../../scripts/browser-test-prewarm.mjs';
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

async function retrySaveAfterStorageError(page: Page) {
	// Autosave may replace the error banner before the Retry click is delivered.
	await page.evaluate(() => {
		function restoreStorage(event: MouseEvent) {
			if (
				!(event.target instanceof Element) ||
				event.target.closest('button')?.textContent?.trim() !== 'Retry save'
			)
				return;
			(window as any).__restoreWorkspaceStorage();
			document.removeEventListener('click', restoreStorage, true);
		}
		document.addEventListener('click', restoreStorage, true);
	});
	await page.getByRole('button', { name: 'Retry save', exact: true }).click();
}

describe('workspace storage browser integration', () => {
	it('retains a hidden file sidebar on desktop reload', browserOptions, async () => {
		await withWorkspacePage(async (page, context, browserUrl) => {
			await disableBrowserPrewarm(context);
			await page.setViewportSize({ width: 1460, height: 940 });
			await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
			const ready = page.locator('#language-select[data-workspace-ready="true"]');
			await ready.waitFor();
			await page.getByRole('button', { name: 'Hide files', exact: true }).click();
			await page.getByRole('button', { name: 'Save', exact: true }).click();
			await page.locator('[data-workspace-save-state="saved"]').waitFor();
			await page.reload({ waitUntil: 'domcontentloaded' });
			await ready.waitFor();
			await expect
				.poll(() =>
					page.getByRole('button', { name: 'Show files', exact: true }).isVisible()
				)
				.toBe(true);
		});
	});

	it(
		'restores saved Python bytecode options and defaults for an older backup',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				await disableBrowserPrewarm(context);
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				const ready = page.locator('#language-select[data-workspace-ready="true"]');
				await ready.waitFor();
				await ready.selectOption('PYTHON');
				await page.getByText('Python bytecode options', { exact: true }).click();
				const mode = page.getByLabel('Bytecode invalidation mode');
				const timestamp = page.getByLabel('Timestamp (Unix seconds)');
				await mode.selectOption('timestamp');
				await timestamp.fill('1700000001');
				await expect
					.poll(() =>
						page.evaluate(
							() =>
								JSON.parse(
									localStorage.getItem('wasm-idle:example-workspace:v3') ?? '{}'
								).pythonTimestampInput
						)
					)
					.toBe('1700000001');
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				await page.reload({ waitUntil: 'domcontentloaded' });
				await ready.waitFor();
				expect(await ready.inputValue()).toBe('PYTHON');
				await page.getByText('Python bytecode options', { exact: true }).click();
				expect(await mode.inputValue()).toBe('timestamp');
				expect(await timestamp.inputValue()).toBe('1700000001');
				const older = {
					version: 4,
					language: 'PYTHON',
					activePath: 'older.py',
					files: [{ path: 'older.py', content: 'print(1)' }]
				};
				await page.locator('input[type=file]').setInputFiles({
					name: 'old.json',
					mimeType: 'application/json',
					buffer: Buffer.from(JSON.stringify(older))
				});
				await page.locator('.file-tab.active[title="older.py"]').waitFor();
				expect(await mode.inputValue()).toBe('checked-hash');
			});
		}
	);

	it.each([false, true])(
		'restores a valid backup into a saved copy during recovery (storage initially full: %s)',
		browserOptions,
		async (initiallyFull) => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				const key = 'wasm-idle:example-workspace:v3';
				const original =
					'{"files":[{"path":"old.cpp","content":"original"}],"openTabs":"broken"}';
				await context.addInitScript(
					({ key, original, initiallyFull }) => {
						if (localStorage.getItem(key) === null) localStorage.setItem(key, original);
						if (!initiallyFull) return;
						const write = Storage.prototype.setItem;
						Storage.prototype.setItem = function (name, value) {
							if (
								this === localStorage &&
								name.startsWith(key + ':') &&
								!sessionStorage.getItem('allowCopy')
							)
								throw new DOMException('Storage is full', 'QuotaExceededError');
							write.call(this, name, value);
						};
					},
					{ key, original, initiallyFull }
				);
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
				await page.locator('[data-workspace-recovery]').waitFor();
				await page
					.locator('#language-select[data-workspace-ready="true"]')
					.waitFor({ state: 'attached', timeout: 90_000 });
				const readOriginal = () =>
					page.evaluate(
						(key) => ({
							source: localStorage.getItem(key),
							backups: Object.fromEntries(
								Object.keys(localStorage)
									.filter((name) => name.startsWith(key + ':recovery:'))
									.map((name) => [name, localStorage.getItem(name)])
							)
						}),
						key
					);
				const before = await readOriginal();
				expect(before.source).toBe(original);
				const originalUrl = page.url();
				const upload = () =>
					page.locator('input[type="file"]').setInputFiles({
						name: 'saved-project.json',
						mimeType: 'application/json',
						buffer: Buffer.from(
							JSON.stringify({
								format: WORKSPACE_BACKUP_FORMAT,
								snapshot: {
									version: 6,
									language: 'CPP',
									activePath: 'restored.cpp',
									files: [{ path: 'restored.cpp', content: 'int restored;' }],
									lspEnabled: false
								}
							})
						)
					});
				await upload();
				if (initiallyFull) {
					await page.getByText(/Import failed: Storage is full/).waitFor();
					expect(page.url()).toBe(originalUrl);
					expect(await page.locator('[data-workspace-recovery]').isVisible()).toBe(true);
					expect(await page.locator('.file-tab[title="restored.cpp"]').count()).toBe(0);
					expect(await readOriginal()).toEqual(before);
					await page.evaluate(() => sessionStorage.setItem('allowCopy', '1'));
					await upload();
				}
				await page.locator('.file-tab.active[title="restored.cpp"]').waitFor();
				const id = new URL(page.url()).searchParams.get('workspace');
				expect(id).toMatch(/^[0-9a-f-]{36}$/i);
				expect(await page.locator('[data-workspace-recovery]').count()).toBe(0);
				const args = page.getByRole('textbox', { name: 'Program arguments' });
				await args.fill('--after-restore');
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.waitForFunction(
					(key) =>
						JSON.parse(localStorage.getItem(key) ?? '{}').argsInput ===
						'--after-restore',
					key + ':' + id
				);
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('.file-tab.active[title="restored.cpp"]').waitFor();
				expect(await args.inputValue()).toBe('--after-restore');
				expect(await readOriginal()).toEqual(before);
			});
		}
	);

	it(
		'preserves both tabs when a stale workspace conflicts and is saved as a separate copy',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				const key = 'wasm-idle:example-workspace:v3';
				await context.addInitScript((key) => {
					if (localStorage.getItem(key) === null)
						localStorage.setItem(
							key,
							JSON.stringify({
								version: 6,
								language: 'CPP',
								activePath: 'notes.txt',
								files: [{ path: 'notes.txt', content: 'original source' }],
								lspEnabled: false
							})
						);
				}, key);
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				const second = await context.newPage();
				try {
					await second.goto(browserUrl, { waitUntil: 'domcontentloaded' });
					await second.locator('[data-workspace-save-state="saved"]').waitFor();
					await page.evaluate(() =>
						(window as any).__wasmIdleDebug.setEditorValue('new source from first tab')
					);
					await page.waitForFunction(
						(key) =>
							JSON.parse(localStorage.getItem(key)!).files[0].content ===
							'new source from first tab',
						key
					);
					await second
						.getByRole('alert')
						.filter({ hasText: 'Another tab changed' })
						.waitFor();
					await second
						.getByRole('textbox', { name: 'Program arguments' })
						.fill('--second-tab');
					await second.getByRole('button', { name: 'Save', exact: true }).click();
					await second.locator('[data-workspace-save-state="conflict"]').waitFor();
					expect(
						await second.evaluate(
							(key) => JSON.parse(localStorage.getItem(key)!).files[0].content,
							key
						)
					).toBe('new source from first tab');
					expect(
						await second.evaluate(() =>
							(window as any).__wasmIdleDebug.getEditorValue()
						)
					).toBe('original source');
					// An unload must not silently discard the still-local stale-tab edits.
					expect(
						await second.evaluate(
							() =>
								!window.dispatchEvent(
									new Event('beforeunload', { cancelable: true })
								)
						)
					).toBe(true);
					await second.getByRole('button', { name: 'Save a separate copy' }).click();
					await second.locator('[data-workspace-save-state="saved"]').waitFor();
					const copyKey = `${key}:${new URL(second.url()).searchParams.get('workspace')}`;
					const copy = await second.evaluate(
						(key) => JSON.parse(localStorage.getItem(key)!),
						copyKey
					);
					expect(copy.files[0].content).toBe('original source');
					expect(copy.argsInput).toBe('--second-tab');
					expect(
						await page.evaluate(
							(key) => JSON.parse(localStorage.getItem(key)!).files[0].content,
							key
						)
					).toBe('new source from first tab');
				} finally {
					await second.close();
				}
			});
		}
	);

	it('isolates writable tabs when Web Locks are unavailable', browserOptions, async () => {
		await withWorkspacePage(async (page, context, browserUrl) => {
			const key = 'wasm-idle:example-workspace:v3';
			await context.addInitScript((key) => {
				Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
				if (localStorage.getItem(key) === null)
					localStorage.setItem(
						key,
						JSON.stringify({
							version: 6,
							language: 'CPP',
							activePath: 'notes.txt',
							files: [{ path: 'notes.txt', content: 'shared original' }],
							lspEnabled: false
						})
					);
			}, key);
			await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
			await page.locator('[data-workspace-save-state="saved"]').waitFor();
			const firstId = new URL(page.url()).searchParams.get('workspace');
			expect(firstId).toBeTruthy();
			const second = await context.newPage();
			try {
				await second.goto(page.url(), { waitUntil: 'domcontentloaded' });
				await second.locator('[data-workspace-save-state="saved"]').waitFor();
				expect(new URL(second.url()).searchParams.get('workspace')).not.toBe(firstId);
				await second.evaluate(() =>
					(window as any).__wasmIdleDebug.setEditorValue('second tab edit')
				);
				const secondKey = `${key}:${new URL(second.url()).searchParams.get('workspace')}`;
				await second.waitForFunction(
					(key) =>
						JSON.parse(localStorage.getItem(key)!).files[0].content ===
						'second tab edit',
					secondKey
				);
				expect(
					await page.evaluate(
						(key) => JSON.parse(localStorage.getItem(key)!).files[0].content,
						`${key}:${firstId}`
					)
				).toBe('shared original');
				expect(
					await page.evaluate(
						(key) => JSON.parse(localStorage.getItem(key)!).files[0].content,
						key
					)
				).toBe('shared original');
			} finally {
				await second.close();
			}
		});
	});

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
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				const editableUrl = new URL(page.url());
				expect(editableUrl.searchParams.get('workspace')).toBeTruthy();
				expect(editableUrl.searchParams.has('lang')).toBe(false);
				expect(editableUrl.searchParams.has('code')).toBe(false);
				expect(editableUrl.searchParams.has('code64')).toBe(false);
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

	it.each(['query', 'fragment'])(
		'retains a %s import across the first isolation reload until it can be saved',
		browserOptions,
		async (format) => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				const key = 'wasm-idle:example-workspace:v3';
				const previous = JSON.stringify({
					version: 6,
					language: 'CPP',
					files: [{ path: 'original.cpp', content: 'int previous_work;' }]
				});
				const source = 'print("공유 문서")';
				const url = new URL(browserUrl);
				url.searchParams.set('theme', 'dark');
				if (format === 'query') {
					url.searchParams.set('lang', 'python');
					url.searchParams.set('code', source);
					url.searchParams.set('args', '--shared-input');
				} else {
					url.hash =
						'workspace=' +
						Buffer.from(
							JSON.stringify({
								version: 6,
								language: 'PYTHON',
								activePath: 'shared.py',
								files: [{ path: 'shared.py', content: source }]
							})
						).toString('base64url');
				}
				// The worker takes control on the second navigation and supplies isolation.
				await page.route(
					(requestUrl) => requestUrl.pathname === url.pathname,
					async (route) => {
						const response = await route.fetch();
						const headers = response.headers();
						delete headers['cross-origin-opener-policy'];
						delete headers['cross-origin-embedder-policy'];
						await route.fulfill({ response, headers });
					},
					{ times: 1 }
				);
				await context.addInitScript(
					({ key, previous, format }) => {
						if (!navigator.serviceWorker.controller)
							localStorage.setItem(key, previous);
						const { getItem, setItem } = Storage.prototype;
						(window as any).__restoreWorkspaceStorage = () =>
							Object.assign(Storage.prototype, { getItem, setItem });
						const isolatedKey = (storage: Storage, name: string) =>
							storage === localStorage && name.startsWith(key + ':');
						Storage.prototype.getItem = function (name) {
							if (format === 'fragment' && isolatedKey(this, name))
								throw new DOMException('Storage denied', 'SecurityError');
							return getItem.call(this, name);
						};
						Storage.prototype.setItem = function (name, value) {
							if (format === 'query' && isolatedKey(this, name))
								throw new DOMException('Quota full', 'QuotaExceededError');
							setItem.call(this, name, value);
						};
					},
					{ key, previous, format }
				);
				await page.goto(url.href, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(() => {
					const [entry] = performance.getEntriesByType(
						'navigation'
					) as PerformanceNavigationTiming[];
					return (
						entry?.type === 'reload' &&
						crossOriginIsolated &&
						!!navigator.serviceWorker.controller
					);
				});
				await page.locator('[data-workspace-save-state="error"]').waitFor();
				expect(page.url()).toBe(url.href);
				expect(await page.locator('#language-select').inputValue()).toBe('PYTHON');
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(source);

				const edited = 'print("편집한 문서")';
				await page.evaluate(
					(text) => (window as any).__wasmIdleDebug.setEditorValue(text),
					edited
				);
				await context.grantPermissions(['clipboard-read', 'clipboard-write']);
				await page.getByRole('button', { name: 'Share', exact: true }).click();
				await page.getByText('Share URL copied', { exact: true }).waitFor();
				const share = new URL(await page.evaluate(() => navigator.clipboard.readText()));
				expect(share.searchParams.get('theme')).toBe('dark');
				for (const name of ['lang', 'code', 'args', 'workspace'])
					expect(share.searchParams.has(name)).toBe(false);
				const exported = JSON.parse(
					Buffer.from(share.hash.slice('#workspace='.length), 'base64url').toString()
				);
				expect(exported.files).toContainEqual(expect.objectContaining({ content: edited }));
				expect(page.url()).toBe(url.href);

				await retrySaveAfterStorageError(page);
				await page.waitForURL((current) => current.searchParams.has('workspace'));
				const editable = new URL(page.url());
				expect(editable.hash).toBe('');
				expect(editable.searchParams.has('code')).toBe(false);
				const saved = await page.evaluate(
					(key) => JSON.parse(localStorage.getItem(key)!),
					`${key}:${editable.searchParams.get('workspace')}`
				);
				expect(saved.language).toBe('PYTHON');
				expect(saved.files).toContainEqual(expect.objectContaining({ content: edited }));
				expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(previous);
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
						if (sessionStorage.getItem('seeded-recovery')) return;
						sessionStorage.setItem('seeded-recovery', '1');
						localStorage.setItem('wasm-idle:example-workspace:v3', primary);
						localStorage.setItem(key, raw);
					},
					{ primary, raw, key }
				);
				const url = new URL(browserUrl);
				url.searchParams.set('workspace', id);
				// Let the real service worker supply isolation on the second navigation.
				await page.route(
					(requestUrl) => requestUrl.href === url.href,
					async (route) => {
						const response = await route.fetch();
						const headers = response.headers();
						delete headers['cross-origin-opener-policy'];
						delete headers['cross-origin-embedder-policy'];
						await route.fulfill({ response, headers });
					},
					{ times: 1 }
				);
				// Wait for the worker's navigation response before inspecting the replacement document.
				const [reload] = await Promise.all([
					page.waitForResponse(
						(response) =>
							response.url() === url.href &&
							response.request().isNavigationRequest() &&
							response.fromServiceWorker(),
						{ timeout: 90_000 }
					),
					page.goto(url.href, { waitUntil: 'domcontentloaded' })
				]);
				await reload.finished();
				await page.waitForFunction(() => {
					const [navigation] = performance.getEntriesByType(
						'navigation'
					) as PerformanceNavigationTiming[];
					return (
						navigation?.type === 'reload' &&
						crossOriginIsolated &&
						!!navigator.serviceWorker.controller
					);
				});
				await page.locator('[data-workspace-recovery]').waitFor();
				const readRecovery = () =>
					page.evaluate(
						(key) => ({
							original: localStorage.getItem(key),
							backups: Object.keys(localStorage)
								.filter((item) => item.startsWith(`${key}:recovery:`))
								.map((item) => [item, localStorage.getItem(item)])
						}),
						key
					);
				const preserved = await readRecovery();
				expect(preserved).toEqual({ original: raw, backups: [[expect.any(String), raw]] });
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('[data-workspace-recovery]').waitFor();
				expect(await readRecovery()).toEqual(preserved);
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
				await page
					.getByRole('textbox', { name: 'Program arguments' })
					.fill('--quota-probe');
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
					await sharedPage.locator('[data-workspace-save-state="saved"]').waitFor();
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
					const setItem = Storage.prototype.setItem;
					target.__restoreWorkspaceStorage = () => {
						Storage.prototype.setItem = setItem;
					};
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
				await page.getByRole('alert').filter({ hasText: 'Not saved locally' }).waitFor();
				const backupDownload = page.waitForEvent('download');
				await page.getByRole('button', { name: 'Export workspace', exact: true }).click();
				const backupPath = await (await backupDownload).path();
				if (!backupPath) throw new Error('Missing workspace backup');
				const backupBytes = await readFile(backupPath);
				const backup = JSON.parse(backupBytes.toString());
				expect(backup.format).toBe(WORKSPACE_BACKUP_FORMAT);
				expect(backup.snapshot.version).toBe(6);
				const { CPP: active, ...inactive } = backup.snapshot.workspaces;
				expect(active).toEqual({
					activePath: backup.snapshot.activePath,
					files: backup.snapshot.files,
					openTabs: backup.snapshot.openTabs
				});
				expect(backup.snapshot.files).toContainEqual({
					path: 'unsaved.txt',
					content: 'latest unsaved content',
					encoding: 'utf-8'
				});
				await retrySaveAfterStorageError(page);
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				expect(
					await page.getByRole('alert').filter({ hasText: 'Not saved locally' }).count()
				).toBe(0);
				expect(
					await page.evaluate(() =>
						JSON.parse(localStorage.getItem('wasm-idle:example-workspace:v3')!)
					)
				).toEqual({ ...backup.snapshot, version: 7, workspaces: inactive });
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

describe('workspace editor model lifetime', () => {
	it(
		'restores the cursor and viewport after a language switch without any undo history',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				await disableBrowserPrewarm(context);
				const code = Array.from(
					{ length: 140 },
					(_, index) => '// source line ' + index
				).join('\n');
				const url = new URL(browserUrl);
				url.searchParams.set('lsp-test', '1');
				url.searchParams.set('lang', 'cpp');
				url.searchParams.set('code', code);
				await page.goto(url.href, { waitUntil: 'domcontentloaded' });
				const view = () =>
					page.evaluate(() => {
						const editor = (window as any).__wasmIdleMonacoEditor;
						return {
							line: editor?.getPosition()?.lineNumber,
							scroll: editor?.getScrollTop()
						};
					});
				await page.waitForFunction(
					() => (window as any).__wasmIdleMonacoEditor?.getModel()?.getLineCount() === 140
				);
				await page.evaluate(() => (window as any).__wasmIdleMonacoEditor.focus());
				await page.keyboard.press('Control+End');
				await expect.poll(async () => (await view()).scroll).toBeGreaterThan(0);
				const before = await view();
				expect(before.line).toBe(140);
				await page.locator('#language-select').selectOption('PYTHON');
				await page.waitForFunction(() =>
					(window as any).__wasmIdleMonacoEditor?.getModel()?.uri.path.endsWith('.py')
				);
				await page.locator('#language-select').selectOption('CPP');
				await expect.poll(view).toEqual(before);
			});
		}
	);

	it(
		'keeps undo and redo separate when language projects share a filename',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				await disableBrowserPrewarm(context);
				await context.addInitScript(() => {
					const project = {
						activePath: 'shared.txt',
						openTabs: ['shared.txt'],
						files: [{ path: 'shared.txt', content: 'base' }]
					};
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							version: 6,
							language: 'CPP',
							lspEnabled: false,
							...project,
							workspaces: { CPP: project, PYTHON: project }
						})
					);
				});
				const url = new URL(browserUrl);
				url.searchParams.set('lsp-test', '1');
				await page.goto(url.href, { waitUntil: 'domcontentloaded' });
				const value = () =>
					page.evaluate(() => (window as any).__wasmIdleMonacoEditor?.getValue());
				await expect.poll(value, { timeout: 60000 }).toBe('base');
				const select = async (language: string, contents: string) => {
					await page.evaluate(() => {
						(window as any).__previousProjectEditor = (
							window as any
						).__wasmIdleMonacoEditor;
					});
					await page.locator('#language-select').selectOption(language);
					await page.waitForFunction((text) => {
						const target = window as any;
						return (
							target.__wasmIdleMonacoEditor !== target.__previousProjectEditor &&
							target.__wasmIdleMonacoEditor?.getValue() === text
						);
					}, contents);
				};
				const focus = () =>
					page.evaluate(() => (window as any).__wasmIdleMonacoEditor.focus());
				const append = async (text: string) => {
					await focus();
					await page.keyboard.press('Control+End');
					await page.keyboard.insertText(text);
				};
				await append('1');
				expect(await value()).toBe('base1');
				await select('PYTHON', 'base');
				await focus();
				await page.keyboard.press('Control+z');
				expect(await value()).toBe('base');
				await append('2');
				await select('CPP', 'base1');
				await focus();
				await page.keyboard.press('Control+z');
				expect(await value()).toBe('base');
				await select('PYTHON', 'base2');
				await focus();
				await page.keyboard.press('Control+z');
				expect(await value()).toBe('base');
				await select('CPP', 'base');
				await focus();
				await page.keyboard.press('Control+y');
				expect(await value()).toBe('base1');

				page.once('dialog', (dialog) => dialog.accept());
				await page.getByRole('button', { name: 'Reset', exact: true }).click();
				await page.locator('.file-tab.active[title="main.cpp"]').waitFor();
				await select('PYTHON', 'base');
				await focus();
				await page.keyboard.press('Control+y');
				expect(await value()).toBe('base2');
			});
		}
	);

	it(
		'saves the first edit in an empty project under the language entry path',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				await disableBrowserPrewarm(context);
				const key = 'wasm-idle:example-workspace:v3';
				await context.addInitScript((key) => {
					if (localStorage.getItem(key) === null) {
						localStorage.setItem(
							key,
							JSON.stringify({
								version: 6,
								language: 'PYTHON',
								activePath: '',
								files: [],
								openTabs: [],
								lspEnabled: false
							})
						);
					}
				}, key);
				await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
				const ready = page.locator('#language-select[data-workspace-ready="true"]');
				await ready.waitFor({ timeout: 120_000 });
				expect(await page.locator('.file-tab').count()).toBe(0);
				const source = 'print("first edit")';
				await page
					.locator('.monaco-editor .view-lines')
					.click({ position: { x: 6, y: 6 } });
				await page.keyboard.insertText('print');
				await page.locator('.file-tab.active[title="main.py"]').waitFor();
				await page.keyboard.insertText('("first edit")');
				await page.locator('button[title="Save workspace"]').click();
				await expect
					.poll(() =>
						page.evaluate((key) => {
							const snapshot = JSON.parse(localStorage.getItem(key) || '{}');
							return {
								version: snapshot.version,
								language: snapshot.language,
								files: snapshot.files
							};
						}, key)
					)
					.toMatchObject({
						version: 7,
						language: 'PYTHON',
						files: [{ path: 'main.py', content: source }]
					});
				await page.reload({ waitUntil: 'domcontentloaded' });
				await ready.waitFor();
				await page.locator('.file-tab.active[title="main.py"]').waitFor();
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getEditorValue())
				).toBe(source);
			});
		}
	);

	it(
		'discards retained redo history when resetting from another file',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				await context.addInitScript((source) => {
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							version: 6,
							language: 'JAVASCRIPT',
							activePath: 'main.js',
							lspEnabled: false,
							files: [
								{ path: 'main.js', content: source },
								{ path: 'second.js', content: 'const second = 2;' }
							],
							openTabs: ['main.js', 'second.js']
						})
					);
				}, editorDefaults.javascript);
				const url = new URL(browserUrl);
				url.searchParams.set('lsp-test', '1');
				await page.goto(url.toString(), {
					waitUntil: 'domcontentloaded',
					timeout: 120_000
				});
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleMonacoEditor?.getValue() === source,
					editorDefaults.javascript,
					{ timeout: 120_000 }
				);
				const before = await page.evaluate(async () => {
					const target = window as any;
					const editor = target.__wasmIdleMonacoEditor;
					target.__resetPreviousModel = editor.getModel();
					editor.pushUndoStop();
					editor.executeEdits('regression', [
						{
							range: {
								startLineNumber: 1,
								startColumn: 1,
								endLineNumber: 1,
								endColumn: 1
							},
							text: '// discarded edit\n'
						}
					]);
					editor.pushUndoStop();
					await editor.getModel().undo();
					return { value: editor.getValue(), canRedo: editor.getModel().canRedo() };
				});
				expect(before).toEqual({ value: editorDefaults.javascript, canRedo: true });
				await page
					.getByRole('navigation', { name: 'Open files' })
					.getByRole('button', { name: 'second.js', exact: true })
					.click();
				await page.waitForFunction(
					() => (window as any).__wasmIdleMonacoEditor?.getValue() === 'const second = 2;'
				);
				expect(
					await page.evaluate(() => (window as any).__resetPreviousModel.isDisposed())
				).toBe(false);
				const showFiles = page.getByRole('button', { name: 'Show files', exact: true });
				if (await showFiles.isVisible()) await showFiles.click();
				page.once('dialog', (dialog) => void dialog.accept());
				await page.getByRole('button', { name: 'Reset', exact: true }).click();
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleMonacoEditor?.getValue() === source,
					editorDefaults.javascript
				);
				const after = await page.evaluate(async () => {
					const target = window as any;
					const editor = target.__wasmIdleMonacoEditor;
					const model = editor.getModel();
					const history = {
						sameModel: model === target.__resetPreviousModel,
						previousDisposed: target.__resetPreviousModel.isDisposed(),
						canUndo: model.canUndo(),
						canRedo: model.canRedo()
					};
					await model.redo();
					return { ...history, value: editor.getValue() };
				});
				expect(after).toEqual({
					sameModel: false,
					previousDisposed: true,
					canUndo: false,
					canRedo: false,
					value: editorDefaults.javascript
				});
			});
		}
	);

	it(
		'retains undo, selection, scroll and the editor when switching tabs',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl) => {
				await context.addInitScript(() => {
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							version: 6,
							language: 'JAVASCRIPT',
							activePath: 'first.js',
							lspEnabled: false,
							files: [
								{
									path: 'first.js',
									content: Array.from(
										{ length: 160 },
										(_, i) => `// line ${i + 1}`
									).join('\n')
								},
								{ path: 'second.js', content: 'const second = 2;' }
							],
							openTabs: ['first.js', 'second.js']
						})
					);
				});
				const url = new URL(browserUrl);
				url.searchParams.set('lsp-test', '1');
				await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(
					() =>
						(window as any).__wasmIdleMonacoEditor
							?.getModel()
							?.getValue()
							.startsWith('// line 1'),
					undefined,
					{ timeout: 120_000 }
				);
				const before = await page.evaluate(() => {
					const target = window as any;
					const editor = target.__wasmIdleMonacoEditor;
					target.__retainedEditor = editor;
					target.__retainedModel = editor.getModel();
					editor.pushUndoStop();
					editor.executeEdits('regression', [
						{
							range: {
								startLineNumber: 1,
								startColumn: 1,
								endLineNumber: 1,
								endColumn: 1
							},
							text: '// edited\n'
						}
					]);
					editor.pushUndoStop();
					editor.setSelection({
						startLineNumber: 80,
						startColumn: 2,
						endLineNumber: 81,
						endColumn: 5
					});
					editor.setScrollTop(1200, 1);
					return {
						selection: { ...editor.getSelection() },
						scrollTop: editor.getScrollTop(),
						value: editor.getValue()
					};
				});
				const tabs = page.getByRole('navigation', { name: 'Open files' });
				await tabs.getByRole('button', { name: 'second.js', exact: true }).click();
				await page.waitForFunction(
					() => (window as any).__wasmIdleMonacoEditor?.getValue() === 'const second = 2;'
				);
				await tabs.getByRole('button', { name: 'first.js', exact: true }).click();
				await page.waitForFunction(() =>
					(window as any).__wasmIdleMonacoEditor?.getValue().startsWith('// edited')
				);
				const after = await page.evaluate(() => {
					const target = window as any;
					const editor = target.__wasmIdleMonacoEditor;
					return {
						sameEditor: editor === target.__retainedEditor,
						sameModel: editor.getModel() === target.__retainedModel,
						selection: { ...editor.getSelection() },
						scrollTop: editor.getScrollTop(),
						value: editor.getValue(),
						canUndo: editor.getModel().canUndo()
					};
				});
				expect(after).toMatchObject({
					...before,
					sameEditor: true,
					sameModel: true,
					canUndo: true
				});
				await page.evaluate(() => (window as any).__wasmIdleMonacoEditor.getModel().undo());
				await page.waitForFunction(() =>
					(window as any).__wasmIdleMonacoEditor.getValue().startsWith('// line 1')
				);
				// Restoring another workspace with the same path must discard the old history.
				await page.locator('input[type="file"]').setInputFiles({
					name: 'replacement.json',
					mimeType: 'application/json',
					buffer: Buffer.from(
						JSON.stringify({
							format: WORKSPACE_BACKUP_FORMAT,
							snapshot: {
								version: 6,
								language: 'JAVASCRIPT',
								activePath: 'first.js',
								files: [{ path: 'first.js', content: 'const replacement = 3;' }],
								lspEnabled: false
							}
						})
					)
				});
				await page.waitForFunction(
					() =>
						(window as any).__wasmIdleMonacoEditor?.getValue() ===
						'const replacement = 3;'
				);
				expect(
					await page.evaluate(() => ({
						disposed: (window as any).__retainedModel.isDisposed(),
						canUndo: (window as any).__wasmIdleMonacoEditor.getModel().canUndo()
					}))
				).toEqual({ disposed: true, canUndo: false });
			});
		}
	);
});
