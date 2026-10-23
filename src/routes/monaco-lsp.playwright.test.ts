// @vitest-environment node

import { nimInvalidSource, nimValidSource } from '../../packages/lsp/test/fixtures/nim-protocol.js';

import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';
import { disableBrowserPrewarm } from '../../scripts/browser-test-prewarm.mjs';
import {
	waitForEditorWorkspace,
	waitForSelectedEditorModel
} from '../../scripts/browser-editor-readiness.mjs';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { cobolFixtureFiles } from '../../packages/lsp/test/fixtures/cobol-protocol.js';

import {
	runBrowserPreparationScripts,
	runWithBrowserProbeSessionLock,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';
import { resolveChromiumExecutable } from '../../scripts/rust-browser-probe-lib.mjs';
import {
	RUBY_RUNTIME_BUNDLE,
	RUBY_RUNTIME_MANIFEST_PATH,
	RUBY_RUNTIME_MODULE_STORAGE_PATH,
	RUBY_RUNTIME_WASM_STORAGE_PATH
} from '@wasm-idle/core';
// Collection precedes the browser build that creates the SDK output.
import { WASM_LEAN4_PROFILE } from '../../packages/lsp/src/bundledLean4Runtime';
import { WASM_RUST_EXECUTABLE_GRAPH_PROFILE } from '$lib/playground/wasmRustVersion';
import { JAVA_LANGUAGE_SERVER_ASSETS } from '../../packages/lsp/src/java/assets';

interface LspBrowserCase {
	language: string;
	label: string;
	fileName: string;
	source: string;
	aliases?: string[];
	statusKey?: string;
	knownFailure?: string;
	expectDiagnostics?: boolean;
	validSource?: string;
	errorLine?: number;
	minimumMarkerSeverity?: number;
	workspaceFiles?: Array<{ path: string; content: string }>;
	expectedResponses?: Array<string | RegExp>;
	assertNoPreEnableRequests?: Array<string | RegExp>;
	expectedRequestPathnames?: string[];
	forbiddenRequestPathnames?: string[];
	requestPathMarker?: string;
	requireSha256RequestPins?: boolean;
	allowAdditionalRequestPathnames?: boolean;
	expectedRequestSha256Pins?: Readonly<Record<string, string>>;
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
	setPosition(position: { lineNumber: number; column: number }): void;
	trigger(source: string, action: string, args: unknown): void;
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

const diagnosticSelector = '.squiggly-error, .squiggly-warning, .squiggly-info';
const browserTimeoutMs = Number(process.env.WASM_IDLE_LSP_BROWSER_TIMEOUT_MS || '180000');
const suiteTimeoutMs = Number(process.env.WASM_IDLE_LSP_BROWSER_SUITE_TIMEOUT_MS || '1800000');
const rustExecutableGraphModules = Object.entries(WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules);
const rustExecutableStoragePathnames = rustExecutableGraphModules.map(
	([, module]) => `/wasm-rust/${module.delivery.storagePath}`
);
const rustExecutableStoragePins = Object.fromEntries(
	rustExecutableGraphModules.map(([, module]) => [
		`/wasm-rust/${module.delivery.storagePath}`,
		module.storage.sha256
	])
);
const rustExecutableForbiddenPathnames = rustExecutableGraphModules.flatMap(([modulePath]) => [
	`/wasm-rust/${modulePath}`,
	`/wasm-rust/${modulePath}.gz`
]);

const javaHelperSource = 'public class Helper {\n  public static int VALUE = 42;\n}\n';
const javaValidSource =
	'public class Main {\n  public static void main(String[] args) {\n    int answer = 42;\n    System.out.println(answer + args.length);\n    int shared = Helper.VALUE;\n    System.out.println(shared);\n  }\n}\n';

const lspBrowserCases: LspBrowserCase[] = [
	{
		language: 'JAVA',
		label: 'Java',
		fileName: 'Main.java',
		source: 'public class Main {\n  public static void main(String[] args) {\n    String answer = 42;\n    System.out.println(answer + args.length);\n    int shared = Helper.VALUE;\n    System.out.println(shared);\n  }\n}\n',
		validSource: javaValidSource,
		errorLine: 3,
		workspaceFiles: [{ path: 'Helper.java', content: javaHelperSource }],
		statusKey: 'java',
		assertNoPreEnableRequests: ['/wasm-java-lsp/'],
		expectedRequestPathnames: JAVA_LANGUAGE_SERVER_ASSETS.map(
			(asset) => `/wasm-java-lsp/${asset.path}`
		),
		expectedRequestSha256Pins: Object.fromEntries(
			JAVA_LANGUAGE_SERVER_ASSETS.map((asset) => [
				`/wasm-java-lsp/${asset.path}`,
				asset.sha256
			])
		),
		requestPathMarker: '/wasm-java-lsp/',
		timeoutMs: 180_000
	},
	{
		language: 'PHP',
		label: 'PHP',
		fileName: 'main.php',
		source: '<?php\nclass Greeter { public function hello(string $name): string { return $name; } }\n$g = new Greeter();\n$g->hello("world");\n',
		expectDiagnostics: false,
		expectedResponses: ['/wasm-phpantom-lsp/phpantom_lsp.wasm'],
		assertNoPreEnableRequests: ['/wasm-phpantom-lsp/']
	},
	{
		language: 'FORTH',
		label: 'Forth',
		fileName: 'main.fth',
		source: ': square ( n -- n ) dup * ;\n5 not-defined . cr\n',
		expectedResponses: ['/wasm-forth-lsp/forth_lsp.wasm'],
		assertNoPreEnableRequests: ['/wasm-forth-lsp/']
	},
	{
		language: 'C3',
		label: 'C3',
		fileName: 'main.c3',
		source: 'module main;\nfn void main() { \\ }\n',
		expectedResponses: [
			'/wasm-c3-lsp/c3_lsp.mjs',
			'/wasm-c3-lsp/c3_lsp.wasm',
			'/wasm-c3-lsp/stdlib.json.gz.bin'
		],
		assertNoPreEnableRequests: ['/wasm-c3-lsp/']
	},
	{
		language: 'RESCRIPT',
		label: 'ReScript',
		fileName: 'Main.res',
		source: 'let answer: int = "text"\n',
		validSource: 'let answer: int = 42\n',
		errorLine: 1,
		aliases: ['rescript'],
		expectedResponses: [
			'/wasm-rescript-lsp/runtime.mjs.gz.bin',
			'/wasm-rescript-lsp/stdlib.pack.gz.bin'
		],
		assertNoPreEnableRequests: ['/wasm-rescript-lsp/'],
		timeoutMs: 120_000
	},
	{
		language: 'V',
		label: 'V',
		fileName: 'main.v',
		statusKey: 'v',
		source: 'module main\n// Squares an integer.\nfn square(value int) int {\n return value * value\n}\nfn main() {\n n := square(5)\n println(n)\n}\n',
		expectDiagnostics: false,
		expectedResponses: [
			'/wasm-v-lsp/v_analyzer.mjs',
			'/wasm-v-lsp/v_analyzer.wasm',
			'/wasm-v-lsp/stdlib.json.gz.bin'
		],
		assertNoPreEnableRequests: ['/wasm-v-lsp/'],
		timeoutMs: 180_000
	},
	{
		language: 'LEAN4',
		label: 'Lean 4',
		fileName: 'Main.lean',
		aliases: ['lean'],
		statusKey: 'lean4',
		source: 'def answer : Nat := "bad"\n',
		validSource: 'def answer : Nat := 42\n',
		errorLine: 1,
		timeoutMs: 240000,
		assertNoPreEnableRequests: ['/wasm-lean4/'],
		expectedResponses: ['/wasm-lean4/lean.mjs?', '/wasm-lean4/lean.wasm.gz.bin?'],
		expectedRequestPathnames: Object.keys(WASM_LEAN4_PROFILE.assets).map(
			(name) => '/wasm-lean4/' + name
		),
		requestPathMarker: '/wasm-lean4/',
		requireSha256RequestPins: true,
		expectedRequestSha256Pins: Object.fromEntries(
			Object.entries(WASM_LEAN4_PROFILE.assets).map(([name, receipt]) => [
				'/wasm-lean4/' + name,
				receipt.sha256
			])
		)
	},
	{
		language: 'NIM',
		label: 'Nim',
		fileName: 'main.nim',
		source: nimInvalidSource,
		validSource: nimValidSource,
		errorLine: 4,
		aliases: ['nimlsp'],
		statusKey: 'nim',
		assertNoPreEnableRequests: ['/wasm-nim-lsp/'],
		expectedResponses: [
			'/wasm-nim-lsp/nimlsp.mjs.gz.bin',
			'/wasm-nim-lsp/nimlsp.wasm.gz.bin',
			'/wasm-nim-lsp/stdlib.json.gz.bin'
		]
	},
	{
		language: 'CPP',
		label: 'C++',
		fileName: 'main.cpp',
		source: '#include <bits/stdc++.h>\n\nint main() {\n    int n = "nope";\n    std::cout << n << "\\n";\n}\n',
		validSource:
			'#include <bits/stdc++.h>\n#include <immintrin.h>\nint square(int value) { return value * value; }\nint main() { auto result = square(4); __m256i lanes = _mm256_set1_epi32(result); std::cout << _mm256_extract_epi32(lanes, 7); }\n',
		errorLine: 4,
		aliases: ['c++', 'cpp', 'clangd'],
		statusKey: 'clangd',
		timeoutMs: 240_000
	},
	{
		language: 'C',
		label: 'C',
		fileName: 'main.c',
		source: 'int main(void) {\n    int n = "nope";\n    return n;\n}\n',
		validSource:
			'#include <immintrin.h>\nint main(void) {\n    int class = 42;\n    __m256i lanes = _mm256_set1_epi32(class);\n    return _mm256_extract_epi32(lanes, 7);\n}\n',
		errorLine: 2,
		aliases: ['clang'],
		statusKey: 'clangd',
		timeoutMs: 240_000
	},
	{
		language: 'OBJC',
		label: 'Objective-C',
		fileName: 'main.m',
		source: '#import <Foundation/Foundation.h>\n\nint main(void) {\n    NSString *value = 42;\n    return value;\n}\n',
		validSource:
			'#import <Foundation/Foundation.h>\nint main(void) {\n    NSString *value = @"hello";\n    return [value length] == 5 ? 0 : 1;\n}\n',
		errorLine: 4,
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
		aliases: ['rs'],
		expectedRequestPathnames: rustExecutableStoragePathnames,
		forbiddenRequestPathnames: rustExecutableForbiddenPathnames,
		requestPathMarker: '/wasm-rust/',
		requireSha256RequestPins: true,
		allowAdditionalRequestPathnames: true,
		expectedRequestSha256Pins: rustExecutableStoragePins
	},
	{
		language: 'POSTGRESQL',
		label: 'PostgreSQL',
		fileName: 'main.sql',
		source: '-- Preserve this prefix while editing.\nselect from;\n',
		validSource: '-- Preserve this prefix while editing.\nselect 1;\n',
		errorLine: 2,
		aliases: ['postgres', 'pgsql'],
		assertNoPreEnableRequests: ['/wasm-postgresql-lsp/'],
		expectedResponses: [
			'/wasm-postgresql-lsp/dist/lsp.js',
			'/wasm-postgresql-lsp/dist/pgls.wasm'
		]
	},
	{
		language: 'BASH',
		label: 'Bash',
		fileName: 'main.sh',
		source: 'source ./missing.sh\n',
		validSource: "printf 'hello\\n'\n",
		errorLine: 1,
		minimumMarkerSeverity: 2,
		aliases: ['shell', 'sh'],
		statusKey: 'bash',
		assertNoPreEnableRequests: ['/wasm-bash-lsp/'],
		expectedResponses: [
			'/wasm-bash-lsp/runtime.mjs',
			'/wasm-bash-lsp/tree-sitter-bash.wasm',
			'/wasm-bash-lsp/web-tree-sitter.wasm',
			'/wasm-bash-lsp/one_ini_bg.wasm'
		]
	},
	{
		language: 'COBOL',
		label: 'COBOL',
		fileName: 'main.cob',
		source: cobolFixtureFiles['main.cob'].replace('DISPLAY GREETING.', 'DISPLAY "BROKEN.'),
		validSource: cobolFixtureFiles['main.cob'],
		errorLine: 8,
		workspaceFiles: Object.entries(cobolFixtureFiles)
			.filter(([path]) => path !== 'main.cob')
			.map(([path, content]) => ({ path, content })),
		aliases: ['cob', 'cbl', 'superbol'],
		statusKey: 'cobol',
		assertNoPreEnableRequests: ['/wasm-cobol-lsp/'],
		expectedResponses: [
			'/wasm-cobol-lsp/host.mjs',
			'/wasm-cobol-lsp/superbol-browser.mjs.gz.bin',
			'/wasm-cobol-lsp/gnucobol-config.json.gz.bin'
		]
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
		expectedResponses: [
			'/wasm-pascal/runtime-manifest.v2.json?',
			'/wasm-pascal/compiler.js.gz.bin?',
			'/wasm-pascal/rtl.js.bin?',
			'/wasm-pascal/system.pas.bin?',
			'/wasm-pascal/runner-worker.js?'
		],
		assertNoPreEnableRequests: ['/wasm-pascal/'],
		expectedRequestPathnames: [
			'/wasm-pascal/runtime-manifest.v2.json',
			'/wasm-pascal/compiler.js.gz.bin',
			'/wasm-pascal/rtl.js.bin',
			'/wasm-pascal/system.pas.bin',
			'/wasm-pascal/runner-worker.js'
		],
		forbiddenRequestPathnames: [
			'/wasm-pascal/compiler.js',
			'/wasm-pascal/compiler.js.gz',
			'/wasm-pascal/rtl.js',
			'/wasm-pascal/system.pas'
		],
		requestPathMarker: '/wasm-pascal/',
		requireSha256RequestPins: true,
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
		expectedResponses: [
			`/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}?`,
			`/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}?`,
			`/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}?`
		],
		assertNoPreEnableRequests: ['/wasm-ruby/'],
		expectedRequestPathnames: [
			`/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}`,
			`/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}`,
			`/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}`
		],
		forbiddenRequestPathnames: [
			'/wasm-ruby/split/runtime-split.v1.json',
			'/wasm-ruby/split/runtime.mjs.bin',
			'/wasm-ruby/split/ruby-core.wasm.gz.bin',
			'/wasm-ruby/split/stdlib.pack.gz.bin',
			'/wasm-ruby/runtime.mjs',
			'/wasm-ruby/assets/ruby_stdlib-C40Yu-vu.wasm',
			'/wasm-ruby/assets/ruby_stdlib-C40Yu-vu.wasm.gz'
		],
		requestPathMarker: '/wasm-ruby/',
		requireSha256RequestPins: true,
		expectedRequestSha256Pins: {
			[`/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}`]:
				RUBY_RUNTIME_BUNDLE.profile.manifestFingerprint,
			[`/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}`]:
				RUBY_RUNTIME_BUNDLE.profile.moduleJavaScriptReceipt.sha256,
			[`/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}`]:
				RUBY_RUNTIME_BUNDLE.profile.wasmReceipt.sha256
		},
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
		language: 'GRAIN',
		label: 'Grain',
		fileName: 'main.gr',
		aliases: ['gr'],
		source: 'module Main\nlet value: Number = "text"\nprint(value)\n',
		validSource: 'module Main\nlet value: Number = 42\nprint(value)\n',
		errorLine: 2,
		expectedResponses: [
			'/wasm-grain-lsp/host.mjs',
			'/wasm-grain-lsp/grainlsp.js.gz.bin',
			'/wasm-grain-lsp/stdlib.pack.gz.bin'
		],
		assertNoPreEnableRequests: ['/wasm-grain-lsp/'],
		timeoutMs: 120_000
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
		expectedResponses: [
			'/wasm-janet/runtime-manifest.v2.json?',
			'/wasm-janet/janet.js?',
			'/wasm-janet/janet.wasm.gz.bin?',
			'/wasm-janet/runner-worker.js?'
		],
		assertNoPreEnableRequests: ['/wasm-janet/'],
		timeoutMs: 180_000
	},
	{
		language: 'FENNEL',
		label: 'Fennel',
		fileName: 'main.fnl',
		source: '(local answer ',
		validSource: '(local answer 42)\n(print answer)\n',
		errorLine: 1,
		aliases: ['fnl'],
		expectedResponses: [
			'/wasm-fennel-lsp/engine.mjs',
			'/wasm-fennel-lsp/lua.wasm',
			'/wasm-fennel-lsp/fennel-ls.lua'
		],
		assertNoPreEnableRequests: ['/wasm-fennel-lsp/'],
		timeoutMs: 120_000
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
	java: ['JAVA'],
	'cpp-python': ['CPP', 'C', 'PYTHON'],
	document: ['JSON', 'YAML', 'TOML', 'HTML', 'CSS', 'MARKDOWN'],
	'runtime-small': [
		'PHP',
		'FORTH',
		'C3',
		'COBOL',
		'RESCRIPT',
		'NIM',
		'ASSEMBLYSCRIPT',
		'WAT',
		'GO',
		'GLEAM',
		'PASCAL',
		'LUA',
		'PROLOG',
		'RUBY'
	],
	'runtime-heavy': ['DUCKDB', 'RUST', 'ZIG', 'OCAML', 'HASKELL', 'FORTRAN', 'LEAN4'],
	'runtime-extra': [
		'V',
		'OBJC',
		'D',
		'ELIXIR',
		'ERLANG',
		'GRAIN',
		'TCL',
		'JANET',
		'FENNEL',
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
		.replaceAll('++', 'pp')
		.replaceAll('#', 'sharp')
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
	/\/(?:wasm-phpantom-lsp|lsp|pyodide|wasm-(?:java-lsp|nim-lsp|lean4|v-lsp|rescript-lsp|cobol-lsp|c3-lsp|grain-lsp|bash-lsp|forth-lsp|fennel-lsp|dotnet|fortran|gleam|go|haskell|janet|lua|of-js-of-ocaml|pascal|postgresql-lsp|prolog|ruby|rust|typescript|wat|zig))\//u.test(
		url
	);

const lspStatusKeyByLanguage: Record<string, string> = {
	LEAN4: 'lean4',
	NIM: 'nim',
	JAVA: 'java',
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
	POSTGRESQL: 'postgresql',
	BASH: 'bash',
	COBOL: 'cobol',
	PROLOG: 'prolog',
	RUBY: 'ruby',
	RESCRIPT: 'rescript'
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
	await addBrowserTestCookies(context, browserUrl);
	await disableBrowserPrewarm(context);
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
			// Observe loading and pre-enable requests from an explicit LSP-off workspace.
			localStorage.setItem(
				'wasm-idle:example-workspace:v3',
				JSON.stringify({ version: 6, files: [], lspEnabled: false })
			);
		} catch {
			// Ignore storage access failures in sandboxed browser contexts.
		}
	});
}

async function waitForPreparedPage(page: Page, browserUrl: string) {
	const testUrl = withLspTestQuery(browserUrl);
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const response = await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
		if (process.env.WASM_IDLE_STRICT_CSP === '1') {
			const responsePolicy = response?.headers()['content-security-policy'] || '';
			expect(responsePolicy).toContain(
				"script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-inline'"
			);
			expect(responsePolicy).not.toContain("'unsafe-eval'");
			const documentPolicy =
				(await page
					.locator('meta[http-equiv="content-security-policy"]')
					.getAttribute('content')) || '';
			expect(documentPolicy).toContain("script-src 'self' blob: 'wasm-unsafe-eval'");
			expect(documentPolicy).toMatch(/'sha256-[A-Za-z0-9+/=]+'/u);
			expect(documentPolicy).not.toContain("'unsafe-eval'");
			const probe = await page.evaluate(async () => {
				const inlineMarker = '__wasmIdleCspInlineProbe';
				const evalMarker = '__wasmIdleCspEvalProbe';
				const evalResultMarker = '__wasmIdleCspEvalProbeResult';
				const violations: Array<{
					blockedUri: string;
					disposition: string;
					effectiveDirective: string;
				}> = [];
				const onViolation = (event: SecurityPolicyViolationEvent) => {
					violations.push({
						blockedUri: event.blockedURI,
						disposition: event.disposition,
						effectiveDirective: event.effectiveDirective
					});
				};
				document.addEventListener('securitypolicyviolation', onViolation);
				let blobScript: HTMLScriptElement | null = null;
				let blobUrl = '';
				try {
					const script = document.createElement('script');
					script.textContent = `globalThis.${inlineMarker} = true;`;
					document.head.append(script);
					script.remove();
					blobUrl = URL.createObjectURL(
						new Blob(
							[
								`try {
	(0, eval)('globalThis.${evalMarker} = true');
	globalThis.${evalResultMarker} = { errorName: '' };
} catch (error) {
	globalThis.${evalResultMarker} = {
		errorName: error instanceof Error ? error.name : typeof error
	};
}`
							],
							{ type: 'text/javascript' }
						)
					);
					blobScript = document.createElement('script');
					blobScript.src = blobUrl;
					await new Promise<void>((resolve) => {
						blobScript!.addEventListener('load', () => resolve(), { once: true });
						blobScript!.addEventListener('error', () => resolve(), { once: true });
						document.head.append(blobScript!);
					});
					await new Promise((resolve) => setTimeout(resolve, 50));
					const evalResult = Reflect.get(globalThis, evalResultMarker);
					return {
						evalErrorName:
							typeof evalResult === 'object' &&
							evalResult !== null &&
							typeof Reflect.get(evalResult, 'errorName') === 'string'
								? Reflect.get(evalResult, 'errorName')
								: '',
						evalRan: Reflect.get(globalThis, evalMarker) === true,
						inlineRan: Reflect.get(globalThis, inlineMarker) === true,
						violations
					};
				} finally {
					blobScript?.remove();
					if (blobUrl) URL.revokeObjectURL(blobUrl);
					Reflect.deleteProperty(globalThis, inlineMarker);
					Reflect.deleteProperty(globalThis, evalMarker);
					Reflect.deleteProperty(globalThis, evalResultMarker);
					document.removeEventListener('securitypolicyviolation', onViolation);
				}
			});
			expect(probe.inlineRan).toBe(false);
			expect(probe.evalRan).toBe(false);
			expect(probe.evalErrorName).toBe('EvalError');
			expect(
				probe.violations.some(
					(violation) =>
						violation.blockedUri === 'inline' && violation.disposition === 'enforce'
				)
			).toBe(true);
			expect(
				probe.violations.some(
					(violation) =>
						violation.blockedUri === 'eval' && violation.disposition === 'enforce'
				)
			).toBe(true);
		}
		const ready = await page
			.evaluate(
				() =>
					crossOriginIsolated &&
					typeof SharedArrayBuffer !== 'undefined' &&
					!!navigator.serviceWorker?.controller
			)
			.catch(() => false);
		if (ready) {
			await waitForEditorWorkspace(page);
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
	await waitForEditorWorkspace(page);
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
	await waitForSelectedEditorModel(page, testCase.language, testCase.fileName);
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
				progressValue:
					rawValue === null || rawValue === undefined ? null : Number(rawValue),
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
			const status = testGlobal.__wasmIdleMonacoLspStatus?.[statusKey];
			if (status?.state === 'error') throw new Error(status.message || `${statusKey} failed`);
			return status?.state === 'ready';
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
		({ selector, statusKey }) => {
			const testGlobal = globalThis as typeof globalThis & MonacoTestGlobal;
			const status = testGlobal.__wasmIdleMonacoLspStatus?.[statusKey];
			if (status?.state === 'error') throw new Error(status.message || `${statusKey} failed`);
			const model = testGlobal.__wasmIdleMonacoEditor?.getModel?.() || null;
			const markers =
				testGlobal.__wasmIdleMonacoApi && model
					? testGlobal.__wasmIdleMonacoApi.editor.getModelMarkers({
							resource: model.uri
						}).length
					: 0;
			return document.querySelectorAll(selector).length > 0 || markers > 0;
		},
		{ selector: diagnosticSelector, statusKey: lspStatusKeyFor(testCase) },
		{ timeout: testCase.timeoutMs ?? browserTimeoutMs }
	);
}

async function waitForClangdDiagnosticsForCurrentVersion(page: Page, timeoutMs = 30_000) {
	await page.waitForFunction(
		() => {
			const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
			const trace = Reflect.get(globalThis, '__wasmIdleClangdTrace')?.() || [];
			const uri = String(hooks.__wasmIdleMonacoEditor?.getModel?.()?.uri);
			const latest = trace
				.filter(
					(entry: any) =>
						['textDocument/didOpen', 'textDocument/didChange'].includes(entry.method) &&
						entry.uri === uri
				)
				.at(-1);
			return (
				latest &&
				trace.some(
					(entry: any) =>
						entry.method === 'textDocument/publishDiagnostics' &&
						entry.uri === uri &&
						entry.version === latest.version &&
						entry.sentAt >= latest.sentAt
				)
			);
		},
		undefined,
		{ timeout: timeoutMs }
	);
	// Monaco consumes the same notification asynchronously after the transport records it.
	await page.waitForTimeout(100);
}

async function checkJavaEditorFeatures(page: Page) {
	const source = javaValidSource;
	await replaceEditorSource(page, source);
	await page.waitForFunction(() => {
		const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
		return (
			hooks.__wasmIdleMonacoApi!.editor.getModelMarkers({
				resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
			}).length === 0
		);
	});
	await page.evaluate(() => {
		const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
		editor.pushUndoStop();
		editor.setSelection({
			startLineNumber: 3,
			startColumn: 5,
			endLineNumber: 3,
			endColumn: 8
		});
		editor.focus();
	});
	await page.keyboard.type('String');
	await page.waitForFunction(() => {
		const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
		return hooks
			.__wasmIdleMonacoApi!.editor.getModelMarkers({
				resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
			})
			.some(
				(marker) =>
					marker.startLineNumber === 3 &&
					/\bint\b.*\bString\b|\bString\b.*\bint\b/u.test(marker.message || '')
			);
	});
	await page.evaluate(() => {
		Reflect.get(globalThis, '__wasmIdleMonacoEditor').pushUndoStop();
	});
	await page.keyboard.press('ControlOrMeta+Z');
	await page.waitForFunction((expectedSource) => {
		const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
		return (
			hooks.__wasmIdleMonacoEditor!.getValue() === expectedSource &&
			hooks.__wasmIdleMonacoApi!.editor.getModelMarkers({
				resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
			}).length === 0
		);
	}, source);
	await page.evaluate(() => {
		const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
		editor.setPosition({
			lineNumber: 4,
			column: editor.getValue().split('\n')[3].indexOf('answer') + 2
		});
		editor.focus();
		editor.trigger('browser-regression', 'editor.action.showHover', {});
	});
	await page.locator('.monaco-hover').filter({ hasText: 'int answer' }).first().waitFor();
	await page.keyboard.press('Escape');
	await page.evaluate(() => {
		const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
		const column = editor.getValue().split('\n')[4].indexOf('VALUE') + 1;
		editor.pushUndoStop();
		editor.setSelection({
			startLineNumber: 5,
			startColumn: column,
			endLineNumber: 5,
			endColumn: column + 'VALUE'.length
		});
		editor.focus();
	});
	await page.keyboard.insertText('VA');
	await page.evaluate(() => {
		const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
		editor.trigger('browser-regression', 'editor.action.triggerSuggest', {});
	});
	await page
		.locator('.suggest-widget.visible')
		.filter({ hasText: 'VALUE' })
		.waitFor({ timeout: 10_000 });
	await page.keyboard.press('Escape');
	await page.keyboard.press('Control+z');
	await page.waitForFunction(
		(expected) => Reflect.get(globalThis, '__wasmIdleMonacoEditor').getValue() === expected,
		source,
		{ timeout: 10_000 }
	);

	const showFiles = page.getByRole('button', { name: 'Show files', exact: true });
	if (await showFiles.isVisible()) await showFiles.click();
	const selectFile = async (path: string) => {
		await page.locator(`.workspace-files button[title="${path}"]`).click();
		await waitForSelectedEditorModel(page, 'JAVA', path);
	};
	await selectFile('Helper.java');
	await replaceEditorSource(
		page,
		'public class Helper {\n  public static String VALUE = "changed";\n}\n'
	);
	await selectFile('Main.java');
	await page.waitForFunction(() => {
		const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
		return hooks
			.__wasmIdleMonacoApi!.editor.getModelMarkers({
				resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
			})
			.some(
				(marker) =>
					marker.startLineNumber === 5 &&
					/\bString\b.*\bint\b/u.test(marker.message || '')
			);
	});
	await selectFile('Helper.java');
	await replaceEditorSource(page, javaHelperSource);
	await selectFile('Main.java');
	await page.waitForFunction(() => {
		const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
		return (
			hooks.__wasmIdleMonacoApi!.editor.getModelMarkers({
				resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
			}).length === 0
		);
	});

	// Replacing sibling files while Main stays open must also restart its source snapshot.
	await page.evaluate(async () => {
		await Reflect.get(globalThis, '__wasmIdleDebug').setWorkspaceFiles([], 'Main.java');
	});
	await page.waitForFunction(() => {
		const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
		return hooks
			.__wasmIdleMonacoApi!.editor.getModelMarkers({
				resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
			})
			.some((marker) => /cannot find symbol[\s\S]*Helper/u.test(marker.message || ''));
	});
	expect(
		await page.evaluate(() => Reflect.get(globalThis, '__wasmIdleMonacoEditor').getValue())
	).toBe(source);
	await page.evaluate(async (content) => {
		await Reflect.get(globalThis, '__wasmIdleDebug').setWorkspaceFiles(
			[{ path: 'Helper.java', content }],
			'Main.java'
		);
	}, javaHelperSource);
	await page.waitForFunction(() => {
		const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
		return (
			hooks.__wasmIdleMonacoApi!.editor.getModelMarkers({
				resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
			}).length === 0
		);
	});
	expect(page.frames()).toHaveLength(1);
	await page.locator('#lsp-toggle').uncheck();
	await page.waitForFunction(() => {
		const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
		return hooks.__wasmIdleMonacoLspStatus?.java?.state === 'disabled';
	});
}

async function checkCppEditorFeatures(page: Page) {
	const source =
		'int square(int value) { return value * value; }\nint main() { auto result = square(4); return result; }\n';
	await replaceEditorSource(page, source);
	await waitForClangdDiagnosticsForCurrentVersion(page);
	expect((await readDiagnosticCounts(page)).markers).toBe(0);
	await page.evaluate(() => {
		const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
		editor.updateOptions({ inlayHints: { enabled: 'on' } });
		editor.setPosition({ lineNumber: 2, column: 28 });
		editor.focus();
		editor.trigger('browser-regression', 'editor.action.showHover', {});
	});
	await page
		.locator('.monaco-hover')
		.filter({ hasText: 'square' })
		.first()
		.waitFor({ timeout: 10_000 });
	expect(await page.locator('.monaco-hover').innerText()).toContain('int');
	await page.keyboard.press('Escape');
	await page.waitForFunction(
		() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			const hints = editor
				.getModel()
				.getAllDecorations()
				.filter((entry: any) => entry.options.description === 'InlayHint');
			const text = hints
				.map(
					(entry: any) =>
						(entry.options.before?.content || '') + (entry.options.after?.content || '')
				)
				.join(' ');
			return text.includes('int') && text.includes('value:');
		},
		undefined,
		{ timeout: 10_000 }
	);
	const trace = await page.evaluate(() => Reflect.get(globalThis, '__wasmIdleClangdTrace')());
	for (const method of ['textDocument/hover', 'textDocument/inlayHint']) {
		expect(
			trace.some(
				(entry: any) =>
					entry.method === method &&
					entry.outcome === 'response' &&
					entry.finishedAt - entry.sentAt < 10_000
			)
		).toBe(true);
	}
	await page.evaluate(() => {
		const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
		for (let i = 0; i < 5; i++)
			editor.setValue(`int main() { auto result = ${i}.0; return 0; }`);
	});
	await waitForClangdDiagnosticsForCurrentVersion(page);
	await page.waitForFunction(
		() => {
			const model = Reflect.get(globalThis, '__wasmIdleMonacoEditor').getModel();
			const text = model
				.getAllDecorations()
				.filter((entry: any) => entry.options.description === 'InlayHint')
				.map(
					(entry: any) =>
						(entry.options.before?.content || '') + (entry.options.after?.content || '')
				)
				.join(' ');
			return text.includes('double') && !text.includes('value:');
		},
		undefined,
		{ timeout: 10_000 }
	);
	expect(await page.locator('.view-lines').innerText()).toContain('double');
}

