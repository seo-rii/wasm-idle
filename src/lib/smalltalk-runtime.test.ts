// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { syncWasmSmalltalkAssets } from '../../scripts/sync-wasm-smalltalk.mjs';
import { compressStaticRuntimeAssets } from '../../scripts/compress-static-runtime-assets.mjs';

describe('pinned original Amber compiler distribution', () => {
	it('reproduces all executable bytes from the offline original source archives', async () => {
		await syncWasmSmalltalkAssets({ check: true });
	});
	it('preserves verified executable URLs through the actual production compressor', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-smalltalk-production-'));
		const targetDir = path.join(dir, 'wasm-smalltalk');
		const versionModulePath = path.join(dir, 'version.ts');
		try {
			await syncWasmSmalltalkAssets({ targetDir, versionModulePath });
			await compressStaticRuntimeAssets({ rootDir: dir });
			await syncWasmSmalltalkAssets({ check: true, targetDir, versionModulePath });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	it('detects modified original module bytes rather than accepting a new hash', async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-smalltalk-pin-'));
		try {
			await syncWasmSmalltalkAssets({
				targetDir: dir,
				versionModulePath: path.join(dir, 'version.ts')
			});
			const modules = await readFile(path.join(dir, 'amber-modules.json.gz.bin'));
			modules[modules.length - 1] ^= 1;
			await writeFile(path.join(dir, 'amber-modules.json.gz.bin'), modules);
			await expect(
				syncWasmSmalltalkAssets({
					check: true,
					targetDir: dir,
					versionModulePath: path.join(dir, 'version.ts')
				})
			).rejects.toThrow('Stale Smalltalk asset');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
