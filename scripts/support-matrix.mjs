import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SUPPORT_MATRIX_START = '## Support matrix';
const SUPPORT_MATRIX_END = '## Monorepo layout';
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const requirePackage = createRequire(import.meta.url);

/** @param {string} filePath */
function readJsonFile(filePath) {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} catch {
		return null;
	}
}

/** @param {string} relativePath */
function readRepoJson(relativePath) {
	return readJsonFile(path.join(REPO_ROOT, relativePath));
}

const rootPackage = readRepoJson('package.json') || {};

/**
 * @param {string} packageName
 */
function installedPackageVersion(packageName) {
	try {
		const packageJson = requirePackage(`${packageName}/package.json`);
		if (typeof packageJson.version === 'string') return packageJson.version;
	} catch {
		// Some packages do not export package.json; fall back to the resolved entry point.
	}
	try {
		let directory = path.dirname(requirePackage.resolve(packageName));
		while (directory !== path.dirname(directory)) {
			const packageJson = readJsonFile(path.join(directory, 'package.json'));
			if (packageJson?.name === packageName && typeof packageJson.version === 'string') {
				return packageJson.version;
			}
			directory = path.dirname(directory);
		}
	} catch {
		return '';
	}
	return '';
}

/**
 * @param {string} packageName
 */
function packageVersion(packageName) {
	return (
		installedPackageVersion(packageName) ||
		rootPackage.dependencies?.[packageName] ||
		rootPackage.devDependencies?.[packageName] ||
		'unknown'
	);
}

/**
 * @param {string} packageName
 */
function npmPackage(packageName) {
	return `${packageName}@${packageVersion(packageName)}`;
}

/**
 * @param {string} relativePath
 */
function workspacePackage(relativePath) {
	const packageJson = readRepoJson(`${relativePath}/package.json`) || {};
	return `${packageJson.name || relativePath}@${packageJson.version || 'unversioned'}`;
}

/**
 * @param {string} relativePath
 * @param {string} packageName
 */
function workspaceDependency(relativePath, packageName) {
	const packageJson = readRepoJson(`${relativePath}/package.json`) || {};
	const installedPackageJson = readRepoJson(
		`${relativePath}/node_modules/${packageName}/package.json`
	);
	const version =
		installedPackageJson?.version ||
		packageJson.dependencies?.[packageName] ||
		packageJson.devDependencies?.[packageName] ||
		packageVersion(packageName);
	return `${packageName}@${version}`;
}

/**
 * @param {string} relativePath
 * @param {string[]} fieldPath
 */
