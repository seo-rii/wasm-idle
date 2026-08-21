// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
	computeJuliaRuntimeFingerprint,
	syncWasmJuliaAssets
} from '../../scripts/sync-wasm-julia.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const workerSourcePath = path.join(
	repositoryRoot,
	'scripts',
	'runtime-workers',
	'wasm-julia-runner-worker.js'
);
const productionLockPath = path.join(repositoryRoot, 'scripts', 'wasm-julia-assets.lock.json');
const temporaryRoots: string[] = [];
const originalSourceDir = process.env.WASM_JULIA_SOURCE_DIR;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

type MutableJuliaInputLock = {
	[key: string]: unknown;
	assets: Array<{ bytes: number; mediaType: string; path: string; sha256: string }>;
	components: Record<string, Record<string, unknown>>;
	documentation: { bytes: number; mediaType: string; path: string; sha256: string };
	license: { bytes: number; path: string; sha256: string; spdx: string };
	packageJson: { bytes: number; path: string; sha256: string };
};

const fixtureFiles = {
	'julia.js': Buffer.from(
		'_jl_eval_string; WebAssembly.instantiate; getPreloadedPackage; "julia-wasm/julia.wasm"; "/npm/@chriskoch/julia-wasm/julia.data";\n'
	),
	'julia.wasm': Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
	'julia.data': Buffer.from('fixture Julia data\n'),
	'LICENSE.md': Buffer.from(
		'MIT License\nPermission is hereby granted\nJulia includes code from the following projects\n'
	),
	'readme.md': Buffer.from('WASM compiled version of the Julia 1.04 compiler\n'),
	'package.json': Buffer.from(
		`${JSON.stringify(
			{
				name: '@chriskoch/julia-wasm',
				version: '1.0.4',
				license: 'MIT',
				main: 'julia.js',
				repository: 'chris-koch-penn/polylang'
			},
			null,
			2
		)}\n`
	)
} as const;

async function createFixture() {
	const root = await mkdtemp(path.join(tmpdir(), 'wasm-julia-sync-'));
	temporaryRoots.push(root);
	const sourceDir = path.join(root, 'source');
	await mkdir(sourceDir, { recursive: true });
	await Promise.all(
		Object.entries(fixtureFiles).map(([fileName, bytes]) =>
			writeFile(path.join(sourceDir, fileName), bytes)
		)
	);
	const lock = JSON.parse(await readFile(productionLockPath, 'utf8')) as MutableJuliaInputLock;
	for (const receipt of lock.assets) {
		const bytes = fixtureFiles[receipt.path as keyof typeof fixtureFiles];
		receipt.bytes = bytes.byteLength;
		receipt.sha256 = sha256(bytes);
	}
	for (const [receipt, fileName] of [
		[lock.packageJson, 'package.json'],
		[lock.license, 'LICENSE.md'],
		[lock.documentation, 'readme.md']
	] as const) {
		const bytes = fixtureFiles[fileName];
		receipt.bytes = bytes.byteLength;
		receipt.sha256 = sha256(bytes);
	}
	const lockFilePath = path.join(root, 'wasm-julia-assets.lock.json');
	await writeFile(lockFilePath, `${JSON.stringify(lock, null, '\t')}\n`);
	return {
		root,
		sourceDir,
		targetDir: path.join(root, 'published'),
		versionModulePath: path.join(root, 'wasmJuliaVersion.ts'),
		lockFilePath
	};
}

async function listFiles(root: string) {
	return (await readdir(root, { withFileTypes: true }))
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
}

async function publishFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
	return syncWasmJuliaAssets({
		sourceDir: fixture.sourceDir,
		targetDir: fixture.targetDir,
		versionModulePath: fixture.versionModulePath,
		workerSourcePath,
		lockFilePath: fixture.lockFilePath
	});
}

