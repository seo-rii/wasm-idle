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
import {
	TEAVM_MANIFEST_FORMAT,
	computeTeaVmManifestFingerprint
} from '../../scripts/sync-wasm-teavm.mjs';
import { describe, expect, it } from 'vitest';

interface TeaVmRuntimeManifestFile {
	path: string;
	mediaType: string;
	bytes: number;
	sha256: string;
	storage: {
		path: string;
		encoding: 'identity' | 'gzip';
		bytes: number;
		sha256: string;
	};
}

interface TeaVmRuntimeManifest {
	format: string;
	runtime: string;
	profileId: string;
	provenanceLevel: string;
	licenseExpression: string;
	fingerprint: string;
	source: {
		repository: string;
		revision: string;
	};
	components: {
		teavm: { version: string; revision: string };
		openjdk: { revision: string };
	};
	build: {
		jdk: { version: string };
		sourcePatches: Array<{ path: string }>;
		gradle: { version: string; verificationMetadata: { sha256: string } };
		overlay: {
			mode: string;
			sources: Array<{ path: string; bytes: number; sha256: string }>;
			correspondence: {
				sources: Array<{
					sourceEntry: string;
					upstreamSha256: string;
					patchedSha256: string;
				}>;
			};
		};
	};
	producer: { files: Array<{ path: string; bytes: number; sha256: string }> };
	legalFiles: Array<{ path: string; bytes: number; sha256: string }>;
	assets: TeaVmRuntimeManifestFile[];
}

const runtimeRoot = resolve(process.cwd(), 'static/teavm');
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const lexicalCompare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

