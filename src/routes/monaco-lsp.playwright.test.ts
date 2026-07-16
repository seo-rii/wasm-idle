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
	statusKey?: string;
	knownFailure?: string;
	expectDiagnostics?: boolean;
	expectedResponses?: Array<string | RegExp>;
	assertNoPreEnableRequests?: Array<string | RegExp>;
	timeoutMs?: number;
}

interface MonacoDiagnosticCounts {
	dom: number;
	markers: number;
}

interface MonacoLspProgressEntry {
	progressVisible: boolean;
	progressValue: number | null;
	state: string;
	text: string;
}

interface MonacoTestStatus {
	state?: string;
	stage?: string;
	loaded?: number;
	total?: number;
	message?: string;
}

interface MonacoTestEditor {
	focus(): void;
	getModel?(): { uri: unknown } | null;
	getValue(): string;
	setValue(value: string): void;
}

interface MonacoTestGlobal {
	__wasmIdleMonacoApi?: {
		editor: {
			getModelMarkers(options?: { resource?: unknown }): Array<{
				owner?: string;
				message?: string;
				severity?: number;
				startLineNumber?: number;
				startColumn?: number;
			}>;
		};
	} | null;
	__wasmIdleMonacoEditor?: MonacoTestEditor | null;
	__wasmIdleMonacoLspStatus?: Record<string, MonacoTestStatus> | null;
	__wasmIdleMonacoLspTraffic?: {
		incoming: number;
		outgoing: number;
		methods: string[];
	} | null;
	__wasmIdleLspProgressObserver?: MutationObserver | null;
	__wasmIdleLspProgressRecord?: (() => void) | null;
	__wasmIdleLspProgressTrace?: MonacoLspProgressEntry[];
}

const bypassCookie = 'dev_bypass_waf=seorii_bypass_token_is_this';
const diagnosticSelector = '.squiggly-error, .squiggly-warning, .squiggly-info';
const browserTimeoutMs = Number(process.env.WASM_IDLE_LSP_BROWSER_TIMEOUT_MS || '180000');
const suiteTimeoutMs = Number(process.env.WASM_IDLE_LSP_BROWSER_SUITE_TIMEOUT_MS || '1800000');

