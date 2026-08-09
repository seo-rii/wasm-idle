import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { WASM_ZIG_ASSET_RECEIPTS, WASM_ZIG_ASSET_VERSION } from './playground/wasmZigVersion';

type Receipt = {
	bytes: number;
	sha256: string;
	uncompressedBytes?: number;
	uncompressedSha256?: string;
};

type ZigRuntimeBuild = {
	schemaVersion: number;
	profileId: string;
	fingerprint: string;
	upstream: {
		releaseBaseUrl: string;
		inputs: Record<string, Receipt>;
	};
	assets: Record<string, Receipt>;
};

type ZigInputLock = {
	schemaVersion: number;
	profileId: string;
	releaseBaseUrl: string;
	inputs: Record<string, Receipt>;
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function readLogicalAsset(asset: string) {
	const rawPath = `static/wasm-zig/${asset}`;
	try {
		return await readFile(rawPath);
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
		if (code !== 'ENOENT') throw error;
		return gunzipSync(await readFile(`${rawPath}.gz`));
	}
}

function fingerprintReceipts(profileId: string, receipts: Record<string, Receipt>) {
	const hash = createHash('sha256');
	hash.update('wasm-zig-execution-asset-receipts-v1\0');
	hash.update(profileId);
	hash.update('\0');
	for (const asset of ['zig_small.wasm', 'std.tar.gz']) {
		const receipt = receipts[asset];
		hash.update(asset);
		hash.update('\0');
		hash.update(String(receipt.bytes));
		hash.update('\0');
		hash.update(receipt.sha256);
		hash.update('\0');
		hash.update(String(receipt.uncompressedBytes || ''));
		hash.update('\0');
		hash.update(receipt.uncompressedSha256 || '');
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

describe('checked-in Zig execution asset receipts', () => {
	it('matches the lock, installed logical bytes, runtime receipt, and generated consumer pin', async () => {
		const [lock, runtimeBuild] = await Promise.all([
			readFile('scripts/wasm-zig-assets.lock.json', 'utf8').then(
				(value) => JSON.parse(value) as ZigInputLock
			),
			readFile('static/wasm-zig/runtime-build.json', 'utf8').then(
				(value) => JSON.parse(value) as ZigRuntimeBuild
			)
		]);

		expect(runtimeBuild.schemaVersion).toBe(1);
		expect(runtimeBuild.profileId).toBe(lock.profileId);
		expect(runtimeBuild.upstream.releaseBaseUrl).toBe(lock.releaseBaseUrl);
		expect(runtimeBuild.upstream.inputs).toEqual(lock.inputs);
		expect(Object.keys(runtimeBuild.assets).sort()).toEqual(['std.tar.gz', 'zig_small.wasm']);
		expect(runtimeBuild.assets).toEqual(WASM_ZIG_ASSET_RECEIPTS);

		const compiler = await readLogicalAsset('zig_small.wasm');
		const stdlibArchive = await readFile('static/wasm-zig/std.tar.gz');
		const stdlibTar = gunzipSync(stdlibArchive);
		expect({ bytes: compiler.byteLength, sha256: sha256(compiler) }).toEqual(
			runtimeBuild.assets['zig_small.wasm']
		);
		expect({
			bytes: stdlibArchive.byteLength,
			sha256: sha256(stdlibArchive),
			uncompressedBytes: stdlibTar.byteLength,
			uncompressedSha256: sha256(stdlibTar)
		}).toEqual(runtimeBuild.assets['std.tar.gz']);

		const fingerprint = fingerprintReceipts(runtimeBuild.profileId, runtimeBuild.assets);
		expect(runtimeBuild.fingerprint).toBe(fingerprint);
		expect(WASM_ZIG_ASSET_VERSION).toBe(fingerprint);
	});
});
