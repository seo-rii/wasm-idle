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

	it('exposes a browser debug hook that writes terminal stdin through the bound control', () => {
		expect(source).toMatch(/type WasmIdleDebugApi = \{\s+writeTerminalInput: \(text: string, eof\?: boolean\) => Promise<void>;\s+\};/s);
		expect(source).toMatch(/target\.__wasmIdleDebug = debugApi;/);
		expect(source).toMatch(/await terminal\.waitForInput\?\.\(\);/);
		expect(source).toMatch(/await terminal\.write\(text\);/);
		expect(source).toMatch(/if \(eof\) await terminal\.eof\?\.\(\);/);
	});

	it('shows a Rust stdin hint that explains EOF for read-to-end programs', () => {
		expect(source).toMatch(/press Enter to send a line\./);
		expect(source).toMatch(
			/Use Ctrl\+D or the EOF\s+button while running if the program reads stdin until EOF\./s
		);
	});
});