const lspBrowserCases: LspBrowserCase[] = [
	{
		language: 'CPP',
		label: 'C++',
		fileName: 'main.cpp',
		source: '#include <bits/stdc++.h>\n\nint main() {\n    int n = "nope";\n    std::cout << n << "\\n";\n}\n',
		aliases: ['c++', 'cpp', 'clangd'],
		statusKey: 'clangd',
		timeoutMs: 240_000
	},
	{
		language: 'C',
		label: 'C',
		fileName: 'main.c',
		source: 'int main(void) {\n    int n = "nope";\n    return n;\n}\n',
		aliases: ['clang'],
		statusKey: 'clangd',
		timeoutMs: 240_000
	},
	{
		language: 'OBJC',
		label: 'Objective-C',
		fileName: 'main.m',
		source: '#import <Foundation/Foundation.h>\n\nint main(void) {\n    NSString *value = 42;\n    return value;\n}\n',
		aliases: ['objective-c', 'objectivec', 'objc'],
		statusKey: 'clangd',
		timeoutMs: 240_000
	},
	{
		language: 'GRAPHQL',
		label: 'GraphQL',
		fileName: 'main.graphql',
		source: 'query Broken {\n  hello(\n}\n',
		aliases: ['gql'],
		timeoutMs: 120_000
	},
	{
		language: 'DUCKDB',
		label: 'DuckDB',
		fileName: 'main.duckdb',
		source: 'SELECT FROM range(5);\n',
		timeoutMs: 240_000
	},
	{
		language: 'JSON',
		label: 'JSON',
		fileName: 'main.json',
		source: '{ "name": }\n',
		aliases: ['jsonc'],
		timeoutMs: 120_000
	},
	{
		language: 'YAML',
		label: 'YAML',
		fileName: 'main.yaml',
		source: 'items: [1\n',
		aliases: ['yml'],
		timeoutMs: 120_000
	},
	{
		language: 'TOML',
		label: 'TOML',
		fileName: 'main.toml',
		source: 'items = [1\n',
		timeoutMs: 120_000
	},
	{
		language: 'HTML',
		label: 'HTML',
		fileName: 'index.html',
		source: '<main><h1>Hello</main>\n',
		aliases: ['htm'],
		expectDiagnostics: false,
		timeoutMs: 120_000
	},
	{
		language: 'CSS',
		label: 'CSS',
		fileName: 'styles.css',
		source: '.main {\n  color: ;\n}\n',
		timeoutMs: 120_000
	},
	{
		language: 'MARKDOWN',
		label: 'Markdown',
		fileName: 'README.md',
		source: '# Intro\n\n[missing][ref]\n\n[link](#nope)\n',
		aliases: ['md'],
		timeoutMs: 120_000
	},
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
		source: '(module (func (result i32) i32.add))\n',
		timeoutMs: 90_000
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
		language: 'PASCAL',
		label: 'Pascal',
		fileName: 'main.pas',
		source: 'program Demo;\nbegin\n  UnknownThing;\nend.\n',
		aliases: ['pas', 'fpc'],
		timeoutMs: 180_000
	},
	{
		language: 'CSHARP',
		label: 'C#',
		fileName: 'Program.cs',
		source: 'using System;\n\nclass Program {\n    static void Main() {\n        int n = "nope";\n        Console.WriteLine(n);\n    }\n}\n',
		aliases: ['csharp', 'cs'],
		assertNoPreEnableRequests: ['/wasm-dotnet/runtime/csharp/'],
		timeoutMs: 240_000
	},
	{
		language: 'FSHARP',
		label: 'F#',
		fileName: 'Program.fsx',
		source: 'let value: int = "nope"\nprintfn "%d" value\n',
		aliases: ['fsharp', 'fs'],
		assertNoPreEnableRequests: ['/wasm-dotnet/runtime/fsharp/'],
		timeoutMs: 240_000
	},
	{
		language: 'VBNET',
		label: 'VB',
		fileName: 'Program.vb',
		source: 'Module Program\n    Sub Main()\n        Dim n As Integer =\n    End Sub\nEnd Module\n',
		aliases: ['vb', 'visualbasic'],
		assertNoPreEnableRequests: ['/wasm-dotnet/runtime/vbnet/'],
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
	},
	{
		language: 'FORTRAN',
		label: 'Fortran',
		fileName: 'main.f',
		source: 'program main\ninteger :: x\nx = "abc"\nend program main\n',
		aliases: ['f90', 'f95'],
		expectedResponses: ['/wasm-fortran/lfortran.wasm', '/wasm-fortran/lfortran.data'],
		timeoutMs: 300_000
	},
	{
		language: 'SQLITE',
		label: 'SQLite',
		fileName: 'main.sql',
		source: 'SELECT FROM numbers;\n',
		aliases: ['sql'],
		timeoutMs: 120_000
	},
	{
		language: 'PROLOG',
		label: 'Prolog',
		fileName: 'main.prolog',
		source: 'main :-\n  writeln(\n',
		aliases: ['swipl'],
		timeoutMs: 180_000
	},
	{
		language: 'RUBY',
		label: 'Ruby',
		fileName: 'main.rb',
		source: 'def main\n  puts(\n',
		aliases: ['rb'],
		timeoutMs: 240_000
	},
	{
		language: 'D',
		label: 'D',
		fileName: 'main.d',
		source: 'import std.stdio;\n\nvoid main() {\n    missing();\n}\n',
		timeoutMs: 300_000
	},
	{
		language: 'ELIXIR',
		label: 'Elixir',
		fileName: 'main.exs',
		source: 'defmodule Main do\n  def run, do: :ok\n',
		aliases: ['ex', 'exs'],
		timeoutMs: 240_000
	},
	{
		language: 'ERLANG',
		label: 'Erlang',
		fileName: 'main.erl',
		source: '-module(main).\n-export([main/0]).\nmain() ->\n',
		aliases: ['erl'],
		timeoutMs: 240_000
	},
	{
		language: 'TCL',
		label: 'Tcl',
		fileName: 'main.tcl',
		source: 'proc main {} {\n  set\n}\n',
		timeoutMs: 180_000
	},
	{
		language: 'JANET',
		label: 'Janet',
		fileName: 'main.janet',
		source: '(defn main []\n  (print 1)\n',
		timeoutMs: 180_000
	},
	{
		language: 'LISP',
		label: 'Scheme',
		fileName: 'main.scm',
		source: '(define (main)\n  (display 1)\n',
		aliases: ['scheme', 'scm'],
		timeoutMs: 180_000
	},
	{
		language: 'R',
		label: 'R',
		fileName: 'main.R',
		source: 'main <- function() {\n  print(\n',
		timeoutMs: 300_000
	},
	{
		language: 'OCTAVE',
		label: 'Octave',
		fileName: 'main.m',
		source: 'function y = main()\n  y = fgetl(stdin\nend\n',
		aliases: ['matlab'],
		timeoutMs: 480_000
	},
	{
		language: 'AWK',
		label: 'AWK',
		fileName: 'main.awk',
		source: 'function total(x) {\n  print(\n}\n',
		timeoutMs: 180_000
	},
	{
		language: 'PERL',
		label: 'Perl',
		fileName: 'main.pl',
		source: 'sub main {\n  print(\n}\n',
		aliases: ['pl'],
		timeoutMs: 180_000
	},
	{
		language: 'WASM',
		label: 'WebAssembly',
		fileName: 'main.wasm',
		source: 'base64:not-wasm',
		aliases: ['webassembly'],
		timeoutMs: 120_000
	}
];

