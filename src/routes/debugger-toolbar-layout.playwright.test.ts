// @vitest-environment node

import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import {
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';
import { prepareContainerRuntimePage } from '../../scripts/container-runtime-browser-observer.mjs';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_WORKSPACE_REGRESSIONS === '1';
const browserOptions = {
	skip: !enabled,
	timeout: 120_000,
	meta: { browser: true, requiredBrowser: enabled }
};

async function withWorkspacePage(
	run: (
		page: Page,
		context: BrowserContext,
		browserUrl: string,
		observeErrors: () => void
	) => Promise<void>
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
		const observeErrors = () => page.on('pageerror', (error) => errors.push(error.message));
		try {
			await run(page, context, server.browserUrl, observeErrors);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
			await browser.close();
			await server.close();
		}
	});
}

describe('narrow paused debugger controls', () => {
	it(
		'toggles gutter breakpoints and keeps paused debugger actions reachable at a 300px pane width',
		browserOptions,
		async () => {
			await withWorkspacePage(async (page, context, browserUrl, observeErrors) => {
				await context.addInitScript(() =>
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							version: 6,
							language: 'PYTHON',
							activePath: 'main.py',
							files: [
								{
									path: 'main.py',
									content: 'value = 1\nprint("debug-layout", value)\n'
								}
							],
							lspEnabled: false,
							sidebarOpen: true
						})
					)
				);
				await page.setViewportSize({ width: 961, height: 960 });
				await prepareContainerRuntimePage(page, browserUrl);
				observeErrors();
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.waitForFunction(() =>
					(window as any).__wasmIdleDebug?.getEditorValue().includes('debug-layout')
				);
				const gutter = page.locator('.monaco-editor .glyph-margin').first();
				const secondLine = page
					.locator('.monaco-editor .line-numbers', { hasText: /^2$/ })
					.first();
				await secondLine.scrollIntoViewIfNeeded();
				const [margin, line] = await Promise.all([
					gutter.boundingBox(),
					secondLine.boundingBox()
				]);
				if (!margin || !line)
					throw new Error('Expected a visible breakpoint gutter on line 2');
				const toggleBreakpoint = () =>
					page.mouse.click(margin.x + 3, line.y + line.height / 2);
				const marker = page.locator('.monaco-editor .debug-breakpoint-glyph');
				await toggleBreakpoint();
				await marker.waitFor();
				await toggleBreakpoint();
				await marker.waitFor({ state: 'detached' });
				await toggleBreakpoint();
				await marker.waitFor();
				await page.getByRole('button', { name: 'Debug', exact: true }).click();
				await page.waitForFunction(
					() => (window as any).__wasmIdleDebug?.getDebugState().paused,
					undefined,
					{ timeout: 60_000 }
				);
				for (const width of [961, 1000]) {
					await page.setViewportSize({ width, height: 960 });
					const showFiles = page.getByRole('button', { name: 'Show files', exact: true });
					if (await showFiles.count()) await showFiles.click();
					await page.waitForTimeout(100);
					const controls = await page.evaluate(() => {
						const shell = document
							.querySelector('.debug-shell')!
							.getBoundingClientRect();
						const pane = document
							.querySelector('.terminal-pane')!
							.getBoundingClientRect();
						return {
							paneWidth: pane.width,
							actions: [...document.querySelectorAll('.debug-controls button')].map(
								(button) => {
									const rect = button.getBoundingClientRect();
									const hit = document.elementFromPoint(
										rect.x + rect.width / 2,
										rect.y + rect.height / 2
									);
									return {
										name: button.getAttribute('aria-label'),
										insideShell:
											rect.left >= shell.left && rect.right <= shell.right,
										receivesPointer: hit === button || button.contains(hit)
									};
								}
							)
						};
					});
					expect(controls.paneWidth).toBeLessThanOrEqual(304);
					expect(controls.actions).toHaveLength(6);
					for (const action of controls.actions) {
						expect(action.insideShell, action.name || '').toBe(true);
						expect(action.receivesPointer, action.name || '').toBe(true);
					}
				}
				await page.getByRole('button', { name: /Stop Debug/ }).click();
			});
		}
	);
});

