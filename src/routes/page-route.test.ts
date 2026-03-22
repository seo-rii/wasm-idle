import source from './+page.svelte?raw';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

describe('example route debug actions', () => {
	it('swaps the debug button for stop debug while a debug session is active', () => {
		expect(() =>
			compile(source, {
				filename: 'src/routes/+page.svelte',
				generate: 'client'
			})
		).not.toThrow();
		expect(source).toMatch(/async function stopDebug\(\) \{/);
		expect(source).toMatch(/await terminal\.stop\?\.\(\);/);
		expect(source).toMatch(
			/\{#if runningMode === 'debug'\}\s+<button class="action-button action-button--stop" onclick=\{stopDebug\}>/s
		);
		expect(source).toMatch(/<span>Stop Debug<\/span>/);
		expect(source).toMatch(/async function sendTerminalEof\(\) \{/);
		expect(source).toMatch(/await terminal\.eof\?\.\(\);/);
		expect(source).toMatch(/title="Send EOF"/);
	});

	it('passes a local wasm-rust bundle to the demo Terminal runtime assets', () => {
		expect(source).toMatch(
			/import \{ WASM_RUST_ASSET_VERSION \} from '\$lib\/playground\/wasmRustVersion';/
		);
		expect(source).toMatch(
			/let runtimeAssets = \$derived\.by<PlaygroundRuntimeAssets>\(\(\) => \(\{\s+rootUrl: path,\s+rust: \{\s+compilerUrl: path\s+\?\s+`\$\{path\}\/wasm-rust\/index\.js\?v=\$\{WASM_RUST_ASSET_VERSION\}`\s+:\s+`\/wasm-rust\/index\.js\?v=\$\{WASM_RUST_ASSET_VERSION\}`\s+\}\s+\}\)\);/s
		);
		expect(source).toMatch(/<Terminal\s+bind:terminal\s+\{path\}\s+\{runtimeAssets\}/s);
	});

	it('persists and forwards the Rust target triple selection', () => {
		expect(source).toMatch(/rustTargetTriple = \$state<RustTargetTriple>\('wasm32-wasip1'\),/);
		expect(source).toMatch(
			/const knownRustTargetTriples = \['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'\] as const;/
		);
		expect(source).toMatch(
			/let availableRustTargetTriples = \$state<RustTargetTriple\[]>\(\[\s+'wasm32-wasip1',\s+'wasm32-wasip2'\s+\]\);/s
		);
		expect(source).toMatch(/localStorage\.setItem\('rustTargetTriple', rustTargetTriple\);/);
		expect(source).toMatch(
			/const manifestUrl = path\s+\?\s+`\$\{path\}\/wasm-rust\/runtime\/runtime-manifest\.v3\.json\?v=\$\{WASM_RUST_ASSET_VERSION\}`\s+:\s+`\/wasm-rust\/runtime\/runtime-manifest\.v3\.json\?v=\$\{WASM_RUST_ASSET_VERSION\}`;/
		);
		expect(source).toMatch(/const response = await fetch\(manifestUrl, \{ cache: 'no-store' \}\);/);
		expect(source).toMatch(
			/const nextAvailableRustTargetTriples = knownRustTargetTriples\.filter\(\(targetTriple\) =>\s+Object\.prototype\.hasOwnProperty\.call\(manifest\.targets \|\| \{}, targetTriple\)\s+\);/s
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
			/\{#each availableRustTargetTriples as targetTriple\}\s+<option value=\{targetTriple\}>\{targetTriple\}<\/option>\s+\{\/each\}/s
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
});
