import layoutSource from './+layout.svelte?raw';
import source from './+page.svelte?raw';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

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
		expect(source).toMatch(/disabled=\{runningMode === 'debug'\}/);
		expect(source).toMatch(/async function sendTerminalEof\(\) \{/);
		expect(source).toMatch(/await terminal\.eof\?\.\(\);/);
		expect(source).toMatch(/title="Send EOF"/);
	});

	it('delegates debug state, runtime watches, and run-to-cursor to the shared debug controller', () => {
		expect(source).toMatch(
			/import Terminal, \{\s+createPlaygroundBinding,\s+createDebugSessionController,\s+cppDebugLanguageAdapter,\s+pythonDebugLanguageAdapter\s+\} from '\$lib';/s
		);
		expect(source).toMatch(/const debug = createDebugSessionController\(\{/);
		expect(source).toMatch(/syncBreakpointsWhile: \(\) => runningMode === 'debug'/);
		expect(source).toMatch(/\$effect\(\(\) => \{\s+debug\.setTerminal\(terminal\);\s+\}\);/s);
		expect(source).toMatch(/\$effect\(\(\) => \{\s+debug\.setAdapter\(debugLanguage\);\s+\}\);/s);
		expect(source).toMatch(/debug\.begin\(\);/);
		expect(source).toMatch(/breakpoints: \[\.\.\.debug\.effectiveBreakpoints\],/);
		expect(source).toMatch(/if \(!debug\.paused\) debug\.reset\(\);/);
		expect(source).toMatch(
			/title=\{debug\.cursorLine \? `Run to Cursor \(L\$\{debug\.cursorLine\}\)` : 'Run to Cursor'\}/
		);
		expect(source).toMatch(
			/aria-label=\{debug\.cursorLine \? `Run to Cursor \(L\$\{debug\.cursorLine\}\)` : 'Run to Cursor'\}/
		);
		expect(source).toMatch(/onclick=\{\(\) => debug\.runToCursor\(\)\}/);
		expect(source).toMatch(/disabled=\{!debug\.canRunToCursor\}/);
		expect(source).toMatch(/onclick=\{\(\) => debug\.sendCommand\('continue'\)\}/);
		expect(source).toMatch(/ondebug=\{debug\.handleEvent\}/);
		expect(source).toMatch(/bind:value=\{debug\.watchInput\}/);
		expect(source).toMatch(/onclick=\{\(\) => debug\.addWatchExpression\(\)\}/);
		expect(source).toMatch(/onclick=\{\(\) => debug\.removeWatchExpression\(watch\.expression\)\}/);
		expect(source).toMatch(/debugLocals=\{debug\.locals\}/);
		expect(source).toMatch(/pausedLine=\{debug\.pausedLine\}/);
		expect(source).toMatch(/onRunToCursor=\{debug\.runToCursor\}/);
		expect(source).toMatch(/<span class="material-symbols-outlined">play_circle<\/span>/);
	});

	it('passes a local wasm-rust bundle through a reusable playground binding', () => {
		expect(source).toMatch(
			/import \{ WASM_RUST_ASSET_VERSION \} from '\$lib\/playground\/wasmRustVersion';/
		);
		expect(source).toMatch(
			/import \{ WASM_TINYGO_ASSET_VERSION \} from '\$lib\/playground\/wasmTinyGoVersion';/
		);
		expect(source).toMatch(
			/let tinygoDisableHostCompile = \$derived\(\s*browser && page\.url\.searchParams\.get\('tinygoCompilePath'\) === 'browser'\s*\);/
		);
		expect(source).toMatch(
			/let runtimeAssets = \$derived\.by<PlaygroundRuntimeAssets>\(\(\) => \(\{\s+rootUrl: path,\s+rust: \{\s+compilerUrl: path\s+\?\s+`\$\{path\}\/wasm-rust\/index\.js\?v=\$\{WASM_RUST_ASSET_VERSION\}`\s+:\s+`\/wasm-rust\/index\.js\?v=\$\{WASM_RUST_ASSET_VERSION\}`\s+\},\s+tinygo: \{\s+disableHostCompile: tinygoDisableHostCompile,\s+moduleUrl: path\s+\?\s+`\$\{path\}\/wasm-tinygo\/runtime\.js\?v=\$\{WASM_TINYGO_ASSET_VERSION\}`\s+:\s+`\/wasm-tinygo\/runtime\.js\?v=\$\{WASM_TINYGO_ASSET_VERSION\}`\s+\}\s+\}\)\);/s
		);
		expect(source).toMatch(
			/const playground = \$derived\.by\(\(\) => createPlaygroundBinding\(runtimeAssets\)\);/
		);
		expect(source).toMatch(/<Terminal\s+bind:terminal\s+playground=\{playground\}/s);
		expect(source).toMatch(
			/type WasmRustRuntimeModule = \{\s+preloadBrowserRustRuntime\?: \(options\?: \{\s+targetTriple\?: RustTargetTriple;\s+\}\) => Promise<void>;\s+\};/s
		);
		expect(source).toMatch(
			/const compilerUrl = runtimeAssets\.rust\?\.compilerUrl;\s+const preloadTargetTriple = availableRustTargetTriples\.includes\(rustTargetTriple\)\s+\?\s+rustTargetTriple\s+:\s+availableRustTargetTriples\[0\];/s
		);
		expect(source).toMatch(
			/const runtimeModule = \(await import\(\s+\/\* @vite-ignore \*\/ compilerUrl\s+\)\) as WasmRustRuntimeModule;/
		);
		expect(source).toMatch(
			/await runtimeModule\.preloadBrowserRustRuntime\?\.\(\{\s+targetTriple: preloadTargetTriple\s+\}\);/s
		);
	});

	it('persists and forwards the Rust target triple selection', () => {
		expect(source).toMatch(/rustTargetTriple = \$state<RustTargetTriple>\('wasm32-wasip1'\),/);
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
		expect(source).toMatch(/const response = await fetch\(manifestUrl, \{ cache: 'no-store' \}\);/);
		expect(source).toMatch(
			/const nextAvailableRustTargetTriples = knownRustTargetTriples\.filter\(\s*\(targetTriple\) =>\s*Object\.prototype\.hasOwnProperty\.call\(manifest\.targets \|\| \{}, targetTriple\)\s*\);/s
		);
		expect(source).toMatch(
			/availableRustTargetTriples = \[\.\.\.nextAvailableRustTargetTriples\];/
		);
		expect(source).toMatch(
			/availableRustTargetTriples = \['wasm32-wasip1', 'wasm32-wasip2'\];/
		);
		expect(source).toMatch(/const editorLanguage = \$derived\(/);
		expect(source).toMatch(/: 'go'/);
		expect(source).toMatch(/rustTargetTriple: language === 'RUST' \? rustTargetTriple : undefined/);
		expect(source).toMatch(/<select id="rust-target-triple" bind:value=\{rustTargetTriple\}>/);
		expect(source).toMatch(
			/\{#each availableRustTargetTriples as targetTriple \(targetTriple\)\}\s+<option value=\{targetTriple\}>\{targetTriple\}<\/option>\s+\{\/each\}/s
		);
		expect(source).toMatch(/rustTargetTriple=\{language === 'RUST' \? rustTargetTriple : undefined\}/);
	});

	it('exposes a browser debug hook that writes terminal stdin through the bound control', () => {
		expect(source).toMatch(/type WasmIdleDebugApi = \{\s+writeTerminalInput: \(text: string, eof\?: boolean\) => Promise<void>;\s+\};/s);
		expect(source).toMatch(/let browserDebugHookVersion = 0;/);
		expect(source).toMatch(/const debugHookVersion = \+\+browserDebugHookVersion;/);
		expect(source).toMatch(/target\.__wasmIdleDebug = debugApi;/);
		expect(source).toMatch(
			/if \(browserDebugHookVersion === debugHookVersion\) delete target\.__wasmIdleDebug;/
		);
		expect(source).toMatch(/await terminal\.waitForInput\?\.\(\);/);
		expect(source).toMatch(/await terminal\.write\(text\);/);
		expect(source).toMatch(/if \(eof\) await terminal\.eof\?\.\(\);/);
	});

	it('keeps browser stdin helper wiring separate from the shared debug controller', () => {
		expect(source).not.toMatch(/terminalControl\?\.debugEvaluate/);
		expect(source).toMatch(/createDebugSessionController/);
	});

	it('shows a Rust stdin hint that explains EOF for read-to-end programs', () => {
		expect(source).toMatch(/press Enter to send a line\./);
		expect(source).toMatch(/selector only shows\s+Rust targets advertised by the bundled wasm-rust runtime manifest/);
		expect(source).toMatch(/`wasm32-wasip1`\s+uses preview1 core wasm/);
		expect(source).toMatch(/availableRustTargetTriples\.includes\('wasm32-wasip2'\)/);
		expect(source).toMatch(/`wasm32-wasip2`\s+uses preview2 component execution/);
		expect(source).toMatch(/availableRustTargetTriples\.includes\('wasm32-wasip3'\)/);
		expect(source).toMatch(/`wasm32-wasip3`\s+is only shown for the current transitional component path/);
		expect(source).toMatch(/Use\s+Ctrl\+D or the EOF button while running/);
	});

	it('surfaces TinyGo through the shared language selector, args field, and stdin hint', () => {
		expect(source).toMatch(/<option value="TINYGO">TinyGo<\/option>/);
		expect(source).toMatch(
			/\{#if language === 'JAVA' \|\| language === 'RUST' \|\| language === 'TINYGO'\}/
		);
		expect(source).toMatch(/language === 'JAVA' \|\| language === 'RUST' \|\| language === 'TINYGO'/);
		expect(source).toMatch(/TinyGo prefers a configured host-assisted compile endpoint/);
		expect(source).toMatch(/falls back to the bundled wasm-tinygo browser pipeline/);
		expect(source).toMatch(/resulting WASI artifact in the local playground runtime/);
		expect(source).toMatch(/reads\s+stdin until EOF/);
	});

	it('keeps the example workspace full-height, resizable, and hides debug panels until debug starts', () => {
		expect(() =>
			compile(layoutSource, {
				filename: 'src/routes/+layout.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(/examplePaneWidth = \$state\(0\),\s+terminalPaneWidth = \$state<number \| null>\(null\),\s+resizingPane = \$state\(false\);/s);
		expect(source).toMatch(/const desktopExampleLayout = \$derived\(examplePaneWidth > 960\);/);
		expect(source).toMatch(/const terminalPanePixelWidth = \$derived\.by\(\(\) => \{/);
		expect(source).toMatch(/\{#if debugLanguage && debug\.active\}/);
		expect(source).toMatch(/class="panel-resizer"/);
		expect(source).toMatch(/role="slider"/);
		expect(source).toMatch(/onpointerdown=\{\(event\) => \{/);
		expect(source).toMatch(/onkeydown=\{\(event\) => \{/);
		expect(source).toMatch(/height: 100dvh;/);
		expect(source).toMatch(/@media \(max-width: 960px\) \{\s+main \{\s+height: auto;\s+min-height: 100vh;\s+min-height: 100dvh;/s);
		expect(source).toMatch(/<div\s+class:panel-resizer--active=\{resizingPane\}\s+class="panel-resizer"/s);
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
