// @vitest-environment node
import { chromium, type Browser, type Page } from 'playwright-core';
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
		readWorkspace(language: string): Promise<{ path: string; content: string | Uint8Array }[]>;
		inspect(): Promise<{
			shell?: {
				running: boolean;
				control?: {
					cwd: string;
					pendingCwd: string | null;
					resizeGeneration?: number;
					appliedResizeGeneration?: number;
				};
			};
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
				await page.locator('.terminal-shell .xterm-helper-textarea').focus();
				await page.keyboard.type('echo first; echo second >&2');
				await page.keyboard.press('Enter');
				// A raw transcript also contains Readline's cursor movements. Check the
				// rows users see, including the prompt on which the next command was typed.
				const visibleRows = async () =>
					(await page.locator('.terminal-shell .xterm-rows > div').allTextContents())
						.map((row) => row.replaceAll('\u00a0', ' ').trimEnd())
						.filter(Boolean);
				await expect
					.poll(async () => (await visibleRows()).slice(-5))
					.toEqual([
						'SIDEBAR-READY',
						'~/PYTHON $ echo first; echo second >&2',
						'first',
						'second',
						'~/PYTHON $'
					]);
				const longWord = '0123456789'.repeat(9);
				await page.keyboard.type(`echo ${longWord}x`);
				await page.keyboard.press('Backspace');
				await expect
					.poll(async () =>
						(await visibleRows()).join('').endsWith(`~/PYTHON $ echo ${longWord}`)
					)
					.toBe(true);
				await page.keyboard.press('Enter');
				await expect
					.poll(async () => (await visibleRows()).join(''))
					.toContain(`~/PYTHON $ echo ${longWord}${longWord}~/PYTHON $`);
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
				await page.locator('.terminal-shell .xterm-helper-textarea').focus();
				const pending = 'echo EOF-$((4 + 2))';
				await page.keyboard.type(pending);
				await expect
					.poll(async () => (await visibleRows()).at(-1))
					.toBe(`~/BASH $ ${pending}`);
				await page.keyboard.press('Control+d');
				await expect
					.poll(visibleRows)
					.toContain('Shell exited; reload to open a new shell.');
				expect(await visibleRows()).not.toContain('EOF-6');
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

const shellViewport = (columns: number) => ({
	width: columns === 53 ? 1560 : 2700,
	height: 1100
});
const readShellScreen = (page: Page) =>
	page.evaluate(() => {
		const terminal = document.querySelector('.terminal-shell .xterm-screen');
		const measure = document.querySelector('.terminal-shell .xterm-char-measure-element');
		const cellWidth =
			(measure?.getBoundingClientRect().width ?? 0) / (measure?.textContent?.length || 1);
		const nodes = Array.from(document.querySelectorAll('.terminal-shell .xterm-rows > div'));
		const rows = nodes.map((node) =>
			(node.textContent ?? '').replaceAll('\u00a0', ' ').trimEnd()
		);
		const cursor = document.querySelector('.terminal-shell .xterm-cursor');
		const cursorRow = nodes.findIndex((node) => cursor && node.contains(cursor));
		let cursorOffset: number | null = null;
		if (cursor && cursorRow >= 0) {
			const beforeCursor = document.createRange();
			beforeCursor.selectNodeContents(nodes[cursorRow]);
			beforeCursor.setEndBefore(cursor);
			cursorOffset =
				rows.slice(0, cursorRow).join('').length + beforeCursor.toString().length;
		}
		return {
			columns:
				terminal && cellWidth > 0
					? Math.round(terminal.getBoundingClientRect().width / cellWidth)
					: null,
			rows,
			text: rows.join(''),
			cursorOffset
		};
	});

async function withShellBrowser(action: (browser: Browser, browserUrl: string) => Promise<void>) {
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
		try {
			browser = await chromium.launch({
				executablePath: await resolveChromiumExecutable(
					process.env.WASM_IDLE_CHROMIUM_EXECUTABLE
				),
				headless: true,
				args: ['--no-sandbox']
			});
			await action(browser, server.browserUrl);
		} finally {
			await browser?.close();
			await server.close();
		}
	});
}

