// @vitest-environment node
import { stripVTControlCharacters } from 'node:util';
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
type EofWindow = typeof globalThis & {
	__wasmIdleContainer?: {
		inspect(): Promise<{
			shell?: {
				closed: boolean;
				control?: { appliedGeneration: number; cwd: string };
			};
		}>;
		readWorkspace(language: string): Promise<unknown>;
	};
	__wasmIdleDebug?: { writeTerminalInput(text: string, eof: boolean): Promise<void> };
};
const text = (value: string) => stripVTControlCharacters(value).replaceAll('\r', '');
const transcript = (page: Page) =>
	page
		.locator('[data-testid="terminal-debug-output"]')
		.textContent()
		.then((value) => value ?? '');
const input = (page: Page, value: string) =>
	page.evaluate(
		(value) => (globalThis as EofWindow).__wasmIdleDebug!.writeTerminalInput(value, false),
		value
	);

it(
	'closes Bash input through nested Readline and foreground readers while preserving commands and EXIT traps',
	{ skip: !enabled, timeout: 240_000, meta: { browser: true, requiredBrowser: enabled } },
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
					headless: true,
					executablePath: await resolveChromiumExecutable(
						process.env.WASM_IDLE_CHROMIUM_EXECUTABLE
					)
				});
				for (const scenario of [
					'secondary-prompt',
					'read-e-empty',
					'read-e-partial',
					'idle-empty',
					'idle-editing',
					'cat',
					'read'
				]) {
					const context = await browser.newContext({
						viewport: { width: 1600, height: 1050 },
						serviceWorkers: 'allow'
					});
					await addBrowserTestCookies(context, server.browserUrl);
					await disableBrowserPrewarm(context);
					await context.addInitScript(() => {
						localStorage.setItem(
							'wasm-idle:example-workspace:v3',
							JSON.stringify({
								version: 6,
								language: 'BASH',
								activePath: 'main.sh',
								files: [
									{ path: 'main.sh', content: "printf 'editor-preserved\\n'\n" }
								],
								lspEnabled: false
							})
						);
					});
					const page = await context.newPage();
					const errors: string[] = [];
					page.on('pageerror', (error) => errors.push(error.message));
					try {
						const url = new URL(server.browserUrl);
						url.searchParams.set('lsp-test', '1');
						await page.goto(url.href, { waitUntil: 'domcontentloaded' });
						await expect
							.poll(
								() =>
									page.evaluate(async () => {
										const shell = (
											await (
												globalThis as EofWindow
											).__wasmIdleContainer?.inspect()
										)?.shell;
										return (
											crossOriginIsolated &&
											shell?.control?.cwd === '/workspace/BASH' &&
											shell.control.appliedGeneration >= 1
										);
									}),
								{ timeout: 60_000 }
							)
							.toBe(true);
						const files = await page.evaluate(() =>
							(globalThis as EofWindow).__wasmIdleContainer!.readWorkspace('BASH')
						);
						await input(
							page,
							`trap 'printf "EOF_EXIT_%s\\n" "$?"' EXIT; printf '%s\\n' EOF_READY\n`
						);
						await expect
							.poll(async () => text(await transcript(page)))
							.toContain('\nEOF_READY\n');
						let expectedStatus = 0;
						if (scenario === 'secondary-prompt') {
							await input(page, "echo 'PS2_MUST_NOT_RUN\n");
							await expect
								.poll(async () => text(await transcript(page)))
								.toContain('\n> ');
							expectedStatus = 2;
						} else if (scenario.startsWith('read-e') || scenario === 'read') {
							await input(
								page,
								`printf '%s\\n' READER_WAIT; IFS= read ${scenario.startsWith('read-e') ? '-e ' : ''}-r value; code=$?; printf 'READER_DONE_%s:<%s>\\n' "$code" "$value"\n`
							);
							await expect
								.poll(async () => text(await transcript(page)))
								.toContain('\nREADER_WAIT\n');
							if (scenario !== 'read-e-empty') await input(page, 'EOF_PARTIAL');
							if (scenario === 'read-e-partial')
								await expect
									.poll(async () => text(await transcript(page)))
									.toContain('EOF_PARTIAL');
						} else if (scenario === 'cat') {
							await input(page, `cat; printf 'CAT_DONE_%s\\n' "$?"\n`);
							await input(page, 'EOF_CAT_PAYLOAD\n');
							await expect
								.poll(async () => text(await transcript(page)))
								.toContain('\nEOF_CAT_PAYLOAD\n');
						} else if (scenario === 'idle-empty') {
							await input(page, `printf '%s\\n' FALSE_WAIT; false\n`);
							await expect
								.poll(async () => text(await transcript(page)))
								.toContain('\nFALSE_WAIT\n');
							expectedStatus = 1;
						} else {
							await input(page, 'echo EOF-$((4 + 2))');
							await expect
								.poll(async () => text(await transcript(page)))
								.toContain('echo EOF-$((4 + 2))');
						}
						// Let Readline consume the final edit before closing its real input pipe.
						await page.waitForTimeout(200);
						const before = (await transcript(page)).length;
						await page.locator('.terminal-shell .xterm-helper-textarea').focus();
						await page.keyboard.press('Control+d');
						await expect
							.poll(
								() =>
									page.evaluate(
										async () =>
											(
												await (
													globalThis as EofWindow
												).__wasmIdleContainer!.inspect()
											).shell?.closed
									),
								{ timeout: 10_000 }
							)
							.toBe(true);
						await expect
							.poll(async () => text((await transcript(page)).slice(before)))
							.toContain('Shell exited; reload to open a new shell.');
						const after = text((await transcript(page)).slice(before));
						expect(after, scenario).toContain(`EOF_EXIT_${expectedStatus}\n`);
						expect(after, scenario).not.toMatch(/runtime-error|PS2_MUST_NOT_RUN|EOF-6/);
						if (scenario === 'secondary-prompt')
							expect(after).toContain('unexpected EOF');
						if (scenario.startsWith('read-e') || scenario === 'read')
							expect(after).toContain(
								// GNU Readline discards an unfinished TTY editing line at EOF;
								// ordinary read retains bytes received before its pipe closes.
								`READER_DONE_1:<${scenario === 'read' ? 'EOF_PARTIAL' : ''}>\n`
							);
						if (scenario === 'cat') expect(after).toContain('CAT_DONE_0\n');
						expect(
							await page.evaluate(() =>
								(globalThis as EofWindow).__wasmIdleContainer!.readWorkspace('BASH')
							)
						).toEqual(files);
						expect(errors).toEqual([]);
					} catch (error) {
						throw new Error(
							`${scenario}: ${String(error)}\n${text(await transcript(page)).slice(-4000)}`,
							{ cause: error }
						);
					} finally {
						await context.close();
					}
				}
			} finally {
				await browser?.close();
				await server.close();
			}
		});
	}
);