function manifestValue(relativePath, fieldPath) {
	let value = readRepoJson(relativePath);
	for (const field of fieldPath) {
		if (!value || typeof value !== 'object') return '';
		value = value[field];
	}
	return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * @param {string} text
 */
function code(text) {
	return `\`${text}\``;
}

/**
 * @param {string[]} values
 */
function codeList(values) {
	return values.map(code).join(', ');
}

/**
 * @typedef {{
 *   file: string;
 *   env: string;
 *   language?: string;
 *   marker?: string;
 * }} BrowserSupportTest
 *
 * @typedef {{
 *   language: string;
 *   ids: string[];
 *   runtime: string;
 *   stdin: string;
 *   editorSupport: string;
 *   debug: string;
 *   browserTest?: BrowserSupportTest;
 * }} SupportMatrixRow
 *
 * @typedef {{
 *   language: string;
 *   candidateIds: string[];
 *   currentEvidence: string;
 *   blocker: string;
 *   requiredFollowUp: string;
 * }} BlockedCandidateRow
 */

/** @type {SupportMatrixRow[]} */
export const supportMatrixRows = [
	{
		language: 'C',
		ids: ['C'],
		runtime: '@wasm-idle/llvm-core / Clang WASI',
		stdin: 'Yes',
		editorSupport: 'clangd',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN',
			language: 'C'
		}
	},
	{
		language: 'C++',
		ids: ['CPP'],
		runtime: '@wasm-idle/llvm-core / Clang WASI',
		stdin: 'Yes',
		editorSupport: 'clangd',
		debug: 'Trace',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_CLANG_STDIN',
			language: 'CPP'
		}
	},
	{
		language: 'Objective-C',
		ids: ['OBJC'],
		runtime: 'GNUstep libobjc2 + @wasm-idle/llvm-core',
		stdin: 'Yes',
		editorSupport: 'clangd',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_OBJECTIVEC',
			language: 'OBJC'
		}
	},
	{
		language: 'Python',
		ids: ['PYTHON3', 'PYPY3'],
		runtime: 'Pyodide',
		stdin: 'Yes',
		editorSupport: 'Python LSP',
		debug: 'Trace',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'PYTHON'
		}
	},
	{
		language: 'Java',
		ids: ['JAVA'],
		runtime: 'TeaVM',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'JAVA'
		}
	},
	{
		language: 'Rust',
		ids: ['RUST'],
		runtime: 'wasm-rust / browser rustc',
		stdin: 'Yes',
		editorSupport: 'rustc diagnostics',
		debug: 'Trace',
		browserTest: {
			file: 'src/lib/playground/rust.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_RUST',
			marker: 'runRustBrowserProbe'
		}
	},
	{
		language: 'Go',
		ids: ['GO'],
		runtime: 'wasm-go / browser Go compiler',
		stdin: 'Yes',
		editorSupport: 'compiler diagnostics',
		debug: 'Trace',
		browserTest: {
			file: 'src/lib/playground/go.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_GO',
			marker: 'runGoBrowserProbe'
		}
	},
	{
		language: 'D',
		ids: ['D'],
		runtime: 'wasm-d',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/d.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_D',
			language: 'D'
		}
	},
	{
		language: 'C#',
		ids: ['CSHARP'],
		runtime: 'wasm-dotnet',
		stdin: 'Yes',
		editorSupport: 'compiler diagnostics',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'CSHARP'
		}
	},
	{
		language: 'F#',
		ids: ['FSHARP'],
		runtime: 'wasm-dotnet',
		stdin: 'Yes',
		editorSupport: 'compiler diagnostics',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'FSHARP'
		}
	},
	{
		language: 'VB.NET',
		ids: ['VBNET'],
		runtime: 'wasm-dotnet',
		stdin: 'Yes',
		editorSupport: 'compiler diagnostics',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'VBNET'
		}
	},
	{
		language: 'Elixir',
		ids: ['ELIXIR'],
		runtime: 'AtomVM / Popcorn',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'ELIXIR'
		}
	},
	{
		language: 'Erlang',
		ids: ['ERLANG'],
		runtime: 'AtomVM / Popcorn',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/erlang.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_ERLANG',
			language: 'ERLANG'
		}
	},
	{
		language: 'Prolog',
		ids: ['PROLOG'],
		runtime: 'SWI-Prolog WASM worker',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_PROLOG',
			language: 'PROLOG'
		}
	},
	{
		language: 'Gleam',
		ids: ['GLEAM'],
		runtime: 'Gleam precompiled browser runtime',
		stdin: 'Yes',
		editorSupport: 'compiler diagnostics',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_GLEAM',
			language: 'GLEAM'
		}
	},
	{
		language: 'Perl',
		ids: ['PERL'],
		runtime: 'Perl WASM worker',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_PERL',
			language: 'PERL'
		}
	},
	{
		language: 'Tcl',
		ids: ['TCL'],
		runtime: 'Wacl Tcl WASM worker',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_TCL',
			language: 'TCL'
		}
	},
	{
		language: 'AWK',
		ids: ['AWK'],
		runtime: 'GoAWK WASM worker',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_AWK',
			language: 'AWK'
		}
	},
	{
		language: 'Pascal',
		ids: ['PASCAL'],
		runtime: 'pas2js worker',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_PASCAL',
			language: 'PASCAL'
		}
	},
	{
		language: 'Forth',
		ids: ['FORTH'],
		runtime: 'WAForth WASM worker',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_FORTH',
			language: 'FORTH'
		}
	},
	{
		language: 'J',
		ids: ['J'],
		runtime: 'J playground WASM worker',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_J',
			language: 'J'
		}
	},
	{
		language: 'BQN',
		ids: ['BQN'],
		runtime: 'CBQN WASM worker',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_BQN',
			language: 'BQN'
		}
	},
	{
		language: 'Janet',
		ids: ['JANET'],
		runtime: 'Janet VM WASM worker',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_JANET',
			language: 'JANET'
		}
	},
	{
		language: 'Julia',
		ids: ['JULIA'],
		runtime: 'Julia 1.0.4 WASM worker',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_JULIA',
			language: 'JULIA'
		}
	},
	{
		language: 'Nim',
		ids: ['NIM'],
		runtime: 'Nim 2.2.4 WASM + clang/lld WASM',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_NIM',
			language: 'NIM'
		}
	},
	{
		language: 'Bash',
		ids: ['BASH'],
		runtime: 'GNU Bash WASIX / Wasmer SDK',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/bash.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_BASH',
			language: 'BASH'
		}
	},
	{
		language: 'ClojureScript',
		ids: ['CLOJURESCRIPT'],
		runtime: 'cljs.js self-hosted compiler',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/static-worker-runtimes.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_CLOJURESCRIPT',
			language: 'CLOJURESCRIPT'
		}
	},
	{
		language: 'TinyGo',
		ids: ['TINYGO'],
		runtime: 'wasm-tinygo',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/tinygo.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_TINYGO',
			marker: 'runTinyGoBrowserProbe'
		}
	},
	{
		language: 'OCaml',
		ids: ['OCAML'],
		runtime: 'wasm-of-js-of-ocaml / js_of_ocaml',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/ocaml.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_OCAML',
			marker: 'runOcamlBrowserProbe'
		}
	},
	{
		language: 'JavaScript',
		ids: ['JAVASCRIPT'],
		runtime: 'wasm-typescript / TypeScript service',
		stdin: 'Yes',
		editorSupport: 'TypeScript LSP',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'JAVASCRIPT'
		}
	},
	{
		language: 'TypeScript',
		ids: ['TYPESCRIPT'],
		runtime: 'wasm-typescript / TypeScript service',
		stdin: 'Yes',
		editorSupport: 'TypeScript LSP',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'TYPESCRIPT'
		}
	},
	{
		language: 'AssemblyScript',
		ids: ['ASSEMBLYSCRIPT'],
		runtime: 'AssemblyScript compiler',
		stdin: 'Yes',
		editorSupport: 'AssemblyScript LSP',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'ASSEMBLYSCRIPT'
		}
	},
	{
		language: 'WAT',
		ids: ['WAT'],
		runtime: 'WABT',
		stdin: 'Yes',
		editorSupport: 'WAT LSP',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'WAT'
		}
	},
	{
		language: 'WASM',
		ids: ['WASM'],
		runtime: 'Browser WebAssembly + WASI shim',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'WASM'
		}
	},
	{
		language: 'Lua',
		ids: ['LUA'],
		runtime: 'Wasmoon',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'LUA'
		}
	},
	{
		language: 'Zig',
		ids: ['ZIG'],
		runtime: 'zig_small.wasm',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'ZIG'
		}
	},
	{
		language: 'Scheme',
		ids: ['LISP'],
		runtime: 'Puppy Scheme / wasm-lisp',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'LISP'
		}
	},
	{
		language: 'Ruby',
		ids: ['RUBY'],
		runtime: 'CRuby WASI',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'RUBY'
		}
	},
	{
		language: 'Haskell',
		ids: ['HASKELL'],
		runtime: 'ghc-in-browser',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'HASKELL'
		}
	},
	{
		language: 'Fortran',
		ids: ['FORTRAN'],
		runtime: 'f2c + @wasm-idle/llvm-core',
		stdin: 'Yes',
		editorSupport: 'Fortran LSP',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_FORTRAN',
			language: 'FORTRAN'
		}
	},
	{
		language: 'COBOL',
		ids: ['COBOL'],
		runtime: 'GnuCOBOL 3.2 + @wasm-idle/llvm-core',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_COBOL',
			language: 'COBOL'
		}
	},
	{
		language: 'R',
		ids: ['R'],
		runtime: 'WebR',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'R'
		}
	},
	{
		language: 'Octave',
		ids: ['OCTAVE'],
		runtime: 'wasm-octave',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/octave.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_OCTAVE',
			language: 'OCTAVE'
		}
	},
	{
		language: 'DuckDB',
		ids: ['DUCKDB'],
		runtime: 'DuckDB-Wasm',
		stdin: 'Files',
		editorSupport: 'DuckDB LSP',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'DUCKDB'
		}
	},
	{
		language: 'SQLite',
		ids: ['SQLITE'],
		runtime: 'sql.js',
		stdin: 'n/a',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'SQLITE'
		}
	},
	{
		language: 'PHP',
		ids: ['PHP'],
		runtime: 'PHP 8.4 / php-wasm',
		stdin: 'Yes',
		editorSupport: 'syntax',
		debug: '-',
		browserTest: {
			file: 'src/lib/playground/stdin.playwright.test.ts',
			env: 'WASM_IDLE_RUN_REAL_BROWSER_STDIN',
			language: 'PHP'
		}
	}
];

