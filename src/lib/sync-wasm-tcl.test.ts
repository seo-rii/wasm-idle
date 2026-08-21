import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { computeTclRuntimeFingerprint, syncWasmTclAssets } from '../../scripts/sync-wasm-tcl.mjs';

const temporaryDirectories: string[] = [];
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

const sourcePaths = [
	'js/require.js',
	'js/tcl/wacl-custom.data',
	'js/tcl/wacl-library.data',
	'js/tcl/wacl.js',
	'js/tcl/wacl.wasm'
] as const;

const sourceGlue = [
	'define("tcl/wacl",function(){',
	'var _wasmbly=(function(url){return new Promise((function(resolve,reject){var wasmXHR=new XMLHttpRequest;wasmXHR.open("GET",url,true);wasmXHR.responseType="arraybuffer";wasmXHR.onload=(function(){resolve(wasmXHR.response)});wasmXHR.onerror=(function(){reject("error "+wasmXHR.status)});wasmXHR.send(null)}))})(_currPath+"wacl.wasm");',
	'var Module;if(typeof Module==="undefined")Module=eval("(function() { try { return Module || {} } catch(e) { return {} } })()");',
	'Module["print"]=(function(txt){console.log("wacl stdout: "+txt)});',
	'Module["printErr"]=(function(txt){console.error("wacl stderr: "+txt)});',
	'delete window.Module;',
	'return {};});\n'
].join('');

interface Fixture {
	root: string;
	sourceDir: string;
	targetDir: string;
	workerSourcePath: string;
	versionModulePath: string;
	lspVersionModulePath: string;
	lockFilePath: string;
	provenanceDir: string;
}

