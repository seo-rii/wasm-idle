// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startBrowserPreviewServer } from '../../../scripts/browser-preview-server.mjs';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { isStdinEditorReady } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_APL === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };

async function runAplConsumer(page: Page, browserUrl: string) {
	const base = `${browserUrl.replace(/\/$/u, '')}/`;
	const harness = `${base}apl-runtime-harness`;
	await page.route(harness, (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>GNU APL runtime</title>',
			headers: {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp'
			}
		})
	);
	await page.goto(harness, { waitUntil: 'domcontentloaded' });
	await page.addScriptTag({
		type: 'module',
		content: `import Apl from ${JSON.stringify(base + 'src/lib/playground/apl.ts')}; globalThis.__Apl = Apl;`
	});
	await page.waitForFunction(() => Boolean((globalThis as any).__Apl));
	return await page.evaluate(async (base) => {
		const sandbox = new (globalThis as any).__Apl();
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
			const arithmetic = await run('⎕←1+2\n', { stdin: '' });
			const arrays = await run('⎕←+⌿2 3⍴⍳6\n', { stdin: '' });
			const nested = await run('⎕←2⊃(10 20)(30 40)\n⎕←1J2+3J4\n', { stdin: '' });
			const functions = await run(
				'∇ Z←Fact N\nZ←1\nLOOP: →(N=0)/END\nZ←Z×N\nN←N-1\n→LOOP\nEND: Z←Z\n∇\n⎕←Fact 5\n',
				{ stdin: '' }
			);
			const explicit = await run('⎕←⍞\n', { stdin: '한글 🦀\n' });
			const delayed = await run('⎕←⍞\n', {}, ['지연 ', '입력 🦀\n']);
			const numeric = await run('N←⎕\n⎕←N×2\n', { stdin: '21\n' });
			const eof = await run('⎕←⍴⍞\n', { stdin: '' });
			const partialEof = await run('⎕←⍞\n', { stdin: 'no-newline' });
			const args = await run('⎕←⎕ARG\n', {
				stdin: '',
				activePath: 'src/한글.apl',
				programArgs: ['--value', '한글']
			});
			const file = await run("⎕←1⊃(⎕FIO[49] 'data/한글.txt')\n", {
				stdin: '',
				workspaceFiles: [{ path: 'data/한글.txt', content: 'workspace 한글\nsecond\n' }]
			});
			const archive = await run('X←42\n)SAVE /saved\nX←0\n)LOAD /saved\n⎕←X\n', {
				stdin: ''
			});
			const invalid = await run('⎕←(1+\n', { stdin: '' });
			const undefinedName = await run('⎕←UNDEFINED\n', { stdin: '' });
			const definition = await run('∇ R←1+2\nR←1\n∇\n', { stdin: '' });
			const caught = await run("R←⎕EC 'UNDEFINED'\n⎕←'caught'\n", { stdin: '' });
			const nonzero = await run(')OFF 7\n', { stdin: '' });
			await run('X←100\n', { stdin: '' });
			const fresh = await run('⎕←X\n', { stdin: '' });
			const limited = await run("⎕←100⍴'X'\n", { stdin: '', limits: { maxOutputBytes: 16 } });
			const afterLimit = await run("⎕←'after limit'\n", { stdin: '' });
			const abort = new AbortController();
			const cancelled = await run('⎕←⍞\n', { signal: abort.signal }, undefined, abort);
			const recovered = await run("⎕←'after cancellation'\n", { stdin: '' });
			const timeout = await run('∇ Spin\nLOOP: →LOOP\n∇\nSpin\n', {
				stdin: '',
				limits: { runTimeoutMs: 1000, compileTimeoutMs: 10000 }
			});
			const afterTimeout = await run("⎕←'after timeout'\n", { stdin: '' });
			const memory = await run('⎕←1\n', { stdin: '', limits: { maxWasmMemoryBytes: 65536 } });
			const heapLimit = await run('A←⍳1000000\n⎕←⍴A\n', {
				stdin: '',
				limits: {
					maxWasmMemoryBytes: 8 * 1024 * 1024,
					runTimeoutMs: 200,
					compileTimeoutMs: 1000
				}
			});
			const afterMemory = await run("⎕←'after memory limit'\n", { stdin: '' });
			return {
				arithmetic,
				arrays,
				nested,
				functions,
				explicit,
				delayed,
				numeric,
				eof,
				partialEof,
				args,
				file,
				archive,
				invalid,
				undefinedName,
				definition,
				caught,
				nonzero,
				fresh,
				limited,
				afterLimit,
				cancelled,
				recovered,
				timeout,
				afterTimeout,
				memory,
				heapLimit,
				afterMemory
			};
		} finally {
			await sandbox.dispose();
		}
	}, base);
}

