// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { releaseBaseUrl, syncWasmLean4Assets } from '../../scripts/sync-wasm-lean4.mjs';
import { WASM_LEAN4_PROFILE } from './playground/wasmLean4Version';

const lockUrl = new URL('../../scripts/wasm-lean4-assets.lock.json', import.meta.url);

it('pins every Lean 4 asset to an immutable wasm-llvm commit URL', async () => {
	const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
	expect(releaseBaseUrl(lock)).toBe(
		`https://raw.githubusercontent.com/seo-rii/wasm-llvm/${lock.producer.revision}/artifacts/lean-browser/`
	);
	expect(lock.producer.revision).toMatch(/^[0-9a-f]{40}$/);
	expect(lock.version).toBe('4.34.1');
	for (const [name, asset] of Object.entries(lock.assets) as [string, any][]) {
		expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
		// Compressed storage uses the canonical inert .gz.bin suffix and records decoded receipts.
		if (asset.encoding === 'gzip') {
			expect(name).toBe(`${asset.upstream}.bin`);
			expect(asset.uncompressed.sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(asset.logicalName).toBe(asset.upstream.replace(/\.gz$/, ''));
		} else expect(name).toBe(asset.upstream);
		expect(asset.bytes).toBeLessThan(24_000_000);
	}
	expect(Object.keys(lock.assets).filter((name) => name.startsWith('lean-init-'))).toHaveLength(
		6
	);
	const { notices: _notices, ...runtimeLock } = lock;
	const { workerReceipt: _workerReceipt, ...profile } = WASM_LEAN4_PROFILE;
	expect(profile).toEqual(runtimeLock);
});

it('rejects a release with altered bytes before touching the target or profile', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'lean4-sync-'));
	try {
		const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
		const target = path.join(directory, 'target');
		const version = path.join(directory, 'profile.ts');
		await writeFile(target, 'existing runtime');
		await writeFile(version, 'existing profile');
		await writeFile(
			path.join(directory, 'producer-receipt.json'),
			Buffer.alloc(lock.assets['producer-receipt.json'].bytes)
		);
		await expect(
			syncWasmLean4Assets({
				sourceDir: directory,
				targetDir: target,
				versionModulePath: version
			})
		).rejects.toThrow('does not match the reviewed lock');
		expect(await readFile(target, 'utf8')).toBe('existing runtime');
		expect(await readFile(version, 'utf8')).toBe('existing profile');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it('rejects downloads whose size differs from the lock', async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'lean4-download-'));
	try {
		const requested: string[] = [];
		const fetchImpl = (async (url: string) => {
			requested.push(String(url));
			return new Response(new Uint8Array(3));
		}) as unknown as typeof fetch;
		await expect(
			syncWasmLean4Assets({
				targetDir: path.join(directory, 'target'),
				versionModulePath: path.join(directory, 'profile.ts'),
				fetchImpl
			})
		).rejects.toThrow(/returned 3 bytes/);
		expect(requested[0]).toMatch(
			/^https:\/\/raw\.githubusercontent\.com\/seo-rii\/wasm-llvm\/[0-9a-f]{40}\/artifacts\/lean-browser\//
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