async function openShellPage(
	browser: Browser,
	browserUrl: string,
	columns: number,
	pageErrors: string[]
) {
	const context = await browser.newContext({
		serviceWorkers: 'allow',
		viewport: shellViewport(columns)
	});
	await addBrowserTestCookies(context, browserUrl);
	await disableBrowserPrewarm(context);
	await context.addInitScript(() => {
		localStorage.setItem(
			'wasm-idle:example-workspace:v3',
			JSON.stringify({
				version: 6,
				language: 'BASH',
				activePath: 'main.sh',
				files: [{ path: 'main.sh', content: 'echo unused\n' }],
				lspEnabled: false
			})
		);
	});
	const page = await context.newPage();
	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.setDefaultTimeout(30_000);
	const url = new URL(browserUrl);
	url.searchParams.set('lsp-test', '1');
	await page.goto(url.href, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(
		async () =>
			crossOriginIsolated &&
			(await (globalThis as SiteWindow).__wasmIdleContainer?.inspect())?.shell?.running ===
				true,
		undefined,
		{ timeout: 90_000 }
	);
	await expect
		.poll(async () => (await readShellScreen(page)).columns, { timeout: 30_000 })
		.toBe(columns);
	await expect
		.poll(async () => (await readShellScreen(page)).text, { timeout: 30_000 })
		.toBe('~/BASH $');
	await page.locator('.terminal-shell .xterm-helper-textarea').focus();
	return { context, page };
}

async function expectResizeSettled(page: Page) {
	// Check acknowledgement after execution so typing immediately after a viewport
	// change continues to exercise the input/resize race.
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const control = (
						await (globalThis as SiteWindow).__wasmIdleContainer!.inspect()
					).shell?.control;
					return {
						applied: (control?.appliedResizeGeneration ?? 0) > 0,
						settled: control?.resizeGeneration === control?.appliedResizeGeneration
					};
				}),
			{ timeout: 30_000 }
		)
		.toEqual({ applied: true, settled: true });
}

it.each([53, 106])(
	'keeps long shell input and its cursor intact while editing and resizing from %i columns',
	{ skip: !enabled, timeout: 240_000, meta: { browser: true, requiredBrowser: enabled } },
	async (initialColumns) => {
		await withShellBrowser(async (browser, browserUrl) => {
			const pageErrors: string[] = [];
			for (const scenario of ['editing', 'resizing'] as const) {
				const { context, page } = await openShellPage(
					browser,
					browserUrl,
					initialColumns,
					pageErrors
				);
				try {
					// Keep the end away from an exact cell boundary: xterm may legitimately
					// leave an end cursor in its last column while autowrap is pending.
					const payload = '0123456789abcdefghijklmnopqrstuvwxyz'.repeat(4).slice(0, 109);
					const model = {
						text: `printf 'EDITED=<%s>\\n' 'FIRST_${payload}_WRONG_LAST'`,
						cursor: 0
					};
					const prompt = '~/BASH $ ';
					expect(model.text.length).toBe(151);
					const assertInput = async (step: string, columns = initialColumns) => {
						await expect
							.poll(
								async () => {
									const state = await readShellScreen(page);
									return {
										columns: state.columns,
										text: state.text,
										cursorOffset: state.cursorOffset
									};
								},
								{
									timeout: 10_000,
									message: `${scenario}, ${initialColumns} columns: ${step}`
								}
							)
							.toEqual({
								columns,
								text: prompt + model.text,
								cursorOffset: prompt.length + model.cursor
							});
					};
					const moveLeft = async (count: number) => {
						for (let index = 0; index < count; index++)
							await page.keyboard.press('ArrowLeft');
						model.cursor -= count;
					};
					const insert = async (text: string) => {
						await page.keyboard.type(text, { delay: 5 });
						model.text =
							model.text.slice(0, model.cursor) +
							text +
							model.text.slice(model.cursor);
						model.cursor += text.length;
					};
					const moveToEnd = async () => {
						await page.keyboard.press('Control+e');
						model.cursor = model.text.length;
					};
					await page.keyboard.type(model.text, { delay: 5 });
					model.cursor = model.text.length;
					await assertInput('151-character input');
					if (scenario === 'editing') {
						await page.keyboard.press('Control+a');
						model.cursor = 0;
						await assertInput('Ctrl+A');
						await insert(':; ');
						await assertInput('insert at beginning');
						await moveToEnd();
						await assertInput('Ctrl+E');
						await moveLeft(1);
						await insert('_TAIL');
						await moveToEnd();
						await assertInput('insert at end');
						// Cross both the old 80-column Readline boundary and the actual
						// 53-column boundary, then edit the argument in the middle.
						for (const [before, after, replacement] of [
							[74, 68, 'MID'],
							[47, 41, 'CUT']
						] as const) {
							await moveLeft(model.cursor - before);
							await assertInput(`before boundary at ${before}`);
							await moveLeft(before - after);
							await assertInput(`cross boundary to ${after}`);
							for (let index = 0; index < 3; index++)
								await page.keyboard.press('Backspace');
							model.text =
								model.text.slice(0, model.cursor - 3) +
								model.text.slice(model.cursor);
							model.cursor -= 3;
							await insert(replacement);
							await assertInput(`delete and replace at ${after}`);
						}
					} else {
						await moveLeft(model.cursor - 68);
						await assertInput('cursor inside unsubmitted input');
						const otherColumns = initialColumns === 53 ? 106 : 53;
						await page.setViewportSize(shellViewport(otherColumns));
						await assertInput('resize with pending input', otherColumns);
						await insert('AWAY');
						await assertInput('insert after resize', otherColumns);
						await page.setViewportSize(shellViewport(initialColumns));
						await assertInput('resize back with pending input');
						await insert('BACK');
						await assertInput('insert after resizing back');
					}
					await moveToEnd();
					await assertInput('final input');
					const argument = model.text.match(/'([^']*)'$/u)![1];
					await page.keyboard.press('Enter');
					await expect
						.poll(async () => (await readShellScreen(page)).text, { timeout: 30_000 })
						.toBe(`${prompt}${model.text}EDITED=<${argument}>${prompt.trimEnd()}`);
					if (scenario === 'resizing') await expectResizeSettled(page);
				} catch (error) {
					throw new Error(
						`${String(error)}\nShell geometry failure: ${JSON.stringify({
							scenario,
							initialColumns,
							pageErrors,
							screen: await readShellScreen(page).catch(() => null)
						})}`,
						{ cause: error }
					);
				} finally {
					await context.close();
				}
			}
			expect(pageErrors).toEqual([]);
		});
	}
);

