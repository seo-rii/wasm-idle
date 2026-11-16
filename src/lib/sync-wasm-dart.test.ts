// @vitest-environment node
import { copyFile, link, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { syncWasmDartAssets } from '../../scripts/sync-wasm-dart.mjs';

async function distributionCopy(action: (root: string, profile: string) => Promise<void>) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-dart-integrity-'));
	const profile = path.join(root, 'profile.ts');
	try {
		for (const name of await readdir('static/wasm-dart')) {
			const original = path.resolve('static/wasm-dart', name);
			const target = path.join(root, name);
			if (['worker.js', 'upstream.json', 'runner-worker.js'].includes(name))
				await copyFile(original, target);
			else {
				try {
					await link(original, target);
				} catch {
					await copyFile(original, target);
				}
			}
		}
		await copyFile('src/lib/playground/wasmDartVersion.ts', profile);
		await action(root, profile);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe('official Dart toolchain distribution', () => {
	beforeAll(async () => {
		await syncWasmDartAssets();
	}, 180_000);
	it('verifies the original release members and deterministic host/profile', async () => {
		const manifest = await syncWasmDartAssets({ check: true });
		expect(manifest.version).toBe('3.14.0');
		expect(manifest.archive.bytes).toBe(40359128);
		expect(Object.keys(manifest.assets)).toHaveLength(7);
	});
	it('rejects altered compiler bytes without changing the generated profile', async () =>
		distributionCopy(async (root, profile) => {
			const original = await readFile(profile, 'utf8');
			await writeFile(path.join(root, 'worker.js'), '/* substitute compiler */');
			await expect(
				syncWasmDartAssets({ check: true, targetDir: root, profilePath: profile })
			).rejects.toThrow('source receipt: worker.js');
			expect(await readFile(profile, 'utf8')).toBe(original);
		}));
	it('prepares missing upstream payloads and rechecks every downloaded receipt', async () =>
		distributionCopy(async (root, profile) => {
			await rm(path.join(root, 'worker.js'));
			let calls = 0;
			const prepareAssets = async (target: string) => {
				calls++;
				await copyFile('static/wasm-dart/worker.js', path.join(target, 'worker.js'));
			};
			await expect(
				syncWasmDartAssets({
					check: true,
					targetDir: root,
					profilePath: profile,
					prepareAssets
				})
			).rejects.toThrow('Missing Dart assets: worker.js');
			expect(calls).toBe(0);
			await syncWasmDartAssets({ targetDir: root, profilePath: profile, prepareAssets });
			expect(calls).toBe(1);
			await syncWasmDartAssets({ check: true, targetDir: root, profilePath: profile });
			await rm(path.join(root, 'worker.js'));
			await expect(
				syncWasmDartAssets({
					targetDir: root,
					profilePath: profile,
					prepareAssets: async () => {
						await writeFile(path.join(root, 'worker.js'), 'substitute');
					}
				})
			).rejects.toThrow('source receipt: worker.js');
		}));
	it('rejects unpinned SDK identity and a stale generated worker', async () =>
		distributionCopy(async (root, profile) => {
			const manifestPath = path.join(root, 'upstream.json');
			const original = await readFile(manifestPath, 'utf8');
			const manifest = JSON.parse(original);
			manifest.revision = '0'.repeat(40);
			await writeFile(manifestPath, JSON.stringify(manifest));
			await expect(
				syncWasmDartAssets({ check: true, targetDir: root, profilePath: profile })
			).rejects.toThrow('pinned official implementation');
			await writeFile(manifestPath, original);
			await writeFile(path.join(root, 'runner-worker.js'), '/* stale host */');
			await expect(
				syncWasmDartAssets({ check: true, targetDir: root, profilePath: profile })
			).rejects.toThrow('generated asset is stale');
		}));
});
