// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { isStdinEditorReady } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_SMALLTALK === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

async function runSmalltalkConsumer(page: Page, browserUrl: string) {
	const base = `${browserUrl.replace(/\/$/u, '')}/`;
	const harness = `${base}smalltalk-runtime-harness`;
	await page.route(harness, (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Smalltalk runtime</title>',
			headers: {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp'
			}
		})
	);
	await page.goto(harness, { waitUntil: 'domcontentloaded' });
	await page.addScriptTag({
		type: 'module',
		content: `import Smalltalk from ${JSON.stringify(base + 'src/lib/playground/smalltalk.ts')}; globalThis.__Smalltalk = Smalltalk;`
	});
	await page.waitForFunction(() => Boolean((globalThis as any).__Smalltalk));
	return await page.evaluate(async (base) => {
		const sandbox = new (globalThis as any).__Smalltalk();
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
							if (event.kind !== 'ready') return;
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
			const print = (expression: string) =>
				`Stdout nextPutAll: (${expression}) asString; cr!`;
			const lineProgram = `| line | line := Stdin nextLine. line ifNil: [Stdout nextPutAll: 'EOF'; cr] ifNotNil: [Stdout nextPutAll: line; cr]!`;
			const arithmetic = await run(print('1 + 2'), { stdin: '' });
			const arrays = await run(
				print(
					'((1 to: 5) collect: [:each | each * each]) inject: 0 into: [:sum :each | sum + each]'
				),
				{ stdin: '' }
			);
			const classes = await run(
				`Object subclass: #Counter slots: {} package: 'User'!
!Counter methodsFor: 'accessing'!
value
 ^ 42
!
!
Stdout nextPutAll: Counter new value asString; cr!`,
				{ stdin: '' }
			);
			const fresh = await run(print('6 * 7'), { stdin: '' });
			const explicit = await run(lineProgram, { stdin: '한글 🦀\n' });
			const delayed = await run(lineProgram, {}, ['지연 ', '입력 🦀\n']);
			const eof = await run(lineProgram, { stdin: '' });
			const partialEof = await run(lineProgram, { stdin: 'no-newline' });
			const crlf = await run(lineProgram, { stdin: 'CRLF\r\n' });
			const raw = await run(`Stdout nextPutAll: Stdin upToEnd!`, { stdin: '안녕😀\nlast' });
			const bytes = await run(print('Stdin nextByte'), { stdin: 'A' });
			const args = await run(`Stdout nextPutAll: Arguments first; cr!`, {
				stdin: '',
				activePath: 'src/main.st',
				programArgs: ['arg 🦀']
			});
			const file = await run(`Stdout nextPutAll: (Files readText: 'data.txt'); cr!`, {
				stdin: '',
				workspaceFiles: [{ path: 'data.txt', content: 'file 한글' }]
			});
			const multi = await run(`Files fileIn: 'helper.st'!`, {
				stdin: '',
				workspaceFiles: [{ path: 'helper.st', content: print('13 * 7') }]
			});
			const transcript = await run(`Transcript show: 'transcript'!`, { stdin: '' });
			const invalid = await run('| bad | bad := !', { stdin: '' });
			const nonzero = await run('1 noSuchSelector!', { stdin: '' });
			const limited = await run(`100 timesRepeat: [Stdout nextPutAll: 'large output'; cr]!`, {
				stdin: '',
				limits: { maxOutputBytes: 16 }
			});
			const afterLimit = await run(`Stdout nextPutAll: 'after limit'; cr!`, { stdin: '' });
			const abort = new AbortController();
			const cancelled = await run(lineProgram, { signal: abort.signal }, undefined, abort);
			const recovered = await run(`Stdout nextPutAll: 'after cancellation'; cr!`, {
				stdin: ''
			});
			const timeout = await run('[ true ] whileTrue: []!', {
				stdin: '',
				limits: { runTimeoutMs: 100, compileTimeoutMs: 10000 }
			});
			const afterTimeout = await run(`Stdout nextPutAll: 'after timeout'; cr!`, {
				stdin: ''
			});
			return {
				arithmetic,
				arrays,
				classes,
				fresh,
				explicit,
				delayed,
				eof,
				partialEof,
				crlf,
				raw,
				bytes,
				args,
				file,
				multi,
				transcript,
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

describe.skipIf(!enabled)('real Amber Smalltalk compiler and kernel in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4999',
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
		'compiles original Smalltalk chunks, methods and collections with real stdin/EOF, arguments, files, errors and recovery',
		{ timeout: 180_000, meta: browserMeta },
		async () => {
			const context = await browser.newContext({ serviceWorkers: 'block' });
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			try {
				const result = await runSmalltalkConsumer(page, server.browserUrl);
				expect(result.arithmetic, JSON.stringify(result.arithmetic)).toMatchObject({
					value: true,
					output: '3\n'
				});
				expect(result.arrays).toMatchObject({ value: true, output: '55\n' });
				expect(result.classes).toMatchObject({ value: true, output: '42\n' });
				expect(result.fresh).toMatchObject({ value: true, output: '42\n' });
				expect(result.explicit).toMatchObject({ value: true, output: '한글 🦀\n' });
				expect(result.delayed).toMatchObject({ value: true, output: '지연 입력 🦀\n' });
				expect(result.delayed.inputRequests).toBeGreaterThan(0);
				expect(result.eof).toMatchObject({ value: true, output: 'EOF\n' });
				expect(result.partialEof).toMatchObject({ value: true, output: 'no-newline\n' });
				expect(result.crlf).toMatchObject({ value: true, output: 'CRLF\n' });
				expect(result.raw).toMatchObject({ value: true, output: '안녕😀\nlast' });
				expect(result.bytes).toMatchObject({ value: true, output: '65\n' });
				expect(result.args).toMatchObject({ value: true, output: 'arg 🦀\n' });
				expect(result.file).toMatchObject({ value: true, output: 'file 한글\n' });
				expect(result.multi).toMatchObject({ value: true, output: '91\n' });
				expect(result.transcript).toMatchObject({ value: true, output: 'transcript\n' });
				expect(result.invalid.value).toBe(false);
				expect(result.invalid.error).not.toBe('');
				expect(result.nonzero.value).toBe(false);
				expect(result.nonzero.error).toContain('noSuchSelector');
				expect(result.limited.code, JSON.stringify(result.limited)).toBe('output-limit');
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
				if (new URL(request.url()).pathname.includes('/wasm-smalltalk/'))
					requests.push(request.url());
			});
			try {
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(isStdinEditorReady, '');
				await page.waitForFunction(() => crossOriginIsolated);
				expect(requests).toEqual([]);
				await page.locator('#language-select').selectOption('SMALLTALK');
				await page.waitForFunction(isStdinEditorReady, 'SMALLTALK');
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
					editorDefaults.smalltalk
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
					await (window as any).__wasmIdleDebug.writeTerminalInput('42\n', false);
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
				await page.waitForFunction((id) => {
					const state = (window as any).__wasmIdleDebug.getExecutionState();
					return state.id > id && state.endedAt !== null;
				}, previousId);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({
					language: 'SMALLTALK',
					status: 'completed',
					exitCode: 0
				});
				expect(
					(
						await page.locator('[data-testid="terminal-debug-output"]').textContent()
					)?.replaceAll('\r', '')
				).toContain('42\n');
				expect(requests.length).toBeGreaterThan(0);
			} finally {
				await context.close();
			}
		}
	);
});
