// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { strToU8, zipSync } from 'fflate';
import { chromium, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { serializeWorkspaceBackup } from './workspaceBackup';
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
			await page.locator('#language-select[data-workspace-ready="true"]').waitFor({
				state: 'attached',
				timeout: 90_000
			});
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
		'preserves the UTF-8 BOM and line endings across edits, undo, save and download',
		browserOptions,
		async () => {
			await withImportPage(async (page) => {
				const original = '\uFEFFfirst\r\n끝';
				const downloadFile = async () => {
					const pending = page.waitForEvent('download');
					await page.getByRole('button', { name: 'Download', exact: true }).click();
					const path = await (await pending).path();
					if (!path) throw new Error('Missing workspace file download');
					return readFile(path);
				};
				await page.locator('input[type="file"]').setInputFiles({
					name: 'bom.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from(original)
				});
				await page.locator('.file-tab.active[title="bom.txt"]').waitFor();
				const line = page.locator('.editor-surface .monaco-editor .view-line').last();
				await expect.poll(() => line.textContent()).toContain('끝');
				expect(await downloadFile()).toEqual(Buffer.from(original));
				await line.click();
				await page.keyboard.press('Control+End');
				await page.keyboard.insertText('!');
				expect(await downloadFile()).toEqual(Buffer.from(original + '!'));
				await line.click();
				await page.keyboard.press('Control+z');
				expect(await downloadFile()).toEqual(Buffer.from(original));
				await line.click();
				await page.keyboard.press('Control+y');
				await page.getByTitle('Save workspace').click();
				await page
					.locator('.statusbar__message')
					.filter({ hasText: 'Saved locally' })
					.waitFor();
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('.file-tab.active[title="bom.txt"]').waitFor();
				expect(await downloadFile()).toEqual(Buffer.from(original + '!'));
			});
		}
	);

	it(
		'keeps uploaded binary bytes intact while adjacent text remains editable',
		browserOptions,
		async () => {
			await withImportPage(async (page) => {
				const content = 'data:application/octet-stream;base64,AP8B';
				const value = () =>
					page.evaluate(() =>
						(
							window as typeof window & {
								__wasmIdleDebug?: { getEditorValue(): string };
							}
						).__wasmIdleDebug?.getEditorValue()
					);
				const select = (name: string) =>
					page.locator(`.workspace-files button[title="${name}"]`).click();
				const typeAtEnd = async (text: string) => {
					await page.locator('.editor-surface .monaco-editor .view-line').first().click();
					await page.keyboard.press('Control+End');
					await page.keyboard.insertText(text);
				};
				await page.locator('input[type="file"]').setInputFiles([
					{
						name: 'sample.bin',
						mimeType: 'application/octet-stream',
						buffer: Buffer.from([0, 255, 1])
					},
					{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') }
				]);
				await expect.poll(value).toBe(content);
				await typeAtEnd('!');
				expect(await value()).toBe(content);
				await select('notes.txt');
				await expect.poll(value).toBe('notes');
				await typeAtEnd(' edited');
				await expect.poll(value).toBe('notes edited');
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await expect.poll(value).toBe('notes edited');
				await select('sample.bin');
				await expect.poll(value).toBe(content);
				expect(await page.locator('[data-workspace-recovery]').count()).toBe(0);
			});
		}
	);

	it(
		'reports restored backups without replacing their status with zero imported files',
		browserOptions,
		async () => {
			await withImportPage(async (page) => {
				const backup = {
					version: 6,
					language: 'PYTHON',
					activePath: 'restored-status.py',
					files: [{ path: 'restored-status.py', content: 'print("status")\n' }]
				};
				await page.locator('input[type="file"]').setInputFiles({
					name: 'renamed.backup',
					mimeType: 'application/json',
					buffer: Buffer.from(serializeWorkspaceBackup(backup))
				});
				await page
					.getByText('Workspace backup restored', { exact: true })
					.waitFor()
					.catch(async (error) => {
						const status = await page.locator('.statusbar__message').textContent();
						throw new Error(
							`Backup restore confirmation missing; current status: ${status}`,
							{
								cause: error
							}
						);
					});
				expect(await page.getByText('0 files imported', { exact: true }).count()).toBe(0);
				expect(
					await page.locator('button[title="restored-status.py"]').count()
				).toBeGreaterThan(0);
			});
		}
	);
	it(
		'rolls back a mixed selection and permits retrying the same files after a ZIP failure',
		browserOptions,
		async () => {
			await withImportPage(async (page) => {
				await page.evaluate(() => {
					const target = window as typeof window & { importReads?: number };
					target.importReads = 0;
					const original = File.prototype.arrayBuffer;
					File.prototype.arrayBuffer = async function () {
						target.importReads = (target.importReads || 0) + 1;
						return original.call(this);
					};
				});
				const beforeUrl = page.url();
				const selection = [
					{
						name: 'first.txt',
						mimeType: 'text/plain',
						buffer: Buffer.from('first file')
					},
					{
						name: 'broken.zip',
						mimeType: 'application/zip',
						buffer: Buffer.from([1, 2, 3])
					}
				];
				await page.locator('input[type="file"]').setInputFiles(selection);
				await page.getByText(/^Import failed:/u).waitFor();
				expect(await page.locator('input[type="file"]').inputValue()).toBe('');
				expect(await page.locator('button[title="first.txt"]').count()).toBe(0);
				expect(page.url()).toBe(beforeUrl);
				const reads = await page.evaluate(
					() => (window as typeof window & { importReads?: number }).importReads || 0
				);
				await page.locator('input[type="file"]').setInputFiles(selection);
				await page.waitForFunction(
					(previous) =>
						((window as typeof window & { importReads?: number }).importReads || 0) >=
						previous + 2,
					reads
				);
				await page.waitForFunction(
					() =>
						(document.querySelector('input[type="file"]') as HTMLInputElement).value ===
						''
				);
				expect(await page.locator('button[title="first.txt"]').count()).toBe(0);
			});
		}
	);
	it.each(['renamed.txt', 'wasm-idle-workspace (1).json'] as const)(
		'restores a backup named %s by its format',
		browserOptions,
		async (name) => {
			await withImportPage(async (page) => {
				const backup = {
					version: 6,
					language: 'PYTHON',
					activePath: 'restored.py',
					files: [{ path: 'restored.py', content: 'print("restored backup")\n' }],
					openTabs: ['restored.py']
				};
				await page.locator('input[type="file"]').setInputFiles({
					name,
					mimeType: 'application/json',
					buffer: Buffer.from(serializeWorkspaceBackup(backup))
				});
				await page.locator('button[title="restored.py"]').waitFor();
				expect(await page.locator('#language-select').inputValue()).toBe('PYTHON');
				expect(await page.locator(`button[title="${name}"]`).count()).toBe(0);
			});
		}
	);
	it(
		'opens ZIP paths unchanged in a new workspace and preserves the original local code',
		browserOptions,
		async () => {
			await withImportPage(async (page) => {
				await page.waitForFunction(
					() =>
						!!(
							window as typeof window & {
								__wasmIdleDebug?: { getEditorValue(): string };
							}
						).__wasmIdleDebug?.getEditorValue()
				);
				const original = '// original workspace\nint main() { return 11; }\n';
				expect(
					await page.evaluate(
						(code) =>
							(
								window as typeof window & {
									__wasmIdleDebug?: {
										setEditorValue(value: string): Promise<boolean>;
									};
								}
							).__wasmIdleDebug?.setEditorValue(code),
						original
					)
				).toBe(true);
				await page.locator('input[type="file"]').setInputFiles({
					name: 'referenced-project.zip',
					mimeType: 'application/zip',
					buffer: Buffer.from(
						zipSync({
							'main.cpp': strToU8(
								'#include "util.h"\nint main() { return VALUE; }\n'
							),
							'util.h': strToU8('#define VALUE 7\n')
						})
					)
				});
				await page.waitForURL((url) => url.searchParams.has('workspace'), {
					waitUntil: 'commit'
				});
				expect(new URL(page.url()).searchParams.get('workspace')).toMatch(
					/^[0-9a-f-]{36}$/u
				);
				await page.locator('button[title="util.h"]').first().waitFor();
				expect(await page.locator('button[title="main-2.cpp"]').count()).toBe(0);
				expect(await page.locator('button[title="util-2.h"]').count()).toBe(0);
				await page.getByRole('link', { name: 'Local workspace', exact: true }).click();
				await page.waitForFunction(
					(expected) =>
						(
							window as typeof window & {
								__wasmIdleDebug?: { getEditorValue(): string };
							}
						).__wasmIdleDebug?.getEditorValue() === expected,
					original
				);
				expect(await page.locator('button[title="util.h"]').count()).toBe(0);
			});
		}
	);
	it(
		'keeps the original workspace when a ZIP cannot be saved and permits retrying the import',
		browserOptions,
		async () => {
			await withImportPage(async (page) => {
				const key = 'wasm-idle:example-workspace:v3';
				await page.getByRole('textbox', { name: 'Program arguments' }).fill('--original');
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await page.waitForFunction(
					(key) =>
						JSON.parse(localStorage.getItem(key) ?? '{}').argsInput === '--original',
					key
				);
				const originalUrl = page.url();
				const originalSnapshot = await page.evaluate((key) => {
					const write = Storage.prototype.setItem;
					Storage.prototype.setItem = function (name, value) {
						if (this === localStorage && name.startsWith(key + ':'))
							throw new DOMException('Storage is full', 'QuotaExceededError');
						write.call(this, name, value);
					};
					return localStorage.getItem(key);
				}, key);
				const upload = () =>
					page.locator('input[type="file"]').setInputFiles({
						name: 'project.zip',
						mimeType: 'application/zip',
						buffer: Buffer.from(zipSync({ 'from-zip.cpp': strToU8('int imported;') }))
					});
				await upload();
				await page.getByText('Import failed: Storage is full', { exact: true }).waitFor();
				expect(page.url()).toBe(originalUrl);
				expect(await page.locator('.file-tab[title="from-zip.cpp"]').count()).toBe(0);
				expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
					originalSnapshot
				);
				// Reloading also restores the browser's ordinary storage writes.
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor({
					state: 'attached',
					timeout: 90_000
				});
				await upload();
				await page.waitForURL((url) => url.searchParams.has('workspace'), {
					waitUntil: 'commit'
				});
				await page.locator('.file-tab.active[title="from-zip.cpp"]').waitFor();
				const id = new URL(page.url()).searchParams.get('workspace');
				expect(id).toMatch(/^[0-9a-f-]{36}$/i);
				const saved = await page.evaluate(
					(key) => JSON.parse(localStorage.getItem(key) ?? '{}'),
					key + ':' + id
				);
				expect(saved.files).toEqual([
					expect.objectContaining({ path: 'from-zip.cpp', content: 'int imported;' })
				]);
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('.file-tab.active[title="from-zip.cpp"]').waitFor();
			});
		}
	);
	it(
		'keeps previous language projects and arguments out of a shared ZIP workspace',
		browserOptions,
		async () => {
			await withImportPage(async (page) => {
				const previousFile = { path: 'previous-project.py', content: 'print("previous")' };
				const backup = {
					version: 6,
					language: 'CPP',
					workspaces: {
						CPP: { files: [{ path: 'main.cpp', content: '// previous C++' }] },
						PYTHON: { files: [previousFile] }
					},
					argsInput: '--previous-project',
					compilerOptions: { CPP: { arguments: '-DPREVIOUS_PROJECT' } }
				};
				const upload = page.locator('input[type="file"]');
				await upload.setInputFiles({
					name: 'previous-workspace.json',
					mimeType: 'application/json',
					buffer: Buffer.from(serializeWorkspaceBackup(backup))
				});
				await page.getByText('Workspace backup restored', { exact: true }).waitFor();
				await page.locator('[data-workspace-save-state="saved"]').waitFor();

				const source = 'int main() { return 0; }';
				await upload.setInputFiles({
					name: 'standalone.zip',
					mimeType: 'application/zip',
					buffer: Buffer.from(zipSync({ 'main.cpp': strToU8(source) }))
				});
				await page.getByText('1 file imported', { exact: true }).waitFor();
				await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
				await page.getByRole('button', { name: 'Share', exact: true }).click();
				await page.getByText(/Share URL copied/).waitFor();
				const share = new URL(await page.evaluate(() => navigator.clipboard.readText()));
				const shared = JSON.parse(
					Buffer.from(share.hash.slice('#workspace='.length), 'base64url').toString(
						'utf8'
					)
				);
				expect(shared.workspaces.CPP.files).toEqual([
					expect.objectContaining({ path: 'main.cpp', content: source })
				]);
				expect(
					shared.workspaces.PYTHON.files.map((file: { path: string }) => file.path)
				).not.toContain(previousFile.path);
				expect(shared.argsInput).toBe('');
				expect(shared.compilerOptions).toEqual({});

				await page.getByRole('link', { name: 'Local workspace', exact: true }).click();
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor({
					state: 'attached',
					timeout: 90_000
				});
				expect(
					await page.getByRole('textbox', { name: 'Program arguments' }).inputValue()
				).toBe(backup.argsInput);
				await page.locator('#language-select').selectOption('PYTHON');
				await page.locator('.file-tab.active[title="previous-project.py"]').waitFor();
			});
		}
	);
	it(
		'rejects traversal in new and renamed file paths without changing the workspace',
		browserOptions,
		async () => {
			await withImportPage(async (page) => {
				page.once('dialog', (dialog) => dialog.accept('a/../b.py'));
				await page.getByRole('button', { name: 'New file', exact: true }).click();
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
