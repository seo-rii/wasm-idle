// @vitest-environment node

import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';

interface LspBrowserCase {
	language: string;
	label: string;
	fileName: string;
	source: string;
	aliases?: string[];
	expectedResponses?: Array<string | RegExp>;
	assertNoPreEnableRequests?: Array<string | RegExp>;
	timeoutMs?: number;
}

const bypassCookie = 'dev_bypass_waf=seorii_bypass_token_is_this';
const diagnosticSelector = '.squiggly-error, .squiggly-warning, .squiggly-info';
const browserTimeoutMs = Number(process.env.WASM_IDLE_LSP_BROWSER_TIMEOUT_MS || '180000');
const suiteTimeoutMs = Number(process.env.WASM_IDLE_LSP_BROWSER_SUITE_TIMEOUT_MS || '1800000');

const lspBrowserCases = [
	{
		language: 'TYPESCRIPT',
		label: 'TypeScript',
		fileName: 'main.ts',
		source: 'const n: number = "not a number";\nconsole.log(n);\n',
		aliases: ['ts'],
		expectedResponses: ['/lsp/typescript-libs.json.gz'],
		assertNoPreEnableRequests: ['/lsp/typescript-libs.json.gz']
	},
	{
		language: 'JAVASCRIPT',
		label: 'JavaScript',
		fileName: 'main.js',
		source: 'const value = ;\nconsole.log(value);\n',
		aliases: ['js']
	},
	{
		language: 'PYTHON',
		label: 'Python',
		fileName: 'main.py',
		source: 'def broken(:\n    pass\n',
		aliases: ['py'],
		timeoutMs: 240_000
	},
	{
		language: 'ASSEMBLYSCRIPT',
		label: 'AssemblyScript',
		fileName: 'main.as.ts',
		source: 'export function main(): i32 {\n  return missing;\n}\n',
		aliases: ['as']
	},
	{
		language: 'WAT',
		label: 'WAT',
		fileName: 'main.wat',
		source: '(module\n  (func (export "main")\n'
	},
	{
		language: 'RUST',
		label: 'Rust',
		fileName: 'main.rs',
		source: 'fn main() {\n    let n: i32 = "nope";\n    println!("{n}");\n}\n',
		aliases: ['rs']
	},
	{
		language: 'GO',
		label: 'Go',
		fileName: 'main.go',
		source: 'package main\n\nfunc main() {\n\tvar n int = "nope"\n\t_ = n\n}\n'
	},
	{
		language: 'GLEAM',
		label: 'Gleam',
		fileName: 'main.gleam',
		source: 'pub fn main() {\n  1 +\n}\n'
	},
	{
		language: 'CSHARP',
		label: 'C#',
		fileName: 'Program.cs',
		source: 'using System;\n\nclass Program {\n    static void Main() {\n        int n = "nope";\n        Console.WriteLine(n);\n    }\n}\n',
		aliases: ['csharp', 'cs'],
		timeoutMs: 240_000
	},
	{
		language: 'FSHARP',
		label: 'F#',
		fileName: 'Program.fsx',
		source: 'let value: int = "nope"\nprintfn "%d" value\n',
		aliases: ['fsharp', 'fs'],
		timeoutMs: 240_000
	},
	{
		language: 'VBNET',
		label: 'VB',
		fileName: 'Program.vb',
		source: 'Module Program\n    Sub Main()\n        Dim n As Integer =\n    End Sub\nEnd Module\n',
		aliases: ['vb', 'visualbasic'],
		timeoutMs: 240_000
	},
	{
		language: 'ZIG',
		label: 'Zig',
		fileName: 'main.zig',
		source: 'pub fn main() void {\n    const n: i32 = "nope";\n    _ = n;\n}\n',
		timeoutMs: 240_000
	},
	{
		language: 'PHP',
		label: 'PHP',
		fileName: 'main.php',
		source: '<?php\nfunction main() {\n    echo "hello";\n'
	},
	{
		language: 'LUA',
		label: 'Lua',
		fileName: 'main.lua',
		source: 'local value = 1\nprint(value + )\n',
		timeoutMs: 240_000
	},
	{
		language: 'OCAML',
		label: 'OCaml',
		fileName: 'main.ml',
		source: 'let value : int =\n  "hello"\n',
		aliases: ['ml'],
		timeoutMs: 240_000
	},
	{
		language: 'HASKELL',
		label: 'Haskell',
		fileName: 'main.hs',
		source: 'main :: IO ()\nmain = print missing\n',
		aliases: ['hs'],
		timeoutMs: 300_000
	}
] satisfies LspBrowserCase[];