describe.skipIf(!enabled)('real GNU APL interpreter in Chromium', () => {
	let server: Awaited<ReturnType<typeof startBrowserPreviewServer>>;
	let browser: Browser;
	beforeAll(async () => {
		server = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:4997',
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
		'runs the original array engine, traditional functions, stdin, archives, errors and limits',
		{ timeout: 180_000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			try {
				const result = await runAplConsumer(page, server.browserUrl);
				expect(result.arithmetic).toMatchObject({ value: true, output: '3\n\n' });
				expect(result.arrays).toMatchObject({ value: true, output: '5 7 9\n\n' });
				expect(result.nested).toMatchObject({ value: true, output: '30 40\n4J6\n\n' });
				expect(result.functions).toMatchObject({ value: true, output: '120\n\n' });
				expect(result.explicit).toMatchObject({ value: true, output: '한글 🦀\n\n' });
				expect(result.delayed).toMatchObject({ value: true, output: '지연 입력 🦀\n\n' });
				expect(result.delayed.inputRequests).toBeGreaterThan(0);
				expect(result.numeric.value).toBe(true);
				expect(result.numeric.output).toContain('42\n');
				expect(result.eof).toMatchObject({ value: true, output: '0\n\n' });
				expect(result.partialEof).toMatchObject({ value: true, output: 'no-newline\n\n' });
				expect(result.args.value).toBe(true);
				expect(result.args.output).toContain('src/한글.apl');
				expect(result.args.output).toContain('--value');
				expect(result.args.output).toContain('한글');
				expect(result.file).toMatchObject({ value: true, output: 'workspace 한글\n\n' });
				expect(result.archive.value).toBe(true);
				expect(result.archive.output).toContain('42\n');
				expect(result.invalid.value).toBe(false);
				expect(result.invalid.output).toContain('SYNTAX ERROR');
				expect(result.undefinedName.value).toBe(false);
				expect(result.undefinedName.output).toContain('VALUE ERROR');
				expect(result.definition.value).toBe(false);
				expect(result.definition.output).toContain('DEFN ERROR');
				expect(result.caught).toMatchObject({ value: true, output: 'caught\n\n' });
				expect(result.nonzero.value).toBe(false);
				expect(result.fresh.value).toBe(false);
				expect(result.limited.code).toBe('output-limit');
				expect(result.afterLimit).toMatchObject({ value: true, output: 'after limit\n\n' });
				expect(result.cancelled.error).not.toBe('');
				expect(result.recovered).toMatchObject({
					value: true,
					output: 'after cancellation\n\n'
				});
				expect(result.timeout.code).toBe('timeout');
				expect(result.afterTimeout).toMatchObject({
					value: true,
					output: 'after timeout\n\n'
				});
				expect(result.memory.code).toBe('resource-limit');
				expect(result.heapLimit.value).toBe(false);
				expect(result.heapLimit.code).toBe('timeout');
				expect(result.afterMemory).toMatchObject({
					value: true,
					output: 'after memory limit\n\n'
				});
			} finally {
				await context.close();
			}
		}
	);

	it(
		'runs the unchanged default through the actual selector, Run and terminal input',
		{ timeout: 180_000, meta: browserMeta },
		async () => {
			const context = await browser.newContext();
			await addBrowserTestCookies(context, server.browserUrl);
			await disableBrowserPrewarm(context);
			const page = await context.newPage();
			page.setDefaultTimeout(60_000);
			const requests: string[] = [];
			context.on('request', (request) => {
				if (new URL(request.url()).pathname.includes('/wasm-apl/'))
					requests.push(request.url());
			});
			try {
				await page.goto(server.browserUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForFunction(isStdinEditorReady, '');
				await page.waitForFunction(() => crossOriginIsolated);
				expect(requests).toEqual([]);
				await page.locator('#language-select').selectOption('APL');
				await page.waitForFunction(isStdinEditorReady, 'APL');
				await page.waitForFunction(
					(source) => (window as any).__wasmIdleDebug.getEditorValue() === source,
					editorDefaults.apl
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
					await (window as any).__wasmIdleDebug.writeTerminalInput(
						'hello APL 한글\n',
						false
					);
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
				await page.waitForFunction((id) => {
					const state = (window as any).__wasmIdleDebug.getExecutionState();
					return state.id > id && state.endedAt !== null;
				}, previousId);
				expect(
					await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
				).toMatchObject({
					language: 'APL',
					status: 'completed',
					exitCode: 0
				});
				expect(
					(
						await page.locator('[data-testid="terminal-debug-output"]').textContent()
					)?.replaceAll('\r', '')
				).toContain('hello APL 한글\n');
				expect(requests.length).toBeGreaterThan(0);
			} finally {
				await context.close();
			}
		}
	);
});