describe('checked-in TeaVM runtime trust root', () => {
	it('binds every logical and stored asset to the shared profile', async () => {
		const files = (await readdir(runtimeRoot, { withFileTypes: true }))
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name)
			.sort(lexicalCompare);
		expect(files).toEqual([
			'THIRD_PARTY_NOTICES.md',
			'compile-classlib-teavm.bin',
			'compiler.wasm-deobfuscator.wasm',
			'compiler.wasm-runtime.js',
			'compiler.wasm.gz',
			'runtime-classlib-teavm.bin.gz',
			'runtime-manifest.v2.json'
		]);

		const manifest = JSON.parse(
			await readFile(resolve(runtimeRoot, 'runtime-manifest.v2.json'), 'utf8')
		) as TeaVmRuntimeManifest;
		expect(Object.keys(manifest).sort(lexicalCompare)).toEqual([
			'assets',
			'build',
			'components',
			'fingerprint',
			'format',
			'legalFiles',
			'licenseExpression',
			'producer',
			'profileId',
			'provenanceLevel',
			'runtime',
			'source'
		]);
		expect(manifest).toMatchObject({
			format: TEAVM_MANIFEST_FORMAT,
			runtime: 'teavm-javac',
			profileId: 'teavm-javac-0.16.0-208d4c9-integrated-overlay-v1',
			provenanceLevel: 'source-build-and-integrated-overlay-reproduced',
			source: {
				repository: 'https://github.com/konsoletyper/teavm-javac.git',
				revision: '208d4c97a602ba0df055f16e6882059fb69d0122'
			},
			components: {
				teavm: {
					version: '0.16.0',
					revision: 'e87d452e4bd70c77b9e19314a46c3d6971c148b6'
				},
				openjdk: { revision: '6c48f4ed707bf0b15f9b6098de30db8aae6fa40f' }
			},
			build: {
				jdk: { version: '25.0.5+8' },
				gradle: { version: '9.1.0' },
				sourcePatches: [
					{ path: 'scripts/teavm/patches/teavm-javac-0.16.0-compat.patch' },
					{ path: 'scripts/teavm/patches/teavm-javac-0.16.0-debug-scopes.patch' }
				],
				overlay: { mode: 'gradle-source-set' }
			},
			producer: {
				files: [
					{ path: 'scripts/sync-wasm-teavm.mjs' },
					{ path: 'scripts/sync-wasm-teavm.d.mts' }
				]
			}
		});
		const overlay = manifest.build.overlay;
		expect(overlay.sources).toHaveLength(10);
		for (const correspondence of overlay.correspondence.sources) {
			const source = overlay.sources.find(({ path }) =>
				path.endsWith(correspondence.sourceEntry)
			);
			expect(source?.sha256).toBe(correspondence.patchedSha256);
			expect(correspondence.upstreamSha256).toMatch(/^[a-f0-9]{64}$/);
		}
		expect(
			overlay.sources.some(({ path }) => path.endsWith('/TIllegalFormatWidthException.java'))
		).toBe(true);
		expect(manifest.assets.map((file) => file.path)).toEqual(TEAVM_RUNTIME_ASSET_NAMES);

		const logicalReceipts = Object.create(null) as Record<
			string,
			{ bytes: number; sha256: string }
		>;
		for (const file of manifest.assets) {
			expect(Object.keys(file).sort(lexicalCompare)).toEqual([
				'bytes',
				'mediaType',
				'path',
				'sha256',
				'storage'
			]);
			expect(Object.keys(file.storage).sort(lexicalCompare)).toEqual([
				'bytes',
				'encoding',
				'path',
				'sha256'
			]);
			const stored = await readFile(resolve(runtimeRoot, file.storage.path));
			expect({ bytes: stored.byteLength, sha256: sha256(stored) }).toEqual({
				bytes: file.storage.bytes,
				sha256: file.storage.sha256
			});
			const logical = file.storage.encoding === 'gzip' ? gunzipSync(stored) : stored;
			const receipt = { bytes: logical.byteLength, sha256: sha256(logical) };
			expect(receipt).toEqual({ bytes: file.bytes, sha256: file.sha256 });
			logicalReceipts[file.path] = receipt;
		}
		for (const legalFile of manifest.legalFiles) {
			const legalBytes = await readFile(resolve(runtimeRoot, legalFile.path));
			expect({ bytes: legalBytes.byteLength, sha256: sha256(legalBytes) }).toEqual({
				bytes: legalFile.bytes,
				sha256: legalFile.sha256
			});
		}

		expect(logicalReceipts).toEqual(TEAVM_RUNTIME_ASSET_RECEIPTS);
		expect(TEAVM_ASSET_RECEIPTS).toEqual(TEAVM_RUNTIME_ASSET_RECEIPTS);
		expect(
			computeTeaVmManifestFingerprint(manifest as unknown as Record<string, unknown>)
		).toBe(TEAVM_RUNTIME_ASSET_VERSION);
		expect(manifest.fingerprint).toBe(TEAVM_RUNTIME_ASSET_VERSION);
		expect(TEAVM_ASSET_VERSION).toBe(TEAVM_RUNTIME_ASSET_VERSION);
	});

	it('keeps every checked-in producer input byte-exact to the input lock', async () => {
		const lock = JSON.parse(
			await readFile(resolve(process.cwd(), 'scripts/wasm-teavm-assets.lock.json'), 'utf8')
		) as {
			build: {
				gradle: { verificationMetadata: { path: string; bytes: number; sha256: string } };
				sourcePatches: Array<{ path: string; bytes: number; sha256: string }>;
				overlay: { sources: Array<{ path: string; bytes: number; sha256: string }> };
				compilerOverrides: {
					sources: Array<{ path: string; bytes: number; sha256: string }>;
				};
			};
			producer: { files: Array<{ path: string; bytes: number; sha256: string }> };
			legalFiles: Array<{
				sourcePath: string;
				bytes: number;
				sha256: string;
			}>;
		};
		const receipts = [
			...lock.producer.files,
			lock.build.gradle.verificationMetadata,
			...lock.build.sourcePatches,
			...lock.legalFiles.map(({ sourcePath: path, bytes, sha256 }) => ({
				path,
				bytes,
				sha256
			}))
		];

		// Every overlay and emitter override is a complete file inside the pinned patches.
		const patch = (
			await Promise.all(
				lock.build.sourcePatches.map(({ path }) =>
					readFile(resolve(process.cwd(), path), 'utf8')
				)
			)
		).join('\n');
		for (const source of [
			...lock.build.overlay.sources,
			...lock.build.compilerOverrides.sources
		]) {
			const section = patch
				.split(`diff --git a/${source.path} b/${source.path}\n`)[1]
				?.split('\ndiff --git ')[0];
			expect(section, source.path).toBeDefined();
			const bytes =
				section!
					.split('\n')
					.filter((line) => line.startsWith('+') && !line.startsWith('+++'))
					.map((line) => line.slice(1))
					.join('\n') + '\n';
			expect({ bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) }, source.path).toEqual(
				{ bytes: source.bytes, sha256: source.sha256 }
			);
		}

		for (const receipt of receipts) {
			const bytes = await readFile(resolve(process.cwd(), receipt.path));
			expect({ bytes: bytes.byteLength, sha256: sha256(bytes) }, receipt.path).toEqual({
				bytes: receipt.bytes,
				sha256: receipt.sha256
			});
		}
	});
});