const normalizeFilterToken = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '');

const urlMatches = (url: string, pattern: string | RegExp) =>
	typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url);

const requestLooksLspRelated = (url: string) =>
	/\/(?:lsp|pyodide|wasm-(?:dotnet|gleam|go|haskell|lua|of-js-of-ocaml|rust|typescript|wat|zig))\//u.test(
		url
	);

function selectedCases() {
	const rawFilter = process.env.WASM_IDLE_LSP_BROWSER_LANGUAGES || '';
	const tokens = new Set(
		rawFilter
			.split(/[,\s]+/u)
			.map(normalizeFilterToken)
			.filter(Boolean)
	);
	if (!tokens.size) return lspBrowserCases;
	return lspBrowserCases.filter((testCase) => {
		const identifiers = [
			testCase.language,
			testCase.label,
			testCase.fileName,
			...(testCase.aliases || [])
		].map(normalizeFilterToken);
		return identifiers.some((identifier) => tokens.has(identifier));
	});
}

async function prepareBrowserContext(context: BrowserContext, browserUrl: string) {
	await context.addCookies([
		{
			name: 'dev_bypass_waf',
			value: 'seorii_bypass_token_is_this',
			url: new URL(browserUrl).origin
		}
	]);
	await context.setExtraHTTPHeaders({ Cookie: bypassCookie });
	await context.addInitScript(() => {
		try {
			for (const key of [
				'wasm-idle:example-workspace:v3',
				'code',
				'language',
				'argsInput',
				'rustTargetTriple',
				'goTarget',
				'tinygoTarget',
				'ocamlBackend',
				'ocamlWasmBinaryenMode'
			]) {
				localStorage.removeItem(key);
			}
		} catch {
			// Ignore storage access failures in sandboxed browser contexts.
		}
	});
}

async function waitForPreparedPage(page: Page, browserUrl: string) {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		await page.goto(browserUrl, { waitUntil: 'domcontentloaded' });
		const ready = await page
			.evaluate(
				() =>
					crossOriginIsolated &&
					typeof SharedArrayBuffer !== 'undefined' &&
					!!navigator.serviceWorker?.controller
			)
			.catch(() => false);
		if (ready) {
			await page.locator('#language-select').waitFor();
			return;
		}
		await page
			.evaluate(async () => {
				if (!navigator.serviceWorker) return;
				await Promise.race([
					navigator.serviceWorker.ready,
					new Promise((resolve) => setTimeout(resolve, 1_500))
				]);
			})
			.catch(() => {});
		await page.waitForTimeout(1_500 + attempt * 500);
	}
	throw new Error('Browser page did not become cross-origin isolated with a service worker');
}

async function selectLanguage(page: Page, testCase: LspBrowserCase) {
	await page.locator('#language-select').selectOption(testCase.language);
	await page.waitForFunction(
		(language) =>
			(document.querySelector('#language-select') as HTMLSelectElement | null)?.value ===
			language,
		testCase.language
	);
	await page.waitForFunction(
		(fileName) =>
			Array.from(document.querySelectorAll('.file-tabs button')).some((button) =>
				button.textContent?.includes(fileName)
			),
		testCase.fileName
	);
	await page.locator('.monaco-editor textarea').waitFor();
}

async function enableLsp(page: Page) {
	const toggle = page.locator('#lsp-toggle');
	if (!(await toggle.isChecked())) {
		await toggle.check();
	}
}

async function replaceEditorSource(page: Page, source: string) {
	await page.locator('.monaco-editor').click({
		force: true,
		position: { x: 180, y: 80 }
	});
	await page.keyboard.press('Control+A');
	await page.keyboard.insertText(source);
}

