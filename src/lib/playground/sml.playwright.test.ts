// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { isStdinEditorReady } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_SML === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

async function runSmlConsumer(page: Page, browserUrl: string) {
	const base = `${browserUrl.replace(/\/$/u, '')}/`;
	const harness = `${base}sml-runtime-harness`;
	await page.route(harness, (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Sml runtime</title>',
			headers: {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp'
			}
		})
	);
	await page.goto(harness, { waitUntil: 'domcontentloaded' });
	await page.addScriptTag({
		type: 'module',
		content: `import Sml from ${JSON.stringify(base + 'src/lib/playground/sml.ts')}; globalThis.__Sml = Sml;`
	});
	await page.waitForFunction(() => Boolean((globalThis as any).__Sml));
	return await page.evaluate(async (base) => {
		const sandbox = new (globalThis as any).__Sml();
		const rootUrl = new URL(base).pathname.replace(/\/$/u, '');
		const run = async (
			code: string,
			options: Record<string, unknown> = {},
			input?: string[],
			abort?: AbortController
		) => {
			await sandbox.load({ rootUrl });
			let output = '';
			let inputRequests = 0;
			let scheduled = false;
			sandbox.output = (chunk: string) => (output += chunk);
			try {
				const value = await sandbox.run(
					code,
					false,
					false,
					{
						report(event: { kind?: string; reason?: string }) {
							if (event.kind !== 'ready' || event.reason !== 'stdin-request') return;
							inputRequests += 1;
							if (scheduled) return;
							scheduled = true;
							if (abort) setTimeout(() => abort.abort(), 20);
							if (input) {
								input.forEach((chunk, index) =>
									setTimeout(() => sandbox.write(chunk), 20 * (index + 1))
								);
								setTimeout(() => sandbox.eof(), 20 * (input.length + 1));
							}
						}
					},
					[],
					options
				);
				return { value, output, inputRequests, error: '', code: '' };
			} catch (error) {
				return {
					value: false,
					output,
					inputRequests,
					error: String(error),
					code: String((error as { code?: unknown })?.code || '')
				};
			}
		};
		try {
			const arithmetic = await run('val _ = print (Int.toString (1 + 2) ^ "\\n");', {
				stdin: ''
			});
			const arrays = await run(
				'val _ = print (Int.toString (List.foldl op+ 0 [0,1,2,3,4]) ^ "\\n");',
				{ stdin: '' }
			);
			const fresh = await run(
				'fun fact 0 = 1 | fact n = n * fact (n - 1); val _ = print (Int.toString (fact 5) ^ "\\n");',
				{ stdin: '' }
			);
			const explicit = await run(
				'val _ = print (case TextIO.inputLine TextIO.stdIn of SOME line => line | NONE => "EOF\\n");',
				{ stdin: '한글 🦀\n' }
			);
			const delayed = await run(
				'val _ = print (case TextIO.inputLine TextIO.stdIn of SOME line => line | NONE => "EOF\\n");',
				{},
				['지연 ', '입력 🦀\n']
			);
			const eof = await run(
				'val _ = print (case TextIO.inputLine TextIO.stdIn of SOME line => line | NONE => "EOF\\n");',
				{ stdin: '' }
			);
			const partialEof = await run(
				'val _ = print (case TextIO.inputLine TextIO.stdIn of SOME line => line | NONE => "EOF\\n");',
				{ stdin: 'no-newline' }
			);
			const args = await run(
				'val _ = List.app (fn arg => print (arg ^ "\\n")) (CommandLine.arguments ());',
				{
					stdin: '',
					activePath: 'src/한글.sml',
					programArgs: ['value', '한글']
				}
			);
			const file = await run(
				'val file = TextIO.openIn "data/input.txt"; val _ = print (TextIO.inputAll file);',
				{
					stdin: '',
					workspaceFiles: [{ path: 'data/input.txt', content: 'workspace data\n' }]
				}
			);
			const invalid = await run('val _ = print MissingName;', { stdin: '' });
			const typeError = await run('val x : int = "bad";', { stdin: '' });
			const uncaught = await run('val _ = raise Fail "boom";', { stdin: '' });
			const nonzero = await run('val _ = OS.Process.exit OS.Process.failure;', { stdin: '' });
			const limited = await run(
				'val _ = List.app (fn _ => print "large output") (List.tabulate (100, fn n => n));',
				{ stdin: '', limits: { maxOutputBytes: 16 } }
			);
			const afterLimit = await run('val _ = print "after limit\\n";', { stdin: '' });
			const abort = new AbortController();
			const cancelled = await run(
				'val _ = print (case TextIO.inputLine TextIO.stdIn of SOME line => line | NONE => "EOF\\n");',
				{ signal: abort.signal },
				undefined,
				abort
			);
			const recovered = await run('val _ = print "after cancellation\\n";', { stdin: '' });
			const timeout = await run(
				'val _ = print (case TextIO.inputLine TextIO.stdIn of SOME line => line | NONE => "EOF\\n");',
				{
					limits: { runTimeoutMs: 1000, compileTimeoutMs: 10000 }
				}
			);
			const afterTimeout = await run('val _ = print "after timeout\\n";', { stdin: '' });
			return {
				arithmetic,
				arrays,
				fresh,
				explicit,
				delayed,
				eof,
				partialEof,
				args,
				file,
				invalid,
				typeError,
				uncaught,
				nonzero,
				limited,
				afterLimit,
				cancelled,
				recovered,
				timeout,
				afterTimeout
			};
		} finally {
			await sandbox.dispose();
		}
	}, base);
}

