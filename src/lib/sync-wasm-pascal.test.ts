import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	PASCAL_MANIFEST_FORMAT,
	computePascalRuntimeFingerprint,
	syncWasmPascalAssets
} from '../../scripts/sync-wasm-pascal.mjs';
import {
	WASM_PASCAL_ASSET_VERSION,
	WASM_PASCAL_RUNTIME_BUNDLE,
	WASM_PASCAL_RUNTIME_PROFILE
} from './playground/wasmPascalVersion';

const repositoryRoot = process.cwd();
const temporaryDirectories: string[] = [];
const artifactRevision = '2c1edc2d47a221498d6086f62431796012e2f3ca';
const pas2jsRevision = '9ac46614dc82';
const profileId = 'pascal-pas2js-3.2.1-legacy-2c1edc2d';
const expectedPublishedFiles = [
	'compiler.js.gz',
	'compiler.js.gz.bin',
	'rtl.js',
	'rtl.js.bin',
	'runner-worker.js',
	'runtime-build.json',
	'runtime-manifest.v1.json',
	'runtime-manifest.v2.json',
	'system.pas',
	'system.pas.bin'
] as const;

function sha256(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function collectRelativeFiles(root: string, current = root): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(current, { withFileTypes: true })) {
		const entryPath = path.join(current, entry.name);
		if (entry.isDirectory()) files.push(...(await collectRelativeFiles(root, entryPath)));
		else if (entry.isFile())
			files.push(path.relative(root, entryPath).split(path.sep).join('/'));
	}
	return files.sort();
}

async function treeReceipt(root: string) {
	const hash = createHash('sha256');
	for (const relativePath of await collectRelativeFiles(root)) {
		hash.update(relativePath);
		hash.update('\0');
		hash.update(await readFile(path.join(root, relativePath)));
		hash.update('\n');
	}
	return hash.digest('hex');
}

function expectedArtifact() {
	return {
		kind: 'opaque-vendored',
		repository: 'https://github.com/seo-rii/wasm-idle.git',
		revision: artifactRevision,
		path: 'static/wasm-pascal',
		provenance: 'legacy-import',
		verifiedBuildInput: false
	};
}

function expectedComponents() {
	return {
		pas2js: {
			version: '3.2.1',
			repository: 'https://gitlab.com/freepascal.org/fpc/pas2js.git',
			revision: pas2jsRevision,
			revisionKind: 'recorded-abbreviated',
			verifiedBuildInput: false,
			evidence: 'runtime-build.json; full upstream commit was not recorded'
		}
	};
}

function expectedBuild() {
	return {
		target: 'browser',
		compiler: 'native pas2js',
		entrypoint: 'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
		integrationSources: [
			'runtimes/wasm-pascal/src/system.pas',
			'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
			'runtimes/wasm-pascal/src/webfilecache.pp'
		],
		transformations: [
			'strip trailing horizontal whitespace and normalize final newline',
			'gzip compiler.js with Node zlib level 9'
		],
		verifiedBuildInput: false
	};
}

