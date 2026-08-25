import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { WASM_TINYGO_RUNTIME_PROFILE } from './wasmTinyGoVersion';

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runtimeDir = path.join(checkoutRoot, 'static', 'wasm-tinygo');
const assetsDir = path.join(runtimeDir, 'assets');
const toolsDir = path.join(runtimeDir, 'tools');
const upstreamToolsDir = path.join(toolsDir, 'upstream');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('bundled wasm-tinygo runtime', () => {
	it('publishes only the receipt-verified upstream TinyGo compiler path', () => {
		expect(existsSync(path.join(runtimeDir, 'upstream.js'))).toBe(true);
		expect(existsSync(path.join(runtimeDir, 'runtime.js'))).toBe(false);
		expect(existsSync(path.join(toolsDir, 'tinygo-compiler.wasm'))).toBe(false);

		const assetEntries = readdirSync(assetsDir);
		expect(assetEntries.some((entry) => /^upstream-entry-.+\.js$/u.test(entry))).toBe(false);
		expect(assetEntries.some((entry) => /^upstream-compile-worker-.+\.js$/u.test(entry))).toBe(
			true
		);
		expect(assetEntries.some((entry) => /^runtime-.+\.js$/u.test(entry))).toBe(false);

		const upstreamEntry = readFileSync(path.join(runtimeDir, 'upstream.js'), 'utf8');
		expect(upstreamEntry).not.toMatch(/\.\/assets\/upstream-entry-.+\.js/u);
		expect(upstreamEntry).toMatch(/upstream-compile-worker-.+\.js/u);

		const manifest = JSON.parse(
			readFileSync(path.join(upstreamToolsDir, 'upstream-toolchain.v2.json'), 'utf8')
		) as {
			schemaVersion?: number;
			format?: string;
			assets?: { rootArchive?: { path?: string } };
		};
		expect(manifest).toMatchObject({
			schemaVersion: 2,
			format: 'wasm-idle-tinygo-upstream-assets-v2',
			assets: { rootArchive: { path: 'tinygoroot.tar.gz.bin' } }
		});
		expect(existsSync(path.join(upstreamToolsDir, 'tinygoroot.tar.gz.bin'))).toBe(true);
		expect(existsSync(path.join(upstreamToolsDir, 'tinygoroot.tar.gz'))).toBe(false);
	});

	it('recomputes every generated TinyGo logical and deployment-storage receipt', () => {
		const expectedPaths = [
			'tools/upstream/lld.wasm',
			'tools/upstream/package-graph-provider-receipt.json',
			'tools/upstream/producer-receipt.json',
			'tools/upstream/tinygo-compiler.wasm',
			'tools/upstream/tinygo-package-graph.wasm',
			'tools/upstream/tinygoroot.tar.gz.bin'
		];
		expect(Object.keys(WASM_TINYGO_RUNTIME_PROFILE.assetReceipts).sort()).toEqual(
			expectedPaths
		);
		for (const assetPath of expectedPaths) {
			const logicalBytes = readFileSync(path.join(runtimeDir, assetPath));
			const receipt = WASM_TINYGO_RUNTIME_PROFILE.assetReceipts[assetPath];
			expect(receipt).toBeDefined();
			if ('uncompressedBytes' in receipt) {
				expect(logicalBytes.byteLength).toBe(receipt.uncompressedBytes);
				expect(sha256(logicalBytes)).toBe(receipt.uncompressedSha256);
				const storageBytes = gzipSync(logicalBytes, { level: 9 });
				expect(storageBytes.byteLength).toBe(receipt.bytes);
				expect(sha256(storageBytes)).toBe(receipt.sha256);
			} else {
				expect(logicalBytes.byteLength).toBe(receipt.bytes);
				expect(sha256(logicalBytes)).toBe(receipt.sha256);
			}
		}
		const manifestBytes = readFileSync(
			path.join(runtimeDir, WASM_TINYGO_RUNTIME_PROFILE.manifestPath)
		);
		expect(manifestBytes.byteLength).toBe(WASM_TINYGO_RUNTIME_PROFILE.manifestReceipt.bytes);
		expect(sha256(manifestBytes)).toBe(WASM_TINYGO_RUNTIME_PROFILE.manifestReceipt.sha256);
	}, 30_000);
});
