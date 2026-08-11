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
	CLOJURESCRIPT_MANIFEST_FORMAT,
	computeClojureScriptRuntimeFingerprint,
	syncWasmClojureScriptAssets
} from '../../scripts/sync-wasm-clojurescript.mjs';

const tempDirs: string[] = [];
const build = {
	clojureScriptVersion: '1.12.134',
	clojureToolsVersion: '1.12.4.1618',
	jdkVersion: '21.0.11+10',
	jdkArchiveSha256: '4b2220e232a97997b436ca6ab15cbf70171ecff52958a46159dfa5a8c44ca4de',
	clojureToolsArchiveSha256: '13769da6d63a98deb2024378ae1a64e4ee211ac1035340dfca7a6944c41cde21',
	target: 'webworker',
	optimizations: 'simple'
};

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-clojurescript-'));
	tempDirs.push(directory);
	return directory;
}

async function writeFixtureFile(
	baseDir: string,
	relativePath: string,
	contents: string | Uint8Array
) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents);
	return targetPath;
}

function sha256(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

function compilerBytes(label = 'fixture') {
	return Buffer.from(
		`globalThis.wasm_idle = { runner: { execute() {} } }; // wasm_idle.runner.execute ${label}\n`,
		'utf8'
	);
}

function licenseBytes() {
	return Buffer.from('Eclipse Public License 1.0 fixture\n', 'utf8');
}

function metadataBytes(compiler: Uint8Array) {
	return Buffer.from(
		`${JSON.stringify(
			{
				format: 'wasm-clojurescript-runtime-build-v1',
				runtime: 'cljs.js',
				...build,
				compilerSha256: sha256(compiler),
				compilerBytes: compiler.byteLength
			},
			null,
			2
		)}\n`,
		'utf8'
	);
}

async function writeFixtureLock(
	baseDir: string,
	compiler: Uint8Array,
	metadata: Uint8Array,
	license: Uint8Array
) {
	return await writeFixtureFile(
		baseDir,
		'wasm-clojurescript-assets.lock.json',
		`${JSON.stringify(
			{
				schemaVersion: 1,
				profileId: 'clojurescript-1.12.134-test',
				source: {
					repository: 'https://github.com/clojure/clojurescript',
					revision: 'r1.12.134',
					integrationRepository: 'https://github.com/seo-rii/wasm-idle',
					integrationRevision: 'f'.repeat(40)
				},
				build,
				license: {
					path: 'LICENSE.txt',
					spdx: 'EPL-1.0',
					bytes: license.byteLength,
					sha256: sha256(license)
				},
				assets: [
					{ path: 'compiler.js', bytes: compiler.byteLength, sha256: sha256(compiler) },
					{
						path: 'runtime-build.json',
						bytes: metadata.byteLength,
						sha256: sha256(metadata)
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
	compiler: Uint8Array,
	metadata: Uint8Array,
	license: Uint8Array
) {
	await Promise.all([
		writeFixtureFile(sourceDir, 'compiler.js', compiler),
		writeFixtureFile(sourceDir, 'runtime-build.json', metadata),
		writeFixtureFile(sourceDir, 'LICENSE.txt', license)
	]);
}

describe('syncWasmClojureScriptAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('publishes a deterministic receipt-backed compiler snapshot', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmClojureScriptVersion.ts');
		const worker = Buffer.from('self.onmessage = () => {};\n', 'utf8');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			worker
		);
		const compiler = compilerBytes();
		const metadata = metadataBytes(compiler);
		const license = licenseBytes();
		await writeSourceSnapshot(sourceDir, compiler, metadata, license);
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			compiler,
			metadata,
			license
		);

		const result = await syncWasmClojureScriptAssets({
			sourceDir,
			targetDir,
			workerSourcePath,
			versionModulePath,
			lockFilePath
		});

		expect((await readdir(targetDir)).sort()).toEqual([
			'LICENSE.txt',
			'compiler.js.gz',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		const installedGzip = await readFile(path.join(targetDir, 'compiler.js.gz'));
		expect(gunzipSync(installedGzip)).toEqual(compiler);
		expect(installedGzip).toEqual(gzipSync(compiler, { level: 9 }));
		expect(await readFile(path.join(targetDir, 'runtime-build.json'))).toEqual(metadata);
		expect(await readFile(path.join(targetDir, 'LICENSE.txt'))).toEqual(license);
		expect(await readFile(path.join(targetDir, 'runner-worker.js'))).toEqual(worker);

		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest).toMatchObject({
			format: CLOJURESCRIPT_MANIFEST_FORMAT,
			runtime: 'cljs.js',
			profileId: 'clojurescript-1.12.134-test',
			fingerprint: result.fingerprint,
			build,
			license: {
				path: 'LICENSE.txt',
				spdx: 'EPL-1.0',
				size: license.byteLength,
				sha256: sha256(license)
			},
			metadata: {
				path: 'runtime-build.json',
				size: metadata.byteLength,
				sha256: sha256(metadata)
			},
			assets: [
				{
					path: 'compiler.js',
					size: compiler.byteLength,
					sha256: sha256(compiler)
				}
			],
			storage: [
				{
					path: 'compiler.js.gz',
					logicalPath: 'compiler.js',
					encoding: 'gzip',
					size: installedGzip.byteLength,
					sha256: sha256(installedGzip)
				}
			]
		});
		expect(computeClojureScriptRuntimeFingerprint(manifest)).toBe(result.fingerprint);
		const versionModule = await readFile(versionModulePath, 'utf8');
		expect(versionModule).toContain(result.fingerprint);
		expect(versionModule).toContain(`bytes: ${worker.byteLength}`);
		expect(versionModule).toContain(`sha256: '${sha256(worker)}'`);
	});

	it('rejects compiler, metadata, and license drift before replacing an installed runtime', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = await writeFixtureFile(
			await makeTempDir(),
			'wasmClojureScriptVersion.ts',
			'previous version\n'
		);
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const compiler = compilerBytes('locked');
		const metadata = metadataBytes(compiler);
		const license = licenseBytes();
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			compiler,
			metadata,
			license
		);
		await writeSourceSnapshot(
			sourceDir,
			Buffer.concat([compiler, Buffer.from('x')]),
			metadata,
			license
		);
		await writeFixtureFile(targetDir, 'previous.txt', 'previous runtime\n');

		const run = () =>
			syncWasmClojureScriptAssets({
				sourceDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath
			});
		await expect(run()).rejects.toThrow('compiler.js does not match the input lock');
		await writeFixtureFile(sourceDir, 'compiler.js', compiler);
		await writeFixtureFile(
			sourceDir,
			'runtime-build.json',
			Buffer.concat([metadata, Buffer.from(' ')])
		);
		await expect(run()).rejects.toThrow('runtime-build.json does not match the input lock');
		await writeFixtureFile(sourceDir, 'runtime-build.json', metadata);
		await writeFixtureFile(
			sourceDir,
			'LICENSE.txt',
			Buffer.concat([license, Buffer.from('x')])
		);
		await expect(run()).rejects.toThrow('license does not match the input lock');
		await expect(readFile(path.join(targetDir, 'previous.txt'), 'utf8')).resolves.toBe(
			'previous runtime\n'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('previous version\n');
	});

	it('rejects an explicit source directory that overlaps the publication target', async () => {
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmClojureScriptVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const compiler = compilerBytes('overlap');
		const metadata = metadataBytes(compiler);
		const license = licenseBytes();
		await writeSourceSnapshot(targetDir, compiler, metadata, license);
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			compiler,
			metadata,
			license
		);

		await expect(
			syncWasmClojureScriptAssets({
				sourceDir: targetDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('runtime target and source directory must not overlap');
		await expect(readFile(path.join(targetDir, 'compiler.js'))).resolves.toEqual(compiler);
	});

	it('rejects a source alias to the target through a symlink', async () => {
		const runtimeParent = await makeTempDir();
		const sourceDir = path.join(runtimeParent, 'runtime');
		const aliasParent = path.join(await makeTempDir(), 'alias');
		await symlink(runtimeParent, aliasParent, 'dir');
		const targetDir = path.join(aliasParent, 'runtime');
		const versionModulePath = path.join(await makeTempDir(), 'wasmClojureScriptVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const compiler = compilerBytes('alias');
		const metadata = metadataBytes(compiler);
		const license = licenseBytes();
		await writeSourceSnapshot(sourceDir, compiler, metadata, license);
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			compiler,
			metadata,
			license
		);

		await expect(
			syncWasmClojureScriptAssets({
				sourceDir,
				targetDir,
				workerSourcePath,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('runtime target and source directory must not overlap');
		await expect(readFile(path.join(sourceDir, 'compiler.js'))).resolves.toEqual(compiler);
	});

	it('rolls back the runtime and version module when the version swap fails', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'runtime');
		const versionModulePath = await writeFixtureFile(
			await makeTempDir(),
			'wasmClojureScriptVersion.ts',
			'previous version\n'
		);
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => {};\n'
		);
		const compiler = compilerBytes('rollback');
		const metadata = metadataBytes(compiler);
		const license = licenseBytes();
		await writeSourceSnapshot(sourceDir, compiler, metadata, license);
		await writeFixtureFile(targetDir, 'previous.txt', 'previous runtime\n');
		const lockFilePath = await writeFixtureLock(
			await makeTempDir(),
			compiler,
			metadata,
			license
		);
		let renameCount = 0;

		await expect(
			syncWasmClojureScriptAssets({
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

	it('rejects compiler bundles that include the browser REPL preload', async () => {
		const sourceDir = await makeTempDir();
		const compiler = Buffer.from(
			'wasm_idle.runner.execute = function() {}; clojure.browser.repl.connect();\n'
		);
		const metadata = metadataBytes(compiler);
		const license = licenseBytes();
		await writeSourceSnapshot(sourceDir, compiler, metadata, license);

		await expect(
			syncWasmClojureScriptAssets({
				sourceDir,
				targetDir: path.join(await makeTempDir(), 'runtime'),
				workerSourcePath: await writeFixtureFile(
					await makeTempDir(),
					'runner-worker.js',
					'worker\n'
				),
				versionModulePath: path.join(await makeTempDir(), 'version.ts'),
				lockFilePath: await writeFixtureLock(
					await makeTempDir(),
					compiler,
					metadata,
					license
				)
			})
		).rejects.toThrow(/browser REPL preload/u);
	});
});
