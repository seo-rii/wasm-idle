// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { isStdinEditorReady } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_UIUA === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

async function runUiuaConsumer(page: Page, browserUrl: string) {
	const base = `${browserUrl.replace(/\/$/u, '')}/`;
	const harness = `${base}uiua-runtime-harness`;
	await page.route(harness, (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Uiua runtime</title>',
			headers: {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp'
			}
		})
	);
	await page.goto(harness, { waitUntil: 'domcontentloaded' });
	await page.addScriptTag({
		type: 'module',
		content: `import Uiua from ${JSON.stringify(base + 'src/lib/playground/uiua.ts')}; globalThis.__Uiua = Uiua;`
	});
	await page.waitForFunction(() => Boolean((globalThis as any).__Uiua));
	return await page.evaluate(async (base) => {
		const sandbox = new (globalThis as any).__Uiua();
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
			const arithmetic = await run('&p + 1 2', { stdin: '' });
			const arrays = await run('&p /+ ⇡5', { stdin: '' });
			const fresh = await run('&p × 6 7', { stdin: '' });
			const explicit = await run('&p &sc', { stdin: '한글 🦀\n' });
			const delayed = await run('&p &sc', {}, ['지연 ', '입력 🦀\n']);
			const eof = await run('&p &sc', { stdin: '' });
			const partialEof = await run('&p &sc', { stdin: 'no-newline' });
			const args = await run('&p &args', {
				stdin: '',
				activePath: 'src/한글.ua',
				programArgs: ['value', '한글']
			});
			const file = await run('&p &fras "data/input.txt"', {
				stdin: '',
				workspaceFiles: [{ path: 'data/input.txt', content: 'workspace data' }]
			});
			const invalid = await run('&p MissingName', { stdin: '' });
			const nonzero = await run('&exit 7', { stdin: '' });
			const limited = await run('&p ⇡1000', { stdin: '', limits: { maxOutputBytes: 16 } });
			const afterLimit = await run('&p "after limit"', { stdin: '' });
			const abort = new AbortController();
			const cancelled = await run('&p &sc', { signal: abort.signal }, undefined, abort);
			const recovered = await run('&p "after cancellation"', { stdin: '' });
			const timeout = await run('&p &sc', {
				limits: { runTimeoutMs: 250, compileTimeoutMs: 250 }
			});
			const afterTimeout = await run('&p "after timeout"', { stdin: '' });
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

describe.skipIf(!enabled)('real Uiua interpreter in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4994',
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
				const result = await runUiuaConsumer(page, server.browserUrl);
				expect(result.arithmetic).toMatchObject({ value: true, output: '3\n' });
				expect(result.arrays).toMatchObject({ value: true, output: '10\n' });
				expect(result.fresh).toMatchObject({ value: true, output: '42\n' });
				expect(result.explicit).toMatchObject({ value: true, output: '한글 🦀\n' });
				expect(result.delayed).toMatchObject({ value: true, output: '지연 입력 🦀\n' });
				expect(result.delayed.inputRequests).toBeGreaterThan(0);
				expect(result.eof).toMatchObject({ value: true, output: '0\n' });
				expect(result.partialEof).toMatchObject({ value: true, output: '0\n' });
				expect(result.args.value).toBe(true);
				expect(result.args.output).toContain('src/한글.ua');
				expect(result.args.output).toContain('value');
				expect(result.args.output).toContain('한글');
				expect(result.file).toMatchObject({ value: true, output: 'workspace data\n' });
				expect(result.invalid.value).toBe(false);
				expect(result.invalid.output).toContain('MissingName');
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
				if (new URL(request.url()).pathname.includes('/wasm-uiua/'))
					requests.push(request.url());
			});
			try {
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(isStdinEditorReady, '');
				await page.waitForFunction(() => crossOriginIsolated);
				expect(requests).toEqual([]);
				await page.locator('#language-select').selectOption('UIUA');
				await page.waitForFunction(isStdinEditorReady, 'UIUA');
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
					editorDefaults.uiua
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
					await (window as any).__wasmIdleDebug.writeTerminalInput('hello Uiua\n', false);
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
				await page.waitForFunction((id) => {
					const state = (window as any).__wasmIdleDebug.getExecutionState();
					return state.id > id && state.endedAt !== null;
				}, previousId);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({
					language: 'UIUA',
					status: 'completed',
					exitCode: 0
				});
				expect(
					(
						await page.locator('[data-testid="terminal-debug-output"]').textContent()
					)?.replaceAll('\r', '')
				).toContain('hello Uiua\n');
				expect(requests.length).toBeGreaterThan(0);
			} finally {
				await context.close();
			}
		}
	);
});
