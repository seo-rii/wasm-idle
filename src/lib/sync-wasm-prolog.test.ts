// @vitest-environment node

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
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
	computePrologRuntimeFingerprint,
	syncWasmPrologAssets
} from '../../scripts/sync-wasm-prolog.mjs';

const temporaryDirectories: string[] = [];

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-prolog-'));
	temporaryDirectories.push(root);
	const packageRoot = path.join(root, 'package');
	const sourceDir = path.join(packageRoot, 'dist', 'swipl');
	const targetDir = path.join(root, 'published', 'wasm-prolog');
	const workerSourcePath = path.join(root, 'worker.js');
	const versionModulePath = path.join(root, 'generated', 'wasmPrologVersion.ts');
	const lspVersionModulePath = path.join(root, 'generated', 'bundledPrologRuntime.ts');
	const lockFilePath = path.join(root, 'wasm-prolog-assets.lock.json');
	await mkdir(sourceDir, { recursive: true });
	const assets = {
		'swipl-web.js': new TextEncoder().encode(
			'var SWIPL=()=>{};/* getPreloadedPackage wasmBinary */\n'
		),
		'swipl-web.wasm': Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0),
		'swipl-web.data': new TextEncoder().encode('fixture-data')
	};
	const license = new TextEncoder().encode('fixture BSD-2-Clause license\n\n');
	await Promise.all([
		...Object.entries(assets).map(([name, bytes]) =>
			writeFile(path.join(sourceDir, name), bytes)
		),
		writeFile(path.join(packageRoot, 'LICENSE.txt'), license),
		writeFile(
			path.join(packageRoot, 'package.json'),
			JSON.stringify({
				name: 'swipl-wasm',
				version: '8.0.1',
				license: 'BSD-2-Clause',
				repository: {
					type: 'git',
					url: 'https://github.com/SWI-Prolog/npm-swipl-wasm.git'
				}
			}),
			'utf8'
		),
		writeFile(workerSourcePath, 'self.onmessage = () => {};\n', 'utf8')
	]);
	await writeFile(
		lockFilePath,
		JSON.stringify({
			schemaVersion: 1,
			profileId: 'swipl-wasm-8.0.1-swipl-10.1.9',
			package: {
				name: 'swipl-wasm',
				version: '8.0.1',
				repository: 'https://github.com/SWI-Prolog/npm-swipl-wasm.git',
				revision: '18fa003833dd4fb2531195063291687255038372',
				tarball: 'https://registry.npmjs.org/swipl-wasm/-/swipl-wasm-8.0.1.tgz',
				integrity:
					'sha512-tP3bSRaMboFRWGD5cfBAGIzu2HH80yqRG+i/YL8BEgQ7xasvJAycwgx0DW16vqqRhUHyFOOPbzX4aXuy9s+b1g=='
			},
			toolchain: {
				swiplVersion: '10.1.9',
				swiplRevision: '6be143dbd030cc9ea621cde719a37f8385575453',
				emsdkVersion: '6.0.0',
				emsdkRevision: 'd223ae73c6998296e3ab27cf81dc2c2c9fd383de',
				zlibVersion: '1.3.2',
				pcre2Version: '10.47',
				pcre2Revision: 'f454e231fe5006dd7ff8f4693fd2b8eb94333429'
			},
			license: {
				path: 'LICENSE.txt',
				spdx: 'BSD-2-Clause',
				bytes: license.byteLength,
				sha256: sha256(license)
			},
			assets: Object.entries(assets).map(([assetPath, bytes]) => ({
				path: assetPath,
				bytes: bytes.byteLength,
				sha256: sha256(bytes)
			}))
		}),
		'utf8'
	);
	return {
		root,
		packageRoot,
		sourceDir,
		targetDir,
		workerSourcePath,
		versionModulePath,
		lspVersionModulePath,
		lockFilePath,
		assets,
		license
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('syncWasmPrologAssets', () => {
	it('publishes one deterministic receipt-backed runtime generation and matching host pins', async () => {
		const fixture = await createFixture();
		const options = {
			packageRoot: fixture.packageRoot,
			sourceDir: fixture.sourceDir,
			targetDir: fixture.targetDir,
			workerSourcePath: fixture.workerSourcePath,
			versionModulePath: fixture.versionModulePath,
			lspVersionModulePath: fixture.lspVersionModulePath,
			lockFilePath: fixture.lockFilePath
		};
		const first = await syncWasmPrologAssets(options);
		const firstFiles = (await readdir(fixture.targetDir)).sort();
		expect(firstFiles).toEqual([
			'LICENSE.txt',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v2.json',
			'swipl-web.data.gz',
			'swipl-web.js',
			'swipl-web.wasm.gz'
		]);
		const manifest = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest.fingerprint).toBe(first.fingerprint);
		expect(computePrologRuntimeFingerprint(manifest)).toBe(first.fingerprint);
		expect(
			gunzipSync(await readFile(path.join(fixture.targetDir, 'swipl-web.wasm.gz')))
		).toEqual(Buffer.from(fixture.assets['swipl-web.wasm']));
		expect(
			gunzipSync(await readFile(path.join(fixture.targetDir, 'swipl-web.data.gz')))
		).toEqual(Buffer.from(fixture.assets['swipl-web.data']));
		expect(await readFile(path.join(fixture.targetDir, 'LICENSE.txt'), 'utf8')).toBe(
			'fixture BSD-2-Clause license\n'
		);
		const appPin = await readFile(fixture.versionModulePath, 'utf8');
		const lspPin = await readFile(fixture.lspVersionModulePath, 'utf8');
		expect(appPin).toContain(first.fingerprint);
		expect(lspPin).toContain(first.fingerprint);
		expect(appPin).toContain(first.workerReceipt.sha256);
		expect(lspPin).toContain(first.workerReceipt.sha256);

		const firstSnapshot = await Promise.all(
			firstFiles.map((name) => readFile(path.join(fixture.targetDir, name)))
		);
		const second = await syncWasmPrologAssets(options);
		expect(second.fingerprint).toBe(first.fingerprint);
		const secondSnapshot = await Promise.all(
			firstFiles.map((name) => readFile(path.join(fixture.targetDir, name)))
		);
		expect(secondSnapshot).toEqual(firstSnapshot);
	});

	it.each(['swipl-web.js', 'swipl-web.wasm', 'swipl-web.data'])(
		'rejects %s drift before replacing an installed generation',
		async (assetPath) => {
			const fixture = await createFixture();
			await mkdir(fixture.targetDir, { recursive: true });
			await writeFile(path.join(fixture.targetDir, 'sentinel'), 'keep', 'utf8');
			await writeFile(path.join(fixture.sourceDir, assetPath), 'changed', 'utf8');
			await expect(
				syncWasmPrologAssets({
					packageRoot: fixture.packageRoot,
					sourceDir: fixture.sourceDir,
					targetDir: fixture.targetDir,
					workerSourcePath: fixture.workerSourcePath,
					versionModulePath: fixture.versionModulePath,
					lspVersionModulePath: fixture.lspVersionModulePath,
					lockFilePath: fixture.lockFilePath
				})
			).rejects.toThrow('does not match the input lock');
			expect(await readFile(path.join(fixture.targetDir, 'sentinel'), 'utf8')).toBe('keep');
		}
	);

	it('rejects package metadata drift before publication', async () => {
		const fixture = await createFixture();
		const packageMetadata = JSON.parse(
			await readFile(path.join(fixture.packageRoot, 'package.json'), 'utf8')
		);
		packageMetadata.version = '8.0.2';
		await writeFile(
			path.join(fixture.packageRoot, 'package.json'),
			JSON.stringify(packageMetadata),
			'utf8'
		);
		await expect(
			syncWasmPrologAssets({
				packageRoot: fixture.packageRoot,
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				workerSourcePath: fixture.workerSourcePath,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				lockFilePath: fixture.lockFilePath
			})
		).rejects.toThrow('package metadata does not match');
	});

	it('rejects license drift before publication', async () => {
		const fixture = await createFixture();
		await writeFile(path.join(fixture.packageRoot, 'LICENSE.txt'), 'changed', 'utf8');
		await expect(
			syncWasmPrologAssets({
				packageRoot: fixture.packageRoot,
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				workerSourcePath: fixture.workerSourcePath,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				lockFilePath: fixture.lockFilePath
			})
		).rejects.toThrow('license does not match');
	});

	it('rejects lexical and realpath-alias overlap with publication inputs', async () => {
		const fixture = await createFixture();
		await expect(
			syncWasmPrologAssets({
				packageRoot: fixture.packageRoot,
				sourceDir: fixture.sourceDir,
				targetDir: fixture.packageRoot,
				workerSourcePath: fixture.workerSourcePath,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				lockFilePath: fixture.lockFilePath
			})
		).rejects.toThrow('must not overlap');

		const alias = path.join(fixture.root, 'source-alias');
		try {
			await symlink(fixture.packageRoot, alias, 'dir');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
			throw error;
		}
		await expect(
			syncWasmPrologAssets({
				packageRoot: fixture.packageRoot,
				sourceDir: fixture.sourceDir,
				targetDir: path.join(alias, 'published'),
				workerSourcePath: fixture.workerSourcePath,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				lockFilePath: fixture.lockFilePath
			})
		).rejects.toThrow('must not overlap');
	});

	it('rolls back the runtime and both generated pins when the final swap fails', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await mkdir(path.dirname(fixture.versionModulePath), { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'old-runtime'), 'old', 'utf8');
		await writeFile(fixture.versionModulePath, 'old app pin\n', 'utf8');
		await writeFile(fixture.lspVersionModulePath, 'old lsp pin\n', 'utf8');
		await expect(
			syncWasmPrologAssets({
				packageRoot: fixture.packageRoot,
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				workerSourcePath: fixture.workerSourcePath,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				lockFilePath: fixture.lockFilePath,
				renamePath: async (sourcePath, targetPath) => {
					if (
						targetPath === fixture.lspVersionModulePath &&
						sourcePath.includes('.staging-')
					) {
						throw new Error('fixture LSP publication failure');
					}
					await rename(sourcePath, targetPath);
				}
			})
		).rejects.toThrow('fixture LSP publication failure');
		expect(await readdir(fixture.targetDir)).toEqual(['old-runtime']);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('old app pin\n');
		expect(await readFile(fixture.lspVersionModulePath, 'utf8')).toBe('old lsp pin\n');
	});

	it('publishes the snapshotted inputs even when source files change during the swap', async () => {
		const fixture = await createFixture();
		let changed = false;
		await syncWasmPrologAssets({
			packageRoot: fixture.packageRoot,
			sourceDir: fixture.sourceDir,
			targetDir: fixture.targetDir,
			workerSourcePath: fixture.workerSourcePath,
			versionModulePath: fixture.versionModulePath,
			lspVersionModulePath: fixture.lspVersionModulePath,
			lockFilePath: fixture.lockFilePath,
			renamePath: async (sourcePath, targetPath) => {
				if (!changed) {
					changed = true;
					await writeFile(
						path.join(fixture.sourceDir, 'swipl-web.js'),
						'replacement',
						'utf8'
					);
				}
				await rename(sourcePath, targetPath);
			}
		});
		expect(await readFile(path.join(fixture.targetDir, 'swipl-web.js'))).toEqual(
			Buffer.from(fixture.assets['swipl-web.js'])
		);
	});
});
