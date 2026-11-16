// @vitest-environment node
import {
	copyFile,
	link,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { syncWasmMoonbitAssets } from '../../scripts/sync-wasm-moonbit.mjs';

describe('MoonBit asset preparation policy', () => {
	it('rejects default preparation and offline checks before reading or creating a target', async () => {
		const prepareAssets = () => {
			throw new Error('producer must not run');
		};
		for (const check of [false, true])
			await expect(
				syncWasmMoonbitAssets({
					check,
					targetDir: '/missing-policy-fixture',
					prepareAssets
				})
			).rejects.toThrow('service-license review');
	});
	it('retains the exact compiler license, service condition and limited output exception', async () => {
		const license = await readFile(
			'runtimes/wasm-moonbit/licenses/COMPILER-LICENSE.txt',
			'utf8'
		);
		expect(license).toContain(
			'14. Commercially or Competitively Offering the Program as a Service.'
		);
		expect(license).toContain('you may convey such embedded portions under the MIT License.');
		expect(await readFile('static/wasm-moonbit/COMPILER-LICENSE.txt', 'utf8')).toBe(license);
	});
});

async function distributionCopy(action: (root: string, profile: string) => Promise<void>) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-moonbit-integrity-'));
	const profile = path.join(root, 'profile.ts');
	try {
		const manifest = JSON.parse(await readFile('static/wasm-moonbit/upstream.json', 'utf8'));
		for (const name of [
			'upstream.json',
			'runner-worker.js',
			...Object.keys(manifest.assets),
			...Object.keys(manifest.notices)
		]) {
			const original = await realpath(path.resolve('static/wasm-moonbit', name));
			const target = path.join(root, name);
			await mkdir(path.dirname(target), { recursive: true });
			if (['moonc.js', 'upstream.json', 'runner-worker.js'].includes(name))
				await copyFile(original, target);
			else {
				try {
					await link(original, target);
				} catch {
					await copyFile(original, target);
				}
			}
		}
		await copyFile('src/lib/playground/wasmMoonbitVersion.ts', profile);
		await action(root, profile);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe.skipIf(process.env.WASM_IDLE_MOONBIT_LOCAL_RESEARCH !== '1')(
	'original MoonBit compiler/core distribution',
	() => {
		beforeAll(async () => {
			await syncWasmMoonbitAssets({ localResearchOnly: true });
		}, 300_000);
		it('verifies the original compiler, deterministic core and retained source/license records', async () => {
			const manifest = await syncWasmMoonbitAssets({ localResearchOnly: true, check: true });
			expect(manifest.version).toBe('0.10.19+97801ee1b');
			expect(manifest.packages).toHaveLength(96);
			expect(manifest.source.modified).toBe(false);
			expect(manifest.source.license).toContain('MoonBit-Public-Source');
			const license = await readFile(
				'runtimes/wasm-moonbit/licenses/COMPILER-LICENSE.txt',
				'utf8'
			);
			expect(license).toContain(
				'14. Commercially or Competitively Offering the Program as a Service.'
			);
			expect(license).toContain(
				'---- MoonBit Compiler Exceptions to the MoonBit Public Source License ----'
			);
			expect(license).toContain(
				'you may convey such embedded portions under the MIT License.'
			);
			expect(manifest.assets['stdlib.tar'].sha256).toBe(
				'c4f7c594c6e900395ec7afe0b1fcbb01452b65587a7303f63710e6db74598500'
			);
		});
		it('rejects altered original compiler bytes without changing the generated host profile', async () =>
			distributionCopy(async (root, profile) => {
				const original = await readFile(profile, 'utf8');
				await writeFile(path.join(root, 'moonc.js'), 'substitute compiler');
				await expect(
					syncWasmMoonbitAssets({
						localResearchOnly: true,
						check: true,
						targetDir: root,
						profilePath: profile
					})
				).rejects.toThrow('source receipt mismatch: moonc.js');
				expect(await readFile(profile, 'utf8')).toBe(original);
			}));
		it('prepares missing files, checks downloaded bytes and keeps --check offline', async () =>
			distributionCopy(async (root, profile) => {
				await rm(path.join(root, 'moonc.js'));
				let calls = 0;
				const prepareAssets = async (target: string) => {
					calls++;
					await copyFile('static/wasm-moonbit/moonc.js', path.join(target, 'moonc.js'));
				};
				await expect(
					syncWasmMoonbitAssets({
						localResearchOnly: true,
						check: true,
						targetDir: root,
						profilePath: profile,
						prepareAssets
					})
				).rejects.toThrow('Missing MoonBit assets');
				expect(calls).toBe(0);
				await syncWasmMoonbitAssets({
					localResearchOnly: true,
					targetDir: root,
					profilePath: profile,
					prepareAssets
				});
				expect(calls).toBe(1);
				await rm(path.join(root, 'moonc.js'));
				await expect(
					syncWasmMoonbitAssets({
						localResearchOnly: true,
						targetDir: root,
						profilePath: profile,
						prepareAssets: async () => {
							await writeFile(path.join(root, 'moonc.js'), 'changed');
						}
					})
				).rejects.toThrow('source receipt mismatch: moonc.js');
			}));
		it('rejects a substituted implementation and a stale generated runner', async () =>
			distributionCopy(async (root, profile) => {
				const file = path.join(root, 'upstream.json'),
					original = await readFile(file, 'utf8'),
					manifest = JSON.parse(original);
				manifest.revision = '0'.repeat(40);
				await writeFile(file, JSON.stringify(manifest));
				await expect(
					syncWasmMoonbitAssets({
						localResearchOnly: true,
						check: true,
						targetDir: root,
						profilePath: profile
					})
				).rejects.toThrow('pinned original compiler/core');
				await writeFile(file, original);
				await writeFile(path.join(root, 'runner-worker.js'), 'stale');
				await expect(
					syncWasmMoonbitAssets({
						localResearchOnly: true,
						check: true,
						targetDir: root,
						profilePath: profile
					})
				).rejects.toThrow('Stale generated MoonBit asset');
			}));
	}
);
