import { createHash } from 'node:crypto';
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
	BQN_MANIFEST_FORMAT,
	computeBqnRuntimeFingerprint,
	syncWasmBqnAssets
} from '../../scripts/sync-wasm-bqn.mjs';

const tempDirs: string[] = [];
const originalWasmBqnSourceDir = process.env.WASM_BQN_SOURCE_DIR;
const originalWasmBqnLicenseFile = process.env.WASM_BQN_LICENSE_FILE;
const buildOptions = ['ENVIRONMENT=worker', 'MODULARIZE=1', 'EXPORT_ES6=1', 'FORCE_FILESYSTEM=1'];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-bqn-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string | Buffer) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents);
	return targetPath;
}

function sha256(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

function fixtureModuleBytes() {
	return Buffer.from('export default Module; cbqn_runLine; FS.init;\n', 'utf8');
}

function fixtureWasmBytes(label = 'fixture') {
	return Buffer.concat([
		Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
		Buffer.from(label, 'utf8')
	]);
}

function fixtureLicenseBytes() {
	return Buffer.from('GNU GENERAL PUBLIC LICENSE Version 3 fixture\n', 'utf8');
}

async function writeFixtureLock(
	baseDir: string,
	moduleBytes: Buffer,
	wasmBytes: Buffer,
	licenseBytes: Buffer,
	profileId = 'dzaima-cbqn-test'
) {
	return await writeFixtureFile(
		baseDir,
		'wasm-bqn-assets.lock.json',
		`${JSON.stringify(
			{
				schemaVersion: 1,
				profileId,
				source: {
					repository: 'https://github.com/dzaima/CBQN',
					path: 'dist',
					revision: 'fixture'
				},
				build: { emscripten: '3.1.8', options: buildOptions },
				license: {
					path: 'LICENSE-GPLv3.txt',
					spdx: 'GPL-3.0-or-later',
					bytes: licenseBytes.byteLength,
					sha256: sha256(licenseBytes)
				},
				assets: [
					{
						path: 'BQN.js',
						bytes: moduleBytes.byteLength,
						sha256: sha256(moduleBytes)
					},
					{
						path: 'BQN.wasm',
						bytes: wasmBytes.byteLength,
						sha256: sha256(wasmBytes)
					}
				]
			},
			null,
			2
		)}\n`
	);
}

async function writeSourceSnapshot(
	sourceDir: string,
	moduleBytes: Buffer,
	wasmBytes: Buffer,
	licenseBytes: Buffer
) {
	await Promise.all([
		writeFixtureFile(sourceDir, 'BQN.js', moduleBytes),
		writeFixtureFile(sourceDir, 'BQN.wasm', wasmBytes),
		writeFixtureFile(sourceDir, 'LICENSE-GPLv3.txt', licenseBytes)
	]);
}

describe('syncWasmBqnAssets', () => {
	afterEach(async () => {
		if (originalWasmBqnSourceDir === undefined) {
			delete process.env.WASM_BQN_SOURCE_DIR;
		} else {
			process.env.WASM_BQN_SOURCE_DIR = originalWasmBqnSourceDir;
		}
		if (originalWasmBqnLicenseFile === undefined) {
			delete process.env.WASM_BQN_LICENSE_FILE;
		} else {
			process.env.WASM_BQN_LICENSE_FILE = originalWasmBqnLicenseFile;
		}
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('publishes a deterministic receipt-backed CBQN runtime snapshot', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmBqnVersion.ts');
		const workerBytes = Buffer.from('self.onmessage = () => {};\n', 'utf8');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			workerBytes
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = fixtureWasmBytes();
		const licenseBytes = fixtureLicenseBytes();
		await writeSourceSnapshot(sourceDir, moduleBytes, wasmBytes, licenseBytes);
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			moduleBytes,
			wasmBytes,
			licenseBytes
		);

		const result = await syncWasmBqnAssets({
			sourceDir,
			targetDir,
			workerSourcePath,
			versionModulePath,
			lockFilePath
		});

		expect((await readdir(targetDir)).sort()).toEqual([
			'BQN.js',
			'BQN.wasm.gz',
			'BQN.wasm.gz.bin',
			'LICENSE-GPLv3.txt',
			'runner-worker.js',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		expect(await readFile(path.join(targetDir, 'BQN.js'))).toEqual(moduleBytes);
		const installedGzip = await readFile(path.join(targetDir, 'BQN.wasm.gz'));
		const installedVerifiedGzip = await readFile(path.join(targetDir, 'BQN.wasm.gz.bin'));
		expect(gunzipSync(installedGzip)).toEqual(wasmBytes);
		expect(installedGzip).toEqual(gzipSync(wasmBytes, { level: 9 }));
		expect(installedVerifiedGzip).toEqual(installedGzip);
		expect(await readFile(path.join(targetDir, 'LICENSE-GPLv3.txt'))).toEqual(licenseBytes);
		expect(await readFile(path.join(targetDir, 'runner-worker.js'))).toEqual(workerBytes);

		const manifestSource = await readFile(
			path.join(targetDir, 'runtime-manifest.v2.json'),
			'utf8'
		);
		const manifest = JSON.parse(manifestSource);
		expect(manifest).toMatchObject({
			format: BQN_MANIFEST_FORMAT,
			runtime: 'dzaima-cbqn',
			profileId: 'dzaima-cbqn-test',
			fingerprint: result.fingerprint,
			build: { emscripten: '3.1.8', options: buildOptions },
			license: {
				path: 'LICENSE-GPLv3.txt',
				spdx: 'GPL-3.0-or-later',
				size: licenseBytes.byteLength,
				sha256: sha256(licenseBytes)
			},
			assets: [
				{
					path: 'BQN.js',
					size: moduleBytes.byteLength,
					sha256: sha256(moduleBytes)
				},
				{
					path: 'BQN.wasm',
					size: wasmBytes.byteLength,
					sha256: sha256(wasmBytes)
				}
			],
			storage: [
				{
					path: 'BQN.js',
					encoding: 'identity',
					size: moduleBytes.byteLength,
					sha256: sha256(moduleBytes)
				},
				{
					path: 'BQN.wasm.gz.bin',
					encoding: 'gzip',
					size: installedGzip.byteLength,
					sha256: sha256(installedGzip)
				}
			]
		});
		expect(computeBqnRuntimeFingerprint(manifest)).toBe(result.fingerprint);
		const versionModule = await readFile(versionModulePath, 'utf8');
		expect(versionModule).toBe(
			`export const WASM_BQN_RUNTIME_PROFILE = {\n\tprofileId: 'dzaima-cbqn-test',\n\tsourceRevision: 'fixture',\n\tmanifestFingerprint: '${result.fingerprint}',\n\tmanifestReceipt: {\n\t\tbytes: ${Buffer.byteLength(manifestSource)},\n\t\tsha256: '${sha256(Buffer.from(manifestSource))}'\n\t},\n\tmoduleReceipt: {\n\t\tbytes: ${moduleBytes.byteLength},\n\t\tsha256: '${sha256(moduleBytes)}'\n\t},\n\twasmReceipt: {\n\t\tbytes: ${installedGzip.byteLength},\n\t\tsha256: '${sha256(installedGzip)}',\n\t\tuncompressedBytes: ${wasmBytes.byteLength},\n\t\tuncompressedSha256: '${sha256(wasmBytes)}'\n\t}\n} as const;\nexport const WASM_BQN_ASSET_VERSION = WASM_BQN_RUNTIME_PROFILE.manifestFingerprint;\nexport const WASM_BQN_RUNNER_RECEIPT = {\n\tbytes: ${workerBytes.byteLength},\n\tsha256: '${sha256(workerBytes)}'\n} as const;\n`
		);
	});

	it('revalidates and republishes an existing gzip-only vendored target', async () => {
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmBqnVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => { self.postMessage({ results: true }); };\n'
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = fixtureWasmBytes('existing');
		const licenseBytes = fixtureLicenseBytes();
		await Promise.all([
			writeFixtureFile(targetDir, 'BQN.js', moduleBytes),
			writeFixtureFile(targetDir, 'BQN.wasm.gz', gzipSync(wasmBytes, { level: 9 })),
			writeFixtureFile(targetDir, 'LICENSE-GPLv3.txt', licenseBytes)
		]);
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			moduleBytes,
			wasmBytes,
			licenseBytes
		);
		process.env.WASM_BQN_SOURCE_DIR = path.join(await makeTempDir(), 'missing');

		const result = await syncWasmBqnAssets({
			targetDir,
			workerSourcePath,
			versionModulePath,
			lockFilePath
		});

		expect(gunzipSync(await readFile(path.join(targetDir, 'BQN.wasm.gz')))).toEqual(wasmBytes);
		await expect(
			readFile(path.join(targetDir, 'runtime-manifest.v2.json'), 'utf8')
		).resolves.toContain(result.fingerprint);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(result.fingerprint);
	});

	it('rejects source drift before replacing an installed runtime', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = await writeFixtureFile(
			await makeTempDir(),
			'wasmBqnVersion.ts',
			'previous version\n'
		);
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = fixtureWasmBytes('locked');
		const licenseBytes = fixtureLicenseBytes();
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			moduleBytes,
			wasmBytes,
			licenseBytes
		);
		await writeSourceSnapshot(
			sourceDir,
			Buffer.concat([moduleBytes, Buffer.from('x')]),
			wasmBytes,
			licenseBytes
		);
		await writeFixtureFile(targetDir, 'previous.txt', 'previous runtime\n');

		await expect(
			syncWasmBqnAssets({
				sourceDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('does not match the input lock');
		await writeFixtureFile(sourceDir, 'BQN.js', moduleBytes);
		await writeFixtureFile(
			sourceDir,
			'LICENSE-GPLv3.txt',
			Buffer.concat([licenseBytes, Buffer.from('x')])
		);
		await expect(
			syncWasmBqnAssets({
				sourceDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('license does not match the input lock');
		await expect(readFile(path.join(targetDir, 'previous.txt'), 'utf8')).resolves.toBe(
			'previous runtime\n'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('previous version\n');
	});

	it('rejects an explicit source directory that overlaps the publication target', async () => {
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmBqnVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = fixtureWasmBytes('overlap');
		const licenseBytes = fixtureLicenseBytes();
		await writeSourceSnapshot(targetDir, moduleBytes, wasmBytes, licenseBytes);
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			moduleBytes,
			wasmBytes,
			licenseBytes
		);

		await expect(
			syncWasmBqnAssets({
				sourceDir: targetDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('source directory and runtime target must not overlap');
		await expect(readFile(path.join(targetDir, 'BQN.wasm'))).resolves.toEqual(wasmBytes);
	});

	it('rejects a source directory that aliases the publication target through a symlink', async () => {
		const runtimeParent = await makeTempDir();
		const sourceDir = path.join(runtimeParent, 'runtime');
		const aliasParent = path.join(await makeTempDir(), 'alias');
		await symlink(runtimeParent, aliasParent, 'dir');
		const targetDir = path.join(aliasParent, 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmBqnVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = fixtureWasmBytes('alias');
		const licenseBytes = fixtureLicenseBytes();
		await writeSourceSnapshot(sourceDir, moduleBytes, wasmBytes, licenseBytes);
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			moduleBytes,
			wasmBytes,
			licenseBytes
		);

		await expect(
			syncWasmBqnAssets({
				sourceDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('source directory and runtime target must not overlap');
		await expect(readFile(path.join(sourceDir, 'BQN.wasm'))).resolves.toEqual(wasmBytes);
	});

	it('rolls back both published outputs when the version swap fails', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = await writeFixtureFile(
			await makeTempDir(),
			'wasmBqnVersion.ts',
			'previous version\n'
		);
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = fixtureWasmBytes('rollback');
		const licenseBytes = fixtureLicenseBytes();
		await writeSourceSnapshot(sourceDir, moduleBytes, wasmBytes, licenseBytes);
		await writeFixtureFile(targetDir, 'previous.txt', 'previous runtime\n');
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			moduleBytes,
			wasmBytes,
			licenseBytes
		);
		let renameCount = 0;

		await expect(
			syncWasmBqnAssets({
				sourceDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath,
				renamePath: async (sourcePath, destinationPath) => {
					renameCount += 1;
					if (renameCount === 4) throw new Error('fixture version publication failure');
					await rename(sourcePath, destinationPath);
				}
			})
		).rejects.toThrow('fixture version publication failure');
		await expect(readFile(path.join(targetDir, 'previous.txt'), 'utf8')).resolves.toBe(
			'previous runtime\n'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('previous version\n');
	});
});
