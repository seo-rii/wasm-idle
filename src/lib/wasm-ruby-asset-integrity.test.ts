import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { RUBY_RUNTIME_ASSET_PATH, RUBY_RUNTIME_ASSET_RECEIPTS } from '@wasm-idle/core';
import {
	RUBY_RUNTIME_GENERATED_ASSET_VERSION,
	RUBY_RUNTIME_GENERATED_BUNDLE,
	RUBY_RUNTIME_GENERATED_PROFILE
} from '../../packages/core/src/ruby-runtime.generated';
import { describe, expect, it } from 'vitest';
import { computeRubyRuntimeFingerprint } from '../../scripts/sync-wasm-ruby.mjs';

type Receipt = { bytes: number; sha256: string };
type LogicalAsset = { path: string; mediaType: string; size: number; sha256: string };
type StorageAsset = {
	path: string;
	logicalPath: string;
	encoding: 'gzip' | 'identity';
	size: number;
	sha256: string;
};

const repoRoot = process.cwd();
const runtimeRoot = path.resolve(repoRoot, 'static/wasm-ruby');
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const lexicalCompare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

async function listFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(currentDir, { withFileTypes: true })) {
		const entryPath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(rootDir, entryPath)));
		else if (entry.isFile()) {
			files.push(path.relative(rootDir, entryPath).split(path.sep).join('/'));
		}
	}
	return files.sort(lexicalCompare);
}

async function receipt(filePath: string): Promise<Receipt> {
	const bytes = await readFile(filePath);
	return { bytes: bytes.byteLength, sha256: sha256(bytes) };
}

