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
	J_MANIFEST_FORMAT,
	computeJRuntimeFingerprint,
	syncWasmJAssets
} from '../../scripts/sync-wasm-j.mjs';

const tempDirs: string[] = [];
const originalWasmJSourceDir = process.env.WASM_J_SOURCE_DIR;

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-j-'));
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

async function writeFixtureLock(
	baseDir: string,
	moduleBytes: Buffer,
	wasmBytes: Buffer,
	profileId = 'jsoftware-j-playground-test'
) {
	return await writeFixtureFile(
		baseDir,
		'wasm-j-assets.lock.json',
		`${JSON.stringify(
			{
				schemaVersion: 1,
				profileId,
				source: {
					repository: 'https://github.com/jsoftware/j-playground',
					path: 'bin/html2',
					revision: 'fixture'
				},
				assets: [
					{
						path: 'jamalgam.js',
						bytes: moduleBytes.byteLength,
						sha256: sha256(moduleBytes)
					},
					{
						path: 'jamalgam.wasm',
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

function fixtureModuleBytes() {
	return Buffer.from(
		'export default function createModule() {}; em_jdo; WebAssembly.instantiate;\n',
		'utf8'
	);
}

describe('syncWasmJAssets', () => {
	afterEach(async () => {
		if (originalWasmJSourceDir === undefined) {
			delete process.env.WASM_J_SOURCE_DIR;
		} else {
			process.env.WASM_J_SOURCE_DIR = originalWasmJSourceDir;
		}
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('publishes a deterministic receipt-backed J runtime snapshot', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmJVersion.ts');
		const workerBytes = Buffer.from('self.onmessage = () => {};\n', 'utf8');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			workerBytes
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = Buffer.from('wasm fixture', 'utf8');
		await writeFixtureFile(sourceDir, 'jamalgam.js', moduleBytes);
		await writeFixtureFile(sourceDir, 'jamalgam.wasm', wasmBytes);
		const lockFilePath = await writeFixtureLock(await makeTempDir(), moduleBytes, wasmBytes);

		const result = await syncWasmJAssets({
			sourceDir,
			targetDir,
			workerSourcePath,
			versionModulePath,
			lockFilePath
		});

		expect((await readdir(targetDir)).sort()).toEqual([
			'jamalgam.js',
			'jamalgam.wasm.gz',
			'runner-worker.js',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		expect(await readFile(path.join(targetDir, 'jamalgam.js'))).toEqual(moduleBytes);
		const installedGzip = await readFile(path.join(targetDir, 'jamalgam.wasm.gz'));
		expect(gunzipSync(installedGzip)).toEqual(wasmBytes);
		expect(installedGzip).toEqual(gzipSync(wasmBytes, { level: 9 }));
		expect(await readFile(path.join(targetDir, 'runner-worker.js'))).toEqual(workerBytes);

		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest).toMatchObject({
			format: J_MANIFEST_FORMAT,
			runtime: 'jsoftware-j-playground',
			profileId: 'jsoftware-j-playground-test',
			fingerprint: result.fingerprint,
			assets: [
				{
					path: 'jamalgam.js',
					size: moduleBytes.byteLength,
					sha256: sha256(moduleBytes)
				},
				{
					path: 'jamalgam.wasm',
					size: wasmBytes.byteLength,
					sha256: sha256(wasmBytes)
				}
			],
			storage: [
				{
					path: 'jamalgam.js',
					encoding: 'identity',
					size: moduleBytes.byteLength,
					sha256: sha256(moduleBytes)
				},
				{
					path: 'jamalgam.wasm.gz',
					encoding: 'gzip',
					size: installedGzip.byteLength,
					sha256: sha256(installedGzip)
				}
			]
		});
		expect(computeJRuntimeFingerprint(manifest)).toBe(result.fingerprint);
		const versionModule = await readFile(versionModulePath, 'utf8');
		expect(versionModule).toContain(result.fingerprint);
		expect(versionModule).toContain(`bytes: ${workerBytes.byteLength}`);
		expect(versionModule).toContain(`sha256: '${sha256(workerBytes)}'`);
	});

	it('revalidates and republishes an existing gzip-only vendored target', async () => {
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmJVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => { self.postMessage({ results: true }); };\n'
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = Buffer.from('existing wasm fixture', 'utf8');
		await writeFixtureFile(targetDir, 'jamalgam.js', moduleBytes);
		await writeFixtureFile(targetDir, 'jamalgam.wasm.gz', gzipSync(wasmBytes, { level: 9 }));
		const lockFilePath = await writeFixtureLock(await makeTempDir(), moduleBytes, wasmBytes);
		process.env.WASM_J_SOURCE_DIR = path.join(await makeTempDir(), 'missing');

		const result = await syncWasmJAssets({
			targetDir,
			workerSourcePath,
			versionModulePath,
			lockFilePath
		});

		expect(gunzipSync(await readFile(path.join(targetDir, 'jamalgam.wasm.gz')))).toEqual(
			wasmBytes
		);
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
			'wasmJVersion.ts',
			'previous version\n'
		);
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = Buffer.from('locked wasm', 'utf8');
		const lockFilePath = await writeFixtureLock(await makeTempDir(), moduleBytes, wasmBytes);
		await writeFixtureFile(
			sourceDir,
			'jamalgam.js',
			Buffer.concat([moduleBytes, Buffer.from('x')])
		);
		await writeFixtureFile(sourceDir, 'jamalgam.wasm', wasmBytes);
		await writeFixtureFile(targetDir, 'previous.txt', 'previous runtime\n');

		await expect(
			syncWasmJAssets({
				sourceDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('does not match the input lock');
		await expect(readFile(path.join(targetDir, 'previous.txt'), 'utf8')).resolves.toBe(
			'previous runtime\n'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('previous version\n');
	});

	it('rejects an explicit source directory that overlaps the publication target', async () => {
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmJVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = Buffer.from('overlap wasm', 'utf8');
		await writeFixtureFile(targetDir, 'jamalgam.js', moduleBytes);
		await writeFixtureFile(targetDir, 'jamalgam.wasm', wasmBytes);
		const lockFilePath = await writeFixtureLock(await makeTempDir(), moduleBytes, wasmBytes);

		await expect(
			syncWasmJAssets({
				sourceDir: targetDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('source directory and runtime target must not overlap');
		await expect(readFile(path.join(targetDir, 'jamalgam.wasm'))).resolves.toEqual(wasmBytes);
	});

	it('rejects a source directory that aliases the publication target through a symlink', async () => {
		const runtimeParent = await makeTempDir();
		const sourceDir = path.join(runtimeParent, 'runtime');
		const aliasParent = path.join(await makeTempDir(), 'alias');
		await symlink(runtimeParent, aliasParent, 'dir');
		const targetDir = path.join(aliasParent, 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmJVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = Buffer.from('symlink alias wasm', 'utf8');
		await writeFixtureFile(sourceDir, 'jamalgam.js', moduleBytes);
		await writeFixtureFile(sourceDir, 'jamalgam.wasm', wasmBytes);
		const lockFilePath = await writeFixtureLock(await makeTempDir(), moduleBytes, wasmBytes);

		await expect(
			syncWasmJAssets({
				sourceDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('source directory and runtime target must not overlap');
		await expect(readFile(path.join(sourceDir, 'jamalgam.wasm'))).resolves.toEqual(wasmBytes);
	});

	it('rolls back both published outputs when the version swap fails', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = await writeFixtureFile(
			await makeTempDir(),
			'wasmJVersion.ts',
			'previous version\n'
		);
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const moduleBytes = fixtureModuleBytes();
		const wasmBytes = Buffer.from('rollback wasm', 'utf8');
		await writeFixtureFile(sourceDir, 'jamalgam.js', moduleBytes);
		await writeFixtureFile(sourceDir, 'jamalgam.wasm', wasmBytes);
		await writeFixtureFile(targetDir, 'previous.txt', 'previous runtime\n');
		const lockFilePath = await writeFixtureLock(await makeTempDir(), moduleBytes, wasmBytes);
		let renameCount = 0;

		await expect(
			syncWasmJAssets({
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
