import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WASM_FORTH_ASSET_VERSION, WASM_FORTH_RUNNER_RECEIPT } from './playground/wasmForthVersion';

type Receipt = { bytes: number; sha256: string };
type ManifestReceipt = { path: string; size: number; sha256: string };

type ForthInputLock = {
	schemaVersion: number;
	profileId: string;
	upstream: {
		packageName: string;
		packageVersion: string;
		assetPath: string;
	} & Receipt;
};

type ForthManifest = {
	format: string;
	runtime: string;
	profileId: string;
	waforthVersion: string;
	fingerprint: string;
	assets: ManifestReceipt[];
};

const require = createRequire(import.meta.url);
const fingerprintDomain = 'wasm-idle:forth-runtime-manifest:v2';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function fingerprintManifest(manifest: ForthManifest) {
	const hash = createHash('sha256');
	hash.update(`${fingerprintDomain}\n`);
	hash.update(`format\0${manifest.format}\n`);
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(`waforthVersion\0${manifest.waforthVersion}\n`);
	for (const receipt of manifest.assets) {
		hash.update(receipt.path);
		hash.update('\0');
		hash.update(String(receipt.size));
		hash.update('\0');
		hash.update(receipt.sha256);
		hash.update('\n');
	}
	return hash.digest('hex');
}

describe('checked-in Forth execution asset receipts', () => {
	it('matches the upstream lock, runtime manifest, worker source, and generated pins', async () => {
		const runtimeRoot = 'static/wasm-forth';
		const [lock, manifest] = await Promise.all([
			readFile('scripts/wasm-forth-assets.lock.json', 'utf8').then(
				(value) => JSON.parse(value) as ForthInputLock
			),
			readFile(path.join(runtimeRoot, 'runtime-manifest.v2.json'), 'utf8').then(
				(value) => JSON.parse(value) as ForthManifest
			)
		]);
		expect(lock.schemaVersion).toBe(1);
		expect(lock.upstream).toMatchObject({
			packageName: 'waforth',
			packageVersion: manifest.waforthVersion,
			assetPath: 'dist/index.js'
		});
		expect(manifest).toMatchObject({
			format: 'wasm-forth-runtime-manifest-v2',
			runtime: 'waforth',
			profileId: lock.profileId,
			fingerprint: WASM_FORTH_ASSET_VERSION
		});
		expect(manifest.assets).toHaveLength(1);

		const packageJsonPath = require.resolve('waforth/package.json');
		const upstreamBytes = await readFile(
			path.join(path.dirname(packageJsonPath), lock.upstream.assetPath)
		);
		expect({ bytes: upstreamBytes.byteLength, sha256: sha256(upstreamBytes) }).toEqual({
			bytes: lock.upstream.bytes,
			sha256: lock.upstream.sha256
		});

		const waforthBytes = await readFile(path.join(runtimeRoot, 'waforth.js'));
		expect(manifest.assets[0]).toEqual({
			path: 'waforth.js',
			size: waforthBytes.byteLength,
			sha256: sha256(waforthBytes)
		});
		expect(fingerprintManifest(manifest)).toBe(WASM_FORTH_ASSET_VERSION);

		const [workerSource, installedWorker] = await Promise.all([
			readFile('scripts/runtime-workers/wasm-forth-runner-worker.js'),
			readFile(path.join(runtimeRoot, 'runner-worker.js'))
		]);
		expect(installedWorker).toEqual(workerSource);
		expect({ bytes: installedWorker.byteLength, sha256: sha256(installedWorker) }).toEqual(
			WASM_FORTH_RUNNER_RECEIPT
		);
		expect((await readdir(runtimeRoot)).sort()).toEqual([
			'runner-worker.js',
			'runtime-manifest.v2.json',
			'waforth.js'
		]);
	});
});