const lspBrowserMatrixGroups = {
	'cpp-python': ['CPP', 'C', 'PYTHON'],
	document: ['JSON', 'YAML', 'TOML', 'HTML', 'CSS', 'MARKDOWN'],
	'runtime-small': ['ASSEMBLYSCRIPT', 'WAT', 'GO', 'GLEAM', 'PASCAL', 'LUA', 'PROLOG', 'RUBY'],
	'runtime-heavy': ['DUCKDB', 'RUST', 'ZIG', 'OCAML', 'HASKELL', 'FORTRAN'],
	'runtime-extra': [
		'OBJC',
		'D',
		'ELIXIR',
		'ERLANG',
		'TCL',
		'JANET',
		'LISP',
		'R',
		'OCTAVE',
		'AWK',
		'PERL',
		'WASM'
	],
	dotnet: ['CSHARP', 'FSHARP', 'VBNET']
} satisfies Record<string, string[]>;

const normalizeFilterToken = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '');

const filterTokensFor = (value: string) =>
	new Set(
		value
			.split(/[,\s]+/u)
			.map(normalizeFilterToken)
			.filter(Boolean)
	);

const urlMatches = (url: string, pattern: string | RegExp) =>
	typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url);

const requestLooksLspRelated = (url: string) =>
	/\/(?:lsp|pyodide|wasm-(?:dotnet|fortran|gleam|go|haskell|lua|of-js-of-ocaml|pascal|prolog|rust|typescript|wat|zig))\//u.test(
		url
	);

