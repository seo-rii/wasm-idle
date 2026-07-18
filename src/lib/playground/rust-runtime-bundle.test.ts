import compilerSource from '../../../static/wasm-rust/compiler.js?raw';
import debugInstrumenterSource from '../../../static/wasm-rust/debug-instrumenter.js?raw';
import runtimeAssetSource from '../../../static/wasm-rust/runtime-asset.js?raw';
import { describe, expect, it } from 'vitest';

describe('bundled wasm-rust compiler', () => {
	it('ships byte-aware runtime download progress handling', () => {
		expect(runtimeAssetSource).toContain(
			'async function readResponseBytes(response, onProgress)'
		);
		expect(runtimeAssetSource).toContain('response.body.getReader()');
		expect(compilerSource).toContain('payload.bytesCompleted !== undefined');
		expect(compilerSource).toContain('payload.bytesTotal !== undefined');
	});

	it('ships the Rust debug instrumenter as a self-contained static module', () => {
		expect(debugInstrumenterSource).not.toContain('@lezer/rust');
		expect(debugInstrumenterSource).not.toContain('sourceMappingURL');
		expect(debugInstrumenterSource).toContain('RUST_DEBUG_MARKER');
		expect(debugInstrumenterSource).toContain('instrumentRustDebugSource');
	});
});