async function checkClangLanguageSwitches(page: Page) {
	for (const language of ['C', 'CPP', 'OBJC']) {
		const testCase = lspBrowserCases.find((entry) => entry.language === language)!;
		await selectLanguage(page, testCase);
		await enableLsp(page);
		await waitForLspReady(page, testCase);
		// Observe the newly opened document before editing it: clangd can suppress
		// identical diagnostics when didChange overtakes the initial AST build.
		await waitForClangdDiagnosticsForCurrentVersion(page);
		// Make the diagnostic set change before checking the corrected document.
		// A clean default and a different clean source can share the same empty
		// diagnostics, which clangd need not publish again for the new version.
		await replaceEditorSource(page, testCase.source);
		await waitForClangdDiagnosticsForCurrentVersion(page);
		expect(
			(await readDiagnosticCounts(page)).markers,
			`${language} after introducing an error`
		).toBeGreaterThan(0);
		await replaceEditorSource(page, testCase.validSource!);
		await waitForClangdDiagnosticsForCurrentVersion(page);
		expect((await readDiagnosticCounts(page)).markers, `${language} after switching`).toBe(0);
		const documentUri = await page.evaluate(() =>
			String(Reflect.get(globalThis, '__wasmIdleMonacoEditor').getModel().uri)
		);
		expect(documentUri).toBe(`file:///workspace/${testCase.fileName}`);
		await replaceEditorSource(page, testCase.source);
		await waitForClangdDiagnosticsForCurrentVersion(page);
		expect((await readDiagnosticCounts(page)).markers).toBeGreaterThan(0);
	}
}