const lspStatusKeyByLanguage: Record<string, string> = {
	TYPESCRIPT: 'typescript',
	JAVASCRIPT: 'typescript',
	CPP: 'clangd',
	C: 'clangd',
	GRAPHQL: 'graphql',
	DUCKDB: 'duckdb',
	JSON: 'json',
	YAML: 'yaml',
	TOML: 'toml',
	HTML: 'html',
	CSS: 'css',
	MARKDOWN: 'markdown',
	PYTHON: 'python',
	ASSEMBLYSCRIPT: 'assemblyscript',
	WAT: 'wat',
	RUST: 'rust',
	GO: 'go',
	GLEAM: 'gleam',
	PASCAL: 'pascal',
	CSHARP: 'dotnet',
	FSHARP: 'dotnet',
	VBNET: 'dotnet',
	ZIG: 'zig',
	PHP: 'php',
	LUA: 'lua',
	OCAML: 'ocaml',
	HASKELL: 'haskell',
	FORTRAN: 'fortran',
	SQLITE: 'sql',
	PROLOG: 'prolog',
	RUBY: 'ruby'
};

const dotnetRuntimeLanguageByLanguage: Record<string, 'csharp' | 'fsharp' | 'vbnet'> = {
	CSHARP: 'csharp',
	FSHARP: 'fsharp',
	VBNET: 'vbnet'
};

const withLspTestQuery = (browserUrl: string) => {
	const url = new URL(browserUrl);
	url.searchParams.set('lsp-test', '1');
	return url.href;
};

const lspStatusKeyFor = (testCase: LspBrowserCase) =>
	testCase.statusKey ||
	lspStatusKeyByLanguage[testCase.language] ||
	normalizeFilterToken(testCase.language);

