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