it(
	'preserves shell history and foreground cat input while resizing in both directions',
	{ skip: !enabled, timeout: 180_000, meta: { browser: true, requiredBrowser: enabled } },
	async () => {
		await withShellBrowser(async (browser, browserUrl) => {
			const pageErrors: string[] = [];
			const { context, page } = await openShellPage(browser, browserUrl, 53, pageErrors);
			try {
				await page.keyboard.type("printf 'HISTORY-%s\\n' one two three");
				await page.keyboard.press('Enter');
				const history = ['HISTORY-one', 'HISTORY-two', 'HISTORY-three'];
				await expect
					.poll(
						async () =>
							(await readShellScreen(page)).rows.filter((row) =>
								row.startsWith('HISTORY-')
							),
						{ timeout: 30_000 }
					)
					.toEqual(history);
				// Stored bytes distinguish actual stdin from terminal echo. The second
				// cat prints those bytes after EOF, while the earlier output remains.
				const command = 'cat > resize.txt; cat resize.txt';
				await page.keyboard.type(command);
				await page.keyboard.press('Enter');
				const received: string[] = [];
				const assertHistory = async (columns: number) => {
					await expect
						.poll(
							async () => {
								const state = await readShellScreen(page);
								const rows = state.rows.filter(Boolean);
								return {
									columns: state.columns,
									history: rows.filter((row) => row.startsWith('HISTORY-')),
									foreground: rows.includes(`~/BASH $ ${command}`)
								};
							},
							{ timeout: 30_000 }
						)
						.toEqual({ columns, history, foreground: true });
				};
				for (const [columns, line] of [
					[53, 'CAT-before'],
					[106, 'CAT-wide'],
					[53, 'CAT-narrow']
				] as const) {
					if (received.length) await page.setViewportSize(shellViewport(columns));
					await page.keyboard.type(line);
					await page.keyboard.press('Enter');
					received.push(line);
					await assertHistory(columns);
				}
				await page.keyboard.press('Control+d');
				await expect
					.poll(async () => (await readShellScreen(page)).rows, { timeout: 30_000 })
					.toContain('Shell exited; reload to open a new shell.');
				const inputBytes = await page.evaluate(async () => {
					const files = await (
						globalThis as SiteWindow
					).__wasmIdleContainer!.readWorkspace('BASH');
					const content = files.find((file) => file.path === 'resize.txt')?.content;
					if (content === undefined) return null;
					return Array.from(
						typeof content === 'string' ? new TextEncoder().encode(content) : content
					);
				});
				expect(inputBytes).toEqual(
					Array.from(new TextEncoder().encode(`${received.join('\n')}\n`))
				);
				const rows = (await readShellScreen(page)).rows.filter(Boolean);
				expect(rows.filter((row) => row.startsWith('HISTORY-'))).toEqual(history);
				for (const line of received) expect(rows).toContain(line);
				expect(rows.filter((row) => row.startsWith('Shell:'))).toEqual([]);
				expect(pageErrors).toEqual([]);
			} catch (error) {
				throw new Error(
					`${String(error)}\nForeground resize failure: ${JSON.stringify({
						pageErrors,
						screen: await readShellScreen(page).catch(() => null)
					})}`,
					{ cause: error }
				);
			} finally {
				await context.close();
			}
		});
	}
);
