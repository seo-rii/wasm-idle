import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
	TEAVM_RUNTIME_ASSET_NAMES,
	TEAVM_RUNTIME_ASSET_RECEIPTS,
	TEAVM_RUNTIME_ASSET_VERSION
} from '@wasm-idle/core';
import { TEAVM_ASSET_RECEIPTS, TEAVM_ASSET_VERSION } from '../../runtimes/teavm/src/index';
import { describe, expect, it } from 'vitest';

interface TeaVmRuntimeManifestFile {
	path: string;
	bytes: number;
	sha256: string;
	storagePath: string;
	storageEncoding: 'identity' | 'gzip';
	storageBytes: number;
	storageSha256: string;
}

interface TeaVmRuntimeManifest {
	formatVersion: number;
	profileId: string;
	fingerprint: string;
	provenance: {
		kind: string;
		importedByCommit: string;
	};
	files: TeaVmRuntimeManifestFile[];
}

const runtimeRoot = resolve(process.cwd(), 'static/teavm');
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const lexicalCompare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const fingerprintReceipts = (files: TeaVmRuntimeManifestFile[]) => {
	const hash = createHash('sha256');
	hash.update('wasm-idle:teavm-runtime:v1\n');
	for (const file of [...files].sort((left, right) => lexicalCompare(left.path, right.path))) {
		hash.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
	}
	return hash.digest('hex');
};

describe('checked-in TeaVM runtime trust root', () => {
	it('binds every logical and stored asset to the shared profile', async () => {
		const files = (await readdir(runtimeRoot, { withFileTypes: true }))
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name)
			.sort(lexicalCompare);
		expect(files).toEqual([
			'compile-classlib-teavm.bin',
			'compiler.wasm-runtime.js',
			'compiler.wasm.gz',
			'runtime-classlib-teavm.bin.gz',
			'runtime-manifest.v1.json'
		]);

		const manifest = JSON.parse(
			await readFile(resolve(runtimeRoot, 'runtime-manifest.v1.json'), 'utf8')
		) as TeaVmRuntimeManifest;
		expect(Object.keys(manifest).sort(lexicalCompare)).toEqual([
			'files',
			'fingerprint',
			'formatVersion',
			'profileId',
			'provenance'
		]);
		expect(manifest).toMatchObject({
			formatVersion: 1,
			profileId: 'teavm-browser-legacy',
			provenance: {
				kind: 'legacy-checkin',
				importedByCommit: 'c1c3ef79190ccc4b577604a9aaf020edb94320b0'
			}
		});
		expect(manifest.files.map((file) => file.path)).toEqual(
			[...TEAVM_RUNTIME_ASSET_NAMES].sort(lexicalCompare)
		);

		const logicalReceipts = Object.create(null) as Record<
			string,
			{ bytes: number; sha256: string }
		>;
		for (const file of manifest.files) {
			expect(Object.keys(file).sort(lexicalCompare)).toEqual([
				'bytes',
				'path',
				'sha256',
				'storageBytes',
				'storageEncoding',
				'storagePath',
				'storageSha256'
			]);
			const stored = await readFile(resolve(runtimeRoot, file.storagePath));
			expect({ bytes: stored.byteLength, sha256: sha256(stored) }).toEqual({
				bytes: file.storageBytes,
				sha256: file.storageSha256
			});
			const logical = file.storageEncoding === 'gzip' ? gunzipSync(stored) : stored;
			const receipt = { bytes: logical.byteLength, sha256: sha256(logical) };
			expect(receipt).toEqual({ bytes: file.bytes, sha256: file.sha256 });
			logicalReceipts[file.path] = receipt;
		}

		expect(logicalReceipts).toEqual(TEAVM_RUNTIME_ASSET_RECEIPTS);
		expect(TEAVM_ASSET_RECEIPTS).toEqual(TEAVM_RUNTIME_ASSET_RECEIPTS);
		expect(fingerprintReceipts(manifest.files)).toBe(TEAVM_RUNTIME_ASSET_VERSION);
		expect(manifest.fingerprint).toBe(TEAVM_RUNTIME_ASSET_VERSION);
		expect(TEAVM_ASSET_VERSION).toBe(TEAVM_RUNTIME_ASSET_VERSION);
	});
});
