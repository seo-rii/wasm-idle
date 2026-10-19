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
	__sidebarInitialEditor?: { language: string; source: string };
	__wasmIdleContainer?: {
		inspect(): Promise<{
			shell?: { running: boolean; control?: { cwd: string; pendingCwd: string | null } };
		}>;
	};
	__wasmIdleDebug?: {
		writeTerminalInput(text: string, eof: boolean): Promise<void>;
		getEditorValue(): string;
	};
};

it(
	'navigates shared folders and writes relative files in the selected language project automatically',
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
			const errors: string[] = [];
			const diagnostics = {
				consoleErrors: [] as string[],
				failedRequests: [] as { path: string; failure: string | null }[],
				httpErrors: [] as { path: string; status: number }[],
				workers: [] as { path: string; event: string }[]
			};
			let capturePageState: () => Promise<unknown> = async () => null;
			try {
				browser = await chromium.launch({
					executablePath: await resolveChromiumExecutable(
						process.env.WASM_IDLE_CHROMIUM_EXECUTABLE
					),
					headless: true,
					args: ['--no-sandbox']
				});
				const context = await browser.newContext({
					serviceWorkers: 'allow',
					viewport: { width: 1600, height: 1050 }
				});
				await addBrowserTestCookies(context, server.browserUrl);
				await disableBrowserPrewarm(context);
				const page = await context.newPage();
				page.setDefaultTimeout(30_000);
				page.on('pageerror', (error) => errors.push(error.message));
				page.on('console', (message) => {
					if (message.type() === 'error')
						diagnostics.consoleErrors.push(message.text().slice(0, 1500));
				});
				page.on('requestfailed', (request) =>
					diagnostics.failedRequests.push({
						path: new URL(request.url()).pathname,
						failure: request.failure()?.errorText ?? null
					})
				);
				page.on('response', (response) => {
					if (response.status() >= 400)
						diagnostics.httpErrors.push({
							path: new URL(response.url()).pathname,
							status: response.status()
						});
				});
				page.on('worker', (worker) => {
					const path = new URL(worker.url()).pathname;
					diagnostics.workers.push({ path, event: 'created' });
					worker.on('close', () => diagnostics.workers.push({ path, event: 'closed' }));
				});
				capturePageState = () =>
					page.evaluate(() => ({
						language:
							document.querySelector<HTMLSelectElement>('#language-select')?.value,
						isolated: crossOriginIsolated,
						serviceWorker: navigator.serviceWorker.controller?.scriptURL ?? null,
						terminal: document
							.querySelector('[data-testid="terminal-debug-output"]')
							?.textContent?.slice(-5000),
						status: document.querySelector('.statusbar__message')?.textContent
					}));
				await page.addInitScript(() => {
					const observer = setInterval(() => {
						const target = globalThis as SiteWindow;
						const select =
							document.querySelector<HTMLSelectElement>('#language-select');
						const source = target.__wasmIdleDebug?.getEditorValue();
						if (!select || !source || !document.querySelector('.monaco-editor')) return;
						target.__sidebarInitialEditor = { language: select.value, source };
						clearInterval(observer);
					}, 5);
				});
				const initialSource = 'print("initial-language-sidebar")\n';
				const url = new URL(server.browserUrl);
				url.searchParams.set('lsp-test', '1');
				url.searchParams.set('lang', 'PYTHON');
				url.searchParams.set('code', initialSource);
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
				expect(initial).toBe('PYTHON');
				await page.waitForFunction(
					() => !!(globalThis as SiteWindow).__sidebarInitialEditor
				);
				expect(
					await page.evaluate(() => (globalThis as SiteWindow).__sidebarInitialEditor)
				).toEqual({ language: 'PYTHON', source: initialSource });
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
				await expect
					.poll(
						() =>
							page.evaluate(async () => {
								const { shell } = await (
									globalThis as SiteWindow
								).__wasmIdleContainer!.inspect();
								return (
									shell?.control?.cwd === '/workspace/PYTHON' &&
									!shell.control.pendingCwd
								);
							}),
						{ timeout: 30_000 }
					)
					.toBe(true);
				await page.locator('#language-select').selectOption('BASH');
				await expect
					.poll(
						() =>
							page.evaluate(async () => {
								const { shell } = await (
									globalThis as SiteWindow
								).__wasmIdleContainer!.inspect();
								return (
									shell?.control?.cwd === '/workspace/BASH' &&
									!shell.control.pendingCwd
								);
							}),
						{ timeout: 30_000 }
					)
					.toBe(true);
				await page.locator('[data-workspace-save-state="saved"]').waitFor();
				await page.locator('.terminal-shell .xterm-helper-textarea').focus();
				await page.keyboard.type('echo 1 >> hi.txt');
				await page.keyboard.press('Enter');
				const file = page.locator('[data-container-path="BASH/hi.txt"]');
				await file.waitFor();
				expect(await page.locator('#language-select').inputValue()).toBe('BASH');
				await file.click();
				await page.waitForFunction(
					() => (globalThis as SiteWindow).__wasmIdleDebug!.getEditorValue() === '1\n'
				);
				expect(await page.locator('#language-select').inputValue()).toBe('BASH');
				await page.locator('.terminal-shell .xterm-helper-textarea').focus();
				await page.keyboard.type('echo 2 >> hi.txt');
				await page.keyboard.press('Enter');
				await page.waitForFunction(
					() => (globalThis as SiteWindow).__wasmIdleDebug!.getEditorValue() === '1\n2\n'
				);
				await page.evaluate(async () => {
					await (globalThis as SiteWindow).__wasmIdleDebug!.writeTerminalInput(
						'mkdir -p nested/deeper\necho leaf > nested/deeper/leaf.txt\n',
						false
					);
				});
				await page
					.getByRole('button', { name: 'Expand /workspace/BASH/nested', exact: true })
					.click();
				await page.locator('[data-container-directory="BASH/nested/deeper"]').waitFor();
				await page
					.getByRole('button', { name: 'Collapse /workspace/BASH/nested', exact: true })
					.click();
				expect(
					await page.locator('[data-container-directory="BASH/nested/deeper"]').count()
				).toBe(0);
				await page.locator('[data-container-directory="BASH/nested"]').click();
				await expect
					.poll(
						() =>
							page.evaluate(async () => {
								const { shell } = await (
									globalThis as SiteWindow
								).__wasmIdleContainer!.inspect();
								return (
									shell?.control?.cwd === '/workspace/BASH' &&
									!shell.control.pendingCwd
								);
							}),
						{ timeout: 30_000 }
					)
					.toBe(true);
				await page.locator('.terminal-shell .xterm-helper-textarea').focus();
				await page.keyboard.type('echo folder-relative > nested/here.txt');
				await page.keyboard.press('Enter');
				const nested = page.locator('[data-container-path="BASH/nested/here.txt"]');
				await nested.waitFor();
				await nested.click();
				await page.waitForFunction(
					() =>
						(globalThis as SiteWindow).__wasmIdleDebug!.getEditorValue() ===
						'folder-relative\n'
				);
				await page
					.getByRole('button', { name: 'Go to parent folder', exact: true })
					.click();
				await expect
					.poll(
						() =>
							page.evaluate(async () => {
								const { shell } = await (
									globalThis as SiteWindow
								).__wasmIdleContainer!.inspect();
								return (
									shell?.control?.cwd === '/workspace/BASH' &&
									!shell.control.pendingCwd
								);
							}),
						{ timeout: 30_000 }
					)
					.toBe(true);
				await file.waitFor();
				expect(errors).toEqual([]);
			} catch (error) {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const state = await Promise.race([
					capturePageState().catch((failure) => ({ failure: String(failure) })),
					new Promise((resolve) => {
						timer = setTimeout(() => resolve({ timedOut: true }), 3000);
					})
				]);
				clearTimeout(timer);
				throw new Error(
					`${String(error)}\nContainer sidebar failure context: ${JSON.stringify({
						pageErrors: errors.slice(-20),
						consoleErrors: diagnostics.consoleErrors.slice(-20),
						failedRequests: diagnostics.failedRequests.slice(-20),
						httpErrors: diagnostics.httpErrors.slice(-20),
						workers: diagnostics.workers.slice(-20),
						state
					})}`,
					{ cause: error }
				);
			} finally {
				await browser?.close();
				await server.close();
			}
		});
	}
);
