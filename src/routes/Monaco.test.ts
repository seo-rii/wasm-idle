import pageSource from './+page.svelte?raw';
import source from './Monaco.svelte?raw';
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
		expect(source).toMatch(/let debugView = \$state<MonacoDebugView \| null>\(null\);/);
		expect(source).toMatch(/clangdEnabled\?: boolean;/);
		expect(source).toMatch(/clangdEnabled = false,/);
		expect(source).toMatch(
			/import \{\s+isEditorDefaultSource,\s+isLegacyEditorDefaultSource,\s+resolveEditorDefaultSource\s+\} from '\.\/editor-defaults';/s
		);
		expect(source).toMatch(
			/monacoApi\.editor\.setModelMarkers\(activeModel, 'wasm-idle-compiler', markers\);/
		);
		expect(source.match(/occurrencesHighlight: 'off'/g)).toHaveLength(2);
		expect(source).toMatch(
			/language === 'java' \|\|\s+language === 'rust' \|\|\s+language === 'go' \|\|\s+language === 'csharp' \|\|\s+language === 'fsharp' \|\|\s+language === 'ocaml'/
		);
		expect(source).toMatch(/language === 'wat'/);
		expect(source).toMatch(/language === 'lisp'/);
		expect(source).toMatch(/language === 'haskell'/);
		expect(source).toMatch(
			/\$effect\(\(\) => \{\s+if \(!editor\) return;[\s\S]*if \(!isEditorDefaultSource\(currentValue\) && !isLegacyEditorDefaultSource\(currentValue\)\) \{[\s\S]*const nextValue = resolveEditorDefaultSource\([\s\S]*rustTargetTriple[\s\S]*editor\.setValue\(nextValue\);[\s\S]*\}\);/s
		);
		expect(source).toMatch(
			/const defaultValue = resolveEditorDefaultSource\([\s\S]*'c'[\s\S]*'cpp'[\s\S]*'python'[\s\S]*'java'[\s\S]*'go'[\s\S]*'csharp'[\s\S]*'fsharp'[\s\S]*'elixir'[\s\S]*'ocaml'[\s\S]*'rust'[\s\S]*rustTargetTriple\s+\);/s
		);
		expect(source).toMatch(
			/debugView = new MonacoDebugView\(Monaco, editor, onBreakpointsChange\);\s+debugView\.setBreakpoints\(breakpoints\);\s+debugView\.setPauseState\(pausedLine, debugLocals, debugLanguage\);/s
		);
		expect(source).toMatch(/onCursorLineChange\?: \(line: number \| null\) => void;/);
		expect(source).toMatch(/onRunToCursor\?: \(line: number \| null\) => void;/);
		expect(source).toMatch(
			/import \{ attachMonacoDebugActions, MonacoDebugView \} from '\$lib';/
		);
		expect(source).toMatch(/let debugActionBindings: \{ dispose\(\): void \} \| null = null;/);
		expect(source).toMatch(
			/debugActionBindings = attachMonacoDebugActions\(editor, \{\s+onCursorLineChange,\s+onRunToCursor\s+\}\);/s
		);
		expect(source).toMatch(/debugActionBindings\?\.dispose\(\);/);
		expect(source).toMatch(
			/if \(language !== 'cpp' \|\| !editor \|\| !clangdEnabled \|\| !clangdBaseUrl\) \{\s+session\?\.dispose\(\);\s+session = null;\s+clangdStatus = \{ state: 'disabled' \};\s+return;\s+\}/s
		);
		expect(source).toMatch(
			/const \{ ClangdSession \} = await import\('\$lib\/clangd\/session'\);/s
		);
		expect(source).toMatch(/let clangdSessionVersion = 0;/);
		expect(source).toMatch(/const nextSessionVersion = \+\+clangdSessionVersion;/);
		expect(source).toMatch(
			/if \(previousModel && previousModelUri !== nextModel\.uri\.toString\(\)\) \{\s+previousModel\.dispose\(\);\s+\}/s
		);
		expect(source).toMatch(
			/if \(clangdSessionVersion === nextSessionVersion\) session = null;/
		);
		expect(source).not.toMatch(/clangd ready/);
		expect(source).not.toMatch(/clangd loading/);
		expect(source).not.toMatch(/clangd failed:/);
		expect(source).not.toMatch(/class="clangd-status"/);
	});

	it('keeps starter sources wired for stdin examples', () => {
		expect(resolveEditorDefaultSource('go', 'wasm32-wasip1')).toBe(editorDefaults.go);
		expect(resolveEditorDefaultSource('c', 'wasm32-wasip1')).toBe(editorDefaults.c);
		expect(resolveEditorDefaultSource('csharp', 'wasm32-wasip1')).toBe(editorDefaults.csharp);
		expect(resolveEditorDefaultSource('fsharp', 'wasm32-wasip1')).toBe(editorDefaults.fsharp);
		expect(resolveEditorDefaultSource('elixir', 'wasm32-wasip1')).toBe(editorDefaults.elixir);
		expect(editorDefaults.c).toContain('puts("Hello, WebAssembly!")');
		expect(editorDefaults.go).toContain("ReadString('\\n')");
		expect(editorDefaults.csharp).toContain('Console.WriteLine');
		expect(editorDefaults.go).toContain(
			'fmt.Printf("factorial_plus_bonus=%d\\n", factorial(n)+bonus)'
		);
		expect(editorDefaults.elixir).toContain('defmodule Demo do');
		expect(editorDefaults.elixir).toContain('Demo.run()');
		expect(editorDefaults.elixir).toContain('IO.gets("")');
		expect(editorDefaults.elixir).toContain('Integer.parse(String.trim(line))');
		expect(editorDefaults.haskell).toContain('putStrLn');
		expect(isEditorDefaultSource(editorDefaults.c)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.go)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.csharp)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.fsharp)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.elixir)).toBe(true);
		expect(isEditorDefaultSource(editorDefaults.haskell)).toBe(true);
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
			/if \(enableDebug && language === 'CPP'\) clangdRequested = true;/
		);
		expect(pageSource).toMatch(/if \(language !== 'CPP'\) clangdRequested = false;/);
		expect(pageSource).toMatch(/<option value="RUST">Rust<\/option>/);
		expect(pageSource).toMatch(/<option value="GO">Go<\/option>/);
		expect(pageSource).toMatch(/<option value="CSHARP">C#<\/option>/);
		expect(pageSource).toMatch(/<option value="FSHARP">F#<\/option>/);
		expect(pageSource).toMatch(/<option value="ELIXIR">Elixir<\/option>/);
		expect(pageSource).toMatch(/<option value="OCAML">OCaml<\/option>/);
		expect(pageSource).toMatch(/<option value="TINYGO">TinyGo<\/option>/);
		expect(pageSource).toMatch(/<option value="JAVASCRIPT">JavaScript<\/option>/);
		expect(pageSource).toMatch(/<option value="TYPESCRIPT">TypeScript<\/option>/);
		expect(pageSource).toMatch(/<option value="WAT">WAT<\/option>/);
		expect(pageSource).toMatch(/<option value="ZIG">Zig<\/option>/);
		expect(pageSource).toMatch(/<option value="LISP">Scheme<\/option>/);
		expect(pageSource).toMatch(/<option value="HASKELL">Haskell<\/option>/);
		expect(pageSource).toMatch(/language=\{editorLanguage\}/);
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
		expect(pageSource).toMatch(/WASM_WAT_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_ZIG_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_LISP_ASSET_VERSION/);
		expect(pageSource).toMatch(/WASM_HASKELL_ASSET_VERSION/);
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
		expect(pageSource).toMatch(/clangdEnabled=\{clangdRequested\}/);
	});

	it('keeps the editor pane shrinkable for the resizable example layout', () => {
		expect(source).toMatch(/<div bind:this=\{divEl\} class="editor-host"><\/div>/);
		expect(source).toMatch(
			/main \{\s+flex: 1;\s+min-width: 0;\s+min-height: 0;\s+display: flex;/s
		);
		expect(source).toMatch(/overflow: hidden;/);
		expect(source).toMatch(/\.editor-host \{\s+flex: 1;\s+min-height: 0;\s+\}/s);
		expect(source).toMatch(
			/@media \(max-width: 960px\) \{\s+main \{\s+min-height: 360px;\s+border-left: 0;\s+border-top: 1px solid #e5e7eb;\s+\}\s+\}/s
		);
	});
});