it(
	'moves the editor breakpoint to the renamed file and leaves a replacement file unmarked',
	browserOptions,
	async () => {
		await withWorkspacePage(async (page, context, browserUrl, observeErrors) => {
			await context.addInitScript(() => {
				const key = 'wasm-idle:example-workspace:v3';
				if (!localStorage.getItem(key))
					localStorage.setItem(
						key,
						JSON.stringify({
							version: 6,
							language: 'PYTHON',
							activePath: 'main.py',
							files: [{ path: 'main.py', content: 'value = 1\nprint(value)\n' }],
							lspEnabled: false,
							sidebarOpen: true
						})
					);
			});
			await prepareContainerRuntimePage(page, browserUrl);
			observeErrors();
			await page.evaluate(() => (window as any).__wasmIdleDebug.setBreakpoints([2]));
			const marker = page.locator('.monaco-editor .debug-breakpoint-glyph');
			const files = page.locator('.workspace-files');
			await marker.waitFor();
			page.once('dialog', (dialog) => dialog.accept('renamed.py'));
			await page.getByRole('button', { name: 'Rename', exact: true }).click();
			await files.locator('button.active[title="renamed.py"]').waitFor();
			await marker.waitFor();
			page.once('dialog', (dialog) => dialog.accept('main.py'));
			await page.getByRole('button', { name: 'New file', exact: true }).click();
			await files.locator('button.active[title="main.py"]').waitFor();
			await marker.waitFor({ state: 'detached' });
			await files.locator('button[title="renamed.py"]').click();
			await marker.waitFor();
			page.once('dialog', (dialog) => dialog.accept());
			await page.getByRole('button', { name: 'Reset', exact: true }).click();
			await files.locator('button.active[title="main.py"]').waitFor();
			page.once('dialog', (dialog) => dialog.accept('renamed.py'));
			await page.getByRole('button', { name: 'New file', exact: true }).click();
			await files.locator('button.active[title="renamed.py"]').waitFor();
			await marker.waitFor({ state: 'detached' });
		});
	}
);

it(
	'isolates breakpoints when a different language project renames and deletes the same path',
	browserOptions,
	async () => {
		await withWorkspacePage(async (page, context, browserUrl, observeErrors) => {
			await context.addInitScript(() => {
				const project = (header: string, main: string) => ({
					activePath: header,
					files: [
						{ path: header, content: '#pragma once\nint first;\nint second;\n' },
						{ path: main, content: 'int main(void) { return 0; }\n' }
					],
					openTabs: [header]
				});
				const c = project('shared.h', 'main.c');
				const key = 'wasm-idle:example-workspace:v3';
				if (!localStorage.getItem(key))
					localStorage.setItem(
						key,
						JSON.stringify({
							version: 6,
							language: 'C',
							...c,
							workspaces: { C: c, CPP: project('api.h', 'main.cpp') },
							lspEnabled: false,
							sidebarOpen: true
						})
					);
			});
			await prepareContainerRuntimePage(page, browserUrl);
			observeErrors();
			const markers = page.locator('.monaco-editor .debug-breakpoint-glyph');
			const files = page.locator('.workspace-files');
			const selected = (path: string) => files.locator(`button.active[title="${path}"]`);
			const choose = async (language: string, path: string) => {
				await page.locator('.language-trigger').click();
				await page.locator('#language-option-' + language).click();
				await selected(path).waitFor();
			};
			await selected('shared.h').waitFor();
			await page.evaluate(() => (window as any).__wasmIdleDebug.setBreakpoints([2]));
			await expect.poll(() => markers.count()).toBe(1);
			await choose('CPP', 'api.h');
			page.once('dialog', (dialog) => dialog.accept('shared.h'));
			await page.getByRole('button', { name: 'Rename', exact: true }).click();
			await selected('shared.h').waitFor();
			await expect.poll(() => markers.count()).toBe(0);
			await choose('C', 'shared.h');
			await expect.poll(() => markers.count()).toBe(1);
			await choose('CPP', 'shared.h');
			await page.evaluate(() => (window as any).__wasmIdleDebug.setBreakpoints([1, 3]));
			await expect.poll(() => markers.count()).toBe(2);
			page.once('dialog', (dialog) => dialog.accept());
			await page.getByRole('button', { name: 'Delete', exact: true }).click();
			await selected('main.cpp').waitFor();
			await choose('C', 'shared.h');
			await expect.poll(() => markers.count()).toBe(1);
		});
	}
);
