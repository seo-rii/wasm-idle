// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
	publishLfortranBundle,
	syncWasmLfortranAssets
} from '../../scripts/sync-wasm-lfortran.mjs';

it('refuses tampered producer receipts without replacing the existing target or profile', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'lfortran-sync-'));
	try {
		const target = path.join(directory, 'target');
		const version = path.join(directory, 'profile.ts');
		await writeFile(target, 'existing runtime');
		await writeFile(version, 'existing profile');
		const lock = JSON.parse(
			await readFile(
				new URL('../../scripts/wasm-lfortran-assets.lock.json', import.meta.url),
				'utf8'
			)
		);
		await writeFile(
			path.join(directory, 'producer-receipt.json'),
			Buffer.alloc(lock.assets['producer-receipt.json'].bytes)
		);
		await expect(
			syncWasmLfortranAssets({
				sourceDir: directory,
				targetDir: target,
				versionModulePath: version
			})
		).rejects.toThrow('SHA-256 mismatch');
		expect(await readFile(target, 'utf8')).toBe('existing runtime');
		expect(await readFile(version, 'utf8')).toBe('existing profile');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it('rolls back the asset directory when publishing the staged profile fails', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'lfortran-publish-'));
	try {
		const targetDir = path.join(directory, 'runtime');
		const versionModulePath = path.join(directory, 'profile.ts');
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'old-worker.js'), 'old worker');
		// A directory permits staging alongside it, but rejects the final file rename.
		await mkdir(versionModulePath);
		await writeFile(path.join(versionModulePath, 'sentinel'), 'old profile');
		await expect(
			publishLfortranBundle({
				targetDir,
				versionModulePath,
				verified: new Map([['lfortran.js', new TextEncoder().encode('verified compiler')]]),
				worker: new TextEncoder().encode('new worker'),
				version: 'new profile'
			})
		).rejects.toThrow();
		expect(await readdir(targetDir)).toEqual(['old-worker.js']);
		expect(await readFile(path.join(targetDir, 'old-worker.js'), 'utf8')).toBe('old worker');
		expect(await readFile(path.join(versionModulePath, 'sentinel'), 'utf8')).toBe(
			'old profile'
		);
		expect((await readdir(directory)).sort()).toEqual(['profile.ts', 'runtime']);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
