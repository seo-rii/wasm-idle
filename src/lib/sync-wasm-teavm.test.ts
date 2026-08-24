import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
	TEAVM_MANIFEST_FORMAT,
	assertTeaVmProducerArgs,
	computeTeaVmManifestFingerprint,
	syncWasmTeaVmAssets
} from '../../scripts/sync-wasm-teavm.mjs';

const tempDirs: string[] = [];
const assetNames = [
	'compiler.wasm-runtime.js',
	'compiler.wasm',
	'compile-classlib-teavm.bin',
	'runtime-classlib-teavm.bin'
] as const;

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-teavm-sync-'));
	tempDirs.push(directory);
	return directory;
}

async function writeFixtureFile(
	baseDirectory: string,
	relativePath: string,
	contents: Uint8Array | string
) {
	const filePath = path.join(baseDirectory, relativePath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, contents);
}

async function createFixture() {
	const root = await makeTempDir();
	const distDir = path.join(root, 'dist');
	const targetDir = path.join(root, 'static', 'teavm');
	const coreGeneratedModulePath = path.join(root, 'core', 'teavm-runtime.generated.ts');
	const wrapperGeneratedModulePath = path.join(root, 'wrapper', 'runtime.generated.ts');
	const lockFilePath = path.join(root, 'wasm-teavm-assets.lock.json');
	const legalSource = Buffer.from('# Fixture notices\n');
	const assets = new Map<string, Uint8Array>([
		['compiler.wasm-runtime.js', Buffer.from('export const load = () => true;\n')],
		['compiler.wasm', Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0)],
		['compile-classlib-teavm.bin', gzipSync(Buffer.from('compile classlib fixture'))],
		['runtime-classlib-teavm.bin', gzipSync(Buffer.from('runtime classlib fixture'))]
	]);

	for (const [asset, bytes] of assets) await writeFixtureFile(distDir, asset, bytes);
	await writeFixtureFile(root, 'scripts/teavm/THIRD_PARTY_NOTICES.md', legalSource);

	const outputs = assetNames.map((asset) => {
		const bytes = assets.get(asset)!;
		const storageEncoding =
			asset === 'compiler.wasm' || asset === 'runtime-classlib-teavm.bin'
				? 'gzip'
				: 'identity';
		const stored = storageEncoding === 'gzip' ? gzipSync(bytes, { level: 9 }) : bytes;
		return {
			path: asset,
			mediaType:
				asset === 'compiler.wasm-runtime.js'
					? 'text/javascript'
					: asset === 'compiler.wasm'
						? 'application/wasm'
						: 'application/octet-stream',
			bytes: bytes.byteLength,
			sha256: sha256(bytes),
			storage: {
				path: storageEncoding === 'gzip' ? `${asset}.gz` : asset,
				encoding: storageEncoding,
				bytes: stored.byteLength,
				sha256: sha256(stored)
			}
		};
	});
	const lock = {
		schemaVersion: 1,
		profileId: 'teavm-fixture-0.13.1',
		provenanceLevel: 'source-build-and-overlay-reproduced',
		licenseExpression: 'Apache-2.0 AND GPL-2.0-only WITH Classpath-exception-2.0',
		source: {
			repository: 'https://example.com/teavm-javac.git',
			revision: '1'.repeat(40),
			archive: {
				url: 'https://example.com/teavm-javac.tar.gz',
				bytes: 123,
				sha256: '2'.repeat(64)
			},
			buildInputs: [{ path: 'gradle.properties', bytes: 10, sha256: '3'.repeat(64) }]
		},
		components: {
			teavm: {
				version: '0.13.1',
				repository: 'https://example.com/teavm.git',
				revision: '4'.repeat(40),
				artifacts: []
			},
			openjdk: {
				repository: 'https://example.com/openjdk.git',
				revision: '5'.repeat(40),
				archive: {
					url: 'https://example.com/openjdk.zip',
					bytes: 456,
					sha256: '6'.repeat(64)
				}
			}
		},
		build: {
			host: { os: 'linux', arch: 'x64' },
			jdk: {
				distribution: 'Eclipse Temurin',
				version: '25.0.3+9',
				archive: {
					url: 'https://example.com/temurin.tar.gz',
					bytes: 789,
					sha256: '7'.repeat(64)
				},
				release: { IMPLEMENTOR_VERSION: 'Temurin-25.0.3+9', JAVA_VERSION: '25.0.3' }
			},
			gradle: {
				version: '9.1.0',
				distributionUrl: 'https://example.com/gradle.zip',
				distributionSha256: '8'.repeat(64)
			},
			node: { version: process.versions.node, zlib: process.versions.zlib },
			commands: ['clean :javac:downloadJDK', ':compiler:createDist'],
			overlay: {
				sourcePath: 'scripts/teavm/TByteBuffer.java',
				sourceBytes: 1,
				sourceSha256: '9'.repeat(64),
				utilityPath: 'scripts/teavm/ApplyRuntimeClasslibOverlay.java',
				utilityBytes: 1,
				utilitySha256: 'a'.repeat(64),
				release: 17,
				targetEntry: 'org/teavm/classlib/java/nio/TByteBuffer.class',
				classBytes: 1,
				classSha256: 'b'.repeat(64),
				canonicalRuntime: { bytes: 1, sha256: 'c'.repeat(64) },
				classpath: []
			}
		},
		producer: {
			files: [{ path: 'scripts/sync-wasm-teavm.mjs', bytes: 1, sha256: 'd'.repeat(64) }]
		},
		legalFiles: [
			{
				sourcePath: 'scripts/teavm/THIRD_PARTY_NOTICES.md',
				targetPath: 'THIRD_PARTY_NOTICES.md',
				mediaType: 'text/markdown',
				bytes: legalSource.byteLength,
				sha256: sha256(legalSource)
			}
		],
		outputs
	};
	await writeFile(lockFilePath, `${JSON.stringify(lock, null, '\t')}\n`);

	return {
		assets,
		coreGeneratedModulePath,
		distDir,
		lock,
		lockFilePath,
		repoRoot: root,
		targetDir,
		wrapperGeneratedModulePath
	};
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('syncWasmTeaVmAssets', () => {
	it('publishes one provenance-bound generation and both consumer receipt modules', async () => {
		const fixture = await createFixture();
		const result = await syncWasmTeaVmAssets(fixture);
		const files = (await readdir(fixture.targetDir)).sort();

		expect(files).toEqual([
			'THIRD_PARTY_NOTICES.md',
			'compile-classlib-teavm.bin',
			'compiler.wasm-runtime.js',
			'compiler.wasm.gz',
			'runtime-classlib-teavm.bin.gz',
			'runtime-manifest.v2.json'
		]);
		const manifest = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest.format).toBe(TEAVM_MANIFEST_FORMAT);
		expect(manifest.profileId).toBe(fixture.lock.profileId);
		expect(manifest.source).toEqual(fixture.lock.source);
		expect(manifest.build).toEqual(fixture.lock.build);
		expect(manifest.fingerprint).toBe(computeTeaVmManifestFingerprint(manifest));
		expect(result.fingerprint).toBe(manifest.fingerprint);

		for (const asset of manifest.assets) {
			const stored = await readFile(path.join(fixture.targetDir, asset.storage.path));
			const logical = asset.storage.encoding === 'gzip' ? gunzipSync(stored) : stored;
			expect({ bytes: logical.byteLength, sha256: sha256(logical) }).toEqual({
				bytes: asset.bytes,
				sha256: asset.sha256
			});
		}

		const coreModule = await readFile(fixture.coreGeneratedModulePath, 'utf8');
		const wrapperModule = await readFile(fixture.wrapperGeneratedModulePath, 'utf8');
		expect(coreModule).toContain(manifest.fingerprint);
		expect(coreModule).toContain(fixture.lock.outputs[0].sha256);
		expect(wrapperModule).toContain(manifest.fingerprint);
		expect(wrapperModule).toContain(fixture.lock.outputs[0].sha256);

		await expect(syncWasmTeaVmAssets(fixture)).resolves.toMatchObject({
			fingerprint: manifest.fingerprint
		});
	});

	it('rejects output drift before replacing an existing generation', async () => {
		const fixture = await createFixture();
		await writeFixtureFile(fixture.targetDir, 'sentinel.txt', 'keep me');
		await writeFile(path.join(fixture.distDir, assetNames[0]), 'drift');

		await expect(syncWasmTeaVmAssets(fixture)).rejects.toThrow(
			'TeaVM compiler.wasm-runtime.js does not match the output lock'
		);
		await expect(readFile(path.join(fixture.targetDir, 'sentinel.txt'), 'utf8')).resolves.toBe(
			'keep me'
		);
	});
});

describe('TeaVM producer CLI', () => {
	it('requires a source checkout and pinned JDK archive', () => {
		expect(() => assertTeaVmProducerArgs(['source', 'jdk.tar.gz'])).not.toThrow();
		expect(() => assertTeaVmProducerArgs(['source'])).toThrow(
			'requires sourceDir and jdkArchivePath'
		);
		expect(() => assertTeaVmProducerArgs(['--source', 'jdk.tar.gz'])).toThrow(
			'Unknown TeaVM producer option'
		);
	});
});