/** @type {BlockedCandidateRow[]} */
export const blockedCandidateRows = [
	{
		language: 'Modern Fortran',
		candidateIds: ['F90', 'F95'],
		currentEvidence:
			`${code('FORTRAN')} now runs through f2c/libf2c, while ` +
			`${code('static/wasm-fortran')} still packages LFortran analyzer assets`,
		blocker:
			`LFortran WASM/WAT stdin codegen still aborts and the C backend reports ` +
			`${code('visit_FileRead() not implemented')}; f2c covers Fortran 77-style code but is not a full modern Fortran compiler`,
		requiredFollowUp:
			'Package a real browser modern Fortran compiler/runtime with stdin-capable codegen before advertising F90/F95 as first-class runtimes'
	},
	{
		language: 'Crystal',
		candidateIds: ['CRYSTAL'],
		currentEvidence:
			'No browser Crystal compiler/runtime assets are packaged in this repository',
		blocker:
			'Crystal cannot be treated as syntax-only or as a wasm-idle-authored translator/subset',
		requiredFollowUp:
			'Find or build a browser-hosted real Crystal compiler/runtime path with stdin/stdout coverage before registering the language'
	},
	{
		language: 'Swift',
		candidateIds: ['SWIFT'],
		currentEvidence:
			'Swift.org documents Wasm support through a native Swift 6.x toolchain plus a Wasm SDK, and SwiftWasm Pad uses a backend compile service; no browser-hosted swiftc/SwiftPM runtime asset is packaged here',
		blocker:
			'Swift cannot be implemented as a wasm-idle-authored parser/runtime subset or as a remote compile service; the playground needs a redistributable browser-hosted real Swift compiler path',
		requiredFollowUp:
			'Build or source a browser-hosted Swift compiler/SwiftPM runtime bundle, prove stdin/stdout execution for generated WASI modules, then register SWIFT as a first-class runtime'
	}
];

/**
 * @typedef {{
 *   packageBase: string;
 *   execution: string;
 *   customization: string;
 * }} RuntimeDetail
 */

/**
 * @param {string} runtimeKey
 * @param {string} envKey
 */
function staticWorkerCustomizationFor(runtimeKey, envKey = runtimeKey.toUpperCase()) {
	return (
		`${code(`runtimeAssets.${runtimeKey}.baseUrl`)}/${code(`runtimeAssets.${runtimeKey}.workerUrl`)} ` +
		`or ${code(`PUBLIC_WASM_${envKey}_BASE_URL`)}/${code(`PUBLIC_WASM_${envKey}_WORKER_URL`)}; ` +
		`${code('programArgs')}, ${code('activePath')}, ${code('workspaceFiles')}`
	);
}