async function checkPostgresqlKeyboardSync(page: Page, validSource: string) {
	await page.evaluate(() => {
		const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
		editor.setPosition({ lineNumber: 2, column: 1 });
		editor.getModel().pushStackElement();
		editor.focus();
	});
	await page.keyboard.type('x');
	await page.waitForFunction((source) => {
		const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
		const editor = hooks.__wasmIdleMonacoEditor!;
		return (
			editor.getValue() === source.replace('select', 'xselect') &&
			hooks
				.__wasmIdleMonacoApi!.editor.getModelMarkers({ resource: editor.getModel!()!.uri })
				.some((marker) => marker.startLineNumber === 2 && (marker.severity || 0) >= 4)
		);
	}, validSource);
	// The diagnostic must remain on line 2: forwarding only the inserted "x"
	// makes the original Full-sync server diagnose a one-line replacement instead.
	await page.keyboard.press('Escape');
	await page.keyboard.press('Control+z');
	await page.waitForFunction((source) => {
		const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
		const editor = hooks.__wasmIdleMonacoEditor!;
		return (
			editor.getValue() === source &&
			hooks.__wasmIdleMonacoApi!.editor.getModelMarkers({
				resource: editor.getModel!()!.uri
			}).length === 0
		);
	}, validSource);
}

