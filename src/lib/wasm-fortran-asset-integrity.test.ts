// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { FORTRAN_EXECUTION_ASSET_NAMES } from './playground/fortranAssets';
import {
	WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS,
	WASM_FORTRAN_EXECUTION_ASSET_VERSION
} from './playground/wasmFortranExecutionAssets';
import { WASM_FORTRAN_ASSET_VERSION } from './playground/wasmFortranVersion';

const staticRoot = path.resolve('static');
const runtimeRoot = path.join(staticRoot, 'wasm-fortran');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function readLogicalAsset(asset: string) {
	try {
		return new Uint8Array(await readFile(path.join(runtimeRoot, asset)));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		return new Uint8Array(gunzipSync(await readFile(path.join(runtimeRoot, `${asset}.gz`))));
	}
}

function fingerprintReceipts(
	profileId: string,
	receipts: Record<string, { bytes: number; sha256: string }>
) {
	const hash = createHash('sha256');
	hash.update('wasm-fortran-f2c-logical-asset-receipts-v1\0');
	hash.update(profileId);
	hash.update('\0');
	for (const asset of FORTRAN_EXECUTION_ASSET_NAMES) {
		const receipt = receipts[asset];
		hash.update(asset);
		hash.update('\0');
		hash.update(String(receipt.bytes));
		hash.update('\0');
		hash.update(receipt.sha256);
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

describe('checked-in Fortran execution asset integrity', () => {
	it('matches every logical asset to runtime-build.json and generated consumer constants', async () => {
		const runtimeBuild = JSON.parse(
			await readFile(path.join(runtimeRoot, 'runtime-build.json'), 'utf8')
		) as {
			schemaVersion: number;
			profileId: string;
			fingerprint: string;
			assets: Record<string, { bytes: number; sha256: string }>;
		};
		expect(runtimeBuild.schemaVersion).toBe(1);
		expect(runtimeBuild.profileId).toBe('netlib-f2c-2022-09-09-cowasm-f2c-1.0.0');
		expect(Object.keys(runtimeBuild.assets).sort()).toEqual(
			[...FORTRAN_EXECUTION_ASSET_NAMES].sort()
		);

		for (const asset of FORTRAN_EXECUTION_ASSET_NAMES) {
			const bytes = await readLogicalAsset(asset);
			const expected = {
				bytes: bytes.byteLength,
				sha256: sha256(bytes)
			};
			expect(runtimeBuild.assets[asset]).toEqual(expected);
			expect(WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS[asset]).toEqual(expected);
		}

		expect(runtimeBuild.fingerprint).toBe(
			fingerprintReceipts(runtimeBuild.profileId, runtimeBuild.assets)
		);
		expect(WASM_FORTRAN_EXECUTION_ASSET_VERSION).toBe(runtimeBuild.fingerprint);
		expect(WASM_FORTRAN_ASSET_VERSION).not.toBe(WASM_FORTRAN_EXECUTION_ASSET_VERSION);
	});

	it('keeps receipt-capped Fortran assets out of unbounded layered materialization', async () => {
		const layeredManifest = await readFile(
			path.join(staticRoot, 'layered-runtime-assets.v1.json'),
			'utf8'
		)
			.then((source) => JSON.parse(source) as { assets?: Record<string, unknown> })
			.catch((error: NodeJS.ErrnoException) => {
				if (error.code === 'ENOENT') return null;
				throw error;
			});
		if (!layeredManifest) return;
		for (const asset of FORTRAN_EXECUTION_ASSET_NAMES) {
			expect(layeredManifest.assets?.[`wasm-fortran/${asset}`]).toBeUndefined();
		}
	});
});