function expectedLicense() {
	return {
		spdx: 'LGPL-2.1-only WITH Independent-modules-exception',
		sourceUrl: 'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/COPYING.txt',
		exceptionSourceUrl:
			'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/LICENSE',
		verifiedBuildInput: false,
		evidence:
			'upstream license URLs recorded; texts were not vendored with the legacy generation'
	};
}

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-pascal-receipt-'));
	temporaryDirectories.push(root);
	const sourceDir = path.join(root, 'source');
	const targetDir = path.join(root, 'target');
	const versionModulePath = path.join(root, 'wasmPascalVersion.ts');
	const lspVersionModulePath = path.join(root, 'bundledPascalRuntime.ts');
	const lockFilePath = path.join(root, 'wasm-pascal-assets.lock.json');
	await mkdir(sourceDir, { recursive: true });
	const compilerJavaScript = new TextEncoder().encode(
		'globalThis.rtl={run() {}};\n' +
			'globalThis.__wasmIdlePascalCompiler={setFile() {},compile() { return ""; }};\n'
	);
	const rtlJavaScript = new TextEncoder().encode('globalThis.rtl = globalThis.rtl || {};\n');
	const systemPascal = new TextEncoder().encode(
		'unit System; interface procedure ReadLn; implementation end.\n'
	);
	const runtimeBuild = {
		format: 'wasm-pascal-runtime-build-v1',
		runtime: 'pas2js',
		pas2jsVersion: '3.2.1',
		pas2jsCommit: pas2jsRevision
	};
	const runtimeBuildBytes = new TextEncoder().encode(
		`${JSON.stringify(runtimeBuild, null, 2)}\n`
	);
	await writeFile(path.join(sourceDir, 'compiler.js'), compilerJavaScript);
	await writeFile(path.join(sourceDir, 'rtl.js'), rtlJavaScript);
	await writeFile(path.join(sourceDir, 'system.pas'), systemPascal);
	await writeFile(path.join(sourceDir, 'runtime-build.json'), runtimeBuildBytes);
	const lock = {
		schemaVersion: 1,
		profileId,
		licenseExpression: 'LGPL-2.1-only WITH Independent-modules-exception',
		artifact: expectedArtifact(),
		components: expectedComponents(),
		build: expectedBuild(),
		license: expectedLicense(),
		assets: [
			{
				path: 'compiler.js',
				bytes: compilerJavaScript.byteLength,
				sha256: sha256(compilerJavaScript)
			},
			{ path: 'rtl.js', bytes: rtlJavaScript.byteLength, sha256: sha256(rtlJavaScript) },
			{ path: 'system.pas', bytes: systemPascal.byteLength, sha256: sha256(systemPascal) },
			{
				path: 'runtime-build.json',
				bytes: runtimeBuildBytes.byteLength,
				sha256: sha256(runtimeBuildBytes)
			}
		]
	};
	await writeFile(lockFilePath, `${JSON.stringify(lock, null, 2)}\n`);
	return {
		sourceDir,
		targetDir,
		versionModulePath,
		lspVersionModulePath,
		lockFilePath,
		workerSourcePath: path.join(
			repositoryRoot,
			'scripts/runtime-workers/wasm-pascal-runner-worker.js'
		),
		compilerJavaScript,
		rtlJavaScript,
		systemPascal,
		runtimeBuildBytes,
		lock
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('syncWasmPascalAssets', () => {
	it('publishes one exact v2 profile and fingerprint-bound runner generation', async () => {
		const fixture = await createFixture();
		const result = await syncWasmPascalAssets(fixture);
		const manifestBytes = await readFile(
			path.join(fixture.targetDir, 'runtime-manifest.v2.json')
		);
		const manifest = JSON.parse(manifestBytes.toString('utf8'));
		const profile = result.runtimeProfile;
		const runnerBytes = await readFile(path.join(fixture.targetDir, 'runner-worker.js'));

		expect(await collectRelativeFiles(fixture.targetDir)).toEqual(expectedPublishedFiles);
		expect(Object.keys(manifest).sort()).toEqual(
			[
				'artifact',
				'assets',
				'build',
				'components',
				'fingerprint',
				'format',
				'license',
				'licenseExpression',
				'metadata',
				'profileId',
				'runtime',
				'storage'
			].sort()
		);
		expect(manifest).toMatchObject({
			format: PASCAL_MANIFEST_FORMAT,
			runtime: 'pas2js',
			profileId,
			artifact: expectedArtifact(),
			components: expectedComponents(),
			build: expectedBuild(),
			license: expectedLicense()
		});
		expect(manifest.assets.map(({ path: assetPath }: { path: string }) => assetPath)).toEqual([
			'compiler.js',
			'rtl.js',
			'system.pas'
		]);
		expect(manifest.storage.map(({ path: assetPath }: { path: string }) => assetPath)).toEqual([
			'compiler.js.gz.bin',
			'rtl.js.bin',
			'system.pas.bin'
		]);
		expect(manifest.fingerprint).toBe(computePascalRuntimeFingerprint(manifest));
		expect(profile).toEqual({
			profileId,
			artifactRevision,
			pas2jsVersion: '3.2.1',
			pas2jsRevision,
			manifestFingerprint: manifest.fingerprint,
			manifestReceipt: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
			compilerJavaScriptReceipt: expect.objectContaining({
				uncompressedBytes: fixture.compilerJavaScript.byteLength,
				uncompressedSha256: sha256(fixture.compilerJavaScript)
			}),
			rtlJavaScriptReceipt: {
				bytes: fixture.rtlJavaScript.byteLength,
				sha256: sha256(fixture.rtlJavaScript)
			},
			systemPascalReceipt: {
				bytes: fixture.systemPascal.byteLength,
				sha256: sha256(fixture.systemPascal)
			}
		});
		expect(result.runnerReceipt).toEqual({
			bytes: runnerBytes.byteLength,
			sha256: sha256(runnerBytes)
		});
		const runnerSource = runnerBytes.toString('utf8');
		for (const value of [
			profileId,
			artifactRevision,
			'3.2.1',
			pas2jsRevision,
			manifest.fingerprint
		]) {
			expect(runnerSource).toContain(value);
		}
		expect(runnerSource).not.toContain('__WASM_IDLE_PASCAL_');
		expect(await readFile(path.join(fixture.targetDir, 'compiler.js.gz.bin'))).toEqual(
			await readFile(path.join(fixture.targetDir, 'compiler.js.gz'))
		);
		expect(await readFile(path.join(fixture.targetDir, 'rtl.js.bin'))).toEqual(
			await readFile(path.join(fixture.targetDir, 'rtl.js'))
		);
		expect(await readFile(path.join(fixture.targetDir, 'system.pas.bin'))).toEqual(
			await readFile(path.join(fixture.targetDir, 'system.pas'))
		);
		expect(
			gunzipSync(await readFile(path.join(fixture.targetDir, 'compiler.js.gz.bin')))
		).toEqual(Buffer.from(fixture.compilerJavaScript));
		const appSource = await readFile(fixture.versionModulePath, 'utf8');
		const lspSource = await readFile(fixture.lspVersionModulePath, 'utf8');
		expect(appSource).toContain('WASM_PASCAL_RUNTIME_PROFILE');
		expect(appSource).toContain('WASM_PASCAL_RUNTIME_BUNDLE');
		expect(appSource).toContain(
			'export const WASM_PASCAL_ASSET_VERSION = WASM_PASCAL_RUNTIME_PROFILE.manifestFingerprint;'
		);
		expect(lspSource).toContain('BUNDLED_PASCAL_RUNTIME_PROFILE');
		expect(lspSource).toContain('BUNDLED_PASCAL_RUNTIME_BUNDLE');
	});

	it('rejects source, lock-shape, and recorded-revision drift', async () => {
		const sourceDrift = await createFixture();
		await writeFile(path.join(sourceDrift.sourceDir, 'rtl.js'), 'tampered');
		await expect(syncWasmPascalAssets(sourceDrift)).rejects.toThrow(
			'wasm-pascal rtl.js does not match the input lock'
		);

		const extraLockKey = await createFixture();
		await writeFile(
			extraLockKey.lockFilePath,
			`${JSON.stringify({ ...extraLockKey.lock, unexpected: true }, null, 2)}\n`
		);
		await expect(syncWasmPascalAssets(extraLockKey)).rejects.toThrow(
			'wasm-pascal input lock has an invalid root shape'
		);

		const revisionDrift = await createFixture();
		const lock = structuredClone(revisionDrift.lock);
		lock.components.pas2js.revision = `${pas2jsRevision}00`;
		await writeFile(revisionDrift.lockFilePath, `${JSON.stringify(lock, null, 2)}\n`);
		await expect(syncWasmPascalAssets(revisionDrift)).rejects.toThrow(
			'wasm-pascal input lock has invalid provenance metadata'
		);
	});

	it('is deterministic across repeated syncs', async () => {
		const fixture = await createFixture();
		const first = await syncWasmPascalAssets(fixture);
		const firstTree = await treeReceipt(fixture.targetDir);
		const firstApp = await readFile(fixture.versionModulePath, 'utf8');
		const firstLsp = await readFile(fixture.lspVersionModulePath, 'utf8');
		const second = await syncWasmPascalAssets(fixture);

		expect(await treeReceipt(fixture.targetDir)).toBe(firstTree);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(firstApp);
		expect(await readFile(fixture.lspVersionModulePath, 'utf8')).toBe(firstLsp);
		expect(second.runtimeProfile).toEqual(first.runtimeProfile);
	});

	it('rolls all three outputs back when the final publication fails', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'previous.txt'), 'previous runtime');
		await writeFile(fixture.versionModulePath, 'previous app\n');
		await writeFile(fixture.lspVersionModulePath, 'previous lsp\n');

		await expect(
			syncWasmPascalAssets({
				...fixture,
				renamePath: async (sourcePath: string, targetPath: string) => {
					if (
						targetPath === fixture.lspVersionModulePath &&
						sourcePath.includes('.next-')
					) {
						throw new Error('injected LSP publication failure');
					}
					await rename(sourcePath, targetPath);
				}
			})
		).rejects.toThrow('injected LSP publication failure');

		expect(await collectRelativeFiles(fixture.targetDir)).toEqual(['previous.txt']);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('previous app\n');
		expect(await readFile(fixture.lspVersionModulePath, 'utf8')).toBe('previous lsp\n');
	});

	it('recomputes the checked-in profile, canonical aliases, and runner receipt', async () => {
		const manifestBytes = await readFile(
			path.join(repositoryRoot, 'static/wasm-pascal/runtime-manifest.v2.json')
		);
		const manifest = JSON.parse(manifestBytes.toString('utf8'));
		const runnerBytes = await readFile(
			path.join(repositoryRoot, 'static/wasm-pascal/runner-worker.js')
		);
		const compilerStorage = await readFile(
			path.join(repositoryRoot, 'static/wasm-pascal/compiler.js.gz.bin')
		);
		const rtlBytes = await readFile(path.join(repositoryRoot, 'static/wasm-pascal/rtl.js.bin'));
		const systemBytes = await readFile(
			path.join(repositoryRoot, 'static/wasm-pascal/system.pas.bin')
		);

		expect(manifest.fingerprint).toBe(computePascalRuntimeFingerprint(manifest));
		expect(WASM_PASCAL_RUNTIME_PROFILE).toMatchObject({
			profileId,
			artifactRevision,
			pas2jsRevision,
			manifestFingerprint: manifest.fingerprint,
			manifestReceipt: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
			compilerJavaScriptReceipt: {
				bytes: compilerStorage.byteLength,
				sha256: sha256(compilerStorage),
				uncompressedBytes: gunzipSync(compilerStorage).byteLength,
				uncompressedSha256: sha256(gunzipSync(compilerStorage))
			},
			rtlJavaScriptReceipt: { bytes: rtlBytes.byteLength, sha256: sha256(rtlBytes) },
			systemPascalReceipt: { bytes: systemBytes.byteLength, sha256: sha256(systemBytes) }
		});
		expect(WASM_PASCAL_RUNTIME_BUNDLE).toEqual({
			profile: WASM_PASCAL_RUNTIME_PROFILE,
			workerReceipt: { bytes: runnerBytes.byteLength, sha256: sha256(runnerBytes) }
		});
		expect(WASM_PASCAL_ASSET_VERSION).toBe(manifest.fingerprint);
	});
});
