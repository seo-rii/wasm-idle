// @vitest-environment node

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
				await page.getByText('2 files imported', { exact: true }).waitFor();
				expect(new URL(page.url()).searchParams.get('workspace')).toMatch(
					/^[0-9a-f-]{36}$/u
				);
				expect(await page.locator('button[title="util.h"]').count()).toBeGreaterThan(0);
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