/** @type {Map<string, RuntimeDetail>} */
const runtimeDetailsByLanguage = new Map([
	[
		'C',
		{
			packageBase:
				`${workspacePackage('packages/llvm-core')} / Clang 22.1.8 WASI sysroot ` +
				`from the ${code('wasm-llvm')} producer`,
			execution:
				`${code('clang')} for ${code('wasm32-wasi')}; default ${code('-std=gnu11')}; ` +
				`native gzip delivery for compiler Wasm and sysroot tar assets; ` +
				`WASI preview1 execution supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.clang.baseUrl')}/${code('loader')} or ${code('rootUrl')}; ` +
				`${code('compileArgs')}, ${code('programArgs')}, ${code('cVersion')}, ` +
				`${code('activePath')}, ${code('workspaceFiles')}`
		}
	],
	[
		'C++',
		{
			packageBase:
				`${workspacePackage('packages/llvm-core')} / Clang 22.1.8 WASI sysroot ` +
				`from the ${code('wasm-llvm')} producer`,
			execution:
				`${code('clang++')} for ${code('wasm32-wasi')}; default ${code('-std=gnu++2a')}; ` +
				`native gzip delivery for compiler Wasm and sysroot tar assets; ` +
				`trace debug uses wasm-idle controls; supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.clang.baseUrl')}/${code('loader')} or ${code('rootUrl')}; ` +
				`${code('compileArgs')}, ${code('programArgs')}, ${code('cppVersion')}, ` +
				`${code('activePath')}, ${code('workspaceFiles')}`
		}
	],
	[
		'Objective-C',
		{
			packageBase:
				`GNUstep libobjc2 v2.3 assets from the ${code('wasm-llvm')} producer + ` +
				`${workspacePackage('packages/llvm-core')}`,
			execution:
				`${code('clang -x objective-c -fobjc-runtime=gnustep-2.0 -fblocks')} for ` +
				`${code('wasm32-wasi')}; links ${code('libobjc.a')}, ${code('libgnustep-base.a')}, ` +
				`and ${code('libffi.a')} when Foundation is imported; Foundation headers are inlined ` +
				`from ${code('foundation-headers.json')}; includes a constructor wrapper for Objective-C ` +
				`class registration; auto-compiles ${code('.m')} and ${code('.c')} workspace sources; ` +
				`supports ${code('stdin')} and ${code('programArgs')}; large Objective-C assets may be ` +
				`served as gzip-only ${code('.gz')} files through the service worker or worker fallback`,
			customization:
				`${code('runtimeAssets.objectivec.baseUrl')}/${code('libobjcUrl')}/` +
				`${code('headersUrl')}/${code('libgnustepBaseUrl')}/${code('libgnustepBaseObjectUrl')}/` +
				`${code('foundationHeadersUrl')}/${code('libffiUrl')} ` +
				`or ${code('PUBLIC_WASM_OBJECTIVEC_*')}; ${code('runtimeAssets.clang.baseUrl')}/` +
				`${code('loader')} for the clang toolchain; ${code('activePath')}, ` +
				`${code('workspaceFiles')}, ${code('compileArgs')}`
		}
	],
	[
		'Python',
		{
			packageBase: `static ESM ${code('static/pyodide/pyodide.mjs')} / ${npmPackage('pyodide')}`,
			execution:
				`loads ${code('pyodide.mjs')}, ${code('pyodide.asm.js')}, ${code('pyodide.asm.wasm')}, and ` +
				`${code('python_stdlib.zip')} from the configured static asset tree on demand; supports ` +
				`${code('stdin')}, workspace files, and trace debugging`,
			customization:
				`${code('runtimeAssets.python.baseUrl')}/${code('loader')} or ${code('rootUrl')}; ` +
				`${code('stdin')}, ${code('activePath')}, ${code('workspaceFiles')}, ${code('debug')}, ` +
				`${code('breakpoints')}, ${code('pauseOnEntry')}, ${code('debugPath')}`
		}
	],
	[
		'Java',
		{
			packageBase: `${workspacePackage('runtimes/teavm')} / TeaVM compiler assets`,
			execution:
				`${code('compiler.wasm')} compiles Java to browser WASM/JS; ` +
				`supports ${code('stdin')} and ${code('programArgs')}`,
			customization: `${code('runtimeAssets.java.baseUrl')}/${code('loader')} or ${code('rootUrl')}`
		}
	],
	[
		'Rust',
		{
			packageBase:
				`${workspacePackage('runtimes/wasm-rust')} / ` +
				`${manifestValue('static/wasm-rust/runtime/runtime-manifest.v3.json', ['version'])} + ` +
				`integrated LLVM/LLD 22.1.8 from the ${code('wasm-llvm')} producer; ` +
				`${code('debug-instrumenter.js')} is a separately generated static asset`,
			execution:
				`browser host ${code('wasm32-wasip1-threads')}; ` +
				`${code('rustc -Zthreads=1 -Zcodegen-backend=llvm --crate-type=bin --edition=2024 -Cpanic=abort -Ccodegen-units=1 --emit=link')}; ` +
				`default target ${code('wasm32-wasip1')}, selectable ${codeList([
					'wasm32-wasip1',
					'wasm32-wasip2',
					'wasm32-wasip3'
				])}; Preview 1 emits core Wasm and Preview 2/3 are component-encoded; ` +
				`supports ${code('stdin')} and ${code('programArgs')}; the debug instrumenter is fetched only for debug runs`,
			customization:
				`${code('runtimeAssets.rust.compilerUrl')}, ${code('runtimeAssets.rust.debugModuleUrl')}, or ${code('PUBLIC_WASM_RUST_COMPILER_URL')}; ` +
				`${code('rootUrl')}, ${code('rustTargetTriple')}, ${code('programArgs')}; ` +
				`compiler requests accept ${code('edition')}, ${code('crateType')}, ${code('extendedTimeout')}, ${code('log')}, and ${code('onProgress')}; ` +
				`runtime manifest controls compiler memory, timeout, and shared workspace size`
		}
	],
	[
		'Go',
		{
			packageBase:
				`${workspacePackage('runtimes/wasm-go')} / ` +
				manifestValue('static/wasm-go/runtime/runtime-manifest.v1.json', ['goVersion']),
			execution: `default target ${code('wasip1/wasm')}; selectable ${codeList([
				'wasip1/wasm',
				'wasip2/wasm',
				'wasip3/wasm',
				'js/wasm'
			])}; supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.go.compilerUrl')} or ${code('PUBLIC_WASM_GO_COMPILER_URL')}; ` +
				`${code('goTarget')}, ${code('programArgs')}`
		}
	],
	[
		'D',
		{
			packageBase:
				`${workspacePackage('runtimes/wasm-d')} / ` +
				manifestValue('static/wasm-d/runtime/runtime-manifest.v1.json', ['version']),
			execution:
				`${code('ldc2 -conf=/toolchain/etc/ldc2.conf -mtriple=wasm32-wasi -c')} then ` +
				`${code('wasm-ld')} to WASI preview1; supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.d.moduleUrl')} or ${code('PUBLIC_WASM_D_MODULE_URL')}; ` +
				`${code('activePath')}, ${code('programArgs')}`
		}
	],
	[
		'C#',
		{
			packageBase:
				`${workspacePackage('runtimes/wasm-dotnet')} / .NET 9.0.16 browser-wasm / ` +
				`Roslyn C# 4.14.0`,
			execution:
				`${code('CSharpCompilationOptions(OutputKind.ConsoleApplication)')}; ` +
				`${code('concurrentBuild=false')}; target ${code('browser-wasm')}; ` +
				`language-specific AOT bundle ${code('runtime/csharp/')}; ` +
				`supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.dotnet.moduleUrl')} or ${code('PUBLIC_WASM_DOTNET_MODULE_URL')}; ` +
				`${code('programArgs')}, LSP on/off`
		}
	],
	[
		'F#',
		{
			packageBase:
				`${workspacePackage('runtimes/wasm-dotnet')} / .NET 9.0.16 browser-wasm / ` +
				`FCS 43.12.204 / FSharp.Core 10.1.204`,
			execution:
				`${code('fsc.exe --target:exe --targetprofile:netcore --noframework --simpleresolution --nowin32manifest --debug- --optimize-')}; ` +
				`language-specific AOT bundle ${code('runtime/fsharp/')}; ` +
				`supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.dotnet.moduleUrl')} or ${code('PUBLIC_WASM_DOTNET_MODULE_URL')}; ` +
				`${code('programArgs')}, LSP on/off`
		}
	],
	[
		'VB.NET',
		{
			packageBase:
				`${workspacePackage('runtimes/wasm-dotnet')} / .NET 9.0.16 browser-wasm / ` +
				`Roslyn Visual Basic 4.14.0`,
			execution:
				`${code('VisualBasicCompilationOptions(OutputKind.ConsoleApplication)')}; ` +
				`${code('concurrentBuild=false')}, ${code('OptionStrict=Off')}, ` +
				`${code('OptionInfer=On')}, ${code('OptionExplicit=On')}; target ${code('browser-wasm')}; ` +
				`language-specific AOT bundle ${code('runtime/vbnet/')}; ` +
				`supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.dotnet.moduleUrl')} or ${code('PUBLIC_WASM_DOTNET_MODULE_URL')}; ` +
				`${code('programArgs')}, LSP on/off`
		}
	],
	[
		'Elixir',
		{
			packageBase: `wasm-elixir asset bundle / ${npmPackage('@swmansion/popcorn')}`,
			execution: `Popcorn/AtomVM bundle ${code('bundle.avm')}; supports ${code('stdin')}`,
			customization: `${code('runtimeAssets.elixir.bundleUrl')} or ${code('PUBLIC_WASM_ELIXIR_BUNDLE_URL')}`
		}
	],
	[
		'Erlang',
		{
			packageBase: `wasm-elixir asset bundle / ${npmPackage('@swmansion/popcorn')}`,
			execution: `Popcorn/AtomVM bundle ${code('bundle.avm')}; supports ${code('stdin')}`,
			customization:
				`${code('runtimeAssets.erlang.bundleUrl')} or ${code('PUBLIC_WASM_ERLANG_BUNDLE_URL')}; ` +
				`falls back to Elixir bundle URL`
		}
	],
	[
		'Prolog',
		{
			packageBase: `${npmPackage('swipl-wasm')} synced into ${code('static/wasm-prolog')}`,
			execution: `static worker runs SWI-Prolog; supports ${code('stdin')} and ${code('programArgs')}`,
			customization: staticWorkerCustomizationFor('prolog')
		}
	],
	[
		'Gleam',
		{
			packageBase: `${npmPackage('@live-codes/gleam-precompiled')} static worker`,
			execution: `Gleam worker compiles/runs browser output with source manifest; supports ${code('stdin')}`,
			customization:
				`${code('runtimeAssets.gleam.baseUrl')}/${code('workerUrl')}/${code('manifestUrl')} or ` +
				`${code('PUBLIC_WASM_GLEAM_*')}; ${code('programArgs')}, ${code('workspaceFiles')}`
		}
	],
	[
		'Perl',
		{
			packageBase:
				`WebPerl ${manifestValue('static/wasm-perl/runtime-manifest.v1.json', ['version'])} ` +
				`(${manifestValue('static/wasm-perl/runtime-manifest.v1.json', ['package'])})`,
			execution: `static worker runs ${code('emperl')}; supports ${code('stdin')} and ${code('programArgs')}`,
			customization: staticWorkerCustomizationFor('perl')
		}
	],
	[
		'Tcl',
		{
			packageBase:
				`Wacl Tcl ${manifestValue('static/wasm-tcl/runtime-manifest.v1.json', ['version'])} ` +
				`(${manifestValue('static/wasm-tcl/runtime-manifest.v1.json', ['package'])})`,
			execution: `static worker runs Wacl Tcl; supports ${code('stdin')} and ${code('programArgs')}`,
			customization: staticWorkerCustomizationFor('tcl', 'TCL')
		}
	],
	[
		'AWK',
		{
			packageBase:
				`GoAWK ${manifestValue('static/wasm-awk/runtime-manifest.v1.json', ['goawkVersion'])} / ` +
				manifestValue('static/wasm-awk/runtime-manifest.v1.json', ['goVersion']),
			execution: `static worker runs ${code('goawk.wasm')}; supports ${code('stdin')} and ${code('programArgs')}`,
			customization: staticWorkerCustomizationFor('awk', 'AWK')
		}
	],
	[
		'Pascal',
		{
			packageBase:
				`pas2js ${manifestValue('static/wasm-pascal/runtime-manifest.v1.json', ['pas2jsVersion'])} ` +
				`(${manifestValue('static/wasm-pascal/runtime-manifest.v1.json', ['pas2jsCommit'])})`,
			execution: `static worker compiles with pas2js then runs JS; supports ${code('stdin')}`,
			customization: staticWorkerCustomizationFor('pascal')
		}
	],
	[
		'Forth',
		{
			packageBase: `${npmPackage('waforth')} / static worker`,
			execution: `WAForth worker; supports ${code('stdin')} and ${code('programArgs')}`,
			customization: staticWorkerCustomizationFor('forth')
		}
	],
	[
		'J',
		{
			packageBase: `${manifestValue('static/wasm-j/runtime-manifest.v1.json', ['runtime']) || 'jsoftware-j-playground'} static worker`,
			execution: `J playground worker; supports ${code('stdin')} and ${code('programArgs')}`,
			customization: staticWorkerCustomizationFor('j', 'J')
		}
	],
	[
		'BQN',
		{
			packageBase:
				`CBQN static worker / Emscripten ` +
				manifestValue('static/wasm-bqn/runtime-manifest.v1.json', ['build', 'emscripten']),
			execution: `CBQN worker; supports ${code('stdin')} and ${code('programArgs')}`,
			customization: staticWorkerCustomizationFor('bqn', 'BQN')
		}
	],
	[
		'Janet',
		{
			packageBase:
				`Janet static worker / Emscripten ` +
				manifestValue('static/wasm-janet/runtime-manifest.v1.json', [
					'build',
					'emscripten'
				]),
			execution: `Janet VM worker; supports ${code('stdin')} and ${code('programArgs')}`,
			customization: staticWorkerCustomizationFor('janet')
		}
	],
	[
		'Julia',
		{
			packageBase: manifestValue('static/wasm-julia/runtime-manifest.v1.json', ['package']),
			execution: `Julia WASM worker; supports ${code('stdin')} and ${code('programArgs')}`,
			customization: staticWorkerCustomizationFor('julia')
		}
	],
	[
		'Nim',
		{
			packageBase: `Nim 2.2.4 / benagastov Nim-WASM-Compiler with clang/lld WASM`,
			execution: `static worker compiles Nim to C, then clang/lld to WASM; supports ${code('stdin')}`,
			customization: staticWorkerCustomizationFor('nim')
		}
	],
	[
		'Bash',
		{
			packageBase:
				`${workspacePackage('runtimes/wasm-bash')} / GNU Bash WASIX + static ESM ` +
				`${code('static/wasm-bash/sdk/index.mjs')} produced from ${npmPackage('@wasmer/sdk')}`,
			execution:
				`runs the pinned ${code('bash.webc')} locally through the on-demand Wasmer SDK asset; invokes ` +
				`${code('bash -c <code> <activePath> ...programArgs')} and supports ` +
				`${code('stdin')}, ${code('programArgs')}, ${code('activePath')}, and ${code('workspaceFiles')}`,
			customization:
				`${code('runtimeAssets.bash.moduleUrl')}/${code('workerUrl')}/${code('webcUrl')} or ` +
				`${code('rootUrl')}; ${code('stdin')}, ${code('programArgs')}, ${code('activePath')}, ` +
				`${code('workspaceFiles')}`
		}
	],
	[
		'ClojureScript',
		{
			packageBase:
				`${workspacePackage('runtimes/wasm-clojurescript')} / ClojureScript ` +
				manifestValue('static/wasm-clojurescript/runtime-manifest.v1.json', [
					'clojureScriptVersion'
				]),
			execution:
				`static worker compiles and evaluates with the official ${code('cljs.js')} self-hosted compiler; ` +
				`supports ${code('stdin')}, ${code('programArgs')}, ${code('activePath')}, and ${code('workspaceFiles')}`,
			customization: staticWorkerCustomizationFor('clojurescript', 'CLOJURESCRIPT')
		}
	],
	[
		'TinyGo',
		{
			packageBase: `${workspacePackage('runtimes/wasm-tinygo')} / TinyGo 0.40.1 browser toolchain`,
			execution: `default target ${code('wasm')}; selectable ${codeList([
				'wasm',
				'wasip1',
				'wasip2',
				'wasip3'
			])}; supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.tinygo.moduleUrl')}/${code('appUrl')}/${code('assetLoader')}/${code('assetPacks')}; ` +
				`${code('PUBLIC_WASM_TINYGO_*')}, ${code('tinygoTarget')}, ${code('programArgs')}`
		}
	],
	[
		'OCaml',
		{
			packageBase: `${workspacePackage('runtimes/wasm-of-js-of-ocaml')} / js_of_ocaml + wasm_of_ocaml`,
			execution:
				`default backend ${code('wasm')}; selectable ${codeList(['wasm', 'js'])}; ` +
				`${code('ocamlWasmBinaryenMode')} ${codeList(['fast', 'full'])}; supports ${code('stdin')}`,
			customization:
				`${code('runtimeAssets.ocaml.moduleUrl')}/${code('manifestUrl')} or ` +
				`${code('PUBLIC_WASM_OCAML_*')}; ${code('ocamlBackend')}`
		}
	],
	[
		'JavaScript',
		{
			packageBase: `${workspacePackage('runtimes/wasm-typescript')} / ${workspaceDependency(
				'runtimes/wasm-typescript',
				'@swc/wasm-typescript'
			)}`,
			execution: `TypeScript service transpiles JS/TS and runs in browser sandbox; supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.typescript.moduleUrl')}/${code('libUrl')} or ` +
				`${code('PUBLIC_WASM_TYPESCRIPT_MODULE_URL')}`
		}
	],
	[
		'TypeScript',
		{
			packageBase: `${workspacePackage('runtimes/wasm-typescript')} / ${workspaceDependency(
				'runtimes/wasm-typescript',
				'@swc/wasm-typescript'
			)}`,
			execution: `TypeScript service transpiles then runs in browser sandbox; supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.typescript.moduleUrl')}/${code('libUrl')} or ` +
				`${code('PUBLIC_WASM_TYPESCRIPT_MODULE_URL')}`
		}
	],
	[
		'AssemblyScript',
		{
			packageBase:
				`static ESM ${code('static/wasm-assemblyscript/runtime.mjs')} produced from ` +
				`${npmPackage('assemblyscript')} + ${npmPackage('@assemblyscript/loader')}`,
			execution:
				`${code('asc <activePath> --outFile module.wasm --runtime incremental --bindings raw --optimize --exportRuntime')}; ` +
				`runs the emitted WASM through WASI/browser imports and supports ${code('stdin')}`,
			customization:
				`${code('runtimeAssets.assemblyscript.moduleUrl')} or ` +
				`${code('PUBLIC_WASM_ASSEMBLYSCRIPT_MODULE_URL')} or ${code('rootUrl')}; ` +
				`${code('stdin')}, ${code('activePath')}, ${code('workspaceFiles')}`
		}
	],
	[
		'WAT',
		{
			packageBase: `${workspacePackage('runtimes/wasm-wat')} / ${workspaceDependency(
				'runtimes/wasm-wat',
				'wabt'
			)}`,
			execution: `WABT parses WAT to WASM then runs through WASI shim; supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.wat.moduleUrl')} or ${code('PUBLIC_WASM_WAT_MODULE_URL')}; ` +
				`${code('programArgs')}`
		}
	],
	[
		'WASM',
		{
			packageBase: `Browser WebAssembly + ${npmPackage('@bjorn3/browser_wasi_shim')}`,
			execution: `loads provided WASM bytes and executes with WASI preview1 imports; supports ${code('stdin')} and ${code('programArgs')}`,
			customization: `${code('programArgs')}, ${code('stdin')}, ${code('activePath')}`
		}
	],
	[
		'Lua',
		{
			packageBase: `${workspacePackage('runtimes/wasm-lua')} / ${workspaceDependency(
				'runtimes/wasm-lua',
				'wasmoon'
			)}`,
			execution: `Wasmoon Lua VM; supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.lua.moduleUrl')} or ${code('PUBLIC_WASM_LUA_MODULE_URL')}; ` +
				`${code('programArgs')}`
		}
	],
	[
		'Zig',
		{
			packageBase: `static wasm-zig assets / ${code('zig_small.wasm')} + ${code('std.tar.gz')}`,
			execution:
				`native gzip delivery for the tar standard library; default target ${code('wasm64-wasi')}; ` +
				`Zig compile args are appended; supports ` +
				`${code('stdin')}, ${code('compileArgs')}, ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.zig.compilerUrl')}/${code('stdlibUrl')} or ${code('PUBLIC_WASM_ZIG_*')}; ` +
				`${code('zigTargetTriple')}, ${code('activePath')}, ${code('workspaceFiles')}`
		}
	],
	[
		'Scheme',
		{
			packageBase: `${workspacePackage('runtimes/wasm-lisp')} / Puppy Scheme WASM component`,
			execution: `Puppy Scheme compiler/runtime; supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.lisp.moduleUrl')} or ${code('PUBLIC_WASM_LISP_MODULE_URL')}; ` +
				`${code('programArgs')}`
		}
	],
	[
		'Ruby',
		{
			packageBase:
				`static ESM ${code('static/wasm-ruby/runtime.mjs')} produced from ` +
				`${npmPackage('@ruby/3.4-wasm-wasi')} + ${npmPackage('@ruby/wasm-wasi')}`,
			execution:
				`CRuby 3.4 WASI runtime loads ${code('ruby+stdlib.wasm')} on demand; supports ` +
				`${code('stdin')}, ${code('programArgs')}, and workspace files`,
			customization:
				`${code('runtimeAssets.ruby.moduleUrl')}/${code('wasmUrl')} or ` +
				`${code('PUBLIC_WASM_RUBY_MODULE_URL')}/${code('PUBLIC_WASM_RUBY_WASM_URL')} or ` +
				`${code('rootUrl')}; ${code('stdin')}, ${code('programArgs')}, ${code('workspaceFiles')}`
		}
	],
	[
		'Haskell',
		{
			packageBase: `ghc-in-browser / GHC 9.14.0.20251031 WASI rootfs`,
			execution:
				`loads ${code('dyld.mjs')}, ${code('rootfs.tar.zst')}, ${code('bsdtar.wasm')}; ` +
				`${code('compileArgs')} become GHC args, otherwise legacy ${code('args')} become GHC args`,
			customization:
				`${code('runtimeAssets.haskell.moduleUrl')}/${code('rootfsUrl')}/${code('bsdtarUrl')}; ` +
				`${code('mainSoPath')}, ${code('searchDirs')}, ${code('activePath')}, ${code('workspaceFiles')}`
		}
	],
	[
		'Fortran',
		{
			packageBase:
				`Netlib f2c 2022-09-09 + ${code('@cowasm/f2c 1.0.0')} libf2c + ` +
				`${workspacePackage('packages/llvm-core')}`,
			execution:
				`runs ${code('f2c.wasm')} in WASI, compiles generated C with the llvm-core Clang host, links ` +
				`${code('libf2c.a')}, then executes the resulting WASI module with ${code('stdin')} and ` +
				`${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.fortran.baseUrl')}/${code('f2cWasmUrl')}/${code('libf2cUrl')}/` +
				`${code('f2cHeaderUrl')}/${code('analyzerUrl')} or ${code('PUBLIC_WASM_FORTRAN_*')}; ` +
				`${code('runtimeAssets.clang.baseUrl')}/${code('loader')} for the C backend; ` +
				`${code('activePath')}, ${code('workspaceFiles')}, ${code('compileArgs')}`
		}
	],
	[
		'COBOL',
		{
			packageBase:
				`GnuCOBOL 3.2 + GMP 6.3.0 assets from the ${code('wasm-llvm')} producer + ` +
				`${workspacePackage('packages/llvm-core')}`,
			execution:
				`native gzip delivery for the frontend Wasm and filesystem tar assets; translates free-format COBOL ` +
				`with the real GnuCOBOL ${code('cobc')} frontend, compiles ` +
				`the generated C with the llvm-core Clang host, links libcob/GMP, and executes the resulting WASI module ` +
				`with ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.cobol.baseUrl')} or ${code('PUBLIC_WASM_COBOL_BASE_URL')}; ` +
				`${code('runtimeAssets.clang.baseUrl')}/${code('loader')} for the C backend; ` +
				`${code('activePath')}, ${code('workspaceFiles')}, ${code('compileArgs')}`
		}
	],
	[
		'R',
		{
			packageBase: `versioned static ${code('static/webr/<hash>/webr.js')} / ${npmPackage('webr')}`,
			execution:
				`loads the browser ESM entry ${code('webr.js')} and its WebR runtime files from the configured static asset tree ` +
				`on demand; supports ${code('stdin')}, ${code('programArgs')}, and workspace files`,
			customization:
				`${code('runtimeAssets.r.baseUrl')} or ${code('PUBLIC_WASM_R_BASE_URL')}; ` +
				`${code('stdin')}, ${code('programArgs')}, ${code('activePath')}, ${code('workspaceFiles')}`
		}
	],
	[
		'Octave',
		{
			packageBase:
				`Octave ${manifestValue('static/wasm-octave/runtime/runtime-manifest.v1.json', ['version'])} ` +
				`(${manifestValue('static/wasm-octave/runtime/runtime-manifest.v1.json', ['package'])})`,
			execution: `Octave CLI Emscripten worker; supports ${code('stdin')} and ${code('programArgs')}`,
			customization:
				`${code('runtimeAssets.octave.baseUrl')}/${code('workerUrl')}/${code('manifestUrl')} or ` +
				`${code('PUBLIC_WASM_OCTAVE_*')}`
		}
	],
	[
		'DuckDB',
		{
			packageBase:
				`static ESM ${code('static/wasm-duckdb/runtime.mjs')} produced from ` +
				`${npmPackage('@duckdb/duckdb-wasm')}`,
			execution:
				`selects the best DuckDB-Wasm MVP/EH bundle on demand and creates a fresh in-memory ` +
				`database per run; ${code('stdin')} is registered as ${code('stdin.txt')} and ` +
				`${code('/dev/stdin')} rather than terminal stdin`,
			customization:
				`${code('runtimeAssets.duckdb.moduleUrl')} or ${code('PUBLIC_WASM_DUCKDB_MODULE_URL')} ` +
				`or ${code('rootUrl')}; ${code('stdin')}, ${code('activePath')}, ${code('workspaceFiles')}`
		}
	],
	[
		'SQLite',
		{
			packageBase: `static ESM ${code('static/wasm-sqlite/runtime.mjs')} produced from ${npmPackage('sql.js')}`,
			execution:
				`sql.js loads ${code('sql-wasm.wasm')} on demand and executes SQL in a fresh in-memory ` +
				`database; terminal stdin is not applicable`,
			customization:
				`${code('runtimeAssets.sqlite.moduleUrl')}/${code('wasmUrl')} or ` +
				`${code('PUBLIC_WASM_SQLITE_MODULE_URL')}/${code('PUBLIC_WASM_SQLITE_WASM_URL')} or ` +
				`${code('rootUrl')}; ${code('workspaceFiles')}`
		}
	],
	[
		'PHP',
		{
			packageBase:
				`static ESM ${code('static/wasm-php/runtime.mjs')} produced from ` +
				`${npmPackage('@php-wasm/web-8-4')} + ${npmPackage('@php-wasm/universal')}`,
			execution:
				`fixed PHP ${code('8.4')} php-wasm runtime; injects ${code('$argv')}/${code('$argc')} and ` +
				`runs the active workspace script with ${code('php.run')}; supports ${code('stdin')} and ` +
				`${code('programArgs')}; there is no runtime version selector`,
			customization:
				`${code('runtimeAssets.php.moduleUrl')} or ${code('PUBLIC_WASM_PHP_MODULE_URL')} or ` +
				`${code('rootUrl')}; ${code('stdin')}, ${code('programArgs')}, ${code('activePath')}, ` +
				`${code('workspaceFiles')}`
		}
	]
]);

