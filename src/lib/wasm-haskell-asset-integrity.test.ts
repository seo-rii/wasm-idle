import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
	HASKELL_RUNTIME_ASSET_NAMES,
	HASKELL_RUNTIME_ASSET_RECEIPTS,
	HASKELL_RUNTIME_ASSET_VERSION
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';
import { validateHaskellRuntimePublication } from '../../scripts/sync-wasm-haskell.mjs';

const repoRoot = process.cwd();
const runtimeRoot = path.resolve(repoRoot, 'static/wasm-haskell');
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function listFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(currentDir, { withFileTypes: true })) {
		const entryPath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(rootDir, entryPath)));
		else if (entry.isFile())
			files.push(path.relative(rootDir, entryPath).split(path.sep).join('/'));
	}
	return files.sort();
}

describe('checked-in Haskell runtime trust root', () => {
	it('binds one exact three-asset graph to the generated Core profile', async () => {
		expect(await listFiles(runtimeRoot)).toEqual([
			'THIRD_PARTY_NOTICES.md',
			'bsdtar.wasm.gz',
			'dyld.mjs',
			'licenses/browser-wasi-shim/LICENSE-APACHE',
			'licenses/browser-wasi-shim/LICENSE-MIT',
			'licenses/bsdtar-wasm/LICENSE',
			'rootfs.tar.zst',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);

		const validated = (await validateHaskellRuntimePublication(runtimeRoot)) as {
			fingerprint: string;
			assets: Array<{ path: string; size: number; sha256: string }>;
		};
		expect(validated.fingerprint).toBe(HASKELL_RUNTIME_ASSET_VERSION);
		expect(
			Object.fromEntries(
				validated.assets.map((asset) => [
					asset.path,
					{ bytes: asset.size, sha256: asset.sha256 }
				])
			)
		).toEqual(HASKELL_RUNTIME_ASSET_RECEIPTS);
		expect(validated.assets.map((asset) => asset.path)).toEqual(HASKELL_RUNTIME_ASSET_NAMES);
	});

	it('keeps the producer lock, build receipt, and compressed contract aligned', async () => {
		const lockPath = path.join(repoRoot, 'scripts/wasm-haskell-assets.lock.json');
		const [lockBytes, buildText, manifestText, compressedText, producerBytes] =
			await Promise.all([
				readFile(lockPath),
				readFile(path.join(runtimeRoot, 'runtime-build.json'), 'utf8'),
				readFile(path.join(runtimeRoot, 'runtime-manifest.v2.json'), 'utf8'),
				readFile(path.join(repoRoot, 'static/compressed-runtime-assets.v1.json'), 'utf8'),
				readFile(path.join(repoRoot, 'scripts/sync-wasm-haskell.mjs'))
			]);
		const lock = JSON.parse(lockBytes.toString('utf8'));
		const build = JSON.parse(buildText);
		const manifest = JSON.parse(manifestText);
		const compressed = JSON.parse(compressedText);

		expect(build.inputLock).toEqual({
			path: 'scripts/wasm-haskell-assets.lock.json',
			bytes: lockBytes.byteLength,
			sha256: sha256(lockBytes)
		});
		expect(lock.producer.script).toEqual({
			path: 'scripts/sync-wasm-haskell.mjs',
			bytes: producerBytes.byteLength,
			sha256: sha256(producerBytes)
		});
		expect(lock.outputs).toEqual(
			manifest.assets.map(
				(asset: { path: string; mediaType: string; size: number; sha256: string }) => ({
					path: asset.path,
					mediaType: asset.mediaType,
					bytes: asset.size,
					sha256: asset.sha256
				})
			)
		);
		expect(compressed.assets).toContain('wasm-haskell/bsdtar.wasm');
		expect(compressed.sizes['wasm-haskell/bsdtar.wasm']).toBe(
			HASKELL_RUNTIME_ASSET_RECEIPTS['bsdtar.wasm'].bytes
		);
	});

	it('ships a self-contained module and records unresolved upstream provenance honestly', async () => {
		const [source, notices, manifestText] = await Promise.all([
			readFile(path.join(runtimeRoot, 'dyld.mjs'), 'utf8'),
			readFile(path.join(runtimeRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
			readFile(path.join(runtimeRoot, 'runtime-manifest.v2.json'), 'utf8')
		]);
		expect(source).not.toContain('./browser_wasi_shim/');
		expect(source).not.toContain('./prelude.mjs');
		expect(source).not.toContain('./post-link.mjs');
		expect(source).not.toContain('https://esm.sh/gh/haskell-wasm/browser_wasi_shim');
		expect(source).toMatch(/export \{[^}]*DyLDBrowserHost[^}]*main[^}]*\}/su);
		expect(notices).toMatch(
			/does not\s+publish a binary-to-source reproducibility attestation/u
		);
		expect(JSON.parse(manifestText).licenseExpression).toContain('NOASSERTION');
	});
});