function selectedCases() {
	const rawFilter = process.env.WASM_IDLE_LSP_BROWSER_LANGUAGES || '';
	const rawGroups = process.env.WASM_IDLE_LSP_BROWSER_GROUPS || '';
	const includeKnownFailures = process.env.WASM_IDLE_LSP_BROWSER_INCLUDE_KNOWN_FAILURES === '1';
	const tokens = filterTokensFor(rawFilter);
	const groupTokens = filterTokensFor(rawGroups);
	if (!tokens.size && !groupTokens.size) {
		return includeKnownFailures
			? lspBrowserCases
			: lspBrowserCases.filter((testCase) => !testCase.knownFailure);
	}
	const selectedLanguages = new Set<string>();
	for (const [group, languages] of Object.entries(lspBrowserMatrixGroups)) {
		if (!groupTokens.has(normalizeFilterToken(group))) continue;
		for (const language of languages) selectedLanguages.add(language);
	}
	let cases = lspBrowserCases;
	if (groupTokens.size) {
		cases = cases.filter((testCase) => selectedLanguages.has(testCase.language));
		if (!tokens.size && !includeKnownFailures) {
			cases = cases.filter((testCase) => !testCase.knownFailure);
		}
	}
	if (tokens.size) {
		cases = cases.filter((testCase) => {
			const identifiers = [
				testCase.language,
				testCase.label,
				testCase.fileName,
				...(testCase.aliases || [])
			].map(normalizeFilterToken);
			return identifiers.some((identifier) => tokens.has(identifier));
		});
	}
	return cases;
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
	const testUrl = withLspTestQuery(browserUrl);
	for (let attempt = 0; attempt < 5; attempt += 1) {
		await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
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

async function installLspProgressProbe(page: Page) {
	await page.evaluate(() => {
		const testGlobal = globalThis as typeof globalThis & MonacoTestGlobal;
		testGlobal.__wasmIdleLspProgressObserver?.disconnect();
		testGlobal.__wasmIdleLspProgressTrace = [];
		const record = () => {
			const status = document.querySelector('[data-lsp-state]') as HTMLElement | null;
			if (!status) return;
			const progress = status.querySelector('[role="progressbar"]') as HTMLElement | null;
			const rawValue = progress?.getAttribute('aria-valuenow');
			const entry: MonacoLspProgressEntry = {
				progressVisible: Boolean(progress),
				progressValue: rawValue === null || rawValue === undefined ? null : Number(rawValue),
				state: status.dataset.lspState || '',
				text: status.textContent?.trim() || ''
			};
			const trace = testGlobal.__wasmIdleLspProgressTrace || [];
			const previous = trace.at(-1);
			if (
				!previous ||
				previous.progressVisible !== entry.progressVisible ||
				previous.progressValue !== entry.progressValue ||
				previous.state !== entry.state ||
				previous.text !== entry.text
			) {
				trace.push(entry);
			}
			testGlobal.__wasmIdleLspProgressTrace = trace;
		};
		const observer = new MutationObserver(record);
		observer.observe(document.body, {
			attributes: true,
			attributeFilter: ['aria-valuenow', 'data-lsp-state'],
			childList: true,
			characterData: true,
			subtree: true
		});
		testGlobal.__wasmIdleLspProgressObserver = observer;
		testGlobal.__wasmIdleLspProgressRecord = record;
		record();
	});
}

async function readAndStopLspProgressProbe(page: Page) {
	return await page.evaluate(() => {
		const testGlobal = globalThis as typeof globalThis & MonacoTestGlobal;
		testGlobal.__wasmIdleLspProgressRecord?.();
		testGlobal.__wasmIdleLspProgressObserver?.disconnect();
		return testGlobal.__wasmIdleLspProgressTrace || [];
	});
}

async function replaceEditorSource(page: Page, source: string) {
	await page.waitForFunction(() => {
		const testGlobal = globalThis as typeof globalThis & MonacoTestGlobal;
		return !!testGlobal.__wasmIdleMonacoEditor;
	});
	await page.evaluate((nextSource) => {
		const testGlobal = globalThis as typeof globalThis & MonacoTestGlobal;
		const editor = testGlobal.__wasmIdleMonacoEditor;
		if (!editor) throw new Error('Monaco editor test hook was not installed');
		editor.setValue(nextSource);
		editor.focus();
	}, source);
	await page.waitForFunction((nextSource) => {
		const testGlobal = globalThis as typeof globalThis & MonacoTestGlobal;
		return testGlobal.__wasmIdleMonacoEditor?.getValue() === nextSource;
	}, source);
}

async function waitForLspReady(page: Page, testCase: LspBrowserCase) {
	await page.waitForFunction(
		(statusKey) => {
			const testGlobal = globalThis as typeof globalThis & MonacoTestGlobal;
			return testGlobal.__wasmIdleMonacoLspStatus?.[statusKey]?.state === 'ready';
		},
		lspStatusKeyFor(testCase),
		{ timeout: testCase.timeoutMs ?? browserTimeoutMs }
	);
}

async function waitForVisibleLspStatus(page: Page) {
	await page.waitForFunction(
		() => {
			const status = document.querySelector('[data-lsp-state]') as HTMLElement | null;
			const state = status?.dataset.lspState || '';
			return Boolean(
				status &&
				/^(loading|ready|error)$/u.test(state) &&
				status.textContent?.includes('LSP')
			);
		},
		undefined,
		{ timeout: 10_000 }
	);
}

async function readDiagnosticCounts(page: Page): Promise<MonacoDiagnosticCounts> {
	return await page.evaluate((selector) => {
		const testGlobal = globalThis as typeof globalThis & MonacoTestGlobal;
		const model = testGlobal.__wasmIdleMonacoEditor?.getModel?.() || null;
		const markers =
			testGlobal.__wasmIdleMonacoApi && model
				? testGlobal.__wasmIdleMonacoApi.editor.getModelMarkers({
						resource: model.uri
					}).length
				: 0;
		return {
			dom: document.querySelectorAll(selector).length,
			markers
		};
	}, diagnosticSelector);
}

async function waitForDiagnostics(page: Page, testCase: LspBrowserCase) {
	await page.waitForFunction(
		(selector) => {
			const testGlobal = globalThis as typeof globalThis & MonacoTestGlobal;
			const model = testGlobal.__wasmIdleMonacoEditor?.getModel?.() || null;
			const markers =
				testGlobal.__wasmIdleMonacoApi && model
					? testGlobal.__wasmIdleMonacoApi.editor.getModelMarkers({
							resource: model.uri
						}).length
					: 0;
			return document.querySelectorAll(selector).length > 0 || markers > 0;
		},
		diagnosticSelector,
		{ timeout: testCase.timeoutMs ?? browserTimeoutMs }
	);
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
	await installLspProgressProbe(page);
	await enableLsp(page);
	await waitForVisibleLspStatus(page);
	await waitForLspReady(page, testCase);
	const progressTrace = await readAndStopLspProgressProbe(page);
	expect(
		progressTrace.some(
			(entry) => entry.state === 'loading' && entry.progressVisible && entry.text.includes('LSP')
		)
	).toBe(true);
	expect(progressTrace.some((entry) => entry.state === 'ready')).toBe(true);
	for (const entry of progressTrace) {
		if (entry.progressValue === null) continue;
		expect(Number.isFinite(entry.progressValue)).toBe(true);
		expect(entry.progressValue).toBeGreaterThanOrEqual(0);
		expect(entry.progressValue).toBeLessThanOrEqual(100);
	}
	await replaceEditorSource(page, testCase.source);

	for (const response of await Promise.all(expectedResponses)) {
		if (response instanceof Error) throw response;
	}

	if (testCase.expectDiagnostics !== false) {
		await waitForDiagnostics(page, testCase);
	}
	const diagnostics = await readDiagnosticCounts(page);
	if (testCase.expectDiagnostics === false) {
		expect(diagnostics.dom + diagnostics.markers).toBe(0);
	} else {
		expect(diagnostics.dom + diagnostics.markers).toBeGreaterThan(0);
	}
	const selectedDotnetRuntime = dotnetRuntimeLanguageByLanguage[testCase.language];
	if (selectedDotnetRuntime) {
		expect(
			lspRequests.some((request) =>
				request.includes(`/wasm-dotnet/runtime/${selectedDotnetRuntime}/`)
			)
		).toBe(true);
		for (const language of ['csharp', 'fsharp', 'vbnet'] as const) {
			if (language === selectedDotnetRuntime) continue;
			expect(
				lspRequests.some((request) =>
					request.includes(`/wasm-dotnet/runtime/${language}/`)
				)
			).toBe(false);
		}
	}
}

async function collectPageDebugInfo(page: Page) {
	return await page.evaluate((selector) => {
		const languageSelect = document.querySelector(
			'#language-select'
		) as HTMLSelectElement | null;
		const lspToggle = document.querySelector('#lsp-toggle') as HTMLInputElement | null;
		const squiggles = Array.from(document.querySelectorAll('[class*="squiggly"]'))
			.slice(0, 20)
			.map((element) => ({
				className: element.className,
				text: element.textContent?.slice(0, 80) || ''
			}));
		const testGlobal = globalThis as typeof globalThis & MonacoTestGlobal;
		const model = testGlobal.__wasmIdleMonacoEditor?.getModel?.() || null;
		const markers =
			testGlobal.__wasmIdleMonacoApi && model
				? testGlobal.__wasmIdleMonacoApi.editor
						.getModelMarkers({ resource: model.uri })
						.slice(0, 20)
						.map((marker) => ({
							owner: marker.owner,
							message: marker.message?.slice(0, 120) || '',
							severity: marker.severity,
							startLineNumber: marker.startLineNumber,
							startColumn: marker.startColumn
						}))
				: [];
		const resources = performance
			.getEntriesByType('resource')
			.map((entry) => entry.name)
			.filter((name) => /(?:lsp|wat|wabt|worker|_app\/immutable)/u.test(name))
			.slice(-80);
		const viewText = Array.from(document.querySelectorAll('.view-lines .view-line'))
			.map((element) => element.textContent || '')
			.join('\n')
			.slice(0, 500);
		return [
			`language=${languageSelect?.value || '<missing>'}`,
			`lspChecked=${String(Boolean(lspToggle?.checked))}`,
			`diagnostics=${document.querySelectorAll(selector).length}`,
			`lspStatus=${JSON.stringify(testGlobal.__wasmIdleMonacoLspStatus || null)}`,
			`lspTraffic=${JSON.stringify(testGlobal.__wasmIdleMonacoLspTraffic || null)}`,
			`markers=${JSON.stringify(markers)}`,
			`viewText=${JSON.stringify(viewText)}`,
			`squiggles=${JSON.stringify(squiggles)}`,
			`resources=${JSON.stringify(resources)}`
		];
	}, diagnosticSelector);
}

describe('Monaco LSP browser integration', () => {
	it('selects browser LSP cases by named matrix group', () => {
		const previousLanguages = process.env.WASM_IDLE_LSP_BROWSER_LANGUAGES;
		const previousGroups = process.env.WASM_IDLE_LSP_BROWSER_GROUPS;
		const previousKnownFailures = process.env.WASM_IDLE_LSP_BROWSER_INCLUDE_KNOWN_FAILURES;
		try {
			delete process.env.WASM_IDLE_LSP_BROWSER_LANGUAGES;
			delete process.env.WASM_IDLE_LSP_BROWSER_INCLUDE_KNOWN_FAILURES;
			process.env.WASM_IDLE_LSP_BROWSER_GROUPS = 'cpp-python';
			expect(selectedCases().map((testCase) => testCase.language)).toEqual([
				'CPP',
				'C',
				'PYTHON'
			]);

			process.env.WASM_IDLE_LSP_BROWSER_GROUPS = 'document';
			expect(selectedCases().map((testCase) => testCase.language)).toEqual([
				'JSON',
				'YAML',
				'TOML',
				'HTML',
				'CSS',
				'MARKDOWN'
			]);

			process.env.WASM_IDLE_LSP_BROWSER_GROUPS = 'runtime-small';
			expect(selectedCases().map((testCase) => testCase.language)).toContain('PASCAL');

			process.env.WASM_IDLE_LSP_BROWSER_GROUPS = 'runtime-heavy';
			expect(selectedCases().map((testCase) => testCase.language)).toEqual([
				'DUCKDB',
				'RUST',
				'ZIG',
				'OCAML',
				'HASKELL',
				'FORTRAN'
			]);

			process.env.WASM_IDLE_LSP_BROWSER_GROUPS = 'runtime-extra';
			expect(selectedCases().map((testCase) => testCase.language)).toEqual([
				'OBJC',
				'D',
				'ELIXIR',
				'ERLANG',
				'TCL',
				'JANET',
				'LISP',
				'R',
				'OCTAVE',
				'AWK',
				'PERL',
				'WASM'
			]);

			process.env.WASM_IDLE_LSP_BROWSER_GROUPS = 'dotnet';
			expect(selectedCases().map((testCase) => testCase.language)).toEqual([
				'CSHARP',
				'FSHARP',
				'VBNET'
			]);
		} finally {
			if (previousLanguages === undefined) {
				delete process.env.WASM_IDLE_LSP_BROWSER_LANGUAGES;
			} else {
				process.env.WASM_IDLE_LSP_BROWSER_LANGUAGES = previousLanguages;
			}
			if (previousGroups === undefined) {
				delete process.env.WASM_IDLE_LSP_BROWSER_GROUPS;
			} else {
				process.env.WASM_IDLE_LSP_BROWSER_GROUPS = previousGroups;
			}
			if (previousKnownFailures === undefined) {
				delete process.env.WASM_IDLE_LSP_BROWSER_INCLUDE_KNOWN_FAILURES;
			} else {
				process.env.WASM_IDLE_LSP_BROWSER_INCLUDE_KNOWN_FAILURES = previousKnownFailures;
			}
		}
	});

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
							const pageDebugInfo = await collectPageDebugInfo(page).catch(
								(debugError) => [
									`Failed to collect page debug info: ${
										debugError instanceof Error
											? debugError.message
											: String(debugError)
									}`
								]
							);
							throw new Error(
								[
									`Monaco LSP case failed: ${testCase.label} (${testCase.language})`,
									error instanceof Error ? error.message : String(error),
									'Page state:',
									...pageDebugInfo,
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