/**
 * @param {string} value
 * @param {number} width
 */
function padCell(value, width) {
	return String(value).padEnd(width);
}

/**
 * @param {readonly SupportMatrixRow[]} rows
 */
export function renderSupportMatrixTable(rows = supportMatrixRows) {
	const headers = ['Language', 'Browser runtime/compiler', 'Stdin', 'Editor support', 'Debug'];
	const tableRows = rows.map((row) => [
		row.language,
		row.runtime,
		row.stdin,
		row.editorSupport,
		row.debug
	]);
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...tableRows.map((row) => row[index].length))
	);
	const headerLine = `| ${headers.map((header, index) => padCell(header, widths[index])).join(' | ')} |`;
	const dividerLine = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
	return [
		headerLine,
		dividerLine,
		...tableRows.map(
			(row) => `| ${row.map((cell, index) => padCell(cell, widths[index])).join(' | ')} |`
		)
	].join('\n');
}

/**
 * @param {readonly SupportMatrixRow[]} rows
 */
export function renderRuntimeDetailsTable(rows = supportMatrixRows) {
	const headers = [
		'Language / IDs',
		'Package/version base',
		'Execution defaults / flags',
		'Customization'
	];
	const tableRows = rows.map((row) => {
		const detail = runtimeDetailsByLanguage.get(row.language);
		if (!detail) throw new Error(`Missing runtime detail row for ${row.language}`);
		return [
			`${row.language}<br>${codeList(row.ids)}`,
			detail.packageBase,
			detail.execution,
			detail.customization
		];
	});
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...tableRows.map((row) => row[index].length))
	);
	const headerLine = `| ${headers.map((header, index) => padCell(header, widths[index])).join(' | ')} |`;
	const dividerLine = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
	return [
		headerLine,
		dividerLine,
		...tableRows.map(
			(row) => `| ${row.map((cell, index) => padCell(cell, widths[index])).join(' | ')} |`
		)
	].join('\n');
}