async function pinnedContainerWorkerUrls(browserUrl: string): Promise<Set<string>> {
	const source = ts.createSourceFile(
		'release.ts',
		await readFile(new URL('../lib/playground/container/release.ts', import.meta.url), 'utf8'),
		ts.ScriptTarget.Latest,
		true
	);
	const declaration = source.statements
		.flatMap((statement) =>
			ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []
		)
		.find((entry) => ts.isIdentifier(entry.name) && entry.name.text === 'release');
	if (!declaration?.initializer) throw new Error('Missing fixed Container release');
	const release = JSON.parse(declaration.initializer.getText(source));
	if (!/^[a-f0-9]{64}$/u.test(release.hostHash))
		throw new Error('Invalid fixed Container host identity');
	const host = new URL(`container-app/host/${release.hostHash}/`, browserUrl);
	return new Set(
		(['sdkWorkerUrl', 'liveWorkerUrl', 'clangWorkerUrl'] as const).map((key) => {
			const url = new URL(release.config[key], host);
			if (url.origin !== host.origin || !url.href.startsWith(host.href))
				throw new Error('Container worker escaped its fixed same-origin host');
			return url.href;
		})
	);
}

async function runLspCase(
	page: Page,
	browserUrl: string,
	testCase: LspBrowserCase,
	lspRequests: string[]
) {
	const strictWorkerResponsePolicies = new Map<string, string>();
	const backgroundWorkerUrls =
		process.env.WASM_IDLE_STRICT_CSP === '1'
			? await pinnedContainerWorkerUrls(browserUrl)
			: new Set<string>();
	page.setDefaultTimeout(testCase.timeoutMs ?? browserTimeoutMs);
	page.on('request', (request) => {
		const url = request.url();
		if (requestLooksLspRelated(url)) lspRequests.push(`> ${request.method()} ${url}`);
	});
	page.on('response', (response) => {
		const url = response.url();
		if (requestLooksLspRelated(url)) lspRequests.push(`< ${response.status()} ${url}`);
		if (
			process.env.WASM_IDLE_STRICT_CSP === '1' &&
			/\/_app\/immutable\/(?:workers|assets)\/(?:assets\/)?[^/]+\.js$/u.test(
				new URL(url).pathname
			)
		) {
			strictWorkerResponsePolicies.set(
				url,
				response.headers()['content-security-policy'] || ''
			);
		}
	});

	await waitForPreparedPage(page, browserUrl);
	await selectLanguage(page, testCase);
	if (testCase.workspaceFiles) {
		const configured = await page.evaluate(
			async ({ files, path, content }) => {
				const api = Reflect.get(globalThis, '__wasmIdleDebug');
				return await api.setWorkspaceFiles([...files, { path, content }], path);
			},
			{
				files: testCase.workspaceFiles,
				path: testCase.fileName,
				content: testCase.validSource || testCase.source
			}
		);
		expect(configured).toBe(true);
		await waitForSelectedEditorModel(page, testCase.language, testCase.fileName);
	}
	if (testCase.validSource) await replaceEditorSource(page, testCase.validSource);
	await page
		.waitForFunction(
			(selector) => document.querySelectorAll(selector).length === 0,
			diagnosticSelector,
			{ timeout: 10_000 }
		)
		.catch(() => {});
	const workersBeforeLsp = new Set(page.workers().map((worker) => worker.url()));

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
	if (process.env.WASM_IDLE_STRICT_CSP === '1') {
		const lspWorkerUrls = page
			.workers()
			.map((worker) => worker.url())
			// The terminal can finish starting a fixed Container worker while LSP loads.
			.filter((url) => !workersBeforeLsp.has(url) && !backgroundWorkerUrls.has(url));
		expect(lspWorkerUrls.length).toBeGreaterThan(0);
		for (const workerUrl of lspWorkerUrls) {
			if (testCase.language === 'LEAN4' && workerUrl.startsWith('blob:')) {
				// These pthread modules are the verified original glue with the documented platform patch.
				expect(new URL(workerUrl).origin).toBe(new URL(browserUrl).origin);
				continue;
			}
			const workerPolicy = strictWorkerResponsePolicies.get(workerUrl) || '';
			expect(workerUrl, `Unexpected LSP worker URL: ${workerUrl}`).toMatch(
				/\/_app\/immutable\/(?:workers|assets)\/(?:assets\/)?[^/]+\.js$/u
			);
			expect(workerPolicy).toContain(
				"script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-inline'"
			);
			expect(workerPolicy).not.toContain("'unsafe-eval'");
		}
	}
	const progressTrace = await readAndStopLspProgressProbe(page);
	expect(
		progressTrace.some(
			(entry) =>
				entry.state === 'loading' && entry.progressVisible && entry.text.includes('LSP')
		)
	).toBe(true);
	expect(progressTrace.some((entry) => entry.state === 'ready')).toBe(true);
	for (const entry of progressTrace) {
		if (entry.progressValue === null) continue;
		expect(Number.isFinite(entry.progressValue)).toBe(true);
		expect(entry.progressValue).toBeGreaterThanOrEqual(0);
		expect(entry.progressValue).toBeLessThanOrEqual(100);
	}
	if (testCase.validSource && testCase.language !== 'LEAN4') {
		if (lspStatusKeyFor(testCase) === 'clangd') {
			// The first standard-library/SIMD preamble uses the case's startup budget.
			await waitForClangdDiagnosticsForCurrentVersion(
				page,
				testCase.timeoutMs ?? browserTimeoutMs
			);
		}
		expect((await readDiagnosticCounts(page)).markers).toBe(0);
	}
	await replaceEditorSource(page, testCase.source);

	for (const response of await Promise.all(expectedResponses)) {
		if (response instanceof Error) throw response;
	}
	if (testCase.expectedRequestPathnames) {
		const requestUrls = lspRequests
			.filter((entry) => entry.startsWith('> '))
			.map((entry) => new URL(entry.slice(entry.indexOf(' ', 2) + 1)))
			.filter((url) => url.pathname.includes(testCase.requestPathMarker || ''));
		if (!testCase.allowAdditionalRequestPathnames) {
			expect(requestUrls).toHaveLength(testCase.expectedRequestPathnames.length);
		}
		for (const pathname of testCase.expectedRequestPathnames) {
			expect(requestUrls.filter((url) => url.pathname.endsWith(pathname))).toHaveLength(1);
		}
		for (const pathname of testCase.forbiddenRequestPathnames || []) {
			expect(requestUrls.some((url) => url.pathname.endsWith(pathname))).toBe(false);
		}
		if (testCase.requireSha256RequestPins) {
			for (const url of requestUrls) {
				expect(url.searchParams.get('v')).toMatch(/^[a-f0-9]{64}$/u);
			}
		}
		for (const [pathname, sha256] of Object.entries(testCase.expectedRequestSha256Pins || {})) {
			const matchingRequests = requestUrls.filter((url) => url.pathname.endsWith(pathname));
			expect(matchingRequests).toHaveLength(1);
			expect(matchingRequests[0]?.search).toBe(`?v=${sha256}`);
		}
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
	if (testCase.validSource) {
		if (lspStatusKeyFor(testCase) === 'clangd')
			await waitForClangdDiagnosticsForCurrentVersion(page);
		const markers = await page.evaluate(() => {
			const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
			return hooks.__wasmIdleMonacoApi!.editor.getModelMarkers({
				resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
			});
		});
		expect(
			markers.some(
				(marker) =>
					marker.startLineNumber === testCase.errorLine &&
					(marker.severity || 0) >= (testCase.minimumMarkerSeverity ?? 4)
			)
		).toBe(true);
		expect(
			markers.some((marker) =>
				/file not found|unknown type name 'NSString'/i.test(marker.message || '')
			)
		).toBe(false);
		await replaceEditorSource(page, testCase.validSource);
		if (lspStatusKeyFor(testCase) === 'clangd')
			await waitForClangdDiagnosticsForCurrentVersion(page);
		else
			await page.waitForFunction(
				() => {
					const api = (globalThis as typeof globalThis & MonacoTestGlobal)
						.__wasmIdleMonacoApi;
					const editor = (globalThis as typeof globalThis & MonacoTestGlobal)
						.__wasmIdleMonacoEditor;
					const model = editor?.getModel?.();
					return (
						api &&
						model &&
						api.editor.getModelMarkers({ resource: model.uri }).length === 0
					);
				},
				undefined,
				{ timeout: testCase.timeoutMs ?? browserTimeoutMs }
			);
		expect((await readDiagnosticCounts(page)).markers).toBe(0);
	}
	if (testCase.language === 'POSTGRESQL')
		await checkPostgresqlKeyboardSync(page, testCase.validSource!);
	if (testCase.language === 'PHP') {
		await page.evaluate(() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			const line = editor.getModel().getLineContent(2);
			editor.setPosition({ lineNumber: 2, column: line.indexOf('): string') + 4 });
			editor.getModel().pushStackElement();
			editor.focus();
		});
		await page.keyboard.type('?');
		await page.waitForFunction(() =>
			Reflect.get(globalThis, '__wasmIdleMonacoEditor').getValue().includes('): ?string')
		);
		const showReturnType = async (nullable: boolean) => {
			await page.evaluate(() => {
				const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
				editor.setPosition({ lineNumber: 4, column: 7 });
				editor.focus();
				editor.trigger('browser-regression', 'editor.action.showHover', {});
			});
			await page
				.locator('.monaco-hover')
				.filter({
					hasText: nullable ? /\): \?string/u : /\): string/u
				})
				.first()
				.waitFor();
			await page.keyboard.press('Escape');
		};
		await showReturnType(true);
		await page.keyboard.press('Control+z');
		await page.waitForFunction(
			(source) => Reflect.get(globalThis, '__wasmIdleMonacoEditor').getValue() === source,
			testCase.source
		);
		await showReturnType(false);
	}
	if (testCase.language === 'GRAIN') {
		await page.evaluate(() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			editor.setPosition({ lineNumber: 2, column: 21 });
			editor.getModel().pushStackElement();
			editor.focus();
		});
		await page.keyboard.type('x');
		await page.waitForFunction(() => {
			const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
			return (
				hooks.__wasmIdleMonacoEditor!.getValue() ===
					'module Main\nlet value: Number = x42\nprint(value)\n' &&
				hooks
					.__wasmIdleMonacoApi!.editor.getModelMarkers({
						resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
					})
					.some(
						(marker) =>
							marker.startLineNumber === 2 &&
							(marker.severity || 0) >= 4 &&
							(marker.message || '').includes('x42')
					)
			);
		});
		await page.keyboard.press('Escape');
		await page.keyboard.press('Control+z');
		await page.waitForFunction(() => {
			const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
			return (
				hooks.__wasmIdleMonacoEditor!.getValue() ===
					'module Main\nlet value: Number = 42\nprint(value)\n' &&
				hooks.__wasmIdleMonacoApi!.editor.getModelMarkers({
					resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
				}).length === 0
			);
		});
		await page.evaluate(() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			editor.setPosition({ lineNumber: 3, column: 8 });
			editor.focus();
			editor.trigger('browser-regression', 'editor.action.showHover', {});
		});
		await page
			.locator('.monaco-hover')
			.filter({ hasText: 'Number' })
			.first()
			.waitFor({ timeout: 10_000 });
		await page.keyboard.press('Escape');
	}
	if (testCase.language === 'C3') {
		const validSource =
			'module main;\nfn int square(int value) { return value * value; }\nfn void main() { int n = square(5); }\n';
		await replaceEditorSource(page, validSource);
		await page.waitForFunction(() => {
			const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
			return (
				hooks.__wasmIdleMonacoApi!.editor.getModelMarkers({
					resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
				}).length === 0
			);
		});
		await page.evaluate(() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			editor.setPosition({ lineNumber: 2, column: editor.getModel().getLineMaxColumn(2) });
			editor.getModel().pushStackElement();
			editor.focus();
		});
		await page.keyboard.type('\\');
		await waitForDiagnostics(page, testCase);
		await page.keyboard.press('Escape');
		await page.keyboard.press('Control+z');
		await page.waitForFunction((source) => {
			const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
			return (
				hooks.__wasmIdleMonacoEditor!.getValue() === source &&
				hooks.__wasmIdleMonacoApi!.editor.getModelMarkers({
					resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
				}).length === 0
			);
		}, validSource);
		await page.evaluate(() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			editor.setPosition({ lineNumber: 2, column: 9 });
			editor.focus();
			editor.trigger('browser-regression', 'editor.action.showHover', {});
		});
		await page.locator('.monaco-hover').filter({ hasText: 'square' }).first().waitFor();
		await page.keyboard.press('Escape');
	}
	if (testCase.language === 'RESCRIPT') {
		await page.evaluate(() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			editor.setPosition({ lineNumber: 1, column: 19 });
			editor.getModel().pushStackElement();
			editor.focus();
		});
		await page.keyboard.type('x');
		await page.waitForFunction(() => {
			const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
			return (
				hooks.__wasmIdleMonacoEditor!.getValue() === 'let answer: int = x42\n' &&
				hooks
					.__wasmIdleMonacoApi!.editor.getModelMarkers({
						resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
					})
					.some((marker) => (marker.severity || 0) >= 4)
			);
		});
		await page.keyboard.press('Escape');
		await page.keyboard.press('Control+z');
		await page.waitForFunction(() => {
			const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
			return (
				hooks.__wasmIdleMonacoEditor!.getValue() === 'let answer: int = 42\n' &&
				hooks.__wasmIdleMonacoApi!.editor.getModelMarkers({
					resource: hooks.__wasmIdleMonacoEditor!.getModel!()!.uri
				}).length === 0
			);
		});
		await page.evaluate(() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			editor.setPosition({ lineNumber: 1, column: 6 });
			editor.focus();
			editor.trigger('browser-regression', 'editor.action.showHover', {});
		});
		await page
			.locator('.monaco-hover')
			.filter({ hasText: 'int' })
			.first()
			.waitFor({ timeout: 10000 });
		await page.keyboard.press('Escape');
	}
	if (testCase.language === 'V') {
		// The upstream initial index runs after initialize. Wait for an editor feature
		// from the opened document before triggering a hover at a fixed position.
		await expect
			.poll(
				async () =>
					(await page.locator('.view-lines').innerText()).replaceAll('\u00a0', ' '),
				{
					timeout: 120_000
				}
			)
			.toContain('n: int');
		async function expectVHover(signature: string) {
			await page.keyboard.press('Escape');
			await page.evaluate(() => {
				const editor = (globalThis as typeof globalThis & MonacoTestGlobal)
					.__wasmIdleMonacoEditor!;
				editor.setPosition({ lineNumber: 7, column: 8 });
				editor.focus();
				editor.trigger('browser-test', 'editor.action.showHover', {});
			});
			await expect
				.poll(
					async () =>
						await page
							.locator('.monaco-hover')
							.innerText()
							.catch(() => ''),
					{
						timeout: 30_000
					}
				)
				.toContain(signature);
			expect(await page.locator('.monaco-hover').innerText()).toContain(
				'Squares an integer.'
			);
		}
		await expectVHover('fn square(value int) int');
		await page.keyboard.press('Escape');
		await page.evaluate(() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			editor.setPosition({ lineNumber: 3, column: 22 });
			editor.getModel().pushStackElement();
			editor.focus();
		});
		// One real keystroke changes the original analyzer's inferred return type.
		await page.keyboard.type('?');
		await page.waitForFunction(
			(expected) => Reflect.get(globalThis, '__wasmIdleMonacoEditor').getValue() === expected,
			testCase.source.replace(') int {', ') ?int {')
		);
		await expectVHover('fn square(value int) ?int');
		await page.keyboard.press('Escape');
		await page.keyboard.press('Control+z');
		await page.waitForFunction(
			(expected) => Reflect.get(globalThis, '__wasmIdleMonacoEditor').getValue() === expected,
			testCase.source
		);
		await expectVHover('fn square(value int) int');
		await page.keyboard.press('Escape');
	}

	if (testCase.language === 'NIM') {
		await page.evaluate(() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			const end = editor.getModel().getLineMaxColumn(4);
			editor.pushUndoStop();
			editor.setSelection({
				startLineNumber: 4,
				startColumn: end - 1,
				endLineNumber: 4,
				endColumn: end
			});
			editor.focus();
		});
		// Exercise Monaco's actual edit events with the upstream Full sync contract.
		await page.keyboard.insertText('x');
		await page.waitForFunction(() => {
			const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
			const model = hooks.__wasmIdleMonacoEditor?.getModel?.();
			return (
				model &&
				hooks.__wasmIdleMonacoApi?.editor
					.getModelMarkers({ resource: model.uri })
					.some((marker) => marker.severity === 8 && marker.startLineNumber === 4)
			);
		});
		await page.keyboard.press('Control+z');
		await page.waitForFunction((source) => {
			const hooks = globalThis as typeof globalThis & MonacoTestGlobal;
			const editor = hooks.__wasmIdleMonacoEditor;
			const model = editor?.getModel?.();
			return (
				model &&
				editor?.getValue() === source &&
				hooks.__wasmIdleMonacoApi?.editor.getModelMarkers({ resource: model.uri })
					.length === 0
			);
		}, testCase.validSource);
		await page.evaluate(() => {
			const editor = Reflect.get(globalThis, '__wasmIdleMonacoEditor');
			editor.setPosition({ lineNumber: 5, column: 9 });
			editor.focus();
			editor.trigger('browser-regression', 'editor.action.showHover', {});
		});
		const hover = page.locator('.monaco-hover').filter({ hasText: 'proc' }).first();
		await hover.waitFor({ timeout: 10_000 });
		expect(await hover.innerText()).toMatch(/name:\s+string/);
		await page.keyboard.press('Escape');
	}
	if (testCase.language === 'CPP') await checkCppEditorFeatures(page);
	if (testCase.language === 'JAVA') await checkJavaEditorFeatures(page);
	if (testCase.language === 'OBJC') await checkClangLanguageSwitches(page);
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
				lspRequests.some((request) => request.includes(`/wasm-dotnet/runtime/${language}/`))
			).toBe(false);
		}
	}
	if (testCase.language === 'JANET') {
		const janetRequestUrls = lspRequests
			.filter((request) => request.startsWith('> GET ') && request.includes('/wasm-janet/'))
			.map((request) => request.slice('> GET '.length));
		const requestedPaths = janetRequestUrls.map((request) => {
			const pathname = new URL(request).pathname;
			return pathname.slice(pathname.lastIndexOf('/wasm-janet/'));
		});
		expect(janetRequestUrls).toHaveLength(4);
		expect(new Set(requestedPaths)).toEqual(
			new Set([
				'/wasm-janet/runtime-manifest.v2.json',
				'/wasm-janet/janet.js',
				'/wasm-janet/janet.wasm.gz.bin',
				'/wasm-janet/runner-worker.js'
			])
		);
		expect(requestedPaths).not.toContain('/wasm-janet/janet.wasm.gz');
		expect(requestedPaths).not.toContain('/wasm-janet/janet.wasm');
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
			`clangdTrace=${JSON.stringify(Reflect.get(globalThis, '__wasmIdleClangdTrace')?.() || [])}`,
			`markers=${JSON.stringify(markers)}`,
			`viewText=${JSON.stringify(viewText)}`,
			`squiggles=${JSON.stringify(squiggles)}`,
			`resources=${JSON.stringify(resources)}`
		];
	}, diagnosticSelector);
}

