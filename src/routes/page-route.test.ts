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

	it('adds a run-to-cursor action that continues with a temporary cursor breakpoint', () => {
		expect(source).toMatch(/cursorLine = \$state<number \| null>\(null\),\s+runToCursorLine = \$state<number \| null>\(null\),/s);
		expect(source).toMatch(/const effectiveBreakpoints = \$derived\.by\(\(\) => \{/);
		expect(source).toMatch(/const canRunToCursor = \$derived\(/);
		expect(source).toMatch(/async function runToCursor\(targetLine = cursorLine\) \{/);
		expect(source).toMatch(/await terminal\.setBreakpoints\?\.\(nextBreakpoints\);/);
		expect(source).toMatch(/await terminal\.debugCommand\?\.\('continue'\);/);
		expect(source).toMatch(/breakpoints: \[\.\.\.effectiveBreakpoints\],/);
		expect(source).toMatch(/terminal\?\.setBreakpoints\?\.\(\[\.\.\.effectiveBreakpoints\]\);/);
		expect(source).toMatch(/title=\{cursorLine \? `Run to Cursor \(L\$\{cursorLine\}\)` : 'Run to Cursor'\}/);
		expect(source).toMatch(/aria-label=\{cursorLine \? `Run to Cursor \(L\$\{cursorLine\}\)` : 'Run to Cursor'\}/);
		expect(source).toMatch(/onclick=\{\(\) => runToCursor\(\)\}/);
		expect(source).toMatch(/disabled=\{!canRunToCursor\}/);
		expect(source).toMatch(/<span class="material-symbols-outlined">play_circle<\/span>/);
	});

	it('passes a local wasm-rust bundle to the demo Terminal runtime assets', () => {
		expect(source).toMatch(
			/import \{ WASM_RUST_ASSET_VERSION \} from '\$lib\/playground\/wasmRustVersion';/
		);
		expect(source).toMatch(
			/let runtimeAssets = \$derived\.by<PlaygroundRuntimeAssets>\(\(\) => \(\{\s+rootUrl: path,\s+rust: \{\s+compilerUrl: path\s+\?\s+`\$\{path\}\/wasm-rust\/index\.js\?v=\$\{WASM_RUST_ASSET_VERSION\}`\s+:\s+`\/wasm-rust\/index\.js\?v=\$\{WASM_RUST_ASSET_VERSION\}`\s+\}\s+\}\)\);/s
		);
		expect(source).toMatch(/<Terminal\s+bind:terminal\s+\{path\}\s+\{runtimeAssets\}/s);
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
		expect(source).toMatch(/rustTargetTriple: language === 'RUST' \? rustTargetTriple : undefined/);
		expect(source).toMatch(/<select id="rust-target-triple" bind:value=\{rustTargetTriple\}>/);
		expect(source).toMatch(
			/\{#each availableRustTargetTriples as targetTriple \(targetTriple\)\}\s+<option value=\{targetTriple\}>\{targetTriple\}<\/option>\s+\{\/each\}/s
		);
		expect(source).toMatch(/rustTargetTriple=\{language === 'RUST' \? rustTargetTriple : undefined\}/);
	});

	it('exposes a browser debug hook that writes terminal stdin through the bound control', () => {
		expect(source).toMatch(/type WasmIdleDebugApi = \{\s+writeTerminalInput: \(text: string, eof\?: boolean\) => Promise<void>;\s+\};/s);
		expect(source).toMatch(/target\.__wasmIdleDebug = debugApi;/);
		expect(source).toMatch(/await terminal\.waitForInput\?\.\(\);/);
		expect(source).toMatch(/await terminal\.write\(text\);/);
		expect(source).toMatch(/if \(eof\) await terminal\.eof\?\.\(\);/);
	});

	it('prefers runtime-backed watch evaluation when the terminal exposes it', () => {
		expect(source).toMatch(/if \(paused && terminalControl\?\.debugEvaluate\) \{/);
		expect(source).toMatch(/value: await terminalControl\.debugEvaluate!\(expression\)/);
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
		expect(source).toMatch(/\{#if debugLanguage && debugActive\}/);
		expect(source).toMatch(/class="panel-resizer"/);
		expect(source).toMatch(/role="slider"/);
		expect(source).toMatch(/onpointerdown=\{\(event\) => \{/);
		expect(source).toMatch(/onkeydown=\{\(event\) => \{/);
		expect(source).toMatch(/height: 100dvh;/);
		expect(source).toMatch(/@media \(max-width: 960px\) \{\s+main \{\s+height: auto;\s+min-height: 100vh;\s+min-height: 100dvh;/s);
		expect(source).toMatch(/<div\s+class:panel-resizer--active=\{resizingPane\}\s+class="panel-resizer"/s);
		expect(source).toMatch(/role="slider"/);
		expect(source).toMatch(/breakpoints=\{effectiveBreakpoints\}/);
		expect(source).toMatch(/onCursorLineChange=\{\(line\) => \(cursorLine = line\)\}/);
		expect(source).toMatch(/onRunToCursor=\{runToCursor\}/);
		expect(layoutSource).toMatch(
			/:global\(html\),\s+:global\(body\) \{\s+margin: 0;\s+min-height: 100%;\s+\}/s
		);
		expect(layoutSource).toMatch(
			/:global\(body\) \{\s+min-height: 100vh;\s+min-height: 100dvh;\s+\}/s
		);
		expect(layoutSource).toMatch(/let \{ children \} = \$props\(\);/);
		expect(layoutSource).toMatch(/\{@render children\(\)\}/);
	});
});