async function createFixture(): Promise<Fixture> {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-tcl-sync-'));
	temporaryDirectories.push(root);
	const sourceDir = path.join(root, 'source');
	const targetDir = path.join(root, 'published', 'wasm-tcl');
	const workerSourcePath = path.join(root, 'inputs', 'runner-worker.js');
	const versionModulePath = path.join(root, 'generated', 'wasmTclVersion.ts');
	const lspVersionModulePath = path.join(root, 'generated', 'bundledTclRuntime.ts');
	const lockFilePath = path.join(root, 'inputs', 'wasm-tcl-assets.lock.json');
	const provenanceDir = path.join(root, 'inputs', 'licenses');
	const sourceBytes = new Map<string, Buffer>([
		['js/require.js', Buffer.from('/* RequireJS fixture */\n')],
		['js/tcl/wacl-custom.data', Buffer.from('custom\n')],
		['js/tcl/wacl-library.data', Buffer.from('library payload\n')],
		['js/tcl/wacl.js', Buffer.from(sourceGlue)],
		['js/tcl/wacl.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])]
	]);
	for (const [relativePath, bytes] of sourceBytes) {
		const target = path.join(sourceDir, relativePath);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, bytes);
	}
	await mkdir(path.dirname(workerSourcePath), { recursive: true });
	await writeFile(
		workerSourcePath,
		"const expectedIdentity = { manifestFingerprint: '__WASM_IDLE_TCL_MANIFEST_FINGERPRINT__' };\nself.onmessage = () => expectedIdentity;\n"
	);
	await mkdir(provenanceDir, { recursive: true });
	const licenseSources = [
		{
			id: 'wacl',
			file: 'WACL.txt',
			spdx: 'BSD-3-Clause',
			bytes: Buffer.from('Wacl license\n')
		},
		{ id: 'tcl', file: 'TCL.txt', spdx: 'TCL', bytes: Buffer.from('Tcl license\n') },
		{
			id: 'requirejs',
			file: 'REQUIREJS.txt',
			spdx: 'MIT',
			bytes: Buffer.from('RequireJS license\n')
		}
	];
	for (const license of licenseSources) {
		await writeFile(path.join(provenanceDir, license.file), license.bytes);
	}
	const officialLock = JSON.parse(
		await readFile(path.resolve('scripts/wasm-tcl-assets.lock.json'), 'utf8')
	) as Record<string, unknown> & {
		artifact: Record<string, unknown>;
		licenses: Array<Record<string, unknown>>;
		archiveEntries: Array<Record<string, unknown>>;
	};
	const lock = {
		...officialLock,
		artifact: {
			...officialLock.artifact,
			size: 1,
			sha256: '0'.repeat(64)
		},
		licenses: licenseSources.map((license) => ({
			id: license.id,
			path: `licenses/${license.file}`,
			spdx: license.spdx,
			sourceUrl: officialLock.licenses.find((candidate) => candidate.id === license.id)
				?.sourceUrl,
			bytes: license.bytes.byteLength,
			sha256: sha256(license.bytes)
		})),
		archiveEntries: sourcePaths.map((relativePath) => {
			const bytes = sourceBytes.get(relativePath)!;
			return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
		})
	};
	await writeFile(lockFilePath, `${JSON.stringify(lock, null, 2)}\n`);
	return {
		root,
		sourceDir,
		targetDir,
		workerSourcePath,
		versionModulePath,
		lspVersionModulePath,
		lockFilePath,
		provenanceDir
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('syncWasmTclAssets', () => {
	it('publishes one deterministic receipt graph and matching app/LSP pins', async () => {
		const fixture = await createFixture();
		const options = { ...fixture };
		const first = await syncWasmTclAssets(options);
		const firstManifestBytes = await readFile(
			path.join(fixture.targetDir, 'runtime-manifest.v2.json')
		);
		const firstManifest = JSON.parse(firstManifestBytes.toString('utf8'));
		const firstStorage = await Promise.all(
			firstManifest.storage.map(async ({ path: assetPath }: { path: string }) => [
				assetPath,
				await readFile(path.join(fixture.targetDir, assetPath))
			])
		);
		const firstAppPin = await readFile(fixture.versionModulePath, 'utf8');
		const firstLspPin = await readFile(fixture.lspVersionModulePath, 'utf8');

		const second = await syncWasmTclAssets(options);
		expect(second.fingerprint).toBe(first.fingerprint);
		expect(second.runtimeProfile).toEqual(first.runtimeProfile);
		expect(await readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'))).toEqual(
			firstManifestBytes
		);
		for (const [assetPath, bytes] of firstStorage) {
			expect(await readFile(path.join(fixture.targetDir, assetPath as string))).toEqual(
				bytes
			);
		}
		expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
		expect(computeTclRuntimeFingerprint(firstManifest)).toBe(first.fingerprint);
		expect(firstManifest.assets).toHaveLength(5);
		expect(firstManifest.storage).toHaveLength(5);
		expect(firstManifest.licenses).toHaveLength(3);
		const libraryCanonical = await readFile(
			path.join(fixture.targetDir, 'tcl/wacl-library.data.gz.bin')
		);
		const wasmCanonical = await readFile(path.join(fixture.targetDir, 'tcl/wacl.wasm.gz.bin'));
		const customCanonical = await readFile(
			path.join(fixture.targetDir, 'tcl/wacl-custom.data.bin')
		);
		expect(gunzipSync(libraryCanonical)).toEqual(
			await readFile(path.join(fixture.sourceDir, 'js/tcl/wacl-library.data'))
		);
		expect(gunzipSync(wasmCanonical)).toEqual(
			await readFile(path.join(fixture.sourceDir, 'js/tcl/wacl.wasm'))
		);
		expect(await readFile(path.join(fixture.targetDir, 'tcl/wacl-library.data.gz'))).toEqual(
			libraryCanonical
		);
		expect(await readFile(path.join(fixture.targetDir, 'tcl/wacl.wasm.gz'))).toEqual(
			wasmCanonical
		);
		expect(customCanonical).toEqual(
			await readFile(path.join(fixture.sourceDir, 'js/tcl/wacl-custom.data'))
		);
		expect(await readFile(path.join(fixture.targetDir, 'tcl/wacl-custom.data'))).toEqual(
			customCanonical
		);
		const appPin = await readFile(fixture.versionModulePath, 'utf8');
		const lspPin = await readFile(fixture.lspVersionModulePath, 'utf8');
		expect(appPin).toBe(firstAppPin);
		expect(lspPin).toBe(firstLspPin);
		expect(appPin).toContain('export const WASM_TCL_RUNTIME_PROFILE =');
		expect(appPin).toContain('WASM_TCL_RUNTIME_PROFILE.manifestFingerprint');
		expect(lspPin).toContain('export const BUNDLED_TCL_RUNTIME_PROFILE =');
		expect(lspPin).toContain('BUNDLED_TCL_RUNTIME_PROFILE.manifestFingerprint');
		expect(appPin).toContain(first.fingerprint);
		expect(lspPin).toContain(first.fingerprint);
		expect(appPin).toContain(first.workerReceipt.sha256);
		expect(lspPin).toContain(first.workerReceipt.sha256);
		expect(appPin).toContain('export const WASM_TCL_RUNTIME_BUNDLE =');
		expect(lspPin).toContain('export const BUNDLED_TCL_RUNTIME_BUNDLE =');
		expect(await readFile(path.join(fixture.targetDir, 'runner-worker.js'), 'utf8')).toContain(
			`manifestFingerprint: '${first.fingerprint}'`
		);
		const logicalReceipt = (logicalPath: string) =>
			firstManifest.assets.find((receipt: { path: string }) => receipt.path === logicalPath)!;
		expect(first.runtimeProfile).toEqual({
			profileId: firstManifest.profileId,
			artifactRevision: firstManifest.artifact.revision,
			waclRevision: firstManifest.components.wacl.revision,
			tclRevision: firstManifest.components.tcl.revision,
			requireJsRevision: firstManifest.components.requirejs.revision,
			emscriptenRevision: firstManifest.components.emscripten.revision,
			manifestFingerprint: first.fingerprint,
			manifestReceipt: {
				bytes: firstManifestBytes.byteLength,
				sha256: sha256(firstManifestBytes)
			},
			requireJsReceipt: {
				bytes: logicalReceipt('require.js').size,
				sha256: logicalReceipt('require.js').sha256
			},
			customDataReceipt: {
				bytes: logicalReceipt('tcl/wacl-custom.data').size,
				sha256: logicalReceipt('tcl/wacl-custom.data').sha256
			},
			libraryDataReceipt: {
				bytes: libraryCanonical.byteLength,
				sha256: sha256(libraryCanonical),
				uncompressedBytes: gunzipSync(libraryCanonical).byteLength,
				uncompressedSha256: sha256(gunzipSync(libraryCanonical))
			},
			glueReceipt: {
				bytes: logicalReceipt('tcl/wacl.js').size,
				sha256: logicalReceipt('tcl/wacl.js').sha256
			},
			wasmReceipt: {
				bytes: wasmCanonical.byteLength,
				sha256: sha256(wasmCanonical),
				uncompressedBytes: gunzipSync(wasmCanonical).byteLength,
				uncompressedSha256: sha256(gunzipSync(wasmCanonical))
			}
		});
		expect((await readdir(fixture.targetDir)).sort()).toEqual([
			'licenses',
			'require.js',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json',
			'tcl'
		]);
		expect((await readdir(path.join(fixture.targetDir, 'tcl'))).sort()).toEqual([
			'wacl-custom.data',
			'wacl-custom.data.bin',
			'wacl-library.data.gz',
			'wacl-library.data.gz.bin',
			'wacl.js',
			'wacl.wasm.gz',
			'wacl.wasm.gz.bin'
		]);
		expect(firstManifest.storage.map((receipt: { path: string }) => receipt.path)).toEqual([
			'require.js',
			'tcl/wacl-custom.data.bin',
			'tcl/wacl-library.data.gz.bin',
			'tcl/wacl.js',
			'tcl/wacl.wasm.gz.bin'
		]);
	});

	it.each([
		[
			'an extra root key',
			(lock: any) => {
				lock.untrusted = true;
			},
			'invalid provenance metadata'
		],
		[
			'an extra artifact key',
			(lock: any) => {
				lock.artifact.untrusted = true;
			},
			'invalid provenance metadata'
		],
		[
			'a missing component',
			(lock: any) => {
				delete lock.components.tcl;
			},
			'invalid provenance metadata'
		],
		[
			'an extra component key',
			(lock: any) => {
				lock.components.wacl.untrusted = true;
			},
			'invalid provenance metadata'
		],
		[
			'an incomplete patch set',
			(lock: any) => {
				lock.patches.pop();
			},
			'complete glue patch set'
		],
		[
			'a duplicate component license',
			(lock: any) => {
				lock.licenses[1].id = lock.licenses[0].id;
			},
			'invalid license metadata'
		],
		[
			'a non-HTTPS license source',
			(lock: any) => {
				lock.licenses[0].sourceUrl = 'http://example.test/license';
			},
			'invalid license source URL metadata'
		],
		[
			'an unpinned HTTPS license source',
			(lock: any) => {
				lock.licenses[0].sourceUrl = 'https://example.test/license';
			},
			'invalid license metadata'
		],
		[
			'an extra archive receipt key',
			(lock: any) => {
				lock.archiveEntries[0].untrusted = true;
			},
			'invalid or duplicate archive entry'
		]
	] as const)('rejects %s in the exact producer lock schema', async (_label, mutate, error) => {
		const fixture = await createFixture();
		const lock = JSON.parse(await readFile(fixture.lockFilePath, 'utf8'));
		mutate(lock);
		await writeFile(fixture.lockFilePath, `${JSON.stringify(lock, null, 2)}\n`);

		await expect(syncWasmTclAssets(fixture)).rejects.toThrow(error);
	});

	it('rejects source drift without replacing the published generation', async () => {
		const fixture = await createFixture();
		await syncWasmTclAssets(fixture);
		const manifestBefore = await readFile(
			path.join(fixture.targetDir, 'runtime-manifest.v2.json')
		);
		await writeFile(path.join(fixture.sourceDir, 'js/tcl/wacl.wasm'), 'corrupt');
		await expect(syncWasmTclAssets(fixture)).rejects.toThrow('does not match the input lock');
		expect(await readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'))).toEqual(
			manifestBefore
		);
	});

	it('rejects a realpath input/output overlap before touching the source', async () => {
		const fixture = await createFixture();
		const sentinel = await readFile(path.join(fixture.sourceDir, 'js/require.js'));
		await expect(
			syncWasmTclAssets({ ...fixture, targetDir: path.join(fixture.sourceDir, 'published') })
		).rejects.toThrow('must not overlap their inputs');
		expect(await readFile(path.join(fixture.sourceDir, 'js/require.js'))).toEqual(sentinel);
	});

	it('rolls all three outputs back when the final publication rename fails', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await mkdir(path.dirname(fixture.versionModulePath), { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'sentinel.txt'), 'runtime-old');
		await writeFile(fixture.versionModulePath, 'app-old');
		await writeFile(fixture.lspVersionModulePath, 'lsp-old');
		let calls = 0;
		await expect(
			syncWasmTclAssets({
				...fixture,
				renamePath: async (sourcePath, targetPath) => {
					calls += 1;
					if (calls === 6) throw new Error('injected LSP publication failure');
					await rename(sourcePath, targetPath);
				}
			})
		).rejects.toThrow('injected LSP publication failure');
		expect(await readFile(path.join(fixture.targetDir, 'sentinel.txt'), 'utf8')).toBe(
			'runtime-old'
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('app-old');
		expect(await readFile(fixture.lspVersionModulePath, 'utf8')).toBe('lsp-old');
	});
});
