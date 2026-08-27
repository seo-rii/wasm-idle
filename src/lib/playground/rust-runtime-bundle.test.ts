import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import compressedRuntimeAssetsSource from '../../../static/compressed-runtime-assets.v1.json?raw';
import compilerSource from '../../../static/wasm-rust/compiler.js.bin?raw';
import compilerWorkerSource from '../../../static/wasm-rust/compiler-worker.js.bin?raw';
import debugInstrumenterSource from '../../../static/wasm-rust/debug-instrumenter.js?raw';
import runtimeAssetSource from '../../../static/wasm-rust/runtime-asset.js.bin?raw';
import runtimeExecutableGraphSource from '../../../static/wasm-rust/runtime-executable-graph.v1.json?raw';
import runtimeManifestSource from '../../../static/wasm-rust/runtime/runtime-manifest.v3.json?raw';
import { describe, expect, it } from 'vitest';
import { parseRustExecutableGraphLock } from '../../../scripts/sync-wasm-rust.mjs';
import {
	canonicalRustExecutableGraphProfile,
	snapshotRustExecutableGraphProfile
} from './rustExecutableGraph';
import {
	WASM_RUST_EXECUTABLE_GRAPH_MANIFEST_PATH,
	WASM_RUST_EXECUTABLE_GRAPH_PROFILE,
	WASM_RUST_RUNTIME_PROFILE
} from './wasmRustVersion';

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

	it('ships one lock-pinned executable graph with exact storage and logical receipts', () => {
		const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
		const graph = snapshotRustExecutableGraphProfile(JSON.parse(runtimeExecutableGraphSource));
		const compressedRuntimeAssets = JSON.parse(compressedRuntimeAssetsSource) as {
			assets: string[];
		};
		const graphLock = parseRustExecutableGraphLock(
			readFileSync(path.resolve('scripts/wasm-rust-assets.lock.json'))
		);

		expect(WASM_RUST_EXECUTABLE_GRAPH_MANIFEST_PATH).toBe('runtime-executable-graph.v1.json');
		expect(graph).toEqual(WASM_RUST_EXECUTABLE_GRAPH_PROFILE);
		expect(graphLock.authorities['published-static']).toEqual(graph);
		expect(sha256(canonicalRustExecutableGraphProfile(graph))).toBe(graph.fingerprint);
		expect(Object.keys(graph.modules)).toHaveLength(41);

		for (const [modulePath, module] of Object.entries(graph.modules)) {
			expect(module.delivery.storagePath.endsWith('.bin'), modulePath).toBe(true);
			expect(compressedRuntimeAssets.assets, modulePath).not.toContain(
				`wasm-rust/${modulePath}`
			);
			expect(compressedRuntimeAssets.assets, module.delivery.storagePath).not.toContain(
				`wasm-rust/${module.delivery.storagePath}`
			);
			expect(existsSync(path.resolve('static', 'wasm-rust', modulePath)), modulePath).toBe(
				false
			);
			expect(
				existsSync(path.resolve('static', 'wasm-rust', `${modulePath}.gz`)),
				modulePath
			).toBe(false);
			const storageBytes = readFileSync(
				path.resolve('static', 'wasm-rust', module.delivery.storagePath)
			);
			expect(storageBytes.byteLength, modulePath).toBe(module.storage.bytes);
			expect(sha256(storageBytes), modulePath).toBe(module.storage.sha256);
			const logicalBytes =
				module.delivery.encoding === 'gzip' ? gunzipSync(storageBytes) : storageBytes;
			expect(logicalBytes.byteLength, modulePath).toBe(module.logical.bytes);
			expect(sha256(logicalBytes), modulePath).toBe(module.logical.sha256);
		}
	});

	it('publishes no executable JavaScript outside the explicit debug allowlist', () => {
		const rootDir = path.resolve('static', 'wasm-rust');
		const pending = [rootDir];
		const executablePaths: string[] = [];
		while (pending.length > 0) {
			const directory = pending.pop()!;
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const entryPath = path.join(directory, entry.name);
				if (entry.isDirectory()) {
					pending.push(entryPath);
				} else if (/\.(?:c|m)?js(?:\.(?:br|gz))?$/iu.test(entry.name)) {
					executablePaths.push(
						path.relative(rootDir, entryPath).replaceAll(path.sep, '/')
					);
				}
			}
		}
		expect(executablePaths.sort()).toEqual(['debug-instrumenter.js']);
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
