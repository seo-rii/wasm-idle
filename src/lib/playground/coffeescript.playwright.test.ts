// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Page } from 'playwright-core';
import { addBrowserTestCookies } from '../../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../../scripts/browser-test-prewarm.mjs';
import {
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../../scripts/rust-browser-probe-lib.mjs';
import { isStdinEditorReady } from '../../../scripts/stdin-browser-probe-lib.mjs';
import { editorDefaults } from '../../routes/editor-defaults';

const enabled = process.env.WASM_IDLE_RUN_REAL_BROWSER_COFFEESCRIPT === '1';
const browserMeta = { browser: true, requiredBrowser: enabled };
const runTimeoutMs = 120_000;
let preview: ReturnType<typeof startBrowserPreviewServer> | undefined;
afterAll(async () => {
	await (await preview)?.close();
});

async function withBrowserPreview(action: (url: string) => Promise<void>) {
	await runWithBrowserProbeSessionLock(async () => {
		const configured = process.env.WASM_IDLE_BROWSER_URL || '';
		if (shouldReuseProvidedBrowserUrl(configured)) return await action(configured);
		preview ??= startBrowserPreviewServer({
			origin: 'http://localhost:4691',
			serverMode: 'dev'
		});
		await action((await preview).browserUrl);
	});
}

async function beginRun(page: Page, source: string) {
	const previousId = await page.evaluate(
		() => (window as any).__wasmIdleDebug.getExecutionState().id
	);
	await page.evaluate(async (code) => {
		if (!(await (window as any).__wasmIdleDebug.setEditorValue(code)))
			throw new Error('Editor rejected CoffeeScript source');
	}, source);
	await page.locator('button.action-button--run').click();
	await page.waitForFunction(
		(id) => (window as any).__wasmIdleDebug.getExecutionState().id > id,
		previousId
	);
}

async function runCoffeeScriptBrowserProbe(options: {
	browserUrl: string;
	source: string;
	stdinText: string;
	expectedOutput: string;
	waitForOutputBeforeStdin?: string;
	followUpRuns?: Array<{
		source: string;
		stdinText: string;
		expectedOutput: string;
		waitForOutputBeforeStdin?: string;
	}>;
}) {
	const browser = await chromium.launch({
		headless: true,
		executablePath: await resolveChromiumExecutable(
			process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
		)
	});
	const context = await browser.newContext();
	await addBrowserTestCookies(context, options.browserUrl);
	await disableBrowserPrewarm(context);
	await context.addInitScript(() =>
		localStorage.setItem(
			'wasm-idle:example-workspace:v3',
			JSON.stringify({ version: 6, files: [], lspEnabled: false, language: 'COFFEESCRIPT' })
		)
	);
	const page = await context.newPage();
	page.setDefaultTimeout(runTimeoutMs);
	const runtimeRequests: string[] = [];
	const transcripts: string[] = [];
	context.on('request', (request) => {
		if (/\/wasm-typescript\/(?:index|javascript|coffeescript)\.js/u.test(request.url()))
			runtimeRequests.push(request.url());
	});
	try {
		const url = new URL(options.browserUrl);
		url.searchParams.set('lang', 'coffeescript');
		await page.goto(url.href, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(isStdinEditorReady, '');
		await page.locator('#language-select').selectOption('COFFEESCRIPT');
		await page.waitForFunction(isStdinEditorReady, 'COFFEESCRIPT');
		expect(runtimeRequests).toEqual([]);
		for (const run of [options, ...(options.followUpRuns || [])]) {
			await beginRun(page, run.source);
			await page.waitForFunction(() => {
				const state = (window as any).__wasmIdleDebug.getExecutionState();
				return !['idle', 'preparing'].includes(state.status);
			});
			if ('waitForOutputBeforeStdin' in run && run.waitForOutputBeforeStdin) {
				await page.waitForFunction(
					(marker) =>
						document
							.querySelector('[data-testid="terminal-debug-output"]')
							?.textContent?.includes(marker),
					run.waitForOutputBeforeStdin
				);
			}
			if (run.stdinText) {
				await page.evaluate(async (text) => {
					await (window as any).__wasmIdleDebug.writeTerminalInput(text, false);
				}, run.stdinText);
				await page.waitForTimeout(100);
				await page.evaluate(async () => {
					await (window as any).__wasmIdleDebug.writeTerminalInput('', true);
				});
			}
			await page.waitForFunction(
				() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
			);
			expect(
				await page.evaluate(() => (window as any).__wasmIdleDebug.getExecutionState())
			).toMatchObject({ status: 'completed', exitCode: 0, language: 'COFFEESCRIPT' });
			expect(
				await page.locator('[data-testid="terminal-debug-output"]').textContent()
			).toContain(run.expectedOutput);
			transcripts.push(
				(await page.locator('[data-testid="terminal-debug-output"]').textContent()) || ''
			);
		}
		return {
			transcript: transcripts.join('\n'),
			runtimeRequests
		};
	} finally {
		await browser.close();
	}
}

describe.skipIf(!enabled)('real CoffeeScript browser execution', () => {
	it(
		'compiles fresh CoffeeScript and runs classes with delayed UTF-8 stdin, EOF and a second source',
		{ timeout: 300_000, meta: browserMeta },
		async () => {
			await withBrowserPreview(async (browserUrl) => {
				const summary = await runCoffeeScriptBrowserProbe({
					browserUrl,
					source: `fs = require 'fs'\nconsole.log 'ready-for-coffee'\nclass Sum\n  constructor: (@values) ->\n  total: -> @values.reduce ((a, b) -> a + b), 0\n[name, rest...] = fs.readFileSync(0, 'utf8').trim().split /\\s+/\nvalues = (Number x for x in rest)\nconsole.log "#{name}=#{new Sum(values).total()}"`,
					stdinText: '한글 1 2 3\n',
					expectedOutput: '한글=6',
					waitForOutputBeforeStdin: 'ready-for-coffee',
					followUpRuns: [
						{
							source: "console.log (n*n for n in [1..3]).join ','",
							stdinText: '',
							expectedOutput: '1,4,9'
						}
					]
				});
				expect(summary.transcript).toContain('한글=6');
				expect(
					summary.runtimeRequests.some((url) =>
						/wasm-typescript\/coffeescript\.js/u.test(url)
					)
				).toBe(true);
				expect(
					summary.runtimeRequests.some((url) =>
						/wasm-typescript\/(?:index|javascript)\.js/u.test(url)
					)
				).toBe(false);
			});
		}
	);
	it(
		'runs the default editor program through terminal stdin',
		{ timeout: 300_000, meta: browserMeta },
		async () => {
			await withBrowserPreview(async (browserUrl) => {
				const summary = await runCoffeeScriptBrowserProbe({
					browserUrl,
					source: editorDefaults.coffeescript,
					stdinText: '10\n',
					expectedOutput: 'fibonacci=55'
				});
				expect(summary.transcript).toContain('fibonacci=55');
			});
		}
	);
	it(
		'reports original compiler diagnostics and recovers after stopping an infinite program',
		{ timeout: 300_000, meta: browserMeta },
		async () => {
			await withBrowserPreview(async (browserUrl) => {
				const browser = await chromium.launch({
					headless: true,
					executablePath: await resolveChromiumExecutable(
						process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
					)
				});
				const context = await browser.newContext();
				await addBrowserTestCookies(context, browserUrl);
				await disableBrowserPrewarm(context);
				await context.addInitScript(() =>
					localStorage.setItem(
						'wasm-idle:example-workspace:v3',
						JSON.stringify({
							version: 6,
							files: [],
							lspEnabled: false,
							language: 'COFFEESCRIPT'
						})
					)
				);
				const page = await context.newPage();
				page.setDefaultTimeout(runTimeoutMs);
				try {
					const url = new URL(browserUrl);
					url.searchParams.set('lsp-test', '1');
					await page.goto(url.href, { waitUntil: 'domcontentloaded' });
					await page.waitForFunction(isStdinEditorReady, 'COFFEESCRIPT');
					await beginRun(page, 'value = 1\nvalue = )');
					await page.waitForFunction(
						() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
					);
					expect(
						await page.evaluate(
							() => (window as any).__wasmIdleDebug.getExecutionState().status
						)
					).toBe('failed');
					expect(
						await page.locator('[data-testid="terminal-debug-output"]').textContent()
					).toContain('unmatched )');
					await beginRun(page, 'console.log "coffee-loop-started"\nloop\n  continue');
					await page.waitForFunction(() =>
						document
							.querySelector('[data-testid="terminal-debug-output"]')
							?.textContent?.includes('coffee-loop-started')
					);
					await page.locator('button.action-button--stop').first().click();
					await page.waitForFunction(
						() =>
							(window as any).__wasmIdleDebug.getExecutionState().status ===
							'cancelled'
					);
					await beginRun(page, 'console.log "coffee-recovered"');
					await page.waitForFunction(
						() => (window as any).__wasmIdleDebug.getExecutionState().endedAt !== null
					);
					expect(
						await page.evaluate(
							() => (window as any).__wasmIdleDebug.getExecutionState().status
						)
					).toBe('completed');
					expect(
						await page.locator('[data-testid="terminal-debug-output"]').textContent()
					).toContain('coffee-recovered');
				} finally {
					await browser.close();
				}
			});
		}
	);
});
