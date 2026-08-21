// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
	computePerlRuntimeFingerprint,
	syncWasmPerlAssets
} from '../../scripts/sync-wasm-perl.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const staticRuntimeDir = path.join(repositoryRoot, 'static', 'wasm-perl');
const workerSourcePath = path.join(
	repositoryRoot,
	'scripts',
	'runtime-workers',
	'wasm-perl-runner-worker.js'
);
const lockFilePath = path.join(repositoryRoot, 'scripts', 'wasm-perl-assets.lock.json');
const temporaryRoots: string[] = [];
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

type MutablePerlInputLock = {
	[key: string]: unknown;
	archiveEntries: Array<Record<string, unknown>>;
	components: Record<string, Record<string, unknown>>;
	licenses: Array<Record<string, unknown>>;
};

async function writeMutatedLock(root: string, mutate: (lock: MutablePerlInputLock) => void) {
	const lock = JSON.parse(await readFile(lockFilePath, 'utf8')) as MutablePerlInputLock;
	mutate(lock);
	const filePath = path.join(root, 'wasm-perl-assets.mutated.lock.json');
	await writeFile(filePath, `${JSON.stringify(lock, null, '\t')}\n`);
	return filePath;
}

async function createFixture() {
	const root = await mkdtemp(path.join(tmpdir(), 'wasm-perl-sync-'));
	temporaryRoots.push(root);
	const sourceDir = path.join(root, 'source');
	await mkdir(sourceDir, { recursive: true });
	for (const asset of ['emperl.js', 'emperl.wasm', 'emperl.data']) {
		await writeFile(
			path.join(sourceDir, asset),
			gunzipSync(await readFile(path.join(staticRuntimeDir, `${asset}.gz`)))
		);
	}
	for (const license of ['LICENSE_artistic.txt', 'LICENSE_gpl.txt']) {
		await writeFile(
			path.join(sourceDir, license),
			await readFile(path.join(staticRuntimeDir, 'licenses', license))
		);
	}
	return {
		root,
		sourceDir,
		targetDir: path.join(root, 'published'),
		versionModulePath: path.join(root, 'wasmPerlVersion.ts'),
		lspVersionModulePath: path.join(root, 'bundledPerlRuntime.ts')
	};
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
		const child = path.posix.join(relative.split(path.sep).join('/'), entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(root, child)));
		else if (entry.isFile()) files.push(child);
	}
	return files.sort();
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('syncWasmPerlAssets', () => {
	it('publishes a deterministic exact receipt graph and generated host pins', async () => {
		const fixture = await createFixture();
		const result = await syncWasmPerlAssets({
			sourceDir: fixture.sourceDir,
			targetDir: fixture.targetDir,
			versionModulePath: fixture.versionModulePath,
			lspVersionModulePath: fixture.lspVersionModulePath,
			workerSourcePath,
			lockFilePath
		});

		expect(await listFiles(fixture.targetDir)).toEqual([
			'emperl.data.gz',
			'emperl.data.gz.bin',
			'emperl.js.gz',
			'emperl.js.gz.bin',
			'emperl.wasm.gz',
			'emperl.wasm.gz.bin',
			'licenses/LICENSE_artistic.txt',
			'licenses/LICENSE_gpl.txt',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		const manifest = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest).toMatchObject({
			format: 'wasm-perl-runtime-manifest-v2',
			runtime: 'webperl',
			fingerprint: result.fingerprint,
			artifact: { kind: 'opaque-prebuilt', doi: '10.5281/zenodo.2582586' }
		});
		expect(computePerlRuntimeFingerprint(manifest)).toBe(result.fingerprint);
		expect(manifest.storage.map((entry: { path: string }) => entry.path).sort()).toEqual([
			'emperl.data.gz.bin',
			'emperl.js.gz.bin',
			'emperl.wasm.gz.bin'
		]);
		for (const storage of manifest.storage) {
			const stored = await readFile(path.join(fixture.targetDir, storage.path));
			expect(stored.byteLength).toBe(storage.size);
			expect(sha256(stored)).toBe(storage.sha256);
			const logical = gunzipSync(stored);
			const receipt = manifest.assets.find(
				(candidate: { path: string }) => candidate.path === storage.logicalPath
			);
			expect(logical.byteLength).toBe(receipt.size);
			expect(sha256(logical)).toBe(receipt.sha256);
			const legacyPath = storage.path.replace(/\.bin$/u, '');
			expect(await readFile(path.join(fixture.targetDir, legacyPath))).toEqual(stored);
		}
		const worker = await readFile(path.join(fixture.targetDir, 'runner-worker.js'));
		expect(result.workerReceipt).toEqual({
			bytes: worker.byteLength,
			sha256: sha256(worker)
		});
		const workerSource = worker.toString('utf8');
		expect(workerSource).toContain(`manifestFingerprint: '${result.fingerprint}'`);
		expect(workerSource).not.toContain('__WASM_IDLE_PERL_MANIFEST_FINGERPRINT__');
		const manifestBytes = await readFile(
			path.join(fixture.targetDir, 'runtime-manifest.v2.json')
		);
		expect(result.runtimeProfile.manifestReceipt).toEqual({
			bytes: manifestBytes.byteLength,
			sha256: sha256(manifestBytes)
		});
		for (const [logicalPath, receiptName] of [
			['emperl.js', 'javascriptReceipt'],
			['emperl.wasm', 'wasmReceipt'],
			['emperl.data', 'dataReceipt']
		] as const) {
			const logicalReceipt = manifest.assets.find(
				(candidate: { path: string }) => candidate.path === logicalPath
			);
			const storageReceipt = manifest.storage.find(
				(candidate: { logicalPath: string }) => candidate.logicalPath === logicalPath
			);
			expect(result.runtimeProfile[receiptName]).toEqual({
				bytes: storageReceipt.size,
				sha256: storageReceipt.sha256,
				uncompressedBytes: logicalReceipt.size,
				uncompressedSha256: logicalReceipt.sha256
			});
		}
		const appModuleSource = await readFile(fixture.versionModulePath, 'utf8');
		expect(appModuleSource).toContain('export const WASM_PERL_RUNTIME_PROFILE =');
		expect(appModuleSource).toContain('export const WASM_PERL_RUNTIME_BUNDLE =');
		expect(appModuleSource).toContain(
			'export const WASM_PERL_ASSET_VERSION = WASM_PERL_RUNTIME_PROFILE.manifestFingerprint;'
		);
		const lspModuleSource = await readFile(fixture.lspVersionModulePath, 'utf8');
		expect(lspModuleSource).toContain('export const BUNDLED_PERL_RUNTIME_PROFILE =');
		expect(lspModuleSource).toContain('export const BUNDLED_PERL_RUNTIME_BUNDLE =');
		expect(lspModuleSource).toContain('BUNDLED_PERL_RUNTIME_PROFILE.manifestFingerprint');
		for (const source of [appModuleSource, lspModuleSource]) {
			expect(source).toContain(result.fingerprint);
			expect(source).toContain(result.workerReceipt.sha256);
			expect(source).toContain(result.runtimeProfile.artifactRevision);
			expect(source).toContain(result.runtimeProfile.webperlRevision);
			expect(source).toContain(result.runtimeProfile.perlRevision);
			expect(source).toContain(result.runtimeProfile.emscriptenRevision);
		}

		const second = await createFixture();
		await syncWasmPerlAssets({
			sourceDir: second.sourceDir,
			targetDir: second.targetDir,
			versionModulePath: second.versionModulePath,
			lspVersionModulePath: second.lspVersionModulePath,
			workerSourcePath,
			lockFilePath
		});
		for (const file of await listFiles(fixture.targetDir)) {
			expect(await readFile(path.join(second.targetDir, file))).toEqual(
				await readFile(path.join(fixture.targetDir, file))
			);
		}
	}, 120_000);

	it('rejects a source receipt mismatch before replacing published outputs', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'previous.txt'), 'previous runtime');
		await writeFile(fixture.versionModulePath, 'previous app pin');
		await writeFile(fixture.lspVersionModulePath, 'previous lsp pin');
		await writeFile(path.join(fixture.sourceDir, 'emperl.wasm'), 'corrupt');

		await expect(
			syncWasmPerlAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				workerSourcePath,
				lockFilePath
			})
		).rejects.toThrow('does not match the input lock');
		expect(await readFile(path.join(fixture.targetDir, 'previous.txt'), 'utf8')).toBe(
			'previous runtime'
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('previous app pin');
		expect(await readFile(fixture.lspVersionModulePath, 'utf8')).toBe('previous lsp pin');
	});

	it.each<[string, (lock: MutablePerlInputLock) => void, string]>([
		['top-level schema extension', (lock) => (lock.unexpected = true), 'provenance metadata'],
		[
			'component provenance drift',
			(lock) => (lock.components.perl.revision = '0'.repeat(40)),
			'provenance metadata'
		],
		[
			'license mapping drift',
			(lock) =>
				(lock.licenses[0].archiveEntry = `${'webperl_prebuilt_v0.09-beta'}/emperl.js`),
			'license metadata'
		],
		[
			'license source URL drift',
			(lock) =>
				(lock.licenses[0].sourceUrl =
					'https://raw.githubusercontent.com/haukex/webperl/main/LICENSE_artistic.txt'),
			'license metadata'
		]
	])('rejects %s in the input lock', async (_label, mutate, error) => {
		const fixture = await createFixture();
		const mutatedLockPath = await writeMutatedLock(fixture.root, mutate);

		await expect(
			syncWasmPerlAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				workerSourcePath,
				lockFilePath: mutatedLockPath
			})
		).rejects.toThrow(error);
	});

	it('rejects an archive entry that escapes the source directory', async () => {
		const fixture = await createFixture();
		const licenseBytes = await readFile(path.join(fixture.sourceDir, 'LICENSE_artistic.txt'));
		await writeFile(path.join(fixture.root, 'outside'), licenseBytes);
		const escapedEntry = 'webperl_prebuilt_v0.09-beta/../outside';
		const mutatedLockPath = await writeMutatedLock(fixture.root, (lock) => {
			const license = lock.licenses[0];
			const archiveEntry = lock.archiveEntries.find(
				(candidate) => candidate.path === license.archiveEntry
			);
			if (!archiveEntry) throw new Error('fixture license archive entry is missing');
			license.archiveEntry = escapedEntry;
			archiveEntry.path = escapedEntry;
		});

		await expect(
			syncWasmPerlAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				workerSourcePath,
				lockFilePath: mutatedLockPath
			})
		).rejects.toThrow('invalid or duplicate archive entry');
	});

	it('publishes from an immutable source snapshot when inputs change during rename', async () => {
		const fixture = await createFixture();
		const original = await readFile(path.join(fixture.sourceDir, 'emperl.js'));
		let mutated = false;
		await syncWasmPerlAssets({
			sourceDir: fixture.sourceDir,
			targetDir: fixture.targetDir,
			versionModulePath: fixture.versionModulePath,
			lspVersionModulePath: fixture.lspVersionModulePath,
			workerSourcePath,
			lockFilePath,
			renamePath: async (source, target) => {
				if (!mutated) {
					mutated = true;
					await writeFile(path.join(fixture.sourceDir, 'emperl.js'), 'replacement race');
				}
				await rename(source, target);
			}
		});

		expect(
			gunzipSync(await readFile(path.join(fixture.targetDir, 'emperl.js.gz.bin')))
		).toEqual(original);
	});

	it('restores all previous outputs when the final publication fails', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'previous.txt'), 'previous runtime');
		await writeFile(fixture.versionModulePath, 'previous app pin');
		await writeFile(fixture.lspVersionModulePath, 'previous lsp pin');

		await expect(
			syncWasmPerlAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				workerSourcePath,
				lockFilePath,
				renamePath: async (source, target) => {
					if (target === fixture.lspVersionModulePath && source.includes('.staging-')) {
						throw new Error('fixture final publication failure');
					}
					await rename(source, target);
				}
			})
		).rejects.toThrow('fixture final publication failure');
		expect(await listFiles(fixture.targetDir)).toEqual(['previous.txt']);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('previous app pin');
		expect(await readFile(fixture.lspVersionModulePath, 'utf8')).toBe('previous lsp pin');
	});

	it('rejects source and publication paths that overlap through resolved boundaries', async () => {
		const fixture = await createFixture();
		await expect(
			syncWasmPerlAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.sourceDir,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				workerSourcePath,
				lockFilePath
			})
		).rejects.toThrow('publication targets must not overlap their inputs');
	});
});
