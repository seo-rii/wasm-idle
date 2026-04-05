import compilerSource from '../../../static/wasm-rust/compiler.js?raw';
import runtimeAssetSource from '../../../static/wasm-rust/runtime-asset.js?raw';
import { describe, expect, it } from 'vitest';

describe('bundled wasm-rust compiler', () => {
	it('ships byte-aware runtime download progress handling', () => {
		expect(runtimeAssetSource).toContain('async function readResponseBytes(response, onProgress)');
		expect(runtimeAssetSource).toContain('response.body.getReader()');
		expect(compilerSource).toContain('payload.bytesCompleted !== undefined');
		expect(compilerSource).toContain('payload.bytesTotal !== undefined');
	});
});