/** @param {readonly BlockedCandidateRow[]} rows */
export function renderBlockedCandidatesTable(rows = blockedCandidateRows) {
	const headers = [
		'Candidate',
		'Candidate IDs',
		'Current evidence',
		'Blocker',
		'Required follow-up'
	];
	const tableRows = rows.map((row) => [
		row.language,
		codeList(row.candidateIds),
		row.currentEvidence,
		row.blocker,
		row.requiredFollowUp
	]);
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...tableRows.map((row) => row[index].length))
	);
	const headerLine = `| ${headers.map((header, index) => padCell(header, widths[index])).join(' | ')} |`;
	const dividerLine = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
	return [
		headerLine,
		dividerLine,
		...tableRows.map(
			(row) => `| ${row.map((cell, index) => padCell(cell, widths[index])).join(' | ')} |`
		)
	].join('\n');
}

/**
 * @param {readonly SupportMatrixRow[]} rows
 */
export function renderSupportMatrixSection(rows = supportMatrixRows) {
	return `${SUPPORT_MATRIX_START}

All execution entries run in the browser through real runtime, compiler, or interpreter
implementations. \`Editor support\` lists browser LSP/compiler diagnostics when wired; \`syntax\`
means Monaco syntax highlighting only. \`Debug\` means wasm-idle's trace/debug controls, not a
native debugger.

${renderSupportMatrixTable(rows)}

### Runtime details

\`Package/version base\` names the deployed static module or manifest and its producer package,
or the browser-side package/workspace runtime that backs each row. Static ESM entries are page
assets loaded over HTTP on demand, not files embedded in the published npm packages.
\`Execution defaults / flags\` lists the default
targets and flags wasm-idle applies, plus the public per-run options that change execution.
\`Customization\` lists the \`runtimeAssets\` fields and matching \`PUBLIC_WASM_*\` env overrides
when they exist.

${renderRuntimeDetailsTable(rows)}

### Blocked candidates

These languages are intentionally not part of the execution support matrix yet. They should stay
out of \`supportedLanguages\` until the blocker is resolved with a real browser runtime/compiler and
stdin/stdout coverage.

${renderBlockedCandidatesTable()}
`;
}

