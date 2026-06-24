import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const SUPPORT_MATRIX_START = '## Support matrix';
const SUPPORT_MATRIX_END = '## Monorepo layout';

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
 */

/** @type {SupportMatrixRow[]} */
export const supportMatrixRows = [
	{
		language: 'C',
		ids: ['C'],
		runtime: 'wasm-clang / Clang WASI',
		stdin: 'Blocked',
		editorSupport: 'clangd',
		debug: '-'
	},
	{
		language: 'C++',
		ids: ['CPP'],
		runtime: 'wasm-clang / Clang WASI',
		stdin: 'Blocked',
		editorSupport: 'clangd',
		debug: 'Trace'
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
		stdin: 'Blocked',
		editorSupport: 'compiler diagnostics',
		debug: '-'
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
		stdin: 'No',
		editorSupport: 'syntax',
		debug: '-'
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
		runtime: 'php-wasm',
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
export function renderSupportMatrixSection(rows = supportMatrixRows) {
	return `${SUPPORT_MATRIX_START}

All execution entries run in the browser through real runtime, compiler, or interpreter
implementations. \`Editor support\` lists browser LSP/compiler diagnostics when wired; \`syntax\`
means Monaco syntax highlighting only. \`Debug\` means wasm-idle's trace/debug controls, not a
native debugger.

${renderSupportMatrixTable(rows)}
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
				if (
					ts.isIdentifier(declaration.name) &&
					declaration.name.text === exportName &&
					declaration.initializer &&
					ts.isArrayLiteralExpression(declaration.initializer)
				) {
					values = declaration.initializer.elements.map((element) => {
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
	const filePath = path.join(rootDir, 'src/lib/playground/index.ts');
	const source = await fs.readFile(filePath, 'utf8');
	return extractStringArrayFromExportedConst(source, filePath, 'supportedLanguages');
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
	if (new Set(matrixIds).size !== matrixIds.length) {
		throw new Error('support matrix rows contain duplicate language ids');
	}
	assertSameSet(
		matrixIds,
		await readSupportedLanguageIds(rootDir),
		'support matrix rows must match src/lib/playground/index.ts supportedLanguages'
	);

	const readmePath = path.join(rootDir, 'README.md');
	const readme = await fs.readFile(readmePath, 'utf8');
	const actualSection = extractReadmeSupportMatrixSection(readme);
	const expectedSection = renderSupportMatrixSection().trimEnd();
	if (actualSection !== expectedSection) {
		throw new Error('README support matrix is stale. Run `pnpm run support:matrix`.');
	}

	for (const row of supportMatrixRows) {
		if (row.stdin === 'No' || row.stdin === 'Blocked') continue;
		if (!row.browserTest) {
			throw new Error(`${row.language} must declare a browser IO test`);
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
