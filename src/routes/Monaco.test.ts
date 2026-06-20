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
		expect(source).toMatch(/gleamLspEnabled\?: boolean;/);
		expect(source).toMatch(/gleamLspEnabled = false,/);
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
		expect(source).toContain(
			"pascal: () => import('monaco-editor/esm/vs/basic-languages/pascal/pascal.contribution.js')"
		);
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
		expect(source).toMatch(/const diagnosticMarkerLanguages = new Set\(\[/);
		for (const markerLanguage of [
			'java',
			'rust',
			'go',
			'd',
			'csharp',
			'fsharp',
			'vb',
			'erlang',
			'prolog',
			'gleam',
			'perl',
			'ocaml',
			'wat',
			'lua',
			'lisp',
			'haskell',
			'r',
			'octave',
			'cpp'
		]) {
			expect(source).toContain(`'${markerLanguage}'`);
		}
		expect(source).toMatch(
			/const defaultLanguage = \$derived\(defaultLanguageAliases\[language\] \?\? language\);/
		);
		expect(source).toMatch(
			/\$effect\(\(\) => \{\s+const activeModel = model \|\| editor\?\.getModel\(\);[\s\S]*if \(!isEditorDefaultSource\(currentValue\) && !isLegacyEditorDefaultSource\(currentValue\)\) \{[\s\S]*activeModel\.setValue\(defaultValue\);[\s\S]*\}\s+\}\);/s
		);
		expect(source).toMatch(
			/const defaultValue = \$derived\(\s+resolveEditorDefaultSource\([\s\S]*'c'[\s\S]*'cpp'[\s\S]*'python'[\s\S]*'java'[\s\S]*'go'[\s\S]*'d'[\s\S]*'csharp'[\s\S]*'fsharp'[\s\S]*'vbnet'[\s\S]*'elixir'[\s\S]*'erlang'[\s\S]*'prolog'[\s\S]*'gleam'[\s\S]*'perl'[\s\S]*'pascal'[\s\S]*'ocaml'[\s\S]*'ruby'[\s\S]*'sqlite'[\s\S]*'php'[\s\S]*'rust'[\s\S]*rustTargetTriple[\s\S]*\)\s+\);/s
		);
		expect(source).toMatch(/id: 'd'/);
		expect(source).toMatch(/aliases: \['D', 'd'\]/);
		expect(source).toMatch(/extensions: \['\.d'\]/);
		expect(source).toMatch(
			/monacoApi\.languages\.setMonarchTokensProvider\('d', dMonarchTokens\);/
		);
		expect(source).toMatch(
			/monacoApi\.languages\.setMonarchTokensProvider\('zig', zigMonarchTokens\);/
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
		expect(source).toMatch(/import type \{ LanguageServerStatus \} from '@wasm-idle\/lsp';/);
		expect(source).not.toMatch(/^\s*import \{[^\n]*\} from '@wasm-idle\/lsp';/m);
		expect(source).toMatch(/const lspRoutes: LspRoute\[] = \[/);
		expect(source).toMatch(/function disableAllLspStatuses\(\) \{/);
		expect(source).toMatch(/if \(!lspEnabled\) \{\s+disableAllLspStatuses\(\);/);
		expect(source).toMatch(/const route = lspRoutes\.find/);
		expect(source).toMatch(/return await route\.load\(currentUrl\);/);
		expect(source).toMatch(
			/const \{ getCppLanguageServer \} = await import\('@wasm-idle\/lsp'\);/
		);
		expect(source).toMatch(/handle\.syncFile\?\.\(normalizedFilePath\);/);
		expect(source).toMatch(/getCSharpLanguageServer/);
		expect(source).toMatch(/getFSharpLanguageServer/);
		expect(source).toMatch(/getVisualBasicLanguageServer/);
		expect(source).toMatch(/getGleamLanguageServer/);
		expect(source).toMatch(/getGoLanguageServer/);
		expect(source).toMatch(/getRustLanguageServer/);
		expect(source).toMatch(/getTypeScriptLanguageServer/);
		expect(source).toMatch(/getJavaScriptLanguageServer/);
		expect(source).toMatch(/getAssemblyScriptLanguageServer/);
		expect(source).toMatch(/getWatLanguageServer/);
		expect(source).toMatch(/getZigLanguageServer/);
		expect(source).toMatch(/getPhpLanguageServer/);
		expect(source).toMatch(/getLuaLanguageServer/);
		expect(source).toMatch(/getOcamlLanguageServer/);
		expect(source).toMatch(/getHaskellLanguageServer/);
		expect(source).toMatch(/typescript: \{ libUrl: typescriptLspLibUrl \}/);
		expect(source).toMatch(/javascript: \{ libUrl: typescriptLspLibUrl \}/);
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
		expect(resolveEditorDefaultSource('lua', 'wasm32-wasip1')).toBe(editorDefaults.lua);
		expect(resolveEditorDefaultSource('sqlite', 'wasm32-wasip1')).toBe(editorDefaults.sqlite);
		expect(resolveEditorDefaultSource('php', 'wasm32-wasip1')).toBe(editorDefaults.php);
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
		expect(isEditorDefaultSource(editorDefaults.lua)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.haskell)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.r)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.octave)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.sqlite)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.php)).toBe(true);
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
		expect(pageSource).toMatch(
			/const debugLspLanguages = new Set<PlaygroundLanguage>\(\['CPP'\]\);/
		);
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
		expect(pageSource).toMatch(/language=\{editorLanguage\}/);
		expect(pageSource).toMatch(/lspLanguage=\{monacoLspLanguage\}/);
		expect(pageSource).toMatch(/filePath=\{activePath\}/);
		expect(pageSource).toMatch(/const monacoLspLanguage = \$derived/);
		expect(pageSource).toMatch(
			/const runtimeLspCapabilities(?:: Partial<Record<PlaygroundLanguage, RuntimeLspCapability>>)? = \{/
		);
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
		expect(pageSource).toMatch(/wasm-elixir\/bundle\.avm\?v=\$\{WASM_ELIXIR_ASSET_VERSION\}/);
		expect(pageSource).toMatch(/WASM_OCAML_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_TYPESCRIPT_ASSET_VERSION/);
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
		expect(pageSource).toMatch(/version: 5,/);
		expect(pageSource).toMatch(
			/if \(typeof value\?\.lspEnabled === 'boolean'\) lspEnabled = value\.lspEnabled;/
		);
		expect(pageSource).toMatch(/clangdEnabled=\{clangdLspEnabled\}/);
		expect(pageSource).toMatch(/const dotnetLspEnabled = \$derived/);
		expect(pageSource).toMatch(/dotnetLspLanguages\.has\(language\)/);
		for (const capability of ['gleam', 'go', 'rust', 'zig', 'php', 'lua', 'ocaml', 'haskell']) {
			expect(pageSource).toContain(`activeRuntimeLspCapability === '${capability}'`);
		}
		for (const prop of [
			'dotnetLspModuleUrl',
			'gleamLspBaseUrl',
			'gleamLspManifestUrl',
			'goLspCompilerUrl',
			'rustLspCompilerUrl',
			'zigLspCompilerUrl',
			'zigLspStdlibUrl',
			'luaLspModuleUrl',
			'ocamlLspModuleUrl',
			'ocamlLspManifestUrl',
			'haskellLspModuleUrl',
			'haskellLspRootfsUrl',
			'haskellLspBsdtarUrl'
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
		) as { dependencies?: Record<string, string> };
		const viteConfig = await readFile(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');
		const libIndex = await readFile(path.resolve(process.cwd(), 'src/lib/index.ts'), 'utf8');

		expect(packageJson.dependencies?.['@seorii/monaco']).toBe('0.1.0');
		expect(packageJson.dependencies).not.toHaveProperty('@hancomac/monaco-languageclient');
		expect(viteConfig).not.toContain('@hancomac/monaco-languageclient');
		expect(viteConfig).not.toContain('vscode-compatibility');
		expect(libIndex).not.toContain('$lib/lsp');
		expect(libIndex).not.toContain('@wasm-idle/lsp');
	});
});