afterEach(async () => {
	if (originalSourceDir === undefined) delete process.env.WASM_JULIA_SOURCE_DIR;
	else process.env.WASM_JULIA_SOURCE_DIR = originalSourceDir;
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('syncWasmJuliaAssets', () => {
	it('publishes a deterministic exact receipt graph and generated host pins', async () => {
		const fixture = await createFixture();
		const result = await publishFixture(fixture);

		expect(await listFiles(fixture.targetDir)).toEqual([
			'LICENSE.md',
			'julia.data.gz',
			'julia.data.gz.bin',
			'julia.js.gz',
			'julia.js.gz.bin',
			'julia.wasm.gz',
			'julia.wasm.gz.bin',
			'readme.md',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		const manifest = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest).toMatchObject({
			format: 'wasm-julia-runtime-manifest-v2',
			runtime: 'chriskoch-julia-wasm',
			profileId: 'julia-1.3.0-dev.560-chriskoch-npm-1.0.4-22a55e0d',
			fingerprint: result.fingerprint,
			artifact: {
				kind: 'opaque-npm-prebuilt',
				packageVersion: '1.0.4',
				verifiedBuildInput: false
			},
			components: { julia: { version: '1.3.0-DEV.560', verifiedBuildInput: false } }
		});
		expect(computeJuliaRuntimeFingerprint(manifest)).toBe(result.fingerprint);
		expect(manifest.storage.map((entry: { path: string }) => entry.path).sort()).toEqual([
			'julia.data.gz.bin',
			'julia.js.gz.bin',
			'julia.wasm.gz.bin'
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
			expect(
				await readFile(path.join(fixture.targetDir, storage.path.replace(/\.bin$/u, '')))
			).toEqual(stored);
		}
		const worker = await readFile(path.join(fixture.targetDir, 'runner-worker.js'));
		expect(result.workerReceipt).toEqual({
			bytes: worker.byteLength,
			sha256: sha256(worker)
		});
		const workerSource = worker.toString('utf8');
		for (const [key, value] of Object.entries({
			profileId: result.runtimeProfile.profileId,
			packageRevision: result.runtimeProfile.packageRevision,
			importedByCommit: result.runtimeProfile.importedByCommit,
			juliaVersion: result.runtimeProfile.juliaVersion,
			emscriptenVersion: result.runtimeProfile.emscriptenVersion,
			manifestFingerprint: result.runtimeProfile.manifestFingerprint
		})) {
			const pin = `${key}: '${value}'`;
			expect(workerSource).toContain(pin);
		}
		for (const placeholder of [
			'__WASM_IDLE_JULIA_PROFILE_ID__',
			'__WASM_IDLE_JULIA_PACKAGE_REVISION__',
			'__WASM_IDLE_JULIA_IMPORTED_BY_COMMIT__',
			'__WASM_IDLE_JULIA_VERSION__',
			'__WASM_IDLE_JULIA_EMSCRIPTEN_VERSION__',
			'__WASM_IDLE_JULIA_MANIFEST_FINGERPRINT__'
		]) {
			expect(workerSource).not.toContain(placeholder);
		}
		const manifestBytes = await readFile(
			path.join(fixture.targetDir, 'runtime-manifest.v2.json')
		);
		expect(result.runtimeProfile.manifestReceipt).toEqual({
			bytes: manifestBytes.byteLength,
			sha256: sha256(manifestBytes)
		});
		for (const [logicalPath, receiptName] of [
			['julia.js', 'javascriptReceipt'],
			['julia.wasm', 'wasmReceipt'],
			['julia.data', 'dataReceipt']
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
		const versionModule = await readFile(fixture.versionModulePath, 'utf8');
		expect(versionModule).toContain('export const WASM_JULIA_RUNTIME_PROFILE =');
		expect(versionModule).toContain('export const WASM_JULIA_RUNTIME_BUNDLE =');
		expect(versionModule).toContain(
			'export const WASM_JULIA_ASSET_VERSION = WASM_JULIA_RUNTIME_PROFILE.manifestFingerprint;'
		);
		for (const value of [
			result.fingerprint,
			result.workerReceipt.sha256,
			result.runtimeProfile.packageRevision,
			result.runtimeProfile.importedByCommit,
			result.runtimeProfile.juliaVersion,
			result.runtimeProfile.emscriptenVersion
		]) {
			expect(versionModule).toContain(value);
		}

		const second = await createFixture();
		await publishFixture(second);
		for (const fileName of await listFiles(fixture.targetDir)) {
			expect(await readFile(path.join(second.targetDir, fileName))).toEqual(
				await readFile(path.join(fixture.targetDir, fileName))
			);
		}
	});

	it('rejects a source receipt mismatch before replacing published outputs', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'previous.txt'), 'previous runtime');
		await writeFile(fixture.versionModulePath, 'previous pin');
		const data = await readFile(path.join(fixture.sourceDir, 'julia.data'));
		data[data.byteLength - 1] ^= 1;
		await writeFile(path.join(fixture.sourceDir, 'julia.data'), data);

		await expect(publishFixture(fixture)).rejects.toThrow('does not match the input lock');
		expect(await readFile(path.join(fixture.targetDir, 'previous.txt'), 'utf8')).toBe(
			'previous runtime'
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('previous pin');
	});

	it.each<[string, (lock: MutableJuliaInputLock) => void]>([
		['top-level schema extension', (lock) => (lock.unexpected = true)],
		['component provenance drift', (lock) => (lock.components.julia.revision = '0'.repeat(40))],
		['license mapping drift', (lock) => (lock.license.path = 'OTHER-LICENSE.md')],
		['duplicate logical asset', (lock) => (lock.assets[1].path = 'julia.js')]
	])('rejects %s in the input lock', async (_label, mutate) => {
		const fixture = await createFixture();
		const lock = JSON.parse(
			await readFile(fixture.lockFilePath, 'utf8')
		) as MutableJuliaInputLock;
		mutate(lock);
		await writeFile(fixture.lockFilePath, `${JSON.stringify(lock, null, '\t')}\n`);

		await expect(publishFixture(fixture)).rejects.toThrow(/input lock/u);
	});

	it('rejects logical receipts above the producer decompression limit', async () => {
		const fixture = await createFixture();
		const lock = JSON.parse(
			await readFile(fixture.lockFilePath, 'utf8')
		) as MutableJuliaInputLock;
		lock.assets[0].bytes = 64 * 1024 * 1024 + 1;
		await writeFile(fixture.lockFilePath, `${JSON.stringify(lock, null, '\t')}\n`);

		await expect(publishFixture(fixture)).rejects.toThrow('has invalid size');
	});

	it('fails closed when an explicit source environment path is missing', async () => {
		const fixture = await createFixture();
		await publishFixture(fixture);
		process.env.WASM_JULIA_SOURCE_DIR = path.join(fixture.root, 'missing-explicit-source');

		await expect(
			syncWasmJuliaAssets({
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				workerSourcePath,
				lockFilePath: fixture.lockFilePath
			})
		).rejects.toThrow('source must be a directory');
	});

	it('publishes from an immutable source snapshot when inputs change during rename', async () => {
		const fixture = await createFixture();
		const original = await readFile(path.join(fixture.sourceDir, 'julia.js'));
		let mutated = false;
		await syncWasmJuliaAssets({
			sourceDir: fixture.sourceDir,
			targetDir: fixture.targetDir,
			versionModulePath: fixture.versionModulePath,
			workerSourcePath,
			lockFilePath: fixture.lockFilePath,
			renamePath: async (source, target) => {
				if (!mutated) {
					mutated = true;
					await writeFile(path.join(fixture.sourceDir, 'julia.js'), 'replacement race');
				}
				await rename(source, target);
			}
		});

		expect(gunzipSync(await readFile(path.join(fixture.targetDir, 'julia.js.gz.bin')))).toEqual(
			original
		);
	});

	it('restores all previous outputs when final publication fails', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'previous.txt'), 'previous runtime');
		await writeFile(fixture.versionModulePath, 'previous pin');

		await expect(
			syncWasmJuliaAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				workerSourcePath,
				lockFilePath: fixture.lockFilePath,
				renamePath: async (source, target) => {
					if (target === fixture.versionModulePath && source.includes('.staging-')) {
						throw new Error('fixture final publication failure');
					}
					await rename(source, target);
				}
			})
		).rejects.toThrow('fixture final publication failure');
		expect(await listFiles(fixture.targetDir)).toEqual(['previous.txt']);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('previous pin');
	});

	it('rejects source and publication paths that overlap through resolved boundaries', async () => {
		const fixture = await createFixture();
		await expect(
			syncWasmJuliaAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.sourceDir,
				versionModulePath: fixture.versionModulePath,
				workerSourcePath,
				lockFilePath: fixture.lockFilePath
			})
		).rejects.toThrow('publication targets must not overlap their inputs');
	});
});