describe('Monaco LSP browser integration', () => {
	it('recognizes only exact same-origin release-pinned Container background workers', async () => {
		const root = 'https://preview.example/wasm-idle/';
		const workers = await pinnedContainerWorkerUrls(root);
		expect(workers.size).toBe(3);
		for (const worker of workers) {
			const url = new URL(worker);
			expect(url.origin).toBe(new URL(root).origin);
			expect(url.pathname).toMatch(
				/^\/wasm-idle\/container-app\/host\/[a-f0-9]{64}\/(?:sdk\/worker|live-worker|clang-worker)\.mjs$/u
			);
			expect(workers.has(worker.replace('preview.example', 'other.example'))).toBe(false);
			expect(workers.has(`${worker}?untrusted=1`)).toBe(false);
			expect(
				workers.has(worker.replace(/\/host\/[^/]+\//u, `/host/${'0'.repeat(64)}/`))
			).toBe(false);
		}
		const host = new URL('.', [...workers][0]);
		expect(workers.has(new URL('untrusted-worker.mjs', host).href)).toBe(false);
		expect(workers.has(new URL('_app/immutable/workers/gleam-worker.js', root).href)).toBe(
			false
		);
	});

	it('binds the Rust case to all inert executable graph deliveries', () => {
		expect(rustExecutableGraphModules).toHaveLength(47);
		for (const modulePath of ['runtime-asset-cache.js', 'runtime-asset-cache-service.js']) {
			expect(WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules).toHaveProperty([modulePath]);
			expect(rustExecutableStoragePathnames).toContain(`/wasm-rust/${modulePath}.bin`);
		}
		expect(rustExecutableStoragePathnames).toHaveLength(47);
		expect(new Set(rustExecutableStoragePathnames).size).toBe(47);
		expect(rustExecutableStoragePathnames.every((pathname) => pathname.endsWith('.bin'))).toBe(
			true
		);
		expect(rustExecutableForbiddenPathnames).toHaveLength(94);
		expect(Object.keys(rustExecutableStoragePins)).toHaveLength(47);
	});

	it('pins Java language-server deliveries separately from Java execution', () => {
		const java = lspBrowserCases.find((testCase) => testCase.language === 'JAVA')!;
		expect(java.expectedRequestPathnames?.length).toBeGreaterThan(0);
		expect(java.assertNoPreEnableRequests).toEqual(['/wasm-java-lsp/']);
		expect(
			java.expectedRequestPathnames?.every((path) => path.startsWith('/wasm-java-lsp/'))
		).toBe(true);
		expect(Object.keys(java.expectedRequestSha256Pins || {}).sort()).toEqual(
			[...java.expectedRequestPathnames!].sort()
		);
		for (const pin of Object.values(java.expectedRequestSha256Pins || {})) {
			expect(pin).toMatch(/^[a-f0-9]{64}$/u);
		}
	});

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

			process.env.WASM_IDLE_LSP_BROWSER_GROUPS = 'java';
			expect(selectedCases().map((testCase) => testCase.language)).toEqual(['JAVA']);

			process.env.WASM_IDLE_LSP_BROWSER_GROUPS = 'runtime-small';
			expect(selectedCases().map((testCase) => testCase.language)).toContain('PASCAL');
			expect(selectedCases().map((testCase) => testCase.language)).toContain('RUBY');

			process.env.WASM_IDLE_LSP_BROWSER_GROUPS = 'runtime-heavy';
			expect(selectedCases().map((testCase) => testCase.language)).toEqual([
				'LEAN4',
				'DUCKDB',
				'RUST',
				'ZIG',
				'OCAML',
				'HASKELL',
				'FORTRAN'
			]);

			process.env.WASM_IDLE_LSP_BROWSER_GROUPS = 'runtime-extra';
			expect(selectedCases().map((testCase) => testCase.language)).toEqual([
				'V',
				'OBJC',
				'D',
				'ELIXIR',
				'ERLANG',
				'GRAIN',
				'TCL',
				'JANET',
				'FENNEL',
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
			delete process.env.WASM_IDLE_LSP_BROWSER_GROUPS;
			for (const [filter, expected] of [
				['C', 'C'],
				['C++', 'CPP'],
				['C#', 'CSHARP']
			]) {
				process.env.WASM_IDLE_LSP_BROWSER_LANGUAGES = filter;
				expect(selectedCases().map((testCase) => testCase.language)).toEqual([expected]);
			}
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
		{
			skip: process.env.WASM_IDLE_RUN_REAL_BROWSER_LSP !== '1',
			timeout: suiteTimeoutMs,
			meta: {
				browser: true,
				requiredBrowser: process.env.WASM_IDLE_RUN_REAL_BROWSER_LSP === '1'
			}
		},
		async () => {
			expect.hasAssertions();

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
				if (
					!reuseProvidedBrowserUrl &&
					cases.some((testCase) => testCase.language === 'POSTGRESQL')
				) {
					await runBrowserPreparationScripts(['sync:postgresql-lsp']);
				}
				if (
					!reuseProvidedBrowserUrl &&
					cases.some((testCase) => testCase.language === 'PHP')
				) {
					await runBrowserPreparationScripts(['sync:phpantom-lsp']);
				}
				if (
					!reuseProvidedBrowserUrl &&
					cases.some((testCase) => testCase.language === 'FENNEL')
				) {
					await runBrowserPreparationScripts(['sync:fennel-lsp']);
				}
				if (
					!reuseProvidedBrowserUrl &&
					cases.some((testCase) => testCase.language === 'FORTH')
				) {
					await runBrowserPreparationScripts(['sync:forth-lsp']);
				}
				if (
					!reuseProvidedBrowserUrl &&
					cases.some((testCase) => testCase.language === 'BASH')
				) {
					await runBrowserPreparationScripts(['sync:bash-lsp']);
				}
				if (
					!reuseProvidedBrowserUrl &&
					cases.some((testCase) => testCase.language === 'GRAIN')
				)
					await runBrowserPreparationScripts(['sync:grain-lsp']);
				if (!reuseProvidedBrowserUrl && cases.some((entry) => entry.language === 'C3'))
					await runBrowserPreparationScripts(['sync:c3-lsp']);
				if (
					!reuseProvidedBrowserUrl &&
					cases.some((testCase) => testCase.language === 'COBOL')
				) {
					await runBrowserPreparationScripts(['sync:cobol-lsp']);
				}
				if (!reuseProvidedBrowserUrl && cases.some((entry) => entry.language === 'V'))
					await runBrowserPreparationScripts(['sync:v-lsp']);
				if (
					!reuseProvidedBrowserUrl &&
					cases.some((testCase) => testCase.language === 'NIM')
				)
					await runBrowserPreparationScripts(['sync:nim-lsp']);
				if (!reuseProvidedBrowserUrl && serverMode === 'preview') {
					await runBrowserPreparationScripts([
						...(cases.some((testCase) => testCase.language === 'RESCRIPT')
							? ['sync:rescript-lsp']
							: []),
						'build:preview',
						'compress:build-runtimes'
					]);
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
							expect(pageErrors).toEqual([]);
							expect(
								consoleMessages.filter((message) =>
									/Missing requestHandler.*provideInlayHints/u.test(message)
								)
							).toEqual([]);
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
		}
	);
});