describe('checked-in Ruby runtime trust root', () => {
	it('binds the exact logical and storage graph to the generated Core profile', async () => {
		expect(await listFiles(runtimeRoot)).toEqual([
			'LICENSE',
			'NOTICE',
			'THIRD_PARTY_NOTICES.md',
			`${RUBY_RUNTIME_ASSET_PATH}.gz`,
			`${RUBY_RUNTIME_ASSET_PATH}.gz.bin`,
			'licenses/browser-wasi-shim/LICENSE-APACHE',
			'licenses/browser-wasi-shim/LICENSE-MIT',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json',
			'runtime.mjs',
			'runtime.mjs.bin'
		]);

		const manifest = JSON.parse(
			await readFile(path.join(runtimeRoot, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest.fingerprint).toBe(RUBY_RUNTIME_GENERATED_ASSET_VERSION);
		expect(RUBY_RUNTIME_GENERATED_PROFILE.manifestFingerprint).toBe(
			RUBY_RUNTIME_GENERATED_ASSET_VERSION
		);
		expect(RUBY_RUNTIME_GENERATED_BUNDLE).toEqual({
			profile: RUBY_RUNTIME_GENERATED_PROFILE
		});
		expect(computeRubyRuntimeFingerprint(manifest)).toBe(RUBY_RUNTIME_GENERATED_ASSET_VERSION);
		expect(() => computeRubyRuntimeFingerprint({ ...manifest, format: 'tampered' })).toThrow(
			'manifest format or runtime is invalid'
		);
		expect(() => computeRubyRuntimeFingerprint({ ...manifest, runtime: 'tampered' })).toThrow(
			'manifest format or runtime is invalid'
		);
		expect(() => computeRubyRuntimeFingerprint({ ...manifest, ignored: true })).toThrow(
			'manifest does not match the exact v2 schema'
		);
		expect(manifest.assets).toEqual([
			{
				path: RUBY_RUNTIME_ASSET_PATH,
				mediaType: 'application/wasm',
				size: RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].bytes,
				sha256: RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].sha256
			},
			{
				path: 'runtime.mjs',
				mediaType: 'text/javascript',
				size: RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs'].bytes,
				sha256: RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs'].sha256
			}
		]);
		expect(manifest.storage).toEqual([
			{
				path: `${RUBY_RUNTIME_ASSET_PATH}.gz.bin`,
				logicalPath: RUBY_RUNTIME_ASSET_PATH,
				encoding: 'gzip',
				size: RUBY_RUNTIME_GENERATED_PROFILE.wasmReceipt.bytes,
				sha256: RUBY_RUNTIME_GENERATED_PROFILE.wasmReceipt.sha256
			},
			{
				path: 'runtime.mjs.bin',
				logicalPath: 'runtime.mjs',
				encoding: 'identity',
				size: RUBY_RUNTIME_GENERATED_PROFILE.moduleJavaScriptReceipt.bytes,
				sha256: RUBY_RUNTIME_GENERATED_PROFILE.moduleJavaScriptReceipt.sha256
			}
		]);

		for (const stored of manifest.storage as StorageAsset[]) {
			const storedBytes = await readFile(path.join(runtimeRoot, stored.path));
			expect({ bytes: storedBytes.byteLength, sha256: sha256(storedBytes) }).toEqual({
				bytes: stored.size,
				sha256: stored.sha256
			});
			const logical = stored.encoding === 'gzip' ? gunzipSync(storedBytes) : storedBytes;
			const expected = (manifest.assets as LogicalAsset[]).find(
				(asset) => asset.path === stored.logicalPath
			);
			expect(expected).toBeDefined();
			expect({ bytes: logical.byteLength, sha256: sha256(logical) }).toEqual({
				bytes: expected?.size,
				sha256: expected?.sha256
			});
		}
		expect(await receipt(path.join(runtimeRoot, 'runtime-manifest.v2.json'))).toEqual(
			RUBY_RUNTIME_GENERATED_PROFILE.manifestReceipt
		);
		expect(RUBY_RUNTIME_GENERATED_PROFILE.wasmReceipt).toEqual({
			bytes: manifest.storage[0].size,
			sha256: manifest.storage[0].sha256,
			uncompressedBytes: RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].bytes,
			uncompressedSha256: RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].sha256
		});
		const canonicalModule = await readFile(path.join(runtimeRoot, 'runtime.mjs.bin'));
		const legacyModule = await readFile(path.join(runtimeRoot, 'runtime.mjs'));
		const canonicalWasm = await readFile(
			path.join(runtimeRoot, `${RUBY_RUNTIME_ASSET_PATH}.gz.bin`)
		);
		const legacyWasm = await readFile(path.join(runtimeRoot, `${RUBY_RUNTIME_ASSET_PATH}.gz`));
		expect(legacyModule.equals(canonicalModule)).toBe(true);
		expect(legacyWasm.equals(canonicalWasm)).toBe(true);
	});

	it('keeps the input lock, build receipt, legacy manifest, and legal receipts aligned', async () => {
		const [lock, build, legacy, manifest] = await Promise.all(
			[
				'scripts/wasm-ruby-assets.lock.json',
				'static/wasm-ruby/runtime-build.json',
				'static/wasm-ruby/runtime-manifest.v1.json',
				'static/wasm-ruby/runtime-manifest.v2.json'
			].map(async (relativePath) =>
				JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'))
			)
		);
		const lockedOutputs = Object.fromEntries(
			lock.outputs.map((asset: { path: string; bytes: number; sha256: string }) => [
				asset.path,
				{ bytes: asset.bytes, sha256: asset.sha256 }
			])
		);
		expect(lockedOutputs).toEqual(RUBY_RUNTIME_ASSET_RECEIPTS);
		expect(legacy).toEqual({
			formatVersion: 1,
			runtimeModule: 'runtime.mjs',
			packages: Object.fromEntries(
				manifest.packages.map((candidate: { name: string; version: string }) => [
					candidate.name,
					candidate.version
				])
			),
			files: manifest.assets.map((asset: LogicalAsset) => ({
				path: asset.path,
				bytes: asset.size,
				sha256: asset.sha256
			}))
		});
		expect(build.artifact).toEqual(lock.artifact);
		expect(build.components).toEqual(lock.components);
		expect(build.packages).toEqual(manifest.packages);
		expect(build.provenanceLevel).toBe('npm-attested-source-and-receipted-derived-output');
		expect(build.artifact.verifiedBuildInput).toBe(false);
		expect(build.artifact.evidence).toContain('does not prove a byte-reproducible');
		expect(await receipt(path.join(runtimeRoot, 'runtime-build.json'))).toEqual({
			bytes: manifest.metadata.size,
			sha256: manifest.metadata.sha256
		});

		for (const legal of lock.legalFiles as Array<{
			targetPath: string;
			bytes: number;
			sha256: string;
		}>) {
			expect(await receipt(path.join(runtimeRoot, legal.targetPath))).toEqual({
				bytes: legal.bytes,
				sha256: legal.sha256
			});
			expect(manifest.legalFiles).toContainEqual({
				targetPath: legal.targetPath,
				mediaType: expect.any(String),
				spdx: expect.any(String),
				size: legal.bytes,
				sha256: legal.sha256
			});
		}
	});

	it('keeps the bundled module on the single verified Wasm URL seam', async () => {
		const moduleBytes = await readFile(path.join(runtimeRoot, 'runtime.mjs'));
		expect(await receipt(path.join(runtimeRoot, 'runtime.mjs'))).toEqual(
			RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs']
		);
		const source = new TextDecoder('utf-8', { fatal: true }).decode(moduleBytes);
		const expression = `new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)},import.meta.url)`;
		expect(source.split(expression)).toHaveLength(2);
	});

	it('keeps the global compressed-asset contract on the same logical Ruby Wasm', async () => {
		const compressed = JSON.parse(
			await readFile(path.join(repoRoot, 'static/compressed-runtime-assets.v1.json'), 'utf8')
		);
		const logicalPath = `wasm-ruby/${RUBY_RUNTIME_ASSET_PATH}`;
		expect(compressed.assets).toContain(logicalPath);
		expect(compressed.sizes[logicalPath]).toBe(
			RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].bytes
		);
	});
});
