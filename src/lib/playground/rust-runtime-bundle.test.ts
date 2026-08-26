import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import compilerSource from '../../../static/wasm-rust/compiler.js?raw';
import compilerWorkerSource from '../../../static/wasm-rust/compiler-worker.js?raw';
import debugInstrumenterSource from '../../../static/wasm-rust/debug-instrumenter.js?raw';
import runtimeAssetSource from '../../../static/wasm-rust/runtime-asset.js?raw';
import runtimeManifestSource from '../../../static/wasm-rust/runtime/runtime-manifest.v3.json?raw';
import { describe, expect, it } from 'vitest';
import { WASM_RUST_RUNTIME_PROFILE } from './wasmRustVersion';

describe('bundled wasm-rust compiler', () => {
	it('ships byte-aware runtime download progress handling', () => {
		expect(runtimeAssetSource).toContain('async function readResponseBytes(');
		expect(runtimeAssetSource).toContain('const reader = stream.getReader()');
		expect(compilerSource).toContain('payload.bytesCompleted !== undefined');
		expect(compilerSource).toContain('payload.bytesTotal !== undefined');
	});

	it('ships a host-pinned manifest and exact storage/logical asset receipts', () => {
		const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
		const manifestBytes = new TextEncoder().encode(runtimeManifestSource);
		const manifest = JSON.parse(runtimeManifestSource) as {
			assetReceipts: Record<
				string,
				{
					bytes: number;
					sha256: string;
					uncompressedBytes?: number;
					uncompressedSha256?: string;
				}
			>;
		};
		expect(manifestBytes.byteLength).toBe(WASM_RUST_RUNTIME_PROFILE.manifestReceipt.bytes);
		expect(sha256(manifestBytes)).toBe(WASM_RUST_RUNTIME_PROFILE.manifestReceipt.sha256);
		expect(Object.keys(manifest.assetReceipts).sort()).toEqual(
			Object.keys(WASM_RUST_RUNTIME_PROFILE.assetReceipts).sort()
		);
		expect(WASM_RUST_RUNTIME_PROFILE.assetReceipts).toEqual(manifest.assetReceipts);

		for (const [assetPath, receipt] of Object.entries(manifest.assetReceipts)) {
			const storageBytes = readFileSync(path.resolve('static', assetPath));
			expect(storageBytes.byteLength, assetPath).toBe(receipt.bytes);
			expect(sha256(storageBytes), assetPath).toBe(receipt.sha256);
			if (receipt.uncompressedBytes !== undefined) {
				const logicalBytes = gunzipSync(storageBytes);
				expect(logicalBytes.byteLength, assetPath).toBe(receipt.uncompressedBytes);
				expect(sha256(logicalBytes), assetPath).toBe(receipt.uncompressedSha256);
			}
		}
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
