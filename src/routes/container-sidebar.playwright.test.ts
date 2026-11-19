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
		setEditorValue(source: string): Promise<boolean>;
		getExecutionState(): { id: number; status: string; exitCode: number | null };
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

it(
	'explains a refused Run and leaves the foreground shell usable for a retry',
	{ skip: !enabled, timeout: 180_000, meta: { browser: true, requiredBrowser: enabled } },
	async () => {
		await withShellBrowser(async (browser, url) => {
			const errors: string[] = [];
			const { context, page } = await openShellPage(browser, url, 53, errors);
			try {
				await page
					.locator('#language-select[data-workspace-ready="true"]')
					.selectOption('CPP');
				const rows = async () => (await readShellScreen(page)).rows;
				await expect.poll(rows, { timeout: 30_000 }).toContain('~/CPP $');
				expect(
					await page.evaluate(() =>
						(globalThis as SiteWindow).__wasmIdleDebug!.setEditorValue(
							'extern "C" int puts(const char*); int main() { puts("retry-ok"); }'
						)
					)
				).toBe(true);
				const input = page.locator('.terminal-shell .xterm-helper-textarea');
				await input.focus();
				await page.keyboard.type('echo waiting; IFS= read -r reply; echo received-$reply');
				await page.keyboard.press('Enter');
				await expect.poll(rows, { timeout: 10_000 }).toContain('waiting');

				const run = page.getByRole('button', { name: 'Run', exact: true });
				const state = () =>
					page.evaluate(() =>
						(globalThis as SiteWindow).__wasmIdleDebug!.getExecutionState()
					);
				await run.click();
				await expect
					.poll(async () => (await state()).status, { timeout: 30_000 })
					.toBe('failed');
				const refused = await state();
				const notice = page.getByRole('alert').filter({
					hasText: 'Finish the current shell command before running a program.'
				});
				await notice.waitFor({ state: 'visible', timeout: 5000 });
				expect(errors).toEqual([]);

				await input.focus();
				await page.keyboard.type('kept');
				await page.keyboard.press('Enter');
				await expect.poll(rows, { timeout: 10_000 }).toContain('received-kept');
				await run.click();
				await notice.waitFor({ state: 'detached' });
				await expect.poll(state, { timeout: 90_000 }).toMatchObject({
					status: 'completed',
					exitCode: 0
				});
				expect((await state()).id).toBeGreaterThan(refused.id);
				await expect.poll(rows, { timeout: 10_000 }).toContain('retry-ok');
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
);

it(
	'preserves UTF-8 bytes when deleting and inserting at the Bash cursor',
	{ skip: !enabled, timeout: 120_000, meta: { browser: true, requiredBrowser: enabled } },
	async () => {
		await withShellBrowser(async (browser, url) => {
			const errors: string[] = [];
			const { context, page } = await openShellPage(browser, url, 53, errors);
			try {
				for (const [path, initial, inserted, expected] of [
					['ascii.txt', 'abZ', 'N', 'aNZ'],
					['hangul.txt', '한글Z', '나', '한나Z'],
					['accent.txt', 'aéZ', 'N', 'aNZ'],
					['emoji.txt', 'a😀Z', 'N', 'aNZ']
				]) {
					await page.keyboard.type(`printf %s > ${path} `);
					await page.keyboard.insertText(initial);
					await page.keyboard.press('ArrowLeft');
					await page.keyboard.press('Backspace');
					await page.keyboard.insertText(inserted);
					await page.keyboard.press('Enter');
					await expect
						.poll(
							() =>
								page.evaluate(async (path) => {
									const files = await (
										globalThis as SiteWindow
									).__wasmIdleContainer!.readWorkspace('BASH');
									const bytes = files.find((file) => file.path === path)?.content;
									return bytes === undefined
										? null
										: Array.from(
												typeof bytes === 'string'
													? new TextEncoder().encode(bytes)
													: bytes
											);
								}, path),
							{ timeout: 10_000 }
						)
						.toEqual(Array.from(new TextEncoder().encode(expected)));
				}
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
);

async function expectResizeSettled(page: Page, minimumGeneration = 1) {
	// Check acknowledgement after execution so typing immediately after a viewport
	// change continues to exercise the input/resize race.
	await expect
		.poll(
			() =>
				page.evaluate(async (minimum) => {
					const control = (
						await (globalThis as SiteWindow).__wasmIdleContainer!.inspect()
					).shell?.control;
					return {
						applied: (control?.appliedResizeGeneration ?? 0) >= minimum,
						settled: control?.resizeGeneration === control?.appliedResizeGeneration
					};
				}, minimumGeneration),
			{ timeout: 30_000 }
		)
		.toEqual({ applied: true, settled: true });
}

it.each([
	['read -e', false, false],
	['read -e', true, false],
	['read -e', true, true],
	['continuation', false, false],
	['continuation', true, false],
	['continuation', true, true]
] as const)(
	'redraws one editable %s line across resize (queued cursor input = %s, Ctrl+L = %s)',
	{ skip: !enabled, timeout: 150_000, meta: { browser: true, requiredBrowser: enabled } },
	async (mode, queued, clearScreen) => {
		await withShellBrowser(async (browser, url) => {
			const errors: string[] = [];
			const { context, page } = await openShellPage(browser, url, 106, errors);
			try {
				const nested = mode === 'read -e';
				const prompt = nested ? 'READ> ' : '> ';
				const command = nested
					? "IFS= read -e -r -t 90 -p 'READ> ' answer; printf '%s' \"$answer\" > result.txt"
					: "printf '%s' > result.txt 'open";
				const input = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(4);
				await page.keyboard.type("printf '%s\\n' HISTORY_BEFORE_EDIT");
				await page.keyboard.press('Enter');
				await expect
					.poll(async () => (await readShellScreen(page)).rows)
					.toContain('HISTORY_BEFORE_EDIT');
				await page.keyboard.type(command);
				await page.keyboard.press('Enter');
				await expect
					.poll(async () => (await readShellScreen(page)).rows.filter(Boolean).at(-1))
					.toBe(prompt.trimEnd());
				const prefix = (await readShellScreen(page)).text + ' ';
				await page.keyboard.type(input);
				if (clearScreen) {
					await page.keyboard.press('Control+l');
					// The full erase invalidates xterm's previous marker. The new origin
					// must be parsed before any queued Readline echo can move the cursor.
					await expect
						.poll(() => page.getByTestId('terminal-debug-output').textContent())
						.toContain('\x1b[2J\x1b]6973;P\x07');
					await expect
						.poll(async () => {
							const { rows, text } = await readShellScreen(page);
							return { firstRowIsPrompt: rows[0].startsWith(prompt), text };
						})
						.toEqual({ firstRowIsPrompt: true, text: prompt + input });
				}
				const visibleEdit = async () => {
					const { rows } = await readShellScreen(page);
					const first = clearScreen ? 0 : rows.findIndex((row) => row.startsWith(prompt));
					return rows.slice(first).join('');
				};
				for (let index = 0; index < input.length - 68; index++)
					await page.keyboard.press('ArrowLeft');
				if (!queued) {
					await expect
						.poll(
							async () => {
								const { text, cursorOffset } = await readShellScreen(page);
								return { text, cursorOffset };
							},
							{ timeout: 15_000 }
						)
						.toEqual({
							text: prefix + input,
							cursorOffset: prefix.length + 68
						});
				}
				await page.setViewportSize(shellViewport(53));
				await expect.poll(async () => (await readShellScreen(page)).columns).toBe(53);
				await expectResizeSettled(page);
				await page.keyboard.press('Control+a');
				await page.keyboard.type('HEAD_');
				await expect.poll(visibleEdit).toBe(prompt + 'HEAD_' + input);
				// Expand again with real keypresses still in flight at the narrow width.
				for (let index = 0; index < 70; index++) await page.keyboard.press('ArrowRight');
				await page.setViewportSize(shellViewport(106));
				await expectResizeSettled(page, 2);
				await page.keyboard.press('Control+a');
				await page.keyboard.type('BACK_');
				await expect.poll(visibleEdit).toBe(prompt + 'BACK_HEAD_' + input);
				await page.keyboard.press('Control+e');
				if (!nested) await page.keyboard.type("'");
				await page.keyboard.press('Enter');
				await expect
					.poll(
						() =>
							page.evaluate(async () => {
								const files = await (
									globalThis as SiteWindow
								).__wasmIdleContainer!.readWorkspace('BASH');
								const bytes = files.find(
									(file) => file.path === 'result.txt'
								)?.content;
								return typeof bytes === 'string'
									? bytes
									: bytes && new TextDecoder().decode(bytes);
							}),
						{ timeout: 15_000 }
					)
					.toBe((nested ? '' : 'open\n') + 'BACK_HEAD_' + input);
				expect((await readShellScreen(page)).rows.includes('HISTORY_BEFORE_EDIT')).toBe(
					!clearScreen
				);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
);

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

it(
	'keeps foreground stdin editable through program output and a terminal resize',
	{ skip: !enabled, timeout: 180_000, meta: { browser: true, requiredBrowser: enabled } },
	async () =>
		withShellBrowser(async (browser, browserUrl) => {
			const context = await browser.newContext({ viewport: shellViewport(106) });
			try {
				await addBrowserTestCookies(context, browserUrl);
				await disableBrowserPrewarm(context);
				const page = await context.newPage();
				const source = `const fs = require('fs');
console.log('DRAFT-READY');
fs.readLineSync(0);
console.log('');
console.log('NEXT');
console.log('RECEIVED=' + fs.readLineSync(0).trimEnd());
console.log('BEFORE-RESIZE');
console.log('RESIZED=' + fs.readLineSync(0).trimEnd());`;
				const url = new URL(browserUrl);
				url.searchParams.set('lang', 'JAVASCRIPT');
				url.searchParams.set('code', source);
				url.searchParams.set('lsp-test', '1');
				await page.goto(url.href, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(
					(expected) =>
						crossOriginIsolated &&
						(window as SiteWindow).__wasmIdleDebug?.getEditorValue() === expected,
					source,
					{ timeout: 90_000 }
				);
				if (await page.locator('#lsp-toggle').isChecked())
					await page.locator('#lsp-toggle').uncheck();
				await page.locator('button.action-button--run').first().click();
				const output = page.locator('[data-testid="terminal-debug-output"]');
				await expect
					.poll(() => output.textContent(), { timeout: 60_000 })
					.toContain('DRAFT-READY');
				const terminal = page.locator('.terminal-shell .xterm-helper-textarea');
				await terminal.focus();
				await terminal.evaluate((textarea) => {
					const clipboardData = new DataTransfer();
					clipboardData.setData('text/plain', 'first\nabcd');
					textarea.dispatchEvent(
						new ClipboardEvent('paste', { bubbles: true, clipboardData })
					);
				});
				const visible = async () => (await readShellScreen(page)).rows.filter(Boolean);
				await expect
					.poll(async () => (await visible()).slice(-2))
					.toEqual(['NEXT', 'abcd']);
				await page.keyboard.press('ArrowLeft');
				await page.keyboard.press('ArrowLeft');
				await page.keyboard.type('X');
				await expect.poll(async () => (await visible()).at(-1)).toBe('abXcd');
				await page.keyboard.press('Enter');
				await expect.poll(() => output.textContent()).toContain('RECEIVED=abXcd');
				const draft = '0123456789'.repeat(13);
				await page.keyboard.insertText(draft);
				await expect
					.poll(async () => (await readShellScreen(page)).text)
					.toContain('BEFORE-RESIZE' + draft);
				await page.keyboard.press('ArrowLeft');
				await page.keyboard.press('ArrowLeft');
				await page.setViewportSize(shellViewport(53));
				await expect.poll(async () => (await readShellScreen(page)).columns).toBe(53);
				await expect
					.poll(async () => (await readShellScreen(page)).text)
					.toContain('BEFORE-RESIZE' + draft);
				await page.keyboard.type('Y');
				const edited = draft.slice(0, -2) + 'Y' + draft.slice(-2);
				await expect
					.poll(async () => (await readShellScreen(page)).text)
					.toContain('BEFORE-RESIZE' + edited);
				await page.setViewportSize(shellViewport(106));
				await expect.poll(async () => (await readShellScreen(page)).columns).toBe(106);
				await page.keyboard.press('Home');
				await page.keyboard.type('X');
				await expect
					.poll(async () => (await readShellScreen(page)).text)
					.toContain('BEFORE-RESIZEX' + edited);
				await page.keyboard.press('Enter');
				await expect.poll(() => output.textContent()).toContain('RESIZED=X' + edited);
			} finally {
				await context.close();
			}
		})
);

it(
	'handles foreground editing shortcuts for a program waiting on stdin',
	{ skip: !enabled, timeout: 180_000, meta: { browser: true, requiredBrowser: enabled } },
	async () =>
		withShellBrowser(async (browser, browserUrl) => {
			const context = await browser.newContext({ viewport: shellViewport(106) });
			try {
				await addBrowserTestCookies(context, browserUrl);
				await disableBrowserPrewarm(context);
				await context.grantPermissions(['clipboard-write'], {
					origin: new URL(browserUrl).origin
				});
				const source = [
					"const fs = require('fs');",
					"console.log('READY_FOR_INPUT');",
					"console.log('FIRST=' + fs.readLineSync(0).trimEnd());",
					"console.log('SECOND=' + fs.readLineSync(0).trimEnd());",
					"console.log('WAIT_TO_STOP');",
					'fs.readLineSync(0);'
				].join('\n');
				const url = new URL(browserUrl);
				url.searchParams.set('lang', 'JAVASCRIPT');
				url.searchParams.set('code', source);
				url.searchParams.set('lsp-test', '1');
				const page = await context.newPage();
				await page.goto(url.href, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(
					(expected) =>
						crossOriginIsolated &&
						(window as SiteWindow).__wasmIdleDebug?.getEditorValue() === expected,
					source,
					{ timeout: 90_000 }
				);
				if (await page.locator('#lsp-toggle').isChecked())
					await page.locator('#lsp-toggle').uncheck();
				await page.locator('button.action-button--run').first().click();
				const output = page.locator('[data-testid="terminal-debug-output"]');
				await expect
					.poll(() => output.textContent(), { timeout: 60_000 })
					.toContain('READY_FOR_INPUT');
				await page.locator('.terminal-shell .xterm-helper-textarea').focus();
				expect(
					await page.evaluate(async () => {
						await navigator.clipboard.writeText('alpha\nbeta');
						return navigator.clipboard.readText().then(
							() => 'allowed',
							(error: DOMException) => error.name
						);
					})
				).toBe('NotAllowedError');
				await page.keyboard.press('Control+v');
				await expect.poll(() => output.textContent()).toContain('FIRST=alpha');
				await page.keyboard.press('Enter');
				await expect.poll(() => output.textContent()).toContain('SECOND=beta\r\n');
				await expect.poll(() => output.textContent()).toContain('WAIT_TO_STOP');
				await page.keyboard.press('Control+c');
				await expect
					.poll(() =>
						page.evaluate(
							() => (window as SiteWindow).__wasmIdleDebug?.getExecutionState().status
						)
					)
					.toBe('cancelled');
				expect(await output.textContent()).not.toContain('AbortError:');
			} finally {
				await context.close();
			}
		})
);