/**
 * @param {string} source
 * @param {string} fileName
 * @param {string} exportName
 */
function extractStringArrayFromExportedConst(source, fileName, exportName) {
	const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	/** @type {string[] | null} */
	let values = null;
	/** @param {import('typescript').Node} node */
	function visit(node) {
		if (
			ts.isVariableStatement(node) &&
			node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
		) {
			for (const declaration of node.declarationList.declarations) {
				let initializer = declaration.initializer;
				while (
					initializer &&
					(ts.isAsExpression(initializer) ||
						ts.isSatisfiesExpression(initializer) ||
						ts.isParenthesizedExpression(initializer))
				) {
					initializer = initializer.expression;
				}
				if (
					ts.isIdentifier(declaration.name) &&
					declaration.name.text === exportName &&
					initializer &&
					ts.isArrayLiteralExpression(initializer)
				) {
					values = initializer.elements.map((element) => {
						if (!ts.isStringLiteral(element)) {
							throw new Error(
								`${exportName} in ${fileName} must contain string literals only`
							);
						}
						return element.text;
					});
				}
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	if (!values) throw new Error(`Could not find exported const ${exportName} in ${fileName}`);
	return values;
}

/** @param {string} rootDir */
export async function readSupportedLanguageIds(rootDir = process.cwd()) {
	const filePath = path.join(rootDir, 'packages/core/src/languages.ts');
	const source = await fs.readFile(filePath, 'utf8');
	return extractStringArrayFromExportedConst(source, filePath, 'supportedLanguageIds');
}

/**
 * @param {readonly string[]} actual
 * @param {readonly string[]} expected
 * @param {string} message
 */
function assertSameSet(actual, expected, message) {
	const actualSet = new Set(actual);
	const expectedSet = new Set(expected);
	const missing = expected.filter((value) => !actualSet.has(value));
	const extra = actual.filter((value) => !expectedSet.has(value));
	if (missing.length || extra.length) {
		throw new Error(
			`${message}\nmissing: ${missing.join(', ') || '<none>'}\nextra: ${
				extra.join(', ') || '<none>'
			}`
		);
	}
}

/** @param {string} readme */
function extractReadmeSupportMatrixSection(readme) {
	const startIndex = readme.indexOf(SUPPORT_MATRIX_START);
	const endIndex = readme.indexOf(SUPPORT_MATRIX_END);
	if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
		throw new Error('README support matrix markers were not found');
	}
	return readme.slice(startIndex, endIndex).trimEnd();
}

/**
 * @param {string} readme
 * @param {string} nextSection
 */
function replaceReadmeSupportMatrixSection(readme, nextSection) {
	const startIndex = readme.indexOf(SUPPORT_MATRIX_START);
	const endIndex = readme.indexOf(SUPPORT_MATRIX_END);
	if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
		throw new Error('README support matrix markers were not found');
	}
	return `${readme.slice(0, startIndex)}${nextSection.trimEnd()}\n\n${readme.slice(endIndex)}`;
}

/** @param {string} rootDir */
export async function validateSupportMatrix(rootDir = process.cwd()) {
	const matrixIds = supportMatrixRows.flatMap((row) => row.ids);
	const blockedCandidateIds = blockedCandidateRows.flatMap((row) => row.candidateIds);
	if (new Set(matrixIds).size !== matrixIds.length) {
		throw new Error('support matrix rows contain duplicate language ids');
	}
	for (const blockedId of blockedCandidateIds) {
		if (matrixIds.includes(blockedId)) {
			throw new Error(`${blockedId} is still listed as a blocked candidate`);
		}
	}
	for (const row of supportMatrixRows) {
		if (!runtimeDetailsByLanguage.has(row.language)) {
			throw new Error(`${row.language} must declare runtime detail metadata`);
		}
	}
	for (const language of runtimeDetailsByLanguage.keys()) {
		if (!supportMatrixRows.some((row) => row.language === language)) {
			throw new Error(`${language} runtime detail metadata has no support matrix row`);
		}
	}
	assertSameSet(
		matrixIds,
		await readSupportedLanguageIds(rootDir),
		'support matrix rows must match packages/core/src/languages.ts supportedLanguageIds'
	);

	const readmePath = path.join(rootDir, 'README.md');
	const readme = await fs.readFile(readmePath, 'utf8');
	const actualSection = extractReadmeSupportMatrixSection(readme);
	const expectedSection = renderSupportMatrixSection().trimEnd();
	if (actualSection !== expectedSection) {
		throw new Error('README support matrix is stale. Run `pnpm run support:matrix`.');
	}

	for (const row of supportMatrixRows) {
		if (!row.browserTest) {
			throw new Error(`${row.language} must declare a browser execution test`);
		}
		const testPath = path.join(rootDir, row.browserTest.file);
		const source = await fs.readFile(testPath, 'utf8');
		if (!source.includes(row.browserTest.env)) {
			throw new Error(`${row.language} browser IO test is missing ${row.browserTest.env}`);
		}
		const marker = row.browserTest.language
			? `language: '${row.browserTest.language}'`
			: row.browserTest.marker;
		if (!marker || !source.includes(marker)) {
			throw new Error(`${row.language} browser IO test marker is missing: ${marker}`);
		}
	}
}

export async function writeReadmeSupportMatrix(rootDir = process.cwd()) {
	const readmePath = path.join(rootDir, 'README.md');
	const readme = await fs.readFile(readmePath, 'utf8');
	const nextReadme = replaceReadmeSupportMatrixSection(readme, renderSupportMatrixSection());
	await fs.writeFile(readmePath, nextReadme);
}

const mode = process.argv[2];
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	if (mode === 'write') {
		await writeReadmeSupportMatrix();
	} else if (mode === 'check') {
		await validateSupportMatrix();
	} else {
		console.error('Usage: node scripts/support-matrix.mjs <write|check>');
		process.exitCode = 1;
	}
}
