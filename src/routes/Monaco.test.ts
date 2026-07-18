import pageSource from './+page.svelte?raw';
import source from './Monaco.svelte?raw';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import {
	editorDefaults,
	isEditorDefaultSource,
	isLegacyEditorDefaultSource,
	legacyBrokenFsharpEditorDefault,
	legacyBrokenTinyGoEditorDefault,
	resolveEditorDefaultSource,
	rustEditorDefaults
} from './editor-defaults';
import {
	clangdLspLanguages,
	debugLspLanguages,
	diagnosticMarkerLanguages,
	monacoLanguageContributionLoaders,
	runtimeLspCapabilities
} from './language-registry';

describe('Monaco route debug sync', () => {
	it('keeps the debug view reactive and applies markers immediately after creation', () => {
		expect(() =>
			compile(source, {
				filename: 'src/routes/Monaco.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).not.toMatch(/clangdBaseUrl\s*=\s*DEFAULT_CLANGD_BASE_URL/);
		expect(source).toMatch(/import type MonacoEditorComponent from '@seorii\/monaco';/);
		expect(source).toMatch(/from '@seorii\/monaco';/);
		expect(source).toMatch(/import\('@seorii\/monaco'\)/);
		expect(source).toMatch(/import\('@seorii\/monaco\/workers'\)/);
		expect(source).not.toMatch(/from '\$lib\/clangd\/session'/);
		expect(source).not.toMatch(/from '\$lib\/clangd\/config'/);
		expect(source).not.toMatch(/from '\$lib\/lsp\/goSession'/);
		expect(source).not.toMatch(/from '\$lib\/lsp\/rustSession'/);
		expect(source).not.toMatch(/@hancomac\/monaco-languageclient/);
		expect(source).not.toMatch(/Monaco\.editor\.create\(/);
		expect(source).toMatch(/let debugView = \$state<MonacoDebugView \| null>\(null\);/);
		expect(source).toMatch(/let Monaco = \$state<typeof monaco \| null>\(null\);/);
		expect(source).toMatch(
			/let MonacoEditor = \$state<typeof MonacoEditorComponent \| null>\(null\);/
		);
		expect(source).toMatch(/lspEnabled\?: boolean;/);
		expect(source).toMatch(/lspEnabled = false,/);
		expect(source).toMatch(/clangdEnabled\?: boolean;/);
		expect(source).toMatch(/clangdEnabled = false,/);
		expect(source).toMatch(/dotnetLspEnabled\?: boolean;/);
		expect(source).toMatch(/dotnetLspEnabled = false,/);
		expect(source).toMatch(/elixirLspEnabled\?: boolean;/);
		expect(source).toMatch(/erlangLspEnabled\?: boolean;/);
		expect(source).toMatch(/gleamLspEnabled\?: boolean;/);
		expect(source).toMatch(/gleamLspEnabled = false,/);
		expect(source).toMatch(/tclLspEnabled\?: boolean;/);
		expect(source).toMatch(/tclLspEnabled = false,/);
		expect(source).toMatch(/pascalLspEnabled\?: boolean;/);
		expect(source).toMatch(/pascalLspEnabled = false,/);
		expect(source).toMatch(/goLspEnabled\?: boolean;/);
		expect(source).toMatch(/goLspEnabled = false,/);
		expect(source).toMatch(/rustLspEnabled\?: boolean;/);
		expect(source).toMatch(/rustLspEnabled = false,/);
		expect(source).toMatch(/lspLanguage\?: string;/);
		expect(source).toMatch(/typescriptLspLibUrl\?: string;/);
		expect(source).toMatch(/const activeLspLanguage = \$derived\(lspLanguage \|\| language\);/);
		expect(source).toMatch(/filePath\?: string;/);
		expect(source).toMatch(
			/import \{\s+isEditorDefaultSource,\s+isLegacyEditorDefaultSource,\s+resolveEditorDefaultSource\s+\} from '\.\/editor-defaults';/s
		);
		expect(monacoLanguageContributionLoaders.pascal).toEqual(expect.any(Function));
		expect(source).toMatch(
			/monacoApi\.editor\.setModelMarkers\(activeModel, 'wasm-idle-compiler', markers\);/
		);
		expect(source).toMatch(/occurrencesHighlight: 'off'/);
		expect(source).toMatch(
			/const modelUriString = \$derived\(`file:\/\/\/workspace\/\$\{normalizedFilePath\}`\);/
		);
		expect(source).toMatch(
			/globalThis as typeof globalThis & \{ MonacoEnvironment\?: unknown \}/
		);
		expect(source).toMatch(/MonacoEnvironment =\s+workers\.createMonacoEnvironment\(\);/s);
		expect(source).toMatch(/<MonacoEditor[\s\S]*lsp=\{resolveLspConnection\}/);
		expect(source).toMatch(/onload=\{handleEditorLoad\}/);
		expect(source).toMatch(/oninput=\{handleEditorInput\}/);
		for (const markerLanguage of [
			'c',
			'java',
			'rust',
			'go',
			'd',
			'csharp',
			'fsharp',
			'vb',
			'elixir',
			'erlang',
			'prolog',
			'gleam',
			'perl',
			'pascal',
			'awk',
			'ocaml',
			'wat',
			'wasm',
			'lua',
			'janet',
			'julia',
			'nim',
			'lisp',
			'haskell',
			'r',
			'octave',
			'cpp',
			'json',
			'yaml',
			'toml',
			'html',
			'css',
			'markdown'
		]) {
			expect(diagnosticMarkerLanguages.has(markerLanguage)).toBe(true);
		}
		expect(source).toMatch(/lspLanguage === 'duckdb' \? 'duckdb'/);
		expect(source).toMatch(
			/\$effect\(\(\) => \{\s+const activeModel = model \|\| editor\?\.getModel\(\);[\s\S]*if \(!isEditorDefaultSource\(currentValue\) && !isLegacyEditorDefaultSource\(currentValue\)\) \{[\s\S]*activeModel\.setValue\(defaultValue\);[\s\S]*\}\s+\}\);/s
		);
		const defaultValueBlock = source.slice(
			source.indexOf('const defaultValue = $derived'),
			source.indexOf('const normalizedFilePath')
		);
		for (const defaultLanguage of ['wat', 'wasm', 'duckdb', 'sqlite', 'rust']) {
			expect(defaultValueBlock).toContain(`| '${defaultLanguage}'`);
		}
		expect(defaultValueBlock).toContain('rustTargetTriple');
		expect(source).toMatch(/id: 'd'/);
		expect(source).toMatch(/aliases: \['D', 'd'\]/);
		expect(source).toMatch(/extensions: \['\.d'\]/);
		expect(source).toMatch(
			/monacoApi\.languages\.setMonarchTokensProvider\('d', dMonarchTokens\);/
		);
		expect(source).toMatch(
			/monacoApi\.languages\.setMonarchTokensProvider\('zig', zigMonarchTokens\);/
		);
		expect(source).toMatch(/id: 'wasm'/);
		expect(source).toMatch(/aliases: \['WASM', 'WebAssembly Binary', 'wasm'\]/);
		expect(source).toMatch(/extensions: \['\.wasm'\]/);
		expect(source).toMatch(
			/monacoApi\.languages\.setMonarchTokensProvider\('wasm', wasmMonarchTokens\);/
		);
		expect(source).toMatch(/let wasmLspStatus = \$state<LanguageServerStatus>/);
		expect(source).toMatch(/label = 'WASM LSP';/);
		expect(source).toMatch(/let pascalLspStatus = \$state<LanguageServerStatus>/);
		expect(source).toMatch(/label = 'Pascal LSP';/);
		expect(source).toMatch(
			/const \{ getWasmLanguageServer \} = await import\('@wasm-idle\/lsp\/wasm'\);/
		);
		expect(source).toMatch(/label = 'Elixir LSP';/);
		expect(source).toMatch(/label = 'Erlang LSP';/);
		expect(source).toMatch(
			/const \{ getElixirLanguageServer \} = await import\('@wasm-idle\/lsp\/elixir'\);/
		);
		expect(source).toMatch(
			/const \{ getErlangLanguageServer \} = await import\('@wasm-idle\/lsp\/erlang'\);/
		);
		expect(source).toMatch(
			/const nextDebugView = new MonacoDebugView\(monacoApi, activeEditor, onBreakpointsChange\);[\s\S]*debugView = nextDebugView;/s
		);
		expect(source).toMatch(/onCursorLineChange\?: \(line: number \| null\) => void;/);
		expect(source).toMatch(/onRunToCursor\?: \(line: number \| null\) => void;/);
		expect(source).toMatch(
			/import \{ attachMonacoDebugActions, MonacoDebugView \} from '\$lib';/
		);
		expect(source).toMatch(/let debugActionBindings: \{ dispose\(\): void \} \| null = null;/);
		expect(source).toMatch(
			/debugActionBindings = attachMonacoDebugActions\(activeEditor, \{\s+onCursorLineChange,\s+onRunToCursor\s+\}\);/s
		);
		expect(source).toMatch(/debugActionBindings\?\.dispose\(\);/);
		expect(source).toMatch(
			/import type \{ EditorLanguageServerHandle, LanguageServerStatus \} from '@wasm-idle\/lsp';/
		);
		expect(source).not.toMatch(/^\s*import \{[^\n]*\} from '@wasm-idle\/lsp';/m);
		expect(source).toMatch(/type MonacoLspStatusView = \{/);
		expect(source).toMatch(/progressPercent: number \| null;/);
		expect(source).toMatch(/lspStatus\?: MonacoLspStatusView \| null;/);
		expect(source).toMatch(/lspStatus = \$bindable<MonacoLspStatusView \| null>\(null\),/);
		expect(source).toMatch(
			/const activeLspStatusView = \$derived\.by<MonacoLspStatusView \| null>\(\(\) => \{/
		);
		expect(source).toMatch(
			/route\.setStatus\(\{ state: 'loading', stage: 'startup', loaded: 0, total: 1 \}\);/
		);
		expect(source).toMatch(
			/const fraction = Math\.max\(0, Math\.min\(status\.loaded \/ status\.total, 1\)\);/
		);
		expect(source).toMatch(/progressPercent = Math\.round\(fraction \* 100\);/);
		expect(source).toMatch(/lspStatus = activeLspStatusView;/);
		expect(source).toMatch(/const lspRoutes: LspRoute\[] = \[/);
		expect(source).toMatch(/function disableAllLspStatuses\(\) \{/);
		expect(source).toMatch(/if \(!lspEnabled\) \{\s+disableAllLspStatuses\(\);/);
		expect(source).toMatch(/const route = lspRoutes\.find/);
		expect(source).toMatch(
			/async \(_providerLanguage: string, context\?: MonacoLspProviderContext\)/
		);
		expect(source).toMatch(/context\?\.signal\?\.aborted \|\| key !== lspConnectionKey/);
		expect(source).toMatch(/const connection = await route\.load\(currentUrl\);/);
		expect(source).toMatch(/connection\.dispose\(\);/);
		expect(source).toMatch(/return connection as unknown as Exclude/);
		expect(source).not.toMatch(/manualDocumentSync/);
		expect(source).not.toMatch(/withMonacoDocumentSync/);
		expect(source).not.toMatch(/recordLspTraffic/);
		expect(source).not.toMatch(/lspOptions=\{/);
		expect(source).toMatch(
			/const \{ getCppLanguageServer \} = await import\('@wasm-idle\/lsp\/clangd'\);/
		);
		expect(source).not.toMatch(/await import\('@wasm-idle\/lsp'\)/);
		for (const entrypoint of [
			'python',
			'dotnet',
			'gleam',
			'd',
			'tcl',
			'pascal',
			'go',
			'rust',
			'typescript',
			'assemblyscript',
			'wat',
			'zig',
			'lua',
			'janet',
			'lisp',
			'ocaml',
			'haskell',
			'fortran',
			'graphql',
			'sql',
			'prolog',
			'ruby',
			'r',
			'octave',
			'awk',
			'perl',
			'document'
		]) {
			expect(source).toContain(`import('@wasm-idle/lsp/${entrypoint}')`);
		}
		expect(source).toMatch(/handle\.syncFile\?\.\(normalizedFilePath\);/);
		expect(source).toMatch(/getCSharpLanguageServer/);
		expect(source).toMatch(/getFSharpLanguageServer/);
		expect(source).toMatch(/getVisualBasicLanguageServer/);
		expect(source).toMatch(/getGleamLanguageServer/);
		expect(source).toMatch(/getDLanguageServer/);
		expect(source).toMatch(/getTclLanguageServer/);
		expect(source).toMatch(/getPascalLanguageServer/);
		expect(source).toMatch(/getGoLanguageServer/);
		expect(source).toMatch(/getRustLanguageServer/);
		expect(source).toMatch(/getTypeScriptLanguageServer/);
		expect(source).toMatch(/getJavaScriptLanguageServer/);
		expect(source).toMatch(/getAssemblyScriptLanguageServer/);
		expect(source).toMatch(/getWatLanguageServer/);
		expect(source).toMatch(/getZigLanguageServer/);
		expect(source).toMatch(/getLuaLanguageServer/);
		expect(source).toMatch(/getJanetLanguageServer/);
		expect(source).toMatch(/getLispLanguageServer/);
		expect(source).toMatch(/getOcamlLanguageServer/);
		expect(source).toMatch(/getHaskellLanguageServer/);
		expect(source).toMatch(/getFortranLanguageServer/);
		expect(source).toMatch(/getGraphqlLanguageServer/);
		expect(source).toMatch(/getDuckDbLanguageServer/);
		expect(source).toMatch(/getJsonLanguageServer/);
		expect(source).toMatch(/getYamlLanguageServer/);
		expect(source).toMatch(/getTomlLanguageServer/);
		expect(source).toMatch(/getHtmlLanguageServer/);
		expect(source).toMatch(/getCssLanguageServer/);
		expect(source).toMatch(/getMarkdownLanguageServer/);
		expect(source).toMatch(/getRLanguageServer/);
		expect(source).toMatch(/getOctaveLanguageServer/);
		expect(source).toMatch(/getAwkLanguageServer/);
		expect(source).toMatch(/getPerlLanguageServer/);
		expect(source).toMatch(/languages: \['c', 'cpp', 'objective-c'\]/);
		expect(source).toMatch(/case 'objective-c':\s+label = 'Objective-C LSP';/);
		expect(source).toMatch(/languages: \['d'\]/);
		expect(source).toMatch(/languages: \['tcl'\]/);
		expect(source).toMatch(/languages: \['pascal'\]/);
		expect(source).toMatch(/languages: \['r'\]/);
		expect(source).toMatch(/languages: \['octave'\]/);
		expect(source).toMatch(/languages: \['awk'\]/);
		expect(source).toMatch(/languages: \['perl'\]/);
		expect(source).toMatch(/languages: \['janet'\]/);
		expect(source).toMatch(/languages: \['lisp'\]/);
		expect(source).toMatch(/languages: \['fortran'\]/);
		expect(source).toMatch(/languages: \['graphql'\]/);
		expect(source).toMatch(/languages: \['duckdb'\]/);
		expect(source).toMatch(/languages: \['json', 'yaml', 'toml', 'html', 'css', 'markdown'\]/);
		expect(source).toMatch(/id: 'fortran'/);
		expect(source).toMatch(
			/monacoApi\.languages\.setMonarchTokensProvider\('fortran', fortranMonarchTokens\);/
		);
		expect(source).toMatch(/id: 'cobol'/);
		expect(source).toMatch(
			/monacoApi\.languages\.setMonarchTokensProvider\('cobol', cobolMonarchTokens\);/
		);
		expect(source).toMatch(/id: 'julia'/);
		expect(source).toMatch(
			/monacoApi\.languages\.setMonarchTokensProvider\('julia', juliaMonarchTokens\);/
		);
		expect(source).toMatch(/id: 'nim'/);
		expect(source).toMatch(
			/monacoApi\.languages\.setMonarchTokensProvider\('nim', nimMonarchTokens\);/
		);
		expect(source).toMatch(/id: 'toml'/);
		expect(source).toMatch(
			/monacoApi\.languages\.setMonarchTokensProvider\('toml', tomlMonarchTokens\);/
		);
		expect(source).toMatch(/typescript: \{ libUrl: typescriptLspLibUrl \}/);
		expect(source).toMatch(/javascript: \{ libUrl: typescriptLspLibUrl \}/);
		expect(source).toMatch(/moduleUrl: duckDbLspModuleUrl \|\| ''/);
		expect(source).not.toMatch(/@duckdb\/duckdb-wasm\/dist/);
		for (const statusKey of ['json', 'yaml', 'toml', 'html', 'css', 'markdown']) {
			expect(source).toMatch(new RegExp(`${statusKey}: documentLspStatus`));
		}
		expect(source).not.toMatch(/clangd ready/);
		expect(source).not.toMatch(/clangd loading/);
		expect(source).not.toMatch(/clangd failed:/);
		expect(source).not.toMatch(/class="clangd-status"/);
	});

	it('keeps starter sources wired for stdin examples', () => {
		expect(resolveEditorDefaultSource('go', 'wasm32-wasip1')).toBe(editorDefaults.go);
		expect(resolveEditorDefaultSource('d', 'wasm32-wasip1')).toBe(editorDefaults.d);
		expect(resolveEditorDefaultSource('c', 'wasm32-wasip1')).toBe(editorDefaults.c);
		expect(resolveEditorDefaultSource('csharp', 'wasm32-wasip1')).toBe(editorDefaults.csharp);
		expect(resolveEditorDefaultSource('fsharp', 'wasm32-wasip1')).toBe(editorDefaults.fsharp);
		expect(resolveEditorDefaultSource('vbnet', 'wasm32-wasip1')).toBe(editorDefaults.vbnet);
		expect(resolveEditorDefaultSource('elixir', 'wasm32-wasip1')).toBe(editorDefaults.elixir);
		expect(resolveEditorDefaultSource('erlang', 'wasm32-wasip1')).toBe(editorDefaults.erlang);
		expect(resolveEditorDefaultSource('prolog', 'wasm32-wasip1')).toBe(editorDefaults.prolog);
		expect(resolveEditorDefaultSource('gleam', 'wasm32-wasip1')).toBe(editorDefaults.gleam);
		expect(resolveEditorDefaultSource('perl', 'wasm32-wasip1')).toBe(editorDefaults.perl);
		expect(resolveEditorDefaultSource('pascal', 'wasm32-wasip1')).toBe(editorDefaults.pascal);
		expect(resolveEditorDefaultSource('forth', 'wasm32-wasip1')).toBe(editorDefaults.forth);
		expect(resolveEditorDefaultSource('j', 'wasm32-wasip1')).toBe(editorDefaults.j);
		expect(resolveEditorDefaultSource('bqn', 'wasm32-wasip1')).toBe(editorDefaults.bqn);
		expect(resolveEditorDefaultSource('janet', 'wasm32-wasip1')).toBe(editorDefaults.janet);
		expect(resolveEditorDefaultSource('julia', 'wasm32-wasip1')).toBe(editorDefaults.julia);
		expect(resolveEditorDefaultSource('nim', 'wasm32-wasip1')).toBe(editorDefaults.nim);
		expect(resolveEditorDefaultSource('lua', 'wasm32-wasip1')).toBe(editorDefaults.lua);
		expect(resolveEditorDefaultSource('wat', 'wasm32-wasip1')).toBe(editorDefaults.wat);
		expect(resolveEditorDefaultSource('wasm', 'wasm32-wasip1')).toBe(editorDefaults.wasm);
		expect(resolveEditorDefaultSource('sqlite', 'wasm32-wasip1')).toBe(editorDefaults.sqlite);
		expect(resolveEditorDefaultSource('fortran', 'wasm32-wasip1')).toBe(editorDefaults.fortran);
		expect(resolveEditorDefaultSource('cobol', 'wasm32-wasip1')).toBe(editorDefaults.cobol);
		expect(resolveEditorDefaultSource('graphql', 'wasm32-wasip1')).toBe(editorDefaults.graphql);
		expect(resolveEditorDefaultSource('duckdb', 'wasm32-wasip1')).toBe(editorDefaults.duckdb);
		expect(resolveEditorDefaultSource('php', 'wasm32-wasip1')).toBe(editorDefaults.php);
		expect(resolveEditorDefaultSource('json', 'wasm32-wasip1')).toBe(editorDefaults.json);
		expect(resolveEditorDefaultSource('yaml', 'wasm32-wasip1')).toBe(editorDefaults.yaml);
		expect(resolveEditorDefaultSource('toml', 'wasm32-wasip1')).toBe(editorDefaults.toml);
		expect(resolveEditorDefaultSource('html', 'wasm32-wasip1')).toBe(editorDefaults.html);
		expect(resolveEditorDefaultSource('css', 'wasm32-wasip1')).toBe(editorDefaults.css);
		expect(resolveEditorDefaultSource('markdown', 'wasm32-wasip1')).toBe(
			editorDefaults.markdown
		);
		expect(editorDefaults.c).toContain('puts("Hello, WebAssembly!")');
		expect(editorDefaults.go).toContain("ReadString('\\n')");
		expect(editorDefaults.d).toContain('stdin.readln()');
		expect(editorDefaults.csharp).toContain('Console.WriteLine');
		expect(editorDefaults.vbnet).toContain('Console.ReadLine()');
		expect(editorDefaults.go).toContain(
			'fmt.Printf("factorial_plus_bonus=%d\\n", factorial(n)+bonus)'
		);
		expect(editorDefaults.elixir).toContain('defmodule Demo do');
		expect(editorDefaults.elixir).toContain('Demo.run()');
		expect(editorDefaults.elixir).toContain('IO.gets("")');
		expect(editorDefaults.elixir).toContain('Integer.parse(String.trim(line))');
		expect(editorDefaults.erlang).toContain('io:get_line("")');
		expect(editorDefaults.erlang).toContain('io:format("stdin=~s"');
		expect(editorDefaults.prolog).toContain('read_line_to_string(user_input, Line)');
		expect(editorDefaults.gleam).toContain('stdin.read_line()');
		expect(editorDefaults.perl).toContain('my $line = <STDIN>;');
		expect(editorDefaults.pascal).toContain('ReadLn(Line);');
		expect(editorDefaults.forth).toContain('KEY DUP 10 <>');
		expect(editorDefaults.j).toContain('1!:1 [ 1');
		expect(editorDefaults.bqn).toContain('•GetLine @');
		expect(editorDefaults.janet).toContain('(getline)');
		expect(editorDefaults.julia).toContain('readline()');
		expect(editorDefaults.nim).toContain('stdin.readLine()');
		expect(editorDefaults.lua).toContain('io.read("*l")');
		expect(editorDefaults.haskell).toContain('putStrLn');
		expect(editorDefaults.r).toContain('readLines(stdin(), n = 1');
		expect(editorDefaults.octave).toContain('fgetl(stdin)');
		expect(editorDefaults.sqlite).toContain('CREATE TABLE numbers');
		expect(editorDefaults.php).toContain("file_get_contents('php://input')");
		expect(isEditorDefaultSource(editorDefaults.c)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.go)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.d)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.csharp)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.fsharp)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.vbnet)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.elixir)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.erlang)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.prolog)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.gleam)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.perl)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.pascal)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.forth)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.j)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.bqn)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.janet)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.julia)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.nim)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.lua)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.haskell)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.r)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.octave)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.fortran)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.cobol)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.graphql)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.duckdb)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.wasm)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.sqlite)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.php)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.json)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.yaml)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.toml)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.html)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.css)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.markdown)).toBe(true);
		expect(isEditorDefaultSource(rustEditorDefaults['wasm32-wasip1'])).toBe(true);
		expect(isLegacyEditorDefaultSource(legacyBrokenTinyGoEditorDefault)).toBe(true);
		expect(isLegacyEditorDefaultSource(legacyBrokenFsharpEditorDefault)).toBe(true);
		expect(isLegacyEditorDefaultSource(editorDefaults.go)).toBe(false);
		expect(isLegacyEditorDefaultSource(editorDefaults.fsharp)).toBe(false);
	});

	it('requests clangd only after cpp debug starts', () => {
		expect(() =>
			compile(pageSource, {
				filename: 'src/routes/+page.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(pageSource).toMatch(/clangdRequested = \$state\(false\),/);
		expect(debugLspLanguages.has('CPP')).toBe(true);
		expect(clangdLspLanguages.has('C')).toBe(true);
		expect(clangdLspLanguages.has('CPP')).toBe(true);
		expect(clangdLspLanguages.has('OBJC')).toBe(true);
		expect(source).toMatch(/languages: \['c', 'cpp', 'objective-c'\]/);
		expect(pageSource).toMatch(
			/if \(enableDebug && debugLspLanguages\.has\(language\)\) clangdRequested = true;/
		);
		expect(pageSource).toMatch(
			/if \(!debugLspLanguages\.has\(language\)\) clangdRequested = false;/
		);
		expect(pageSource).toMatch(/<option value="RUST">Rust<\/option>/);
		expect(pageSource).toMatch(/<option value="GO">Go<\/option>/);
		expect(pageSource).toMatch(/<option value="D">D<\/option>/);
		expect(pageSource).toMatch(/<option value="CSHARP">C#<\/option>/);
		expect(pageSource).toMatch(/<option value="FSHARP">F#<\/option>/);
		expect(pageSource).toMatch(/<option value="VBNET">VB\.NET<\/option>/);
		expect(pageSource).toMatch(/<option value="ELIXIR">Elixir<\/option>/);
		expect(pageSource).toMatch(/<option value="ERLANG">Erlang<\/option>/);
		expect(pageSource).toMatch(/<option value="PROLOG">Prolog<\/option>/);
		expect(pageSource).toMatch(/<option value="GLEAM">Gleam<\/option>/);
		expect(pageSource).toMatch(/<option value="PERL">Perl<\/option>/);
		expect(pageSource).toMatch(/<option value="JANET">Janet<\/option>/);
		expect(pageSource).toMatch(/<option value="JULIA">Julia<\/option>/);
		expect(pageSource).toMatch(/<option value="NIM">Nim<\/option>/);
		expect(pageSource).toMatch(/<option value="OCAML">OCaml<\/option>/);
		expect(pageSource).toMatch(/<option value="TINYGO">TinyGo<\/option>/);
		expect(pageSource).toMatch(/<option value="JAVASCRIPT">JavaScript<\/option>/);
		expect(pageSource).toMatch(/<option value="TYPESCRIPT">TypeScript<\/option>/);
		expect(pageSource).toMatch(/<option value="WAT">WAT<\/option>/);
		expect(pageSource).toMatch(/<option value="LUA">Lua<\/option>/);
		expect(pageSource).toMatch(/<option value="ZIG">Zig<\/option>/);
		expect(pageSource).toMatch(/<option value="LISP">Scheme<\/option>/);
		expect(pageSource).toMatch(/<option value="HASKELL">Haskell<\/option>/);
		expect(pageSource).toMatch(/<option value="R">R<\/option>/);
		expect(pageSource).toMatch(/<option value="OCTAVE">Octave<\/option>/);
		expect(pageSource).toMatch(/<option value="FORTRAN">Fortran<\/option>/);
		expect(pageSource).toMatch(/<option value="COBOL">COBOL<\/option>/);
		expect(pageSource).toMatch(/<option value="GRAPHQL">GraphQL<\/option>/);
		expect(pageSource).toMatch(/<option value="DUCKDB">DuckDB<\/option>/);
		expect(pageSource).toMatch(/<option value="JSON">JSON<\/option>/);
		expect(pageSource).toMatch(/<option value="YAML">YAML<\/option>/);
		expect(pageSource).toMatch(/<option value="TOML">TOML<\/option>/);
		expect(pageSource).toMatch(/<option value="HTML">HTML<\/option>/);
		expect(pageSource).toMatch(/<option value="CSS">CSS<\/option>/);
		expect(pageSource).toMatch(/<option value="MARKDOWN">Markdown<\/option>/);
		expect(pageSource).toMatch(/language=\{editorLanguage\}/);
		expect(pageSource).toMatch(/lspLanguage=\{monacoLspLanguage\}/);
		expect(pageSource).toMatch(/filePath=\{activePath\}/);
		expect(pageSource).toMatch(/const monacoLspLanguage = \$derived/);
		expect(runtimeLspCapabilities.RUST).toBe('rust');
		expect(runtimeLspCapabilities.GO).toBe('go');
		expect(runtimeLspCapabilities.D).toBe('d');
		expect(runtimeLspCapabilities.TCL).toBe('tcl');
		expect(runtimeLspCapabilities.PASCAL).toBe('pascal');
		expect(runtimeLspCapabilities.ELIXIR).toBe('elixir');
		expect(runtimeLspCapabilities.ERLANG).toBe('erlang');
		expect(runtimeLspCapabilities.R).toBe('r');
		expect(runtimeLspCapabilities.OCTAVE).toBe('octave');
		expect(runtimeLspCapabilities.AWK).toBe('awk');
		expect(runtimeLspCapabilities.PERL).toBe('perl');
		expect(runtimeLspCapabilities.WASM).toBe('wasm');
		expect(runtimeLspCapabilities.JANET).toBe('janet');
		expect(runtimeLspCapabilities.LISP).toBe('lisp');
		expect(runtimeLspCapabilities.FORTRAN).toBe('fortran');
		expect(pageSource).toMatch(
			/const typescriptLspLibUrl = \$derived\(\s+lspEnabled && typescriptLspLanguages\.has\(language\)/
		);
		expect(pageSource).toMatch(
			/<select id="rust-target-triple" bind:value=\{rustTargetTriple\}>/
		);
		expect(pageSource).toMatch(/<select id="tinygo-target" bind:value=\{tinygoTarget\}>/);
		expect(pageSource).toMatch(/<select id="ocaml-backend" bind:value=\{ocamlBackend\}>/);
		expect(pageSource).toMatch(
			/<select id="ocaml-binaryen-mode" bind:value=\{ocamlWasmBinaryenMode\}>/
		);
		expect(pageSource).toMatch(/WASM_ELIXIR_ASSET_VERSION/);
		expect(pageSource).toMatch(
			/import elixirRuntimeWorkerUrl from '\$lib\/playground\/worker\/elixir\?worker&url';/
		);
		expect(pageSource).toMatch(/const elixirLspEnabled = \$derived/);
		expect(pageSource).toMatch(/const erlangLspEnabled = \$derived/);
		expect(pageSource).toMatch(/elixirLspWorkerUrl=\{beamLspWorkerUrl\}/);
		expect(pageSource).toMatch(/erlangLspWorkerUrl=\{beamLspWorkerUrl\}/);
		expect(pageSource).toMatch(/wasm-elixir\/bundle\.avm\?v=\$\{WASM_ELIXIR_ASSET_VERSION\}/);
		expect(pageSource).toMatch(/WASM_OCAML_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_TYPESCRIPT_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_SWIFT_ASSET_VERSION/);
		expect(pageSource).toMatch(
			/lsp\/typescript-libs\.json\.gz\?v=\$\{WASM_TYPESCRIPT_ASSET_VERSION\}/
		);
		expect(pageSource).toMatch(/WASM_WAT_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_LUA_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_ZIG_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_LISP_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_HASKELL_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_R_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_OCTAVE_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_D_ASSET_VERSION/);
		expect(pageSource).toMatch(/wasm-d\/index\.js\?v=\$\{WASM_D_ASSET_VERSION\}/);
		expect(pageSource).toMatch(
			/wasm-of-js-of-ocaml\/browser-native\/src\/index\.js\?v=\$\{WASM_OCAML_ASSET_VERSION\}/
		);
		expect(pageSource).toMatch(
			/wasm-of-js-of-ocaml\/browser-native-bundle\/browser-native-manifest\.v1\.json\?v=\$\{WASM_OCAML_ASSET_VERSION\}/
		);
		expect(pageSource).toMatch(
			/wasm-swift\/runtime-manifest\.v1\.json\?v=\$\{WASM_SWIFT_ASSET_VERSION\}/
		);
		expect(pageSource).toMatch(
			/\{#each availableRustTargetTriples as targetTriple \(targetTriple\)\}\s+<option value=\{targetTriple\}>\{targetTriple\}<\/option>\s+\{\/each\}/s
		);
		expect(pageSource).toMatch(/runtime-manifest\.v3\.json\?v=\$\{WASM_RUST_ASSET_VERSION\}/);
		expect(pageSource).toMatch(/preloadBrowserRustRuntime/);
		expect(pageSource).toMatch(/preloadBrowserGoRuntime/);
		expect(pageSource).toMatch(
			/const playground = \$derived\.by\(\(\) => createPlaygroundBinding\(runtimeAssets\)\);/
		);
		expect(pageSource).toMatch(/lspEnabled = \$state\(false\),/);
		expect(pageSource).toMatch(/id="lsp-toggle"/);
		expect(pageSource).toMatch(/type EditorLspStatusView = \{/);
		expect(pageSource).toMatch(/progressPercent: number \| null;/);
		expect(pageSource).toMatch(
			/editorLspStatus = \$state<EditorLspStatusView \| null>\(null\),/
		);
		expect(pageSource).toMatch(/class="lsp-status lsp-status--\{editorLspStatus\.state\}"/);
		expect(pageSource).toMatch(/data-lsp-state=\{editorLspStatus\.state\}/);
		expect(pageSource).toMatch(/class="lsp-status__progress"/);
		expect(pageSource).toMatch(/role="progressbar"/);
		expect(pageSource).toMatch(
			/--lsp-progress-scale: \$\{editorLspStatus\.progressPercent \/ 100\};/
		);
		expect(pageSource).toMatch(/bind:lspStatus=\{editorLspStatus\}/);
		expect(pageSource).toMatch(/version: 5,/);
		expect(pageSource).toMatch(
			/if \(typeof value\?\.lspEnabled === 'boolean'\) lspEnabled = value\.lspEnabled;/
		);
		expect(pageSource).toMatch(/clangdEnabled=\{clangdLspEnabled\}/);
		expect(pageSource).toMatch(/const dotnetLspEnabled = \$derived/);
		expect(pageSource).toMatch(/dotnetLspLanguages\.has\(language\)/);
		for (const capability of [
			'gleam',
			'd',
			'tcl',
			'go',
			'rust',
			'zig',
			'lua',
			'janet',
			'lisp',
			'ocaml',
			'haskell',
			'octave'
		]) {
			expect(pageSource).toContain(`activeRuntimeLspCapability === '${capability}'`);
		}
		for (const prop of [
			'dotnetLspModuleUrl',
			'gleamLspBaseUrl',
			'gleamLspManifestUrl',
			'dLspModuleUrl',
			'tclLspBaseUrl',
			'tclLspWorkerUrl',
			'goLspCompilerUrl',
			'rustLspCompilerUrl',
			'zigLspCompilerUrl',
			'zigLspStdlibUrl',
			'luaLspModuleUrl',
			'janetLspBaseUrl',
			'janetLspWorkerUrl',
			'lispLspModuleUrl',
			'ocamlLspModuleUrl',
			'ocamlLspManifestUrl',
			'haskellLspModuleUrl',
			'haskellLspRootfsUrl',
			'haskellLspBsdtarUrl',
			'octaveLspBaseUrl',
			'octaveLspWorkerUrl',
			'octaveLspManifestUrl'
		]) {
			expect(pageSource).toContain(`{${prop}}`);
		}
	});

	it('keeps the editor pane shrinkable for the resizable example layout', () => {
		expect(source).toMatch(/<div class="editor-host">[\s\S]*<MonacoEditor/);
		expect(source).toMatch(
			/main \{\s+flex: 1;\s+min-width: 0;\s+min-height: 0;\s+display: flex;/s
		);
		expect(source).toMatch(/overflow: hidden;/);
		expect(source).toMatch(/\.editor-host \{\s+flex: 1;\s+min-height: 0;\s+\}/s);
		expect(source).toMatch(
			/@media \(max-width: 960px\) \{\s+main \{\s+min-height: 360px;\s+border-left: 0;\s+border-top: 1px solid #e5e7eb;\s+\}\s+\}/s
		);
	});

	it('does not keep the legacy monaco-languageclient in the app shell', async () => {
		const packageJson = JSON.parse(
			await readFile(path.resolve(process.cwd(), 'package.json'), 'utf8')
			) as {
				dependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};
		const viteConfig = await readFile(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');
		const libIndex = await readFile(path.resolve(process.cwd(), 'src/lib/index.ts'), 'utf8');

		expect(packageJson.devDependencies?.['@seorii/monaco']).toBe('0.1.1');
		expect(packageJson.dependencies).not.toHaveProperty('@seorii/monaco');
		expect(packageJson.dependencies).not.toHaveProperty('@hancomac/monaco-languageclient');
		expect(viteConfig).not.toContain('@hancomac/monaco-languageclient');
		expect(viteConfig).not.toContain('vscode-compatibility');
		expect(libIndex).not.toContain('$lib/lsp');
		expect(libIndex).not.toContain('@wasm-idle/lsp');
	});

	it('serves the app with cross-origin isolation headers for browser compiler runtimes', async () => {
		const viteConfig = await readFile(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');
		const pagesHeaders = await readFile(path.resolve(process.cwd(), 'static/_headers'), 'utf8');

		for (const sourceText of [viteConfig, pagesHeaders]) {
			expect(sourceText).toContain('Cross-Origin-Opener-Policy');
			expect(sourceText).toContain('same-origin');
			expect(sourceText).toContain('Cross-Origin-Embedder-Policy');
			expect(sourceText).toContain('require-corp');
			expect(sourceText).toContain('Cross-Origin-Resource-Policy');
		}
		expect(viteConfig).toContain('server:');
		expect(viteConfig).toContain('preview:');
		expect(pagesHeaders).toContain('/*');
	});
});