describe.skipIf(!enabled)('real Sml interpreter in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4995',
			serverMode: 'dev'
		});
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable(
				process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
			)
		});
	}, 120_000);
	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	it(
		'executes fresh source with original array semantics, stdin/EOF, files, arguments, errors and recovery',
		{ timeout: 180_000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			try {
				const result = await runSmlConsumer(page, server.browserUrl);
				expect(result.arithmetic).toMatchObject({ value: true, output: '3\n' });
				expect(result.arrays).toMatchObject({ value: true, output: '10\n' });
				expect(result.fresh).toMatchObject({ value: true, output: '120\n' });
				expect(result.explicit).toMatchObject({ value: true, output: '한글 🦀\n' });
				expect(result.delayed).toMatchObject({ value: true, output: '지연 입력 🦀\n' });
				expect(result.delayed.inputRequests).toBeGreaterThan(0);
				expect(result.eof).toMatchObject({ value: true, output: 'EOF\n' });
				expect(result.partialEof).toMatchObject({ value: true, output: 'no-newline\n' });
				expect(result.args.value).toBe(true);
				expect(result.args.output).toContain('src/한글.sml');
				expect(result.args.output).toContain('value');
				expect(result.args.output).toContain('한글');
				expect(result.file).toMatchObject({ value: true, output: 'workspace data\n' });
				expect(result.invalid.value).toBe(false);
				expect(result.invalid.output).toContain('MissingName');
				expect(result.typeError.value).toBe(false);
				expect(result.typeError.output).toContain('type mismatch');
				expect(result.uncaught.value).toBe(false);
				expect(result.uncaught.output).toContain('boom');
				expect(result.nonzero.value).toBe(false);
				expect(result.limited.code).toBe('output-limit');
				expect(result.afterLimit).toMatchObject({ value: true, output: 'after limit\n' });
				expect(result.cancelled.error).not.toBe('');
				expect(result.recovered).toMatchObject({
					value: true,
					output: 'after cancellation\n'
				});
				expect(result.timeout.code).toBe('timeout');
				expect(result.afterTimeout).toMatchObject({
					value: true,
					output: 'after timeout\n'
				});
			} finally {
				await context.close();
			}
		}
	);

	it(
		'runs the unchanged default example through the actual selector, Run and terminal input',
		{ timeout: 180_000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			await disableBrowserPrewarm(context);
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			const requests: string[] = [];
			context.on('request', (request) => {
				if (new URL(request.url()).pathname.includes('/wasm-sml/'))
					requests.push(request.url());
			});
			try {
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(isStdinEditorReady, '');
				await page.waitForFunction(() => crossOriginIsolated);
				expect(requests).toEqual([]);
				await page.locator('#language-select').selectOption('SML');
				await page.waitForFunction(isStdinEditorReady, 'SML');
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
					editorDefaults.sml
				);
				const previousId = await page.evaluate(
					() => (window as any).__wasmIdleDebug.getExecutionState().id
				);
				await page.locator('button.action-button--run').first().click();
				await page.waitForFunction((id) => {
					const state = (window as any).__wasmIdleDebug.getExecutionState();
					return state.id > id && !['idle', 'preparing'].includes(state.status);
				}, previousId);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('hello Sml\n', false);
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
				await page.waitForFunction((id) => {
					const state = (window as any).__wasmIdleDebug.getExecutionState();
					return state.id > id && state.endedAt !== null;
				}, previousId);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({
					language: 'SML',
					status: 'completed',
					exitCode: 0
				});
				expect(
					(
						await page.locator('[data-testid="terminal-debug-output"]').textContent()
					)?.replaceAll('\r', '')
				).toContain('hello Sml\n');
				expect(requests.length).toBeGreaterThan(0);
			} finally {
				await context.close();
			}
		}
	);
});
