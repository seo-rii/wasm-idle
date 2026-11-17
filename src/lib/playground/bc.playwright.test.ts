// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { isStdinEditorReady } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_BC === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

async function runBcConsumer(page: Page, browserUrl: string) {
	const base = `${browserUrl.replace(/\/$/u, '')}/`;
	const harness = `${base}bc-runtime-harness`;
	await page.route(harness, (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Bc runtime</title>',
			headers: {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp'
			}
		})
	);
	await page.goto(harness, { waitUntil: 'domcontentloaded' });
	await page.addScriptTag({
		type: 'module',
		content: `import Bc from ${JSON.stringify(base + 'src/lib/playground/bc.ts')}; globalThis.__Bc = Bc;`
	});
	await page.waitForFunction(() => Boolean((globalThis as any).__Bc));
	return await page.evaluate(async (base) => {
		const sandbox = new (globalThis as any).__Bc();
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
			const arithmetic = await run('1+2\n', { stdin: '' });
			const functions = await run(
				'define f(n) { if (n<=1) return(1); return(n*f(n-1)); }\nf(20)\n',
				{ stdin: '' }
			);
			const fresh = await run('6*7\n', { stdin: '' });
			const explicit = await run('a=read();print "한글 🦀:",a+1,"\\n"\n', { stdin: '41\n' });
			const delayed = await run('a=read();print "지연:",a+1,"\\n"\n', {}, ['4', '1\n']);
			const eof = await run('a=read();a\n', { stdin: '' });
			const partialEof = await run('a=read();a\n', { stdin: '41' });
			const args = await run('s(0)\n', {
				stdin: '',
				activePath: 'src/한글.bc',
				programArgs: ['-l']
			});
			const file = await run('value=40\n', {
				stdin: '',
				programArgs: ['-f', 'data/input.bc'],
				workspaceFiles: [{ path: 'data/input.bc', content: 'value+2\n' }]
			});
			const invalid = await run('1+\n', { stdin: '' });
			const nonzero = await run('1/0\n', { stdin: '' });
			const limited = await run('for(i=0;i<1000;i++) print i,"\\n"\n', {
				stdin: '',
				limits: { maxOutputBytes: 16 }
			});
			const afterLimit = await run('print "after limit\\n"\n', { stdin: '' });
			const abort = new AbortController();
			const cancelled = await run('a=read();a\n', { signal: abort.signal }, undefined, abort);
			const recovered = await run('print "after cancellation\\n"\n', { stdin: '' });
			const timeout = await run('a=read();a\n', {
				limits: { runTimeoutMs: 250, compileTimeoutMs: 250 }
			});
			const afterTimeout = await run('print "after timeout\\n"\n', { stdin: '' });
			return {
				arithmetic,
				functions,
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

describe.skipIf(!enabled)('real Bc interpreter in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4996',
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
		'executes fresh source with original decimal and function semantics, stdin/EOF, files, arguments, errors and recovery',
		{ timeout: 180_000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			try {
				const result = await runBcConsumer(page, server.browserUrl);
				expect(result.arithmetic).toMatchObject({ value: true, output: '3\n' });
				expect(result.functions).toMatchObject({
					value: true,
					output: '2432902008176640000\n'
				});
				expect(result.fresh).toMatchObject({ value: true, output: '42\n' });
				expect(result.explicit).toMatchObject({ value: true, output: '한글 🦀:42\n' });
				expect(result.delayed).toMatchObject({ value: true, output: '지연:42\n' });
				expect(result.delayed.inputRequests).toBeGreaterThan(0);
				expect(result.eof.value).toBe(false);
				expect(result.eof.output).toContain('bad read() expression');
				expect(result.partialEof.value).toBe(false);
				expect(result.partialEof.output).toContain('bad read() expression');
				expect(result.args.value).toBe(true);
				expect(result.args.output).toBe('0\n');

				expect(result.file).toMatchObject({ value: true, output: '42\n' });
				expect(result.invalid.value).toBe(false);
				expect(result.invalid.output).toContain('Parse error');
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
				if (new URL(request.url()).pathname.includes('/wasm-bc/'))
					requests.push(request.url());
			});
			try {
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(isStdinEditorReady, '');
				await page.waitForFunction(() => crossOriginIsolated);
				expect(requests).toEqual([]);
				await page.locator('#language-select').selectOption('BC');
				await page.waitForFunction(isStdinEditorReady, 'BC');
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
					editorDefaults.bc
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
					await (window as any).__wasmIdleDebug.writeTerminalInput('41\n', false);
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
				await page.waitForFunction((id) => {
					const state = (window as any).__wasmIdleDebug.getExecutionState();
					return state.id > id && state.endedAt !== null;
				}, previousId);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({
					language: 'BC',
					status: 'completed',
					exitCode: 0
				});
				expect(
					(
						await page.locator('[data-testid="terminal-debug-output"]').textContent()
					)?.replaceAll('\r', '')
				).toContain('value=42\n');
				expect(requests.length).toBeGreaterThan(0);
			} finally {
				await context.close();
			}
		}
	);
});