async function runLspCase(
	page: Page,
	browserUrl: string,
	testCase: LspBrowserCase,
	lspRequests: string[]
) {
	page.setDefaultTimeout(testCase.timeoutMs ?? browserTimeoutMs);
	page.on('request', (request) => {
		const url = request.url();
		if (requestLooksLspRelated(url)) lspRequests.push(`> ${request.method()} ${url}`);
	});
	page.on('response', (response) => {
		const url = response.url();
		if (requestLooksLspRelated(url)) lspRequests.push(`< ${response.status()} ${url}`);
	});

	await waitForPreparedPage(page, browserUrl);
	await selectLanguage(page, testCase);
	await page
		.waitForFunction(
			(selector) => document.querySelectorAll(selector).length === 0,
			diagnosticSelector,
			{ timeout: 10_000 }
		)
		.catch(() => {});

	for (const pattern of testCase.assertNoPreEnableRequests || []) {
		expect(lspRequests.some((request) => urlMatches(request, pattern))).toBe(false);
	}

	const expectedResponses = (testCase.expectedResponses || []).map((pattern) =>
		page
			.waitForResponse(
				(response) => response.status() === 200 && urlMatches(response.url(), pattern),
				{ timeout: testCase.timeoutMs ?? browserTimeoutMs }
			)
			.catch((error: unknown) => error)
	);
	await enableLsp(page);
	await replaceEditorSource(page, testCase.source);

	for (const response of await Promise.all(expectedResponses)) {
		if (response instanceof Error) throw response;
	}

	await page.waitForFunction(
		(selector) => document.querySelectorAll(selector).length > 0,
		diagnosticSelector,
		{ timeout: testCase.timeoutMs ?? browserTimeoutMs }
	);
	expect(await page.locator(diagnosticSelector).count()).toBeGreaterThan(0);
}

describe('Monaco LSP browser integration', () => {
	it(
		'renders browser diagnostics for the Monaco LSP matrix',
		async () => {
			if (process.env.WASM_IDLE_RUN_REAL_BROWSER_LSP !== '1') {
				return;
			}

			const cases = selectedCases();
			if (!cases.length) {
				throw new Error(
					`No Monaco LSP cases matched WASM_IDLE_LSP_BROWSER_LANGUAGES=${JSON.stringify(
						process.env.WASM_IDLE_LSP_BROWSER_LANGUAGES
					)}`
				);
			}

			await runWithBrowserProbeSessionLock(async () => {
				const configuredBrowserUrl = process.env.WASM_IDLE_BROWSER_URL || '';
				const serverMode =
					process.env.WASM_IDLE_BROWSER_SERVER_MODE === 'dev' ? 'dev' : 'preview';
				const reuseProvidedBrowserUrl = shouldReuseProvidedBrowserUrl(configuredBrowserUrl);
				if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
					await runBrowserPreparationScripts(['build:preview']);
				}
				const previewServer = reuseProvidedBrowserUrl
					? {
							origin: new URL(configuredBrowserUrl).origin,
							browserUrl: configuredBrowserUrl,
							close: async () => {}
						}
					: await startBrowserPreviewServer(
							configuredBrowserUrl
								? {
										origin: new URL(configuredBrowserUrl).origin,
										basePath: new URL(configuredBrowserUrl).pathname,
										serverMode
									}
								: { origin: 'http://localhost:4593', serverMode }
						);
				const browser = await chromium.launch({
					headless: true,
					executablePath: await resolveChromiumExecutable(
						process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
					)
				});
				const context = await browser.newContext();
				await prepareBrowserContext(context, previewServer.browserUrl);

				try {
					for (const testCase of cases) {
						const page = await context.newPage();
						const consoleMessages: string[] = [];
						const pageErrors: string[] = [];
						let lspRequests: string[] = [];
						page.on('console', (message) => {
							consoleMessages.push(`[${message.type()}] ${message.text()}`);
						});
						page.on('pageerror', (error) => {
							pageErrors.push(error.stack || error.message);
						});

						try {
							await runLspCase(page, previewServer.browserUrl, testCase, lspRequests);
						} catch (error) {
							throw new Error(
								[
									`Monaco LSP case failed: ${testCase.label} (${testCase.language})`,
									error instanceof Error ? error.message : String(error),
									'LSP requests:',
									...lspRequests.slice(-120),
									'Console:',
									...consoleMessages.slice(-80),
									'Page errors:',
									...pageErrors.slice(-20)
								].join('\n')
							);
						} finally {
							await page.close();
						}
					}
				} finally {
					await browser.close();
					await previewServer.close();
				}
			});
		},
		suiteTimeoutMs
	);
});
