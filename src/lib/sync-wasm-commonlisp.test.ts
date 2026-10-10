// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import {
	commonLispReleaseBaseUrl,
	publishCommonLispBundle,
	readCommonLispLock,
	syncWasmCommonLispAssets
} from '../../scripts/sync-wasm-commonlisp.mjs';

it('downloads only from the pinned wasm-llvm revision', async () => {
	const lock = await readCommonLispLock();
	expect(commonLispReleaseBaseUrl(lock)).toBe(
		`https://raw.githubusercontent.com/seo-rii/wasm-llvm/${lock.producerRevision}/artifacts/ecl-browser/`
	);
	expect(() => commonLispReleaseBaseUrl({ producerRevision: 'main' })).toThrow();
});

it('refuses tampered downloads without replacing the existing target or profile', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'commonlisp-sync-'));
	try {
		const target = path.join(directory, 'target');
		const version = path.join(directory, 'profile.ts');
		await writeFile(target, 'existing runtime');
		await writeFile(version, 'existing profile');
		const lock = await readCommonLispLock();
		const fetchImpl = vi.fn(async (url: string) => {
			const name = String(url).split('/').pop() as string;
			return new Response(new Uint8Array(lock.assets[name].bytes), { status: 200 });
		});
		await expect(
			syncWasmCommonLispAssets({
				targetDir: target,
				versionModulePath: version,
				fetchImpl: fetchImpl as unknown as typeof fetch
			})
		).rejects.toThrow('SHA-256 mismatch');
		expect(fetchImpl.mock.calls[0][0]).toContain(lock.producerRevision);
		expect(await readFile(target, 'utf8')).toBe('existing runtime');
		expect(await readFile(version, 'utf8')).toBe('existing profile');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it('rolls back the asset directory when publishing the staged profile fails', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'commonlisp-publish-'));
	try {
		const targetDir = path.join(directory, 'runtime');
		const versionModulePath = path.join(directory, 'profile.ts');
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'old-worker.js'), 'old worker');
		await mkdir(versionModulePath);
		await writeFile(path.join(versionModulePath, 'sentinel'), 'old profile');
		await expect(
			publishCommonLispBundle({
				targetDir,
				versionModulePath,
				verified: new Map([['ecl.mjs', new TextEncoder().encode('verified runtime')]]),
				worker: new TextEncoder().encode('new worker'),
				version: 'new profile'
			})
		).rejects.toThrow();
		expect(await readdir(targetDir)).toEqual(['old-worker.js']);
		expect((await readdir(directory)).sort()).toEqual(['profile.ts', 'runtime']);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
