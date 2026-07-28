import compilerSource from '../../../static/wasm-rust/compiler.js?raw';
import compilerWorkerSource from '../../../static/wasm-rust/compiler-worker.js?raw';
import debugInstrumenterSource from '../../../static/wasm-rust/debug-instrumenter.js?raw';
import runtimeAssetSource from '../../../static/wasm-rust/runtime-asset.js?raw';
import runtimeManifestSource from '../../../static/wasm-rust/runtime/runtime-manifest.v3.json?raw';
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

	it('ships the LLDB DWARF artifact and compiler contract', () => {
		expect(compilerSource).toContain('dwarfDebugDescriptorBase');
		expect(compilerSource).toContain('artifact.debug =');
		expect(compilerSource).toContain('moduleSha256');
		expect(compilerSource).toContain("sourceRoot: '/workspace'");
		expect(compilerSource).toContain("path: '/workspace/main.rs'");
		expect(compilerWorkerSource).toContain("'-Cdebuginfo=2'");
		expect(compilerWorkerSource).toContain("'-Copt-level=0'");
		expect(compilerWorkerSource).toContain("'--remap-path-prefix=/work=/workspace'");

		const runtimeManifest = JSON.parse(runtimeManifestSource) as {
			compilerProvenance?: {
				name?: string;
				llvmVersion?: string;
				llvmRevision?: string;
			};
		};
		expect(runtimeManifest.compilerProvenance).toMatchObject({
			name: 'rustc',
			llvmVersion: '22.1.8',
			llvmRevision: expect.any(String)
		});
	});

	it('ships the Rust debug instrumenter as a self-contained static module', () => {
		expect(debugInstrumenterSource).not.toContain('@lezer/rust');
		expect(debugInstrumenterSource).not.toContain('sourceMappingURL');
		expect(debugInstrumenterSource).toContain('RUST_DEBUG_MARKER');
		expect(debugInstrumenterSource).toContain('instrumentRustDebugSource');
	});
});
