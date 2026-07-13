import layoutSource from './+layout.svelte?raw';
import source from './+page.svelte?raw';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import {
	argsHelpLanguages,
	argsLabels,
	compilerDiagnosticLanguages,
	editorLanguages,
	editorOnlyLanguages,
	type PlaygroundLanguage
} from './language-registry';

const expectEditorLanguage = (language: PlaygroundLanguage, editorLanguage: string) => {
	expect(editorLanguages[language]).toBe(editorLanguage);
};

describe('example route debug actions', () => {
	it('swaps run/debug actions for stop buttons while sessions are active', () => {
		expect(() =>
			compile(source, {
				filename: 'src/routes/+page.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(/async function stopExecution\(\) \{/);
		expect(source).toMatch(/if \(!terminal \|\| !runningMode\) return;/);
		expect(source).toMatch(/if \(runningMode === 'debug'\) \{/);
		expect(source).toMatch(/await debug\.stop\(\);/);
		expect(source).toMatch(
			/\{#if runningMode === 'run'\}\s+<button class="action-button action-button--stop" onclick=\{stopExecution\}>/s
		);
		expect(source).toMatch(/<span>Stop Running<\/span>/);
		expect(source).toMatch(/await terminal\.stop\?\.\(\);/);
		expect(source).toMatch(
			/\{#if runningMode === 'debug'\}\s+<button class="action-button action-button--stop" onclick=\{stopExecution\}>/s
		);
		expect(source).toMatch(/<span>Stop Debug<\/span>/);
		expect(source).toMatch(/disabled=\{runningMode === 'debug' \|\| !executionAvailable\}/);
		expect(source).toMatch(/async function sendTerminalEof\(\) \{/);
		expect(source).toMatch(/await terminal\.eof\?\.\(\);/);
		expect(source).toMatch(/title="Send EOF"/);
	});

	it('delegates debug state, runtime watches, and run-to-cursor to the shared debug controller', () => {
		expect(source).toMatch(
			/import Terminal, \{\s+createPlaygroundBinding,\s+createDebugSessionController,\s+cppDebugLanguageAdapter,\s+goDebugLanguageAdapter,\s+pythonDebugLanguageAdapter,\s+rustDebugLanguageAdapter,\s+isSharedArrayBufferAvailable\s+\} from '\$lib';/s
		);
		expect(source).toMatch(
			/const debugLanguageAdapters(?:: Partial<Record<PlaygroundLanguage, DebugLanguageAdapter>>)? = \{/
		);
		expect(source).toMatch(/GO: goDebugLanguageAdapter/);
		expect(source).toMatch(/RUST: rustDebugLanguageAdapter/);
		expect(source).toMatch(/CPP: cppDebugLanguageAdapter/);
		expect(source).toMatch(/PYTHON: pythonDebugLanguageAdapter/);
		expect(source).toMatch(/const debug = createDebugSessionController\(\{/);
		expect(source).toMatch(/syncBreakpointsWhile: \(\) => runningMode === 'debug'/);
		expect(source).toMatch(/\$effect\(\(\) => \{\s+debug\.setTerminal\(terminal\);\s+\}\);/s);
		expect(source).toMatch(
			/\$effect\(\(\) => \{\s+debug\.setAdapter\(debugLanguage\);\s+\}\);/s
		);
		expect(source).toMatch(/debug\.begin\(\);/);
		expect(source).toMatch(/breakpoints: \[\.\.\.debug\.effectiveBreakpoints\],/);
		expect(source).toMatch(/if \(!debug\.paused\) debug\.reset\(\);/);
		expect(source).toMatch(
			/title=\{debug\.cursorLine\s+\?\s+`Run to Cursor \(L\$\{debug\.cursorLine\}\)`\s+:\s+'Run to Cursor'\}/
		);
		expect(source).toMatch(
			/aria-label=\{debug\.cursorLine\s+\?\s+`Run to Cursor \(L\$\{debug\.cursorLine\}\)`\s+:\s+'Run to Cursor'\}/
		);
		expect(source).toMatch(/onclick=\{\(\) => debug\.runToCursor\(\)\}/);
		expect(source).toMatch(/disabled=\{!debug\.canRunToCursor\}/);
		expect(source).toMatch(/onclick=\{\(\) => debug\.sendCommand\('continue'\)\}/);
		expect(source).toMatch(/ondebug=\{debug\.handleEvent\}/);
		expect(source).toMatch(/bind:value=\{debug\.watchInput\}/);
		expect(source).toMatch(/onclick=\{\(\) => debug\.addWatchExpression\(\)\}/);
		expect(source).toMatch(
			/onclick=\{\(\) =>\s+debug\.removeWatchExpression\(watch\.expression\)\}/
		);
		expect(source).toMatch(/debugLocals=\{debug\.locals\}/);
		expect(source).toMatch(/pausedLine=\{debug\.pausedLine\}/);
		expect(source).toMatch(/onRunToCursor=\{debug\.runToCursor\}/);
		expect(source).toMatch(/<span class="material-symbols-outlined">play_circle<\/span>/);
	});

	it('preloads stdin when SharedArrayBuffer is unavailable or Bash is selected', () => {
		expect(source).not.toMatch(/location\.reload\(\)/);
		expect(source).toMatch(
			/const sharedBufferAvailable = \$derived\(\s*!browser \|\| isSharedArrayBufferAvailable\(\)\s*\);/s
		);
		expect(source).toMatch(
			/const preloadedStdin =\s+sharedBufferAvailable && language !== 'BASH' \? undefined : stdinInput;/s
		);
		expect(source).toMatch(/stdin: preloadedStdin/);
		expect(source).toMatch(
			/\{#if !sharedBufferAvailable \|\| language === 'BASH'\}\s+<div class="stdin-panel">/s
		);
		expect(source).toMatch(/bind:value=\{stdinInput\}/);
		expect(source).toMatch(
			/disabled=\{!!runningMode \|\| !debugLanguage \|\| !sharedBufferAvailable\}/
		);
	});

	it('passes a local wasm-rust bundle through a reusable playground binding', () => {
		expect(source).toMatch(
			/import \{ WASM_GO_ASSET_VERSION \} from '\$lib\/playground\/wasmGoVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_BQN_ASSET_VERSION \} from '\$lib\/playground\/wasmBqnVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_JANET_ASSET_VERSION \} from '\$lib\/playground\/wasmJanetVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_JULIA_ASSET_VERSION \} from '\$lib\/playground\/wasmJuliaVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_NIM_ASSET_VERSION \} from '\$lib\/playground\/wasmNimVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_SWIFT_ASSET_VERSION \} from '\$lib\/playground\/wasmSwiftVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_D_ASSET_VERSION \} from '\$lib\/playground\/wasmDVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_DOTNET_ASSET_VERSION \} from '\$lib\/playground\/wasmDotnetVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_ELIXIR_ASSET_VERSION \} from '\$lib\/playground\/wasmElixirVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_OCAML_ASSET_VERSION \} from '\$lib\/playground\/wasmOcamlVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_OCTAVE_ASSET_VERSION \} from '\$lib\/playground\/wasmOctaveVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_PROLOG_ASSET_VERSION \} from '\$lib\/playground\/wasmPrologVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_GLEAM_ASSET_VERSION \} from '\$lib\/playground\/wasmGleamVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_PERL_ASSET_VERSION \} from '\$lib\/playground\/wasmPerlVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_RUST_ASSET_VERSION \} from '\$lib\/playground\/wasmRustVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_TINYGO_ASSET_VERSION \} from '\$lib\/playground\/wasmTinyGoVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_TYPESCRIPT_ASSET_VERSION \} from '\$lib\/playground\/wasmTypeScriptVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_WAT_ASSET_VERSION \} from '\$lib\/playground\/wasmWatVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_LUA_ASSET_VERSION \} from '\$lib\/playground\/wasmLuaVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_ZIG_ASSET_VERSION \} from '\$lib\/playground\/wasmZigVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_LISP_ASSET_VERSION \} from '\$lib\/playground\/wasmLispVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_HASKELL_ASSET_VERSION \} from '\$lib\/playground\/wasmHaskellVersion';/
		);
		expect(source).not.toContain('tinygo' + 'CompilePath');
		expect(source).not.toMatch(/dotnetCompilePath/);
		expect(source).not.toContain('tinygo' + 'Host' + 'CompileUrl');
		expect(source).not.toContain('tinygo' + 'Disable' + 'Host' + 'Compile');
		expect(source).toMatch(
			/let runtimeAssets = \$derived\.by<PlaygroundRuntimeAssets>\(\(\) => \(\{/
		);
		expect(source).toMatch(/rootUrl: path,/);
		expect(source).toMatch(
			/rust: \{\s+compilerUrl: path\s+\?\s+`\$\{path\}\/wasm-rust\/index\.js\?v=\$\{WASM_RUST_ASSET_VERSION\}`\s+:\s+`\/wasm-rust\/index\.js\?v=\$\{WASM_RUST_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/go: \{\s+compilerUrl: path\s+\?\s+`\$\{path\}\/wasm-go\/index\.js\?v=\$\{WASM_GO_ASSET_VERSION\}`\s+:\s+`\/wasm-go\/index\.js\?v=\$\{WASM_GO_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/d: \{\s+moduleUrl: path\s+\?\s+`\$\{path\}\/wasm-d\/index\.js\?v=\$\{WASM_D_ASSET_VERSION\}`\s+:\s+`\/wasm-d\/index\.js\?v=\$\{WASM_D_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/dotnet: \{\s+moduleUrl: path\s+\?\s+`\$\{path\}\/wasm-dotnet\/index\.js\?v=\$\{WASM_DOTNET_ASSET_VERSION\}`\s+:\s+`\/wasm-dotnet\/index\.js\?v=\$\{WASM_DOTNET_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/elixir: \{\s+bundleUrl: path\s+\?\s+`\$\{path\}\/wasm-elixir\/bundle\.avm\?v=\$\{WASM_ELIXIR_ASSET_VERSION\}`\s+:\s+`\/wasm-elixir\/bundle\.avm\?v=\$\{WASM_ELIXIR_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/erlang: \{\s+bundleUrl: path\s+\?\s+`\$\{path\}\/wasm-elixir\/bundle\.avm\?v=\$\{WASM_ELIXIR_ASSET_VERSION\}`\s+:\s+`\/wasm-elixir\/bundle\.avm\?v=\$\{WASM_ELIXIR_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/prolog: \{\s+baseUrl: path\s+\?\s+`\$\{path\}\/wasm-prolog\/`\s+:\s+'\/wasm-prolog\/',\s+workerUrl: path\s+\?\s+`\$\{path\}\/wasm-prolog\/runner-worker\.js\?v=\$\{WASM_PROLOG_ASSET_VERSION\}`\s+:\s+`\/wasm-prolog\/runner-worker\.js\?v=\$\{WASM_PROLOG_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/gleam: \{\s+baseUrl: path\s+\?\s+`\$\{path\}\/wasm-gleam\/`\s+:\s+'\/wasm-gleam\/',\s+workerUrl: path\s+\?\s+`\$\{path\}\/wasm-gleam\/runner-worker\.js\?v=\$\{WASM_GLEAM_ASSET_VERSION\}`\s+:\s+`\/wasm-gleam\/runner-worker\.js\?v=\$\{WASM_GLEAM_ASSET_VERSION\}`,\s+manifestUrl: path\s+\?\s+`\$\{path\}\/wasm-gleam\/source-manifest\.v1\.json\?v=\$\{WASM_GLEAM_ASSET_VERSION\}`\s+:\s+`\/wasm-gleam\/source-manifest\.v1\.json\?v=\$\{WASM_GLEAM_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/perl: \{\s+baseUrl: path\s+\?\s+`\$\{path\}\/wasm-perl\/`\s+:\s+'\/wasm-perl\/',\s+workerUrl: path\s+\?\s+`\$\{path\}\/wasm-perl\/runner-worker\.js\?v=\$\{WASM_PERL_ASSET_VERSION\}`\s+:\s+`\/wasm-perl\/runner-worker\.js\?v=\$\{WASM_PERL_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/janet: \{\s+baseUrl: path\s+\?\s+`\$\{path\}\/wasm-janet\/`\s+:\s+'\/wasm-janet\/',\s+workerUrl: path\s+\?\s+`\$\{path\}\/wasm-janet\/runner-worker\.js\?v=\$\{WASM_JANET_ASSET_VERSION\}`\s+:\s+`\/wasm-janet\/runner-worker\.js\?v=\$\{WASM_JANET_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/julia: \{\s+baseUrl: path\s+\?\s+`\$\{path\}\/wasm-julia\/`\s+:\s+'\/wasm-julia\/',\s+workerUrl: path\s+\?\s+`\$\{path\}\/wasm-julia\/runner-worker\.js\?v=\$\{WASM_JULIA_ASSET_VERSION\}`\s+:\s+`\/wasm-julia\/runner-worker\.js\?v=\$\{WASM_JULIA_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/nim: \{\s+baseUrl: path\s+\?\s+`\$\{path\}\/wasm-nim\/`\s+:\s+'\/wasm-nim\/',\s+workerUrl: path\s+\?\s+`\$\{path\}\/wasm-nim\/runner-worker\.js\?v=\$\{WASM_NIM_ASSET_VERSION\}`\s+:\s+`\/wasm-nim\/runner-worker\.js\?v=\$\{WASM_NIM_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/swift: \{\s+baseUrl: path\s+\?\s+`\$\{path\}\/wasm-swift\/`\s+:\s+'\/wasm-swift\/',\s+workerUrl: path\s+\?\s+`\$\{path\}\/wasm-swift\/runner-worker\.js\?v=\$\{WASM_SWIFT_ASSET_VERSION\}`\s+:\s+`\/wasm-swift\/runner-worker\.js\?v=\$\{WASM_SWIFT_ASSET_VERSION\}`,\s+manifestUrl: path\s+\?\s+`\$\{path\}\/wasm-swift\/runtime-manifest\.v1\.json\?v=\$\{WASM_SWIFT_ASSET_VERSION\}`\s+:\s+`\/wasm-swift\/runtime-manifest\.v1\.json\?v=\$\{WASM_SWIFT_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/ocaml: \{\s+moduleUrl: path\s+\?\s+`\$\{path\}\/wasm-of-js-of-ocaml\/browser-native\/src\/index\.js\?v=\$\{WASM_OCAML_ASSET_VERSION\}`\s+:\s+`\/wasm-of-js-of-ocaml\/browser-native\/src\/index\.js\?v=\$\{WASM_OCAML_ASSET_VERSION\}`,\s+manifestUrl: path\s+\?\s+`\$\{path\}\/wasm-of-js-of-ocaml\/browser-native-bundle\/browser-native-manifest\.v1\.json\?v=\$\{WASM_OCAML_ASSET_VERSION\}`\s+:\s+`\/wasm-of-js-of-ocaml\/browser-native-bundle\/browser-native-manifest\.v1\.json\?v=\$\{WASM_OCAML_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/tinygo: \{\s+moduleUrl: path\s+\?\s+`\$\{path\}\/wasm-tinygo\/runtime\.js\?v=\$\{WASM_TINYGO_ASSET_VERSION\}`\s+:\s+`\/wasm-tinygo\/runtime\.js\?v=\$\{WASM_TINYGO_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/typescript: \{\s+moduleUrl: path\s+\?\s+`\$\{path\}\/wasm-typescript\/index\.js\?v=\$\{WASM_TYPESCRIPT_ASSET_VERSION\}`\s+:\s+`\/wasm-typescript\/index\.js\?v=\$\{WASM_TYPESCRIPT_ASSET_VERSION\}`,\s+libUrl: path\s+\?\s+`\$\{path\}\/lsp\/typescript-libs\.json\.gz\?v=\$\{WASM_TYPESCRIPT_ASSET_VERSION\}`\s+:\s+`\/lsp\/typescript-libs\.json\.gz\?v=\$\{WASM_TYPESCRIPT_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/wat: \{\s+moduleUrl: path\s+\?\s+`\$\{path\}\/wasm-wat\/index\.js\?v=\$\{WASM_WAT_ASSET_VERSION\}`\s+:\s+`\/wasm-wat\/index\.js\?v=\$\{WASM_WAT_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/lua: \{\s+moduleUrl: path\s+\?\s+`\$\{path\}\/wasm-lua\/index\.js\?v=\$\{WASM_LUA_ASSET_VERSION\}`\s+:\s+`\/wasm-lua\/index\.js\?v=\$\{WASM_LUA_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/zig: \{\s+compilerUrl: path\s+\?\s+`\$\{path\}\/wasm-zig\/zig_small\.wasm\?v=\$\{WASM_ZIG_ASSET_VERSION\}`\s+:\s+`\/wasm-zig\/zig_small\.wasm\?v=\$\{WASM_ZIG_ASSET_VERSION\}`,\s+stdlibUrl: path\s+\?\s+`\$\{path\}\/wasm-zig\/std\.zip\?v=\$\{WASM_ZIG_ASSET_VERSION\}`\s+:\s+`\/wasm-zig\/std\.zip\?v=\$\{WASM_ZIG_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/lisp: \{\s+moduleUrl: path\s+\?\s+`\$\{path\}\/wasm-lisp\/index\.js\?v=\$\{WASM_LISP_ASSET_VERSION\}`\s+:\s+`\/wasm-lisp\/index\.js\?v=\$\{WASM_LISP_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/haskell: \{\s+moduleUrl: path\s+\?\s+`\$\{path\}\/wasm-haskell\/dyld\.mjs\?v=\$\{WASM_HASKELL_ASSET_VERSION\}`\s+:\s+`\/wasm-haskell\/dyld\.mjs\?v=\$\{WASM_HASKELL_ASSET_VERSION\}`,\s+rootfsUrl: path\s+\?\s+`\$\{path\}\/wasm-haskell\/rootfs\.tar\.zst\?v=\$\{WASM_HASKELL_ASSET_VERSION\}`\s+:\s+`\/wasm-haskell\/rootfs\.tar\.zst\?v=\$\{WASM_HASKELL_ASSET_VERSION\}`,\s+bsdtarUrl: path\s+\?\s+`\$\{path\}\/wasm-haskell\/bsdtar\.wasm\?v=\$\{WASM_HASKELL_ASSET_VERSION\}`\s+:\s+`\/wasm-haskell\/bsdtar\.wasm\?v=\$\{WASM_HASKELL_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/octave: \{\s+baseUrl: path\s+\?\s+`\$\{path\}\/wasm-octave\/runtime\/`\s+:\s+'\/wasm-octave\/runtime\/',\s+workerUrl: path\s+\?\s+`\$\{path\}\/wasm-octave\/runner-worker\.js\?v=\$\{WASM_OCTAVE_ASSET_VERSION\}`\s+:\s+`\/wasm-octave\/runner-worker\.js\?v=\$\{WASM_OCTAVE_ASSET_VERSION\}`,\s+manifestUrl: path\s+\?\s+`\$\{path\}\/wasm-octave\/runtime\/runtime-manifest\.v1\.json\?v=\$\{WASM_OCTAVE_ASSET_VERSION\}`\s+:\s+`\/wasm-octave\/runtime\/runtime-manifest\.v1\.json\?v=\$\{WASM_OCTAVE_ASSET_VERSION\}`\s+\}/s
		);
		expect(source).toMatch(
			/const playground = \$derived\.by\(\(\) => createPlaygroundBinding\(runtimeAssets\)\);/
		);
		expect(source).toMatch(/<Terminal\s+bind:terminal\s+\{playground\}/s);
		expect(source).toMatch(
			/type WasmRustRuntimeModule = \{\s+preloadBrowserRustRuntime\?: \(options\?: \{\s+targetTriple\?: RustTargetTriple;\s+\}\) => Promise<void>;\s+\};/s
		);
		expect(source).toMatch(/if \(!browser \|\| language !== 'RUST'\) return;/);
		expect(source).toMatch(
			/const compilerUrl = runtimeAssets\.rust\?\.compilerUrl;\s+const preloadTargetTriple = availableRustTargetTriples\.includes\(rustTargetTriple\)\s+\?\s+rustTargetTriple\s+:\s+availableRustTargetTriples\[0\];/s
		);
		expect(source).toMatch(
			/const runtimeModule = \(await import\(\s+\/\* @vite-ignore \*\/ compilerUrl\s+\)\) as WasmRustRuntimeModule;/
		);
		expect(source).toMatch(
			/await runtimeModule\.preloadBrowserRustRuntime\?\.\(\{\s+targetTriple: preloadTargetTriple\s+\}\);/s
		);
		expect(source).toMatch(
			/type WasmGoRuntimeModule = \{\s+preloadBrowserGoRuntime\?: \(options\?: \{\s*target\?: GoTarget;?\s*\}\) => Promise<void>;\s+\};/s
		);
		expect(source).toMatch(/if \(!browser \|\| language !== 'GO'\) return;/);
		expect(source).toMatch(/const compilerUrl = runtimeAssets\.go\?\.compilerUrl;/);
		expect(source).toMatch(
			/const preloadTarget = availableGoTargets\.includes\(goTarget\)\s+\?\s+goTarget\s+:\s+availableGoTargets\[0\];/
		);
		expect(source).toMatch(
			/const runtimeModule = \(await import\(\s+\/\* @vite-ignore \*\/ compilerUrl\s+\)\) as WasmGoRuntimeModule;/
		);
		expect(source).toMatch(
			/await runtimeModule\.preloadBrowserGoRuntime\?\.\(\{\s+target: preloadTarget\s+\}\);/s
		);
	});

	it('persists and forwards the Rust target triple selection', () => {
		expect(source).toMatch(/rustTargetTriple = \$state<RustTargetTriple>\('wasm32-wasip1'\),/);
		expect(source).toMatch(/if \(!browser \|\| language !== 'RUST'\) return;/);
		expect(source).toMatch(
			/const knownRustTargetTriples = \['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'\] as const;/
		);
		expect(source).toMatch(
			/let availableRustTargetTriples = \$state<RustTargetTriple\[]>\(\[\s*'wasm32-wasip1',\s*'wasm32-wasip2'\s*\]\);/s
		);
		expect(source).toMatch(/localStorage\.setItem\('rustTargetTriple', rustTargetTriple\);/);
		expect(source).toMatch(
			/const manifestUrl = path\s+\?\s+`\$\{path\}\/wasm-rust\/runtime\/runtime-manifest\.v3\.json\?v=\$\{WASM_RUST_ASSET_VERSION\}`\s+:\s+`\/wasm-rust\/runtime\/runtime-manifest\.v3\.json\?v=\$\{WASM_RUST_ASSET_VERSION\}`;/
		);
		expect(source).toMatch(
			/const response = await fetch\(manifestUrl, \{ cache: 'no-store' \}\);/
		);
		expect(source).toMatch(
			/const nextAvailableRustTargetTriples = knownRustTargetTriples\.filter\(\s*\(targetTriple\) =>\s*Object\.prototype\.hasOwnProperty\.call\(manifest\.targets \|\| \{}, targetTriple\)\s*\);/s
		);
		expect(source).toMatch(
			/availableRustTargetTriples = \[\.\.\.nextAvailableRustTargetTriples\];/
		);
		expect(source).toMatch(
			/availableRustTargetTriples = \['wasm32-wasip1', 'wasm32-wasip2'\];/
		);
		expect(source).toMatch(/const editorLanguage = \$derived\(editorLanguages\[language\]\);/);
		expectEditorLanguage('ELIXIR', 'elixir');
		expectEditorLanguage('ERLANG', 'erlang');
		expectEditorLanguage('PROLOG', 'prolog');
		expectEditorLanguage('GLEAM', 'gleam');
		expectEditorLanguage('PERL', 'perl');
		expectEditorLanguage('TINYGO', 'go');
		expectEditorLanguage('JAVASCRIPT', 'javascript');
		expectEditorLanguage('TYPESCRIPT', 'typescript');
		expectEditorLanguage('ASSEMBLYSCRIPT', 'typescript');
		expectEditorLanguage('WAT', 'wat');
		expectEditorLanguage('LUA', 'lua');
		expectEditorLanguage('ZIG', 'zig');
		expectEditorLanguage('LISP', 'lisp');
		expectEditorLanguage('RUBY', 'ruby');
		expectEditorLanguage('HASKELL', 'haskell');
		expectEditorLanguage('R', 'r');
		expectEditorLanguage('BQN', 'bqn');
		expectEditorLanguage('JANET', 'janet');
		expectEditorLanguage('FORTRAN', 'fortran');
		expectEditorLanguage('COBOL', 'cobol');
		expectEditorLanguage('GRAPHQL', 'graphql');
		expectEditorLanguage('DUCKDB', 'sql');
		expectEditorLanguage('JSON', 'json');
		expectEditorLanguage('YAML', 'yaml');
		expectEditorLanguage('TOML', 'toml');
		expectEditorLanguage('HTML', 'html');
		expectEditorLanguage('CSS', 'css');
		expectEditorLanguage('MARKDOWN', 'markdown');
		expect(source).toMatch(/RUST: \(\) => \(\{ rustTargetTriple \}\)/);
		expect(source).toMatch(/\.\.\.languageExecutionOptions/);
		expect(source).toMatch(/<select id="rust-target-triple" bind:value=\{rustTargetTriple\}>/);
		expect(source).toMatch(
			/\{#each availableRustTargetTriples as targetTriple \(targetTriple\)\}\s+<option value=\{targetTriple\}>\{targetTriple\}<\/option>\s+\{\/each\}/s
		);
		expect(source).toMatch(/rustTargetTriple=\{languageExecutionOptions\.rustTargetTriple\}/);
	});

	it('persists and forwards the Go target selection', () => {
		expect(source).toMatch(/GoTarget,/);
		expect(source).toMatch(/goTarget = \$state<GoTarget>\('wasip1\/wasm'\),/);
		expect(source).toMatch(/if \(!browser \|\| language !== 'GO'\) return;/);
		expect(source).toMatch(
			/const knownGoTargets = \['wasip1\/wasm', 'wasip2\/wasm', 'wasip3\/wasm', 'js\/wasm'\] as const;/
		);
		expect(source).toMatch(
			/let availableGoTargets = \$state<GoTarget\[]>\(\['wasip1\/wasm'\]\);/
		);
		expect(source).toMatch(/localStorage\.setItem\('goTarget', goTarget\);/);
		expect(source).toMatch(/const storedGoTarget = localStorage\.getItem\('goTarget'\);/);
		expect(source).toMatch(
			/const manifestUrl = path\s+\?\s+`\$\{path\}\/wasm-go\/runtime\/runtime-manifest\.v1\.json\?v=\$\{WASM_GO_ASSET_VERSION\}`\s+:\s+`\/wasm-go\/runtime\/runtime-manifest\.v1\.json\?v=\$\{WASM_GO_ASSET_VERSION\}`;/
		);
		expect(source).toMatch(
			/const nextAvailableGoTargets = knownGoTargets\.filter\(\s*\(target\) =>\s*Object\.prototype\.hasOwnProperty\.call\(manifest\.targets \|\| \{}, target\)\s*\);/s
		);
		expect(source).toMatch(/availableGoTargets = \[\.\.\.nextAvailableGoTargets\];/);
		expect(source).toMatch(/availableGoTargets = \['wasip1\/wasm'\];/);
		expect(source).toMatch(/GO: \(\) => \(\{ goTarget \}\)/);
		expect(source).toMatch(/requestedGoTarget === 'js\/wasm'/);
		expect(source).toMatch(/storedGoTarget === 'js\/wasm'/);
		expect(source).toMatch(/<select id="go-target" bind:value=\{goTarget\}>/);
		expect(source).toMatch(
			/\{#each availableGoTargets as target \(target\)\}\s+<option value=\{target\}>\{target\}<\/option>\s+\{\/each\}/s
		);
	});

	it('exposes a browser debug hook that writes terminal stdin through the bound control', () => {
		expect(source).toMatch(
			/type WasmIdleDebugApi = \{\s+writeTerminalInput: \(text: string, eof\?: boolean\) => Promise<void>;\s+getEditorValue: \(\) => string;\s+setEditorValue: \(text: string\) => Promise<boolean>;\s+setWorkspaceFiles: \(files: WorkspaceFile\[], activePath\?: string\) => Promise<boolean>;\s+setPreloadedStdin: \(text: string\) => void;\s+\};/s
		);
		expect(source).toMatch(/let browserDebugHookVersion = 0;/);
		expect(source).toMatch(/const debugHookVersion = \+\+browserDebugHookVersion;/);
		expect(source).toMatch(/target\.__wasmIdleDebug = debugApi;/);
		expect(source).toMatch(
			/if \(browserDebugHookVersion === debugHookVersion\) delete target\.__wasmIdleDebug;/
		);
		expect(source).toMatch(/await terminal\.waitForInput\?\.\(\);/);
		expect(source).toMatch(/await terminal\.write\(text\);/);
		expect(source).toMatch(/if \(eof\) await terminal\.eof\?\.\(\);/);
		expect(source).toMatch(
			/getEditorValue\(\) \{\s+return editor\?\.getValue\(\) \|\| '';\s+\}/s
		);
		expect(source).toMatch(
			/async setEditorValue\(text: string\) \{\s+if \(!editor\) return false;\s+editor\.setValue\(text\);\s+updateActiveContent\(text\);\s+await Promise\.resolve\(\);\s+return editor\.getValue\(\) === text && activeFile\?\.content === text;\s+\}/s
		);
		expect(source).toMatch(/setPreloadedStdin\(text: string\) \{\s+stdinInput = text;\s+\}/s);
	});

	it('keeps browser stdin helper wiring separate from the shared debug controller', () => {
		expect(source).not.toMatch(/terminalControl\?\.debugEvaluate/);
		expect(source).toMatch(/createDebugSessionController/);
	});

	it('keeps LSP opt-in and persists the toggle in workspace snapshots', () => {
		expect(source).toMatch(/lspEnabled = \$state\(false\),/);
		expect(source).toMatch(
			/function snapshot\(\): WorkspaceSnapshot \{[\s\S]*log,\s+lspEnabled,[\s\S]*version: 5,/s
		);
		expect(source).toMatch(
			/if \(typeof value\?\.lspEnabled === 'boolean'\) lspEnabled = value\.lspEnabled;/
		);
		expect(source).toMatch(
			/<input id="lsp-toggle" type="checkbox" bind:checked=\{lspEnabled\} \/>/
		);
		expect(source).toMatch(
			/<Monaco[\s\S]*\{lspEnabled\}[\s\S]*clangdEnabled=\{clangdLspEnabled\}/s
		);
		expect(source).toMatch(/\{typescriptLspLibUrl\}/);
	});

	it('shows a Rust stdin hint that explains EOF for read-to-end programs', () => {
		expect(source).toMatch(/press Enter to send a line\./);
		expect(source).toMatch(
			/selector only shows\s+Rust targets advertised by the bundled wasm-rust runtime manifest/
		);
		expect(source).toMatch(/`wasm32-wasip1`\s+uses preview1 core wasm/);
		expect(source).toMatch(/availableRustTargetTriples\.includes\('wasm32-wasip2'\)/);
		expect(source).toMatch(/`wasm32-wasip2`\s+uses preview2 component execution/);
		expect(source).toMatch(/availableRustTargetTriples\.includes\('wasm32-wasip3'\)/);
		expect(source).toMatch(
			/`wasm32-wasip3`\s+is only shown for the current transitional component path/
		);
		expect(source).toMatch(/Use\s+Ctrl\+D or the EOF button while running/);
	});

	it('surfaces TinyGo through the shared language selector, args field, and stdin hint', () => {
		expect(source).toMatch(/TinyGoTarget/);
		expect(source).toMatch(/tinygoTarget = \$state<TinyGoTarget>\('wasm'\),/);
		expect(source).toMatch(
			/const knownTinyGoTargets = \['wasm', 'wasip1', 'wasip2', 'wasip3'\] as const;/
		);
		expect(source).toMatch(/localStorage\.setItem\('tinygoTarget', tinygoTarget\);/);
		expect(source).toMatch(
			/const storedTinyGoTarget = localStorage\.getItem\('tinygoTarget'\);/
		);
		expect(source).toMatch(
			/requestedTinyGoTarget === 'wasip2' \|\|\s+requestedTinyGoTarget === 'wasip3'/s
		);
		expect(source).toMatch(/TINYGO: \(\) => \(\{ tinygoTarget \}\)/);
		expect(source).toMatch(/<option value="GO">Go<\/option>/);
		expect(source).toMatch(/<option value="D">D<\/option>/);
		expect(source).toMatch(/<option value="CSHARP">C#<\/option>/);
		expect(source).toMatch(/<option value="FSHARP">F#<\/option>/);
		expect(source).toMatch(/<option value="VBNET">VB\.NET<\/option>/);
		expect(source).toMatch(/<option value="ELIXIR">Elixir<\/option>/);
		expect(source).toMatch(/<option value="ERLANG">Erlang<\/option>/);
		expect(source).toMatch(/<option value="PROLOG">Prolog<\/option>/);
		expect(source).toMatch(/<option value="GLEAM">Gleam<\/option>/);
		expect(source).toMatch(/<option value="PERL">Perl<\/option>/);
		expect(source).toMatch(/<option value="PASCAL">Pascal<\/option>/);
		expect(source).toMatch(/<option value="CLOJURESCRIPT">ClojureScript<\/option>/);
		expect(source).toMatch(/<option value="FORTH">Forth<\/option>/);
		expect(source).toMatch(/<option value="J">J<\/option>/);
		expect(source).toMatch(/<option value="BQN">BQN<\/option>/);
		expect(source).toMatch(/<option value="JANET">Janet<\/option>/);
		expect(source).toMatch(/<option value="OCAML">OCaml<\/option>/);
		expect(source).toMatch(/<option value="TINYGO">TinyGo<\/option>/);
		expect(source).toMatch(/<option value="JAVASCRIPT">JavaScript<\/option>/);
		expect(source).toMatch(/<option value="TYPESCRIPT">TypeScript<\/option>/);
		expect(source).toMatch(/<option value="ASSEMBLYSCRIPT">AssemblyScript<\/option>/);
		expect(source).toMatch(/<option value="WAT">WAT<\/option>/);
		expect(source).toMatch(/<option value="LUA">Lua<\/option>/);
		expect(source).toMatch(/<option value="ZIG">Zig<\/option>/);
		expect(source).toMatch(/<option value="LISP">Scheme<\/option>/);
		expect(source).toMatch(/<option value="RUBY">Ruby<\/option>/);
		expect(source).toMatch(/<option value="HASKELL">Haskell<\/option>/);
		expect(source).toMatch(/<option value="R">R<\/option>/);
		expect(source).toMatch(/<option value="OCTAVE">Octave<\/option>/);
		expect(source).toMatch(/<option value="SQLITE">SQLite<\/option>/);
		expect(source).toMatch(/<option value="PHP">PHP<\/option>/);
		expect(source).toMatch(/\{#if argsHelpLanguages\.has\(language\)\}/);
		for (const argsLanguage of [
			'JAVA',
			'RUST',
			'GO',
			'D',
			'CSHARP',
			'FSHARP',
			'VBNET',
			'PROLOG',
			'GLEAM',
			'PERL',
			'TCL',
			'AWK',
			'TINYGO',
			'JAVASCRIPT',
			'TYPESCRIPT',
			'LUA',
			'ZIG',
			'LISP',
			'RUBY',
			'HASKELL',
			'R',
			'OCTAVE',
			'PHP'
		] as const) {
			expect(argsHelpLanguages.has(argsLanguage)).toBe(true);
		}
		expect(source).toMatch(/Go uses the bundled `wasm-go` browser compiler runtime/);
		expect(source).toMatch(
			/selector only shows Go\s+targets advertised by the bundled runtime manifest/
		);
		expect(source).toMatch(/`wasip1\/wasm`/);
		expect(source).toMatch(/preview1\s+core wasm/);
		expect(source).toMatch(/availableGoTargets\.includes\('wasip2\/wasm'\)/);
		expect(source).toMatch(/availableGoTargets\.includes\('wasip3\/wasm'\)/);
		expect(source).toMatch(/availableGoTargets\.includes\('js\/wasm'\)/);
		expect(source).toMatch(/`js\/wasm` runs through the bundled `wasm_exec\.js` browser host/);
		expect(source).toMatch(/<select id="tinygo-target" bind:value=\{tinygoTarget\}>/);
		expect(source).toMatch(
			/\{#each knownTinyGoTargets as target \(target\)\}\s+<option value=\{target\}>\{target\}<\/option>\s+\{\/each\}/s
		);
		expect(source).toMatch(
			/TinyGo runs through the bundled wasm-tinygo browser pipeline by default/
		);
		expect(source).not.toContain('host' + ' compile endpoint');
		expect(source).toMatch(/loads its\s+direct runtime module/);
		expect(source).toMatch(/`wasip2` and `wasip3` use the wasm-tinygo preview target profiles/);
		expect(source).toMatch(/resulting WASI artifact in the local playground\s+runtime/);
		expect(source).toMatch(/reads\s+stdin until EOF/);
	});

	it('surfaces D through bundled LDC and Emscripten LLD browser assets', () => {
		expect(source).toMatch(/d: \{/);
		expect(source).toMatch(/WASM_D_ASSET_VERSION/);
		expect(source).toMatch(/wasm-d\/index\.js\?v=\$\{WASM_D_ASSET_VERSION\}/);
		expect(source).toMatch(/<option value="D">D<\/option>/);
		expect(source).toMatch(/d: 'D'/);
		expect(source).toMatch(/dlang: 'D'/);
		expectEditorLanguage('D', 'd');
		expect(source).toMatch(/'.d': 'D'/);
		expect(source).toMatch(/D: 'main\.d'/);
		expect(source).toMatch(/D: 'd'/);
		expect(compilerDiagnosticLanguages.has('D')).toBe(true);
		expect(source).toMatch(/D compiles in the browser with the bundled LDC WASI compiler/);
		expect(source).toMatch(/Emscripten LLD\s+linker assets/);
		expect(source).toMatch(/executes the emitted WASI artifact locally/);
		expect(source).toMatch(/stdin until EOF/);
	});

	it('surfaces C#, F#, and VB.NET through wasm-dotnet runtime assets and the browser compiler hint', () => {
		expect(source).toMatch(/dotnet: \{/);
		expect(source).not.toContain('dotnet' + 'Host' + 'CompileUrl');
		expect(source).toMatch(/<option value="CSHARP">C#<\/option>/);
		expect(source).toMatch(/<option value="FSHARP">F#<\/option>/);
		expect(source).toMatch(/<option value="VBNET">VB\.NET<\/option>/);
		expect(source).toMatch(/csharp: 'CSHARP'/);
		expect(source).toMatch(/'c#': 'CSHARP'/);
		expect(source).toMatch(/cs: 'CSHARP'/);
		expect(source).toMatch(/fsharp: 'FSHARP'/);
		expect(source).toMatch(/'f#': 'FSHARP'/);
		expect(source).toMatch(/fs: 'FSHARP'/);
		expect(source).toMatch(/vbnet: 'VBNET'/);
		expect(source).toMatch(/vb: 'VBNET'/);
		expect(source).toMatch(/visualbasic: 'VBNET'/);
		expectEditorLanguage('CSHARP', 'csharp');
		expectEditorLanguage('FSHARP', 'fsharp');
		expectEditorLanguage('VBNET', 'vb');
		expect(source).toMatch(/'.vb': 'VBNET'/);
		expect(source).toMatch(/VBNET: 'Program\.vb'/);
		expect(source).toMatch(/VBNET: 'vbnet'/);
		expect(compilerDiagnosticLanguages.has('VBNET')).toBe(true);
		expect(source).toMatch(/isEditorDefaultSource\(content\)/);
		expect(source).toMatch(/isLegacyEditorDefaultSource\(content\)/);
		expect(source).toMatch(
			/\{language === 'CSHARP' \? 'C#' : language === 'VBNET' \? 'VB\.NET' : 'F#'\} uses a\s+`wasm-dotnet`\s+browser runtime module/
		);
		expect(source).toMatch(/static \.NET `browser-wasm` compiler app/);
		expect(source).toMatch(/`runtime\/dotnet\.js`/);
		expect(source).toMatch(
			/terminal input submitted before or during preparation\s+is passed to `Console\.In`/
		);
		expect(source).not.toContain('api/dotnet');
	});

	it('surfaces JavaScript and TypeScript through the wasm-typescript runtime', () => {
		expect(source).toMatch(/typescript: \{/);
		expect(source).toMatch(/WASM_TYPESCRIPT_ASSET_VERSION/);
		expect(source).toMatch(/wasm-typescript\/index\.js\?v=\$\{WASM_TYPESCRIPT_ASSET_VERSION\}/);
		expect(source).toMatch(
			/lsp\/typescript-libs\.json\.gz\?v=\$\{WASM_TYPESCRIPT_ASSET_VERSION\}/
		);
		expect(source).toMatch(/<option value="JAVASCRIPT">JavaScript<\/option>/);
		expect(source).toMatch(/<option value="TYPESCRIPT">TypeScript<\/option>/);
		expect(source).toMatch(/javascript: 'JAVASCRIPT'/);
		expect(source).toMatch(/js: 'JAVASCRIPT'/);
		expect(source).toMatch(/typescript: 'TYPESCRIPT'/);
		expect(source).toMatch(/ts: 'TYPESCRIPT'/);
		expectEditorLanguage('JAVASCRIPT', 'javascript');
		expectEditorLanguage('TYPESCRIPT', 'typescript');
		expect(source).toMatch(/JAVASCRIPT: 'main\.js'/);
		expect(source).toMatch(/TYPESCRIPT: 'main\.ts'/);
		expect(source).toMatch(/JAVASCRIPT: 'javascript'/);
		expect(source).toMatch(/TYPESCRIPT: 'typescript'/);
		expect(source).toMatch(
			/\{\s*language === 'JAVASCRIPT'\s+\?\s+'JavaScript'\s+:\s+'TypeScript'\s*\}\s+runs through the bundled\s+`wasm-typescript`\s+browser module/
		);
		expect(source).toMatch(/`fs\.readFileSync\('\/dev\/stdin', 'utf8'\)`/);
		expect(source).toMatch(/`fs\.readFileSync\(0,\s+'utf8'\)`/);
		expect(source).toMatch(/send Ctrl\+D or\s+the EOF button after\s+typing input/s);
	});

	it('surfaces AssemblyScript through the bundled browser compiler', () => {
		expect(source).toMatch(/<option value="ASSEMBLYSCRIPT">AssemblyScript<\/option>/);
		expect(source).toMatch(/assemblyscript: 'ASSEMBLYSCRIPT'/);
		expect(source).toMatch(/as: 'ASSEMBLYSCRIPT'/);
		expectEditorLanguage('ASSEMBLYSCRIPT', 'typescript');
		expect(source).toMatch(/endsWith\('\.as\.ts'\)\) return 'ASSEMBLYSCRIPT'/);
		expect(source).toMatch(/ASSEMBLYSCRIPT: 'main\.as\.ts'/);
		expect(source).toMatch(/ASSEMBLYSCRIPT: 'assemblyscript'/);
		expect(source).toMatch(/AssemblyScript compiles in the browser/);
		expect(source).toMatch(/bundled `assemblyscript` compiler/);
		expect(source).toMatch(/zero-argument numeric, boolean, and string exports/);
	});

	it('surfaces WAT through the wasm-wat browser compiler contract', () => {
		expect(source).toMatch(/wat: \{/);
		expect(source).toMatch(/WASM_WAT_ASSET_VERSION/);
		expect(source).toMatch(/wasm-wat\/index\.js\?v=\$\{WASM_WAT_ASSET_VERSION\}/);
		expect(source).toMatch(/<option value="WAT">WAT<\/option>/);
		expect(source).toMatch(/wat: 'WAT'/);
		expect(source).toMatch(/wast: 'WAT'/);
		expectEditorLanguage('WAT', 'wat');
		expect(source).toMatch(/'.wat': 'WAT'/);
		expect(source).toMatch(/WAT: 'main\.wat'/);
		expect(source).toMatch(/WAT: 'wat'/);
		expect(source).toMatch(/WAT compiles through the bundled WABT browser module/);
		expect(source).toMatch(/Zero-argument numeric exports are called automatically/);
	});

	it('surfaces WASM through the binary WebAssembly runner contract', () => {
		expect(source).toMatch(/<option value="WASM">WASM<\/option>/);
		expect(source).toMatch(/wasm: 'WASM'/);
		expect(source).toMatch(/wasm32: 'WASM'/);
		expectEditorLanguage('WASM', 'wasm');
		expect(source).toMatch(/'.wasm': 'WASM'/);
		expect(source).toMatch(/WASM: 'main\.wasm'/);
		expect(source).toMatch(/WASM: 'wasm'/);
		expect(source).toMatch(
			/WASM executes a WebAssembly binary from base64, hex, or a `data:application\/wasm`/
		);
		expect(source).toMatch(/WASI preview1 stdin/);
	});

	it('surfaces Lua through the wasm-lua browser runtime contract', () => {
		expect(source).toMatch(/lua: \{/);
		expect(source).toMatch(/WASM_LUA_ASSET_VERSION/);
		expect(source).toMatch(/wasm-lua\/index\.js\?v=\$\{WASM_LUA_ASSET_VERSION\}/);
		expect(source).toMatch(/<option value="LUA">Lua<\/option>/);
		expect(source).toMatch(/lua: 'LUA'/);
		expectEditorLanguage('LUA', 'lua');
		expect(source).toMatch(/'.lua': 'LUA'/);
		expect(source).toMatch(/LUA: 'main\.lua'/);
		expect(source).toMatch(/LUA: 'lua'/);
		expect(source).toMatch(/Lua runs through the bundled `wasmoon` Lua VM/);
		expect(source).toMatch(/backed by its local wasm payload/);
	});

	it('surfaces BQN through the CBQN wasm worker runtime contract', () => {
		expect(source).toMatch(/bqn: \{/);
		expect(source).toMatch(/WASM_BQN_ASSET_VERSION/);
		expect(source).toMatch(/wasm-bqn\/runner-worker\.js\?v=\$\{WASM_BQN_ASSET_VERSION\}/);
		expect(source).toMatch(/<option value="BQN">BQN<\/option>/);
		expect(source).toMatch(/bqn: 'BQN'/);
		expectEditorLanguage('BQN', 'bqn');
		expect(source).toMatch(/'.bqn': 'BQN'/);
		expect(source).toMatch(/BQN: 'main\.bqn'/);
		expect(source).toMatch(/BQN: 'bqn'/);
		expect(source).toMatch(/BQN runs through bundled CBQN WebAssembly assets/);
		expect(source).toMatch(/`•GetLine @`/);
	});

	it('surfaces Janet through the upstream Janet VM wasm worker runtime contract', () => {
		expect(source).toMatch(/janet: \{/);
		expect(source).toMatch(/WASM_JANET_ASSET_VERSION/);
		expect(source).toMatch(/wasm-janet\/runner-worker\.js\?v=\$\{WASM_JANET_ASSET_VERSION\}/);
		expect(source).toMatch(/<option value="JANET">Janet<\/option>/);
		expect(source).toMatch(/janet: 'JANET'/);
		expectEditorLanguage('JANET', 'janet');
		expect(source).toMatch(/'.janet': 'JANET'/);
		expect(source).toMatch(/JANET: 'main\.janet'/);
		expect(source).toMatch(/JANET: 'janet'/);
		expect(source).toMatch(/Janet runs through the upstream Janet VM compiled to WebAssembly/);
		expect(source).toMatch(/Use `getline` or[\s\S]*`file\/read stdin :line`/);
	});

	it('surfaces Julia through the Julia wasm worker runtime contract', () => {
		expect(source).toMatch(/julia: \{/);
		expect(source).toMatch(/WASM_JULIA_ASSET_VERSION/);
		expect(source).toMatch(/wasm-julia\/runner-worker\.js\?v=\$\{WASM_JULIA_ASSET_VERSION\}/);
		expect(source).toMatch(/<option value="JULIA">Julia<\/option>/);
		expect(source).toMatch(/julia: 'JULIA'/);
		expect(source).toMatch(/jl: 'JULIA'/);
		expectEditorLanguage('JULIA', 'julia');
		expect(source).toMatch(/'.jl': 'JULIA'/);
		expect(source).toMatch(/JULIA: 'main\.jl'/);
		expect(source).toMatch(/JULIA: 'julia'/);
		expect(source).toMatch(/Julia runs through the bundled Julia 1\.0\.4 WebAssembly runtime/);
		expect(source).toMatch(/Use `readline\(\)`/);
	});

	it('surfaces Nim through the Nim wasm compiler worker runtime contract', () => {
		expect(source).toMatch(/nim: \{/);
		expect(source).toMatch(/WASM_NIM_ASSET_VERSION/);
		expect(source).toMatch(/wasm-nim\/runner-worker\.js\?v=\$\{WASM_NIM_ASSET_VERSION\}/);
		expect(source).toMatch(/<option value="NIM">Nim<\/option>/);
		expect(source).toMatch(/nim: 'NIM'/);
		expect(source).toMatch(/nimrod: 'NIM'/);
		expectEditorLanguage('NIM', 'nim');
		expect(source).toMatch(/'.nim': 'NIM'/);
		expect(source).toMatch(/NIM: 'main\.nim'/);
		expect(source).toMatch(/NIM: 'nim'/);
		expect(source).toMatch(/Nim runs through the bundled Nim 2\.2\.4 WebAssembly compiler/);
		expect(source).toMatch(/Use `readLine\(stdin\)`/);
	});

	it('surfaces Zig through bundled wasm compiler assets and the browser runtime hint', () => {
		expect(source).toMatch(/zig: \{/);
		expect(source).toMatch(/WASM_ZIG_ASSET_VERSION/);
		expect(source).toMatch(/wasm-zig\/zig_small\.wasm\?v=\$\{WASM_ZIG_ASSET_VERSION\}/);
		expect(source).toMatch(/wasm-zig\/std\.zip\?v=\$\{WASM_ZIG_ASSET_VERSION\}/);
		expect(source).toMatch(/<option value="ZIG">Zig<\/option>/);
		expect(source).toMatch(/zig: 'ZIG'/);
		expectEditorLanguage('ZIG', 'zig');
		expect(source).toMatch(/'.zig': 'ZIG'/);
		expect(source).toMatch(/ZIG: 'main\.zig'/);
		expect(source).toMatch(/ZIG: 'zig'/);
		expect(source).toMatch(/ZIG: \(\) => \(\{ zigTargetTriple: 'wasm64-wasi' \}\)/);
		expect(source).toMatch(/Zig runs the bundled `zig_small\.wasm` compiler/);
		expect(source).toMatch(/`std\.zip` standard\s+library inside\s+the browser worker/s);
		expect(source).toMatch(/compiles for `wasm64-wasi`/);
		expect(source).toMatch(/executes the\s+emitted WASI artifact locally/s);
		expect(source).not.toContain('api/zig');
	});

	it('surfaces Lisp through the Puppy Scheme wasm compiler contract', () => {
		expect(source).toMatch(/lisp: \{/);
		expect(source).toMatch(/WASM_LISP_ASSET_VERSION/);
		expect(source).toMatch(/wasm-lisp\/index\.js\?v=\$\{WASM_LISP_ASSET_VERSION\}/);
		expect(source).toMatch(/<option value="LISP">Scheme<\/option>/);
		expect(source).toMatch(/lisp: 'LISP'/);
		expect(source).toMatch(/scheme: 'LISP'/);
		expectEditorLanguage('LISP', 'lisp');
		expect(source).toMatch(/'.scm': 'LISP'/);
		expect(source).toMatch(/LISP: 'main\.scm'/);
		expect(source).toMatch(/LISP: 'lisp'/);
	});

	it('surfaces Ruby through the CRuby WebAssembly runtime contract', () => {
		expect(source).toMatch(/<option value="RUBY">Ruby<\/option>/);
		expect(source).toMatch(/ruby: 'RUBY'/);
		expect(source).toMatch(/rb: 'RUBY'/);
		expectEditorLanguage('RUBY', 'ruby');
		expect(source).toMatch(/'.rb': 'RUBY'/);
		expect(source).toMatch(/RUBY: 'main\.rb'/);
		expect(source).toMatch(/RUBY: 'ruby'/);
		expect(source).toMatch(/Ruby runs through bundled CRuby WebAssembly assets/);
		expect(source).toMatch(/from `ruby\.wasm`/);
		expect(source).toMatch(/reads stdin until EOF/);
	});

	it('surfaces Haskell through the ghc-in-browser wasm compiler contract', () => {
		expect(source).toMatch(/haskell: \{/);
		expect(source).toMatch(/WASM_HASKELL_ASSET_VERSION/);
		expect(source).toMatch(/wasm-haskell\/dyld\.mjs\?v=\$\{WASM_HASKELL_ASSET_VERSION\}/);
		expect(source).toMatch(
			/wasm-haskell\/rootfs\.tar\.zst\?v=\$\{WASM_HASKELL_ASSET_VERSION\}/
		);
		expect(source).toMatch(/wasm-haskell\/bsdtar\.wasm\?v=\$\{WASM_HASKELL_ASSET_VERSION\}/);
		expect(source).toMatch(/<option value="HASKELL">Haskell<\/option>/);
		expect(source).toMatch(/haskell: 'HASKELL'/);
		expect(source).toMatch(/hs: 'HASKELL'/);
		expectEditorLanguage('HASKELL', 'haskell');
		expect(source).toMatch(/'.hs': 'HASKELL'/);
		expect(source).toMatch(/HASKELL: 'main\.hs'/);
		expect(source).toMatch(/HASKELL: 'haskell'/);
		expect(argsLabels.HASKELL).toBe('GHC Args');
		expect(source).toMatch(/<span>\{argsLabel\}<\/span>/);
		expect(source).toMatch(/Haskell loads a wasm GHC\/GHCi root filesystem/);
		expect(source).toMatch(/program stdin is currently treated as EOF/);
	});

	it('surfaces R through the bundled webR runtime contract', () => {
		expect(source).toMatch(
			/import \{ WASM_R_ASSET_VERSION \} from '\$lib\/playground\/wasmRVersion';/
		);
		expect(source).toMatch(
			/r: \{\s+baseUrl: path\s+\?\s+`\$\{path\}\/webr\/\$\{WASM_R_ASSET_VERSION\}\/`\s+:\s+`\/webr\/\$\{WASM_R_ASSET_VERSION\}\/`\s+\}/s
		);
		expect(source).toMatch(/<option value="R">R<\/option>/);
		expect(source).toMatch(/r: 'R'/);
		expectEditorLanguage('R', 'r');
		expect(source).toMatch(/'.r': 'R'/);
		expect(source).toMatch(/R: 'main\.R'/);
		expect(source).toMatch(/R: 'r'/);
		expect(source).toMatch(/R runs through bundled webR WebAssembly assets/);
	});

	it('surfaces Octave through the bundled GNU Octave wasm runtime contract', () => {
		expect(source).toMatch(
			/import \{ WASM_OCTAVE_ASSET_VERSION \} from '\$lib\/playground\/wasmOctaveVersion';/
		);
		expect(source).toMatch(/<option value="OCTAVE">Octave<\/option>/);
		expect(source).toMatch(/octave: 'OCTAVE'/);
		expect(source).toMatch(/matlab: 'OCTAVE'/);
		expectEditorLanguage('OCTAVE', 'octave');
		expect(source).toMatch(/'.m': 'OCTAVE'/);
		expect(source).toMatch(/OCTAVE: 'main\.m'/);
		expect(source).toMatch(/OCTAVE: 'octave'/);
		expect(source).toMatch(/Octave runs through bundled GNU Octave WebAssembly assets/);
		expect(source).toMatch(/code using `stdin` reads a line/);
	});

	it('surfaces SQLite through the bundled sql.js worker runtime contract', () => {
		expect(source).toMatch(/<option value="SQLITE">SQLite<\/option>/);
		expect(source).toMatch(/sqlite: 'SQLITE'/);
		expect(source).toMatch(/sql: 'SQLITE'/);
		expectEditorLanguage('SQLITE', 'sql');
		expect(source).toMatch(/'.sql': 'SQLITE'/);
		expect(source).toMatch(/'.sqlite': 'SQLITE'/);
		expect(source).toMatch(/SQLITE: 'main\.sql'/);
		expect(source).toMatch(/SQLITE: 'sqlite'/);
		expect(source).toMatch(/SQLite runs through bundled sql\.js WebAssembly assets/);
		expect(source).toMatch(/SELECT results are printed as tab-separated tables/);
	});

	it('surfaces DuckDB through the bundled DuckDB-Wasm worker runtime contract', () => {
		expect(source).toMatch(/<option value="DUCKDB">DuckDB<\/option>/);
		expect(source).toMatch(/duckdb: 'DUCKDB'/);
		expectEditorLanguage('DUCKDB', 'sql');
		expect(source).toMatch(/'.duckdb': 'DUCKDB'/);
		expect(source).toMatch(/DUCKDB: 'main\.duckdb'/);
		expect(source).toMatch(/DUCKDB: 'duckdb'/);
		expect(source).toMatch(/DuckDB runs through `@duckdb\/duckdb-wasm`/);
		expect(source).toMatch(/SELECT results are printed as tab-separated tables/);
		expect(editorOnlyLanguages.has('DUCKDB')).toBe(false);
	});

	it('surfaces COBOL through the GnuCOBOL wasm-llvm runtime contract', () => {
		expect(source).toMatch(/<option value="COBOL">COBOL<\/option>/);
		expect(source).toMatch(/cobol: 'COBOL'/);
		expect(source).toMatch(/gnucobol: 'COBOL'/);
		expect(source).toMatch(/'.cob': 'COBOL'/);
		expect(source).toMatch(/COBOL: 'main\.cob'/);
		expect(source).toMatch(/COBOL: 'cobol'/);
		expect(source).toMatch(/GnuCOBOL 3\.2/);
		expect(source).toMatch(/Use `ACCEPT` for stdin and `DISPLAY` for stdout/);
		expect(editorOnlyLanguages.has('COBOL')).toBe(false);
	});

	it('surfaces editor-only LSP workspaces', () => {
		expect(source).toMatch(/<option value="FORTRAN">Fortran<\/option>/);
		expect(editorOnlyLanguages.has('FORTRAN')).toBe(false);
		for (const [language, label] of [
			['GRAPHQL', 'GraphQL'],
			['JSON', 'JSON'],
			['YAML', 'YAML'],
			['TOML', 'TOML'],
			['HTML', 'HTML'],
			['CSS', 'CSS'],
			['MARKDOWN', 'Markdown']
		]) {
			expect(source).toMatch(new RegExp(`<option value="${language}">${label}<\\/option>`));
		}
		for (const language of [
			'GRAPHQL',
			'JSON',
			'YAML',
			'TOML',
			'HTML',
			'CSS',
			'MARKDOWN'
		] as const) {
			expect(editorOnlyLanguages.has(language)).toBe(true);
		}
		expect(source).toMatch(
			/const executionAvailable = \$derived\(!editorOnlyLanguages\.has\(language\)\);/
		);
		expect(source).toMatch(/if \(!executionAvailable\) return;/);
		expect(source).toMatch(/fortran: 'FORTRAN'/);
		expect(source).toMatch(/graphql: 'GRAPHQL'/);
		expect(source).toMatch(/json: 'JSON'/);
		expect(source).toMatch(/jsonc: 'JSON'/);
		expect(source).toMatch(/yaml: 'YAML'/);
		expect(source).toMatch(/yml: 'YAML'/);
		expect(source).toMatch(/toml: 'TOML'/);
		expect(source).toMatch(/html: 'HTML'/);
		expect(source).toMatch(/htm: 'HTML'/);
		expect(source).toMatch(/css: 'CSS'/);
		expect(source).toMatch(/markdown: 'MARKDOWN'/);
		expect(source).toMatch(/md: 'MARKDOWN'/);
		expect(source).toMatch(/FORTRAN: 'main\.f'/);
		expect(source).toMatch(/GRAPHQL: 'main\.graphql'/);
		expect(source).toMatch(/JSON: 'main\.json'/);
		expect(source).toMatch(/YAML: 'main\.yaml'/);
		expect(source).toMatch(/TOML: 'main\.toml'/);
		expect(source).toMatch(/HTML: 'index\.html'/);
		expect(source).toMatch(/CSS: 'styles\.css'/);
		expect(source).toMatch(/MARKDOWN: 'README\.md'/);
		expect(source).toMatch(/'.json': 'JSON'/);
		expect(source).toMatch(/'.jsonc': 'JSON'/);
		expect(source).toMatch(/'.yaml': 'YAML'/);
		expect(source).toMatch(/'.yml': 'YAML'/);
		expect(source).toMatch(/'.toml': 'TOML'/);
		expect(source).toMatch(/'.html': 'HTML'/);
		expect(source).toMatch(/'.htm': 'HTML'/);
		expect(source).toMatch(/'.css': 'CSS'/);
		expect(source).toMatch(/'.md': 'MARKDOWN'/);
		expect(source).toMatch(/'.markdown': 'MARKDOWN'/);
	});

	it('surfaces PHP through the php-wasm browser runtime contract', () => {
		expect(source).toMatch(/<option value="PHP">PHP<\/option>/);
		expect(source).toMatch(/php: 'PHP'/);
		expectEditorLanguage('PHP', 'php');
		expect(source).toMatch(/'.php': 'PHP'/);
		expect(source).toMatch(/PHP: 'main\.php'/);
		expect(source).toMatch(/PHP: 'php'/);
		expect(source).toMatch(/PHP runs through `@php-wasm\/web` in the browser worker/);
		expect(source).toMatch(/stdin is provided as `php:\/\/input`/);
	});

	it('surfaces Elixir through the shared language selector and Popcorn hint', () => {
		expect(source).toMatch(/elixir: \{/);
		expect(source).toMatch(/bundleUrl: path/);
		expect(source).toMatch(/<option value="ELIXIR">Elixir<\/option>/);
		expect(source).toMatch(/elixir: 'ELIXIR'/);
		expectEditorLanguage('ELIXIR', 'elixir');
		expect(source).toMatch(/Elixir runs through a bundled Popcorn evaluator/);
		expect(source).toMatch(/Code\.eval_string/);
		expect(source).toMatch(/prints the final expression as `=&gt; \.\.\.`/);
		expect(source).toMatch(/press Enter to send stdin/);
		expect(source).toMatch(/CLI args are still disabled/);
	});

	it('surfaces Erlang through the shared language selector and Popcorn hint', () => {
		expect(source).toMatch(/erlang: \{/);
		expect(source).toMatch(/<option value="ERLANG">Erlang<\/option>/);
		expect(source).toMatch(/erlang: 'ERLANG'/);
		expect(source).toMatch(/erl: 'ERLANG'/);
		expect(source).toMatch(/'.erl': 'ERLANG'/);
		expect(source).toMatch(/ERLANG: 'main\.erl'/);
		expect(source).toMatch(/ERLANG: 'erlang'/);
		expectEditorLanguage('ERLANG', 'erlang');
		expect(source).toMatch(/Erlang runs through the bundled Popcorn\/AtomVM evaluator/);
		expect(source).toMatch(/module files compile with the bundled Erlang compiler/);
		expect(source).toMatch(/`io:get_line\(""\)` or `io:get_chars\("", N\)`/);
	});

	it('surfaces Prolog, Gleam, and Perl through static wasm worker runtime contracts', () => {
		expect(source).toMatch(/prolog: \{/);
		expect(source).toMatch(/gleam: \{/);
		expect(source).toMatch(/perl: \{/);
		expect(source).toMatch(/WASM_PROLOG_ASSET_VERSION/);
		expect(source).toMatch(/WASM_GLEAM_ASSET_VERSION/);
		expect(source).toMatch(/WASM_PERL_ASSET_VERSION/);
		expect(source).toMatch(/<option value="PROLOG">Prolog<\/option>/);
		expect(source).toMatch(/<option value="GLEAM">Gleam<\/option>/);
		expect(source).toMatch(/<option value="PERL">Perl<\/option>/);
		expect(source).toMatch(/prolog: 'PROLOG'/);
		expect(source).toMatch(/swipl: 'PROLOG'/);
		expect(source).toMatch(/swi: 'PROLOG'/);
		expect(source).toMatch(/gleam: 'GLEAM'/);
		expect(source).toMatch(/perl: 'PERL'/);
		expect(source).toMatch(/'.prolog': 'PROLOG'/);
		expect(source).toMatch(/'.pro': 'PROLOG'/);
		expect(source).toMatch(/'.gleam': 'GLEAM'/);
		expect(source).toMatch(/'.pl': 'PERL'/);
		expect(source).toMatch(/PROLOG: 'main\.prolog'/);
		expect(source).toMatch(/GLEAM: 'main\.gleam'/);
		expect(source).toMatch(/PERL: 'main\.pl'/);
		expect(source).toMatch(/PROLOG: 'prolog'/);
		expect(source).toMatch(/GLEAM: 'gleam'/);
		expect(source).toMatch(/PERL: 'perl'/);
		expect(source).toMatch(/SWI-Prolog WebAssembly assets/);
		expect(source).toMatch(/Gleam WebAssembly compiler/);
		expect(source).toMatch(/WebPerl WebAssembly assets/);
		expect(source).toMatch(/`wasm_idle\/stdin`/);
		expect(source).toMatch(/`&lt;STDIN&gt;`/);
	});

	it('surfaces OCaml through the shared language selector and backend hint', () => {
		expect(source).toMatch(/ocamlBackend = \$state<OcamlBackend>\('wasm'\),/);
		expect(source).toMatch(/ocamlWasmBinaryenMode = \$state<OcamlWasmBinaryenMode>\('fast'\),/);
		expect(source).toMatch(/localStorage\.setItem\('ocamlBackend', ocamlBackend\);/);
		expect(source).toMatch(
			/localStorage\.setItem\('ocamlWasmBinaryenMode', ocamlWasmBinaryenMode\);/
		);
		expect(source).toMatch(
			/const storedOcamlBackend = localStorage\.getItem\('ocamlBackend'\);/
		);
		expect(source).toMatch(
			/const storedOcamlWasmBinaryenMode = localStorage\.getItem\('ocamlWasmBinaryenMode'\);/
		);
		expect(source).toMatch(
			/const requestedOcamlBackend = page\.url\.searchParams\.get\('ocamlBackend'\);/
		);
		expect(source).toMatch(
			/const requestedOcamlWasmBinaryenMode =\s+page\.url\.searchParams\.get\('ocamlWasmBinaryenMode'\);/s
		);
		expect(source).toMatch(
			/requestedOcamlBackend === 'js' \|\| requestedOcamlBackend === 'wasm'/
		);
		expect(source).toMatch(/storedOcamlBackend === 'js' \|\| storedOcamlBackend === 'wasm'/);
		expect(source).toMatch(
			/requestedOcamlWasmBinaryenMode === 'fast' \|\|\s+requestedOcamlWasmBinaryenMode === 'full'/
		);
		expect(source).toMatch(
			/storedOcamlWasmBinaryenMode === 'fast' \|\|\s+storedOcamlWasmBinaryenMode === 'full'/
		);
		expectEditorLanguage('OCAML', 'ocaml');
		expect(source).toMatch(/OCAML: \(\) => \(\{ ocamlBackend, ocamlWasmBinaryenMode \}\)/);
		expect(source).toMatch(/<select id="ocaml-backend" bind:value=\{ocamlBackend\}>/);
		expect(source).toMatch(
			/<select id="ocaml-binaryen-mode" bind:value=\{ocamlWasmBinaryenMode\}>/
		);
		expect(source).toMatch(/<option value="wasm">wasm_of_ocaml<\/option>/);
		expect(source).toMatch(/<option value="js">js_of_ocaml<\/option>/);
		expect(source).toMatch(/<option value="fast">Binaryen fast<\/option>/);
		expect(source).toMatch(/<option value="full">Binaryen full<\/option>/);
		expect(source).toMatch(
			/OCaml uses the bundled `wasm-of-js-of-ocaml` browser-native toolchain/
		);
		expect(source).toMatch(/selector switches between `wasm_of_ocaml` and `js_of_ocaml`/);
		expect(source).toMatch(/Binaryen fast is the\s+default low-memory wasm path/s);
		expect(source).toMatch(
			/Binaryen full runs the original static `wasm-metadce`\s+and `wasm-opt` passes/s
		);
		expect(source).toMatch(/Type into the\s+terminal below and press Enter to send a line/s);
	});

	it('keeps the example workspace full-height, resizable, and hides debug panels until debug starts', () => {
		expect(() =>
			compile(layoutSource, {
				filename: 'src/routes/+layout.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(
			/examplePaneWidth = \$state\(0\),\s+terminalPaneWidth = \$state<number \| null>\(null\),\s+resizingPane = \$state\(false\);/s
		);
		expect(source).toMatch(/const desktopExampleLayout = \$derived\(examplePaneWidth > 960\);/);
		expect(source).toMatch(/const terminalPanePixelWidth = \$derived\.by\(\(\) => \{/);
		expect(source).toMatch(/\{#if debugLanguage && debug\.active\}/);
		expect(source).toMatch(/class="panel-resizer"/);
		expect(source).toMatch(/role="slider"/);
		expect(source).toMatch(/onpointerdown=\{\(event\) => \{/);
		expect(source).toMatch(/onkeydown=\{\(event\) => \{/);
		expect(source).toMatch(/height: 100dvh;/);
		expect(source).toMatch(
			/@media \(max-width: 960px\) \{\s+main \{\s+height: auto;\s+min-height: 100vh;\s+min-height: 100dvh;/s
		);
		expect(source).toMatch(
			/<div\s+class:panel-resizer--active=\{resizingPane\}\s+class="panel-resizer"/s
		);
		expect(source).toMatch(/role="slider"/);
		expect(source).toMatch(/breakpoints=\{debug\.effectiveBreakpoints\}/);
		expect(source).toMatch(/onCursorLineChange=\{debug\.setCursorLine\}/);
		expect(source).toMatch(/onBreakpointsChange=\{debug\.setBreakpoints\}/);
		expect(source).toMatch(/onRunToCursor=\{debug\.runToCursor\}/);
		expect(layoutSource).toMatch(
			/:global\(html\),\s+:global\(body\) \{\s+margin: 0;\s+min-height: 100%;\s+\}/s
		);
		expect(layoutSource).toMatch(
			/:global\(body\) \{\s+min-height: 100vh;\s+min-height: 100dvh;\s+\}/s
		);
		expect(layoutSource).toMatch(/let \{ children \} = \$props\(\);/);
		expect(layoutSource).toMatch(/\{@render children\(\)\}/);
	});

	it('keys recursive call stack entries by index so duplicate frames still render', () => {
		expect(source).toMatch(
			/\{#each debug\.callStack as frame, index \(`\$\{frame\.functionName\}:\$\{frame\.line\}:\$\{index\}`\)\}/
		);
	});
});
