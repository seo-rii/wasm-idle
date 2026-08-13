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
	await writeFile(workerSourcePath, 'self.onmessage = () => undefined;\n');
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
			sourceUrl: `https://example.test/${license.file}`,
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

		const second = await syncWasmTclAssets(options);
		expect(second.fingerprint).toBe(first.fingerprint);
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
		expect(
			gunzipSync(await readFile(path.join(fixture.targetDir, 'tcl/wacl-library.data.gz')))
		).toEqual(await readFile(path.join(fixture.sourceDir, 'js/tcl/wacl-library.data')));
		expect(await readFile(path.join(fixture.targetDir, 'tcl/wacl-custom.data'))).toEqual(
			await readFile(path.join(fixture.sourceDir, 'js/tcl/wacl-custom.data'))
		);
		const appPin = await readFile(fixture.versionModulePath, 'utf8');
		const lspPin = await readFile(fixture.lspVersionModulePath, 'utf8');
		expect(appPin).toContain(first.fingerprint);
		expect(lspPin).toContain(first.fingerprint);
		expect(appPin).toContain(first.workerReceipt.sha256);
		expect(lspPin).toContain(first.workerReceipt.sha256);
		expect((await readdir(fixture.targetDir)).sort()).toEqual([
			'licenses',
			'require.js',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json',
			'tcl'
		]);
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
