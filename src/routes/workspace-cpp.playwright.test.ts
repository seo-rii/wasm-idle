// @vitest-environment node
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { expect, it } from 'vitest';
import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../scripts/browser-test-prewarm.mjs';
import {
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';
import { isStdinEditorReady } from '../../scripts/stdin-browser-probe-lib.mjs';
import type { WorkspaceFile } from './workspaceCodec';

const enabled = process.env.WASM_IDLE_RUN_CONTAINER_WEBSITE_BROWSER === '1';
const runTimeout = Number(process.env.WASM_IDLE_CPP_WORKSPACE_RUN_TIMEOUT_MS || '180000');
const storageKey = 'wasm-idle:example-workspace:v3';
const ownedWasm = 'data:application/wasm;base64,AGFzbQEAAAA=';
type Execution = { id: number; status: string; exitCode: number | null; endedAt: number | null };
type SiteWindow = typeof globalThis & {
	__wasmIdleDebug?: {
		getExecutionState(): Execution;
		getEditorValue(): string;
		setEditorValue(source: string): Promise<boolean>;
	};
};
type SavedWorkspace = {
	files: WorkspaceFile[];
	workspaces: Record<string, { files: WorkspaceFile[] }>;
};

function source(revision: number) {
	return `#include <fstream>
#include <iostream>
int main() {
    const char bytes[] = {0, static_cast<char>(255), 'A'};
    std::ofstream("generated.bin", std::ios::binary).write(bytes, sizeof(bytes));
    std::cout << "cpp_workspace_${revision}\\n";
    return 0;
}
`;
}

async function run(page: Page, expectedOutput: string) {
	const previous = await page.evaluate(
		() => (globalThis as SiteWindow).__wasmIdleDebug!.getExecutionState().id
	);
	await page.locator('button.action-button--run').click();
	await page.waitForFunction(
		(previousId) => {
			const state = (globalThis as SiteWindow).__wasmIdleDebug!.getExecutionState();
			return state.id > previousId && state.endedAt !== null;
		},
		previous,
		{ timeout: runTimeout }
	);
	expect(
		await page.evaluate(() => (globalThis as SiteWindow).__wasmIdleDebug!.getExecutionState())
	).toMatchObject({ status: 'completed', exitCode: 0 });
	expect(await page.locator('[data-testid="terminal-debug-output"]').textContent()).toContain(
		expectedOutput
	);
	await page.locator('[data-container-path="CPP/generated.bin"]').waitFor();
}

async function saveAndCheckFiles(page: Page, expectedSource: string) {
	// Shared-container metadata can arrive before the editor has reconciled guest
	// writes. Wait for the autosaved editor snapshot, not just the sidebar row.
	await page.waitForFunction(
		({ key, source }) => {
			const saved = JSON.parse(localStorage.getItem(key) || 'null') as SavedWorkspace | null;
			return (
				saved?.files.some((file) => file.path === 'generated.bin') &&
				saved.files.some((file) => file.path === 'main.cpp' && file.content === source)
			);
		},
		{ key: storageKey, source: expectedSource },
		{ timeout: 30_000 }
	);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await page.locator('[data-workspace-save-state="saved"]').waitFor();
	const saved = await page.evaluate(
		(key) => JSON.parse(localStorage.getItem(key)!) as SavedWorkspace,
		storageKey
	);
	for (const files of [saved.files, saved.workspaces.CPP.files]) {
		// program.wasm belongs to the user. Compiler output must neither replace it
		// nor add another generated binary to the editable project or its snapshot.
		expect(files.map((file) => file.path).sort()).toEqual([
			'generated.bin',
			'main.cpp',
			'program.wasm'
		]);
		expect(files.find((file) => file.path === 'main.cpp')?.content).toBe(expectedSource);
		expect(files.find((file) => file.path === 'program.wasm')).toMatchObject({
			content: ownedWasm,
			encoding: 'data-url'
		});
		const generated = files.find((file) => file.path === 'generated.bin')!;
		expect(generated.encoding).toBe('data-url');
		expect(Buffer.from(generated.content.split(',')[1], 'base64')).toEqual(
			Buffer.from([0, 255, 65])
		);
	}
	expect(
		(await page.getByRole('alert').allTextContents()).map((text) => text.trim()).filter(Boolean)
	).toEqual([]);
}

it(
	'keeps C++ compiler output outside saved files while edits and user binaries survive repeated runs',
	{
		skip: !enabled,
		timeout: runTimeout * 3 + 90_000,
		meta: { browser: true, requiredBrowser: enabled }
	},
	async () => {
		await runWithBrowserProbeSessionLock(async () => {
			const provided = process.env.WASM_IDLE_BROWSER_URL;
			const server =
				provided && shouldReuseProvidedBrowserUrl(provided)
					? { browserUrl: provided, close: async () => {} }
					: await startBrowserPreviewServer({
							origin: 'http://127.0.0.1:4679',
							serverMode: 'preview'
						});
			let browser: Browser | undefined;
			let context: BrowserContext | undefined;
			let page: Page | undefined;
			const pageErrors: string[] = [];
			try {
				browser = await chromium.launch({
					headless: true,
					executablePath: await resolveChromiumExecutable(
						process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
					)
				});
				context = await browser.newContext({
					serviceWorkers: 'allow',
					viewport: { width: 1440, height: 1050 }
				});
				await addBrowserTestCookies(context, server.browserUrl);
				await disableBrowserPrewarm(context);
				const initialSource = source(1);
				await context.addInitScript(
					({ key, source, binary }) => {
						if (localStorage.getItem(key) !== null) return;
						localStorage.setItem(
							key,
							JSON.stringify({
								version: 6,
								language: 'CPP',
								activePath: 'main.cpp',
								files: [
									{ path: 'main.cpp', content: source },
									{ path: 'program.wasm', content: binary, encoding: 'data-url' }
								],
								lspEnabled: false
							})
						);
					},
					{ key: storageKey, source: initialSource, binary: ownedWasm }
				);
				page = await context.newPage();
				page.setDefaultTimeout(30_000);
				page.on('pageerror', (error) => pageErrors.push(error.message));
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await page.waitForFunction(isStdinEditorReady, 'CPP', { timeout: 90_000 });
				expect(
					await page.evaluate(() =>
						(globalThis as SiteWindow).__wasmIdleDebug!.getEditorValue()
					)
				).toBe(initialSource);
				await run(page, 'cpp_workspace_1');
				await saveAndCheckFiles(page, initialSource);

				const revisedSource = source(2);
				expect(
					await page.evaluate(
						(text) => (globalThis as SiteWindow).__wasmIdleDebug!.setEditorValue(text),
						revisedSource
					)
				).toBe(true);
				// Run immediately while the edited source is still queued for publication.
				await run(page, 'cpp_workspace_2');
				await saveAndCheckFiles(page, revisedSource);
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.waitForFunction(isStdinEditorReady, 'CPP', { timeout: 90_000 });
				expect(
					await page.evaluate(() =>
						(globalThis as SiteWindow).__wasmIdleDebug!.getEditorValue()
					)
				).toBe(revisedSource);
				await run(page, 'cpp_workspace_2');
				await saveAndCheckFiles(page, revisedSource);
				expect(pageErrors).toEqual([]);
			} catch (error) {
				const state = await page
					?.evaluate(() => ({
						execution: (globalThis as SiteWindow).__wasmIdleDebug?.getExecutionState(),
						saveState: document
							.querySelector('[data-workspace-save-state]')
							?.getAttribute('data-workspace-save-state'),
						alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(
							(node) => node.textContent
						),
						terminal: document
							.querySelector('[data-testid="terminal-debug-output"]')
							?.textContent?.slice(-2500)
					}))
					.catch(() => null);
				throw new Error(
					`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({ state, pageErrors })}`,
					{ cause: error }
				);
			} finally {
				await context?.close();
				await browser?.close();
				await server.close();
			}
		});
	}
);

it(
	'preserves project files across shell writes, switches, saves, and older explorer conflicts',
	{
		skip: !enabled,
		timeout: 180_000,
		meta: { browser: true, requiredBrowser: enabled }
	},
	async () => {
		await runWithBrowserProbeSessionLock(async () => {
			const provided = process.env.WASM_IDLE_BROWSER_URL;
			const server =
				provided && shouldReuseProvidedBrowserUrl(provided)
					? { browserUrl: provided, close: async () => {} }
					: await startBrowserPreviewServer({
							origin: 'http://127.0.0.1:4679',
							serverMode: 'preview'
						});
			let browser: Browser | undefined;
			try {
				browser = await chromium.launch({
					executablePath: await resolveChromiumExecutable(
						process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
					)
				});
				const context = await browser.newContext({
					serviceWorkers: 'allow',
					viewport: { width: 1440, height: 1000 }
				});
				await addBrowserTestCookies(context, server.browserUrl);
				await disableBrowserPrewarm(context);
				const legacyFiles = [
					{ path: 'main.cpp', content: 'int main(){return 0;}' },
					{ path: 'include/numbers.h', content: '#define NUMBER 3' },
					{ path: 'include', content: 'user bytes' },
					{ path: 'include-2', content: 'existing sibling' }
				];
				await context.addInitScript(
					({ key, files }) => {
						if (!localStorage.getItem(key))
							localStorage.setItem(
								key,
								JSON.stringify({
									version: 6,
									language: 'CPP',
									files,
									activePath: 'include',
									openTabs: ['main.cpp', 'include'],
									lspEnabled: false,
									sidebarOpen: true
								})
							);
					},
					{ key: storageKey, files: legacyFiles }
				);
				const page = await context.newPage();
				const errors: string[] = [];
				page.on('pageerror', (error) => errors.push(error.message));
				page.setDefaultTimeout(20_000);
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await expect
					.poll(() =>
						page.evaluate(() =>
							(globalThis as SiteWindow).__wasmIdleDebug?.getEditorValue()
						)
					)
					.toBe('user bytes');
				expect(await page.locator('.file-tab.active').getAttribute('title')).toBe(
					'include-3'
				);
				expect(await page.locator('.file-tab[title="main.cpp"]').count()).toBe(1);
				for (const [action, path, source] of [
					['New file', 'include'],
					['New file', 'include-2/child'],
					['Rename', 'include'],
					['Rename', 'include-3/child'],
					['Rename', 'include', 'include/numbers.h']
				]) {
					if (source)
						await page.locator(`.workspace-files button[title="${source}"]`).click();
					const oldFiles = await page
						.locator('.workspace-files button')
						.allTextContents();
					page.once('dialog', (dialog) => void dialog.accept(path));
					await page.getByRole('button', { name: action, exact: true }).click();
					await expect
						.poll(() => page.locator('.statusbar__message').textContent())
						.toMatch(/is a (file|directory)/);
					expect(await page.locator('.workspace-files button').allTextContents()).toEqual(
						oldFiles
					);
				}
				async function choose(language: string) {
					await page.locator('.language-trigger').click();
					await page.locator('#language-option-' + language).click();
				}
				async function shell(command: string) {
					await page.locator('.terminal-shell .xterm-helper-textarea').focus();
					await page.keyboard.type(command);
					await page.keyboard.press('Enter');
				}
				const remote = () =>
					page.evaluate(async () => {
						const binding = (
							globalThis as SiteWindow & {
								__wasmIdleContainer: {
									readWorkspace(
										language: string
									): Promise<Array<{ path: string; content: Uint8Array }>>;
								};
							}
						).__wasmIdleContainer;
						return Object.fromEntries(
							(await binding.readWorkspace('PYTHON')).map((f) => [
								f.path,
								new TextDecoder().decode(f.content)
							])
						);
					});
				const saved = () =>
					page.evaluate((key) => {
						const snapshot = JSON.parse(localStorage.getItem(key)!) as SavedWorkspace;
						return Object.fromEntries(
							snapshot.workspaces.PYTHON.files.map((f) => [f.path, f.content])
						);
					}, storageKey);
				await page.waitForFunction(
					() =>
						document
							.querySelector('.terminal-shell .xterm-rows')
							?.textContent?.replaceAll('\u00a0', ' ')
							.includes('~/CPP $'),
					undefined,
					{ timeout: 60_000 }
				);
				await shell(
					"mkdir -p ../PYTHON; echo 'print(7)' > ../PYTHON/main.py; echo first > ../PYTHON/scratch.py"
				);
				const initialPython = { 'main.py': 'print(7)\n', 'scratch.py': 'first\n' };
				await expect.poll(remote, { timeout: 20_000 }).toEqual(initialPython);
				await choose('PYTHON');
				await expect
					.poll(() =>
						page.evaluate(() =>
							(globalThis as SiteWindow).__wasmIdleDebug?.getEditorValue()
						)
					)
					.toBe(initialPython['main.py']);
				expect(await remote()).toEqual(initialPython);
				await choose('CPP');
				await shell(
					"echo 'print(9)' > /workspace/PYTHON/main.py; rm /workspace/PYTHON/scratch.py; echo next > /workspace/PYTHON/new.py"
				);
				const updatedPython = { 'main.py': 'print(9)\n', 'new.py': 'next\n' };
				await expect.poll(remote, { timeout: 20_000 }).toEqual(updatedPython);
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await expect.poll(saved).toEqual(updatedPython);
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await expect.poll(remote, { timeout: 30_000 }).toEqual(updatedPython);
				await choose('PYTHON');
				await expect
					.poll(() =>
						page.evaluate(() =>
							(globalThis as SiteWindow).__wasmIdleDebug?.getEditorValue()
						)
					)
					.toBe(updatedPython['main.py']);
				await choose('CPP');
				await shell('rm /workspace/PYTHON/main.py /workspace/PYTHON/new.py');
				await expect.poll(remote, { timeout: 20_000 }).toEqual({});
				await page.getByRole('button', { name: 'Save', exact: true }).click();
				await expect.poll(saved).toEqual({});
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.locator('#language-select[data-workspace-ready="true"]').waitFor();
				await choose('PYTHON');
				await expect.poll(() => page.locator('.workspace-files button').count()).toBe(0);
				expect(await saved()).toEqual({});
				expect(errors).toEqual([]);
			} finally {
				await browser?.close();
				await server.close();
			}
		});
	}
);
