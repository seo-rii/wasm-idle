import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmDDist } from '../../scripts/sync-wasm-d.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-d-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(
	baseDir: string,
	relativePath: string,
	contents: string | Uint8Array = relativePath
) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents);
}

async function writeCompleteRuntimeFixture(
	sourceDir: string,
	linker: { js: string; wasm: string; data: string }
) {
	await writeFixtureFile(sourceDir, 'index.js', 'export const runtime = true;\n');
	await writeFixtureFile(sourceDir, 'runtime/bin/ldc2.wasm.gz', gzipSync('fixture-ldc2'));
	await writeFixtureFile(
		sourceDir,
		'runtime/toolchain/toolchain.tar.gz',
		gzipSync('fixture-toolchain')
	);
	await writeFixtureFile(sourceDir, 'runtime/bin/lld.js', linker.js);
	await writeFixtureFile(sourceDir, 'runtime/bin/lld.wasm.gz', gzipSync(linker.wasm));
	await writeFixtureFile(sourceDir, 'runtime/bin/lld.data.gz', gzipSync(linker.data));
	await writeFixtureFile(
		sourceDir,
		'runtime/runtime-build.json',
		`${JSON.stringify({ profileId: 'd-browser-test', assets: [] })}\n`
	);
	await writeFixtureFile(
		sourceDir,
		'runtime/runtime-manifest.v1.json',
		`${JSON.stringify({
			manifestVersion: 1,
			profileId: 'd-browser-test',
			compiler: {
				ldc2: { asset: 'bin/ldc2.wasm.gz', compression: 'gzip' },
				toolchain: { asset: 'toolchain/toolchain.tar.gz', compression: 'gzip' },
				linker: {
					js: { asset: 'bin/lld.js' },
					wasm: { asset: 'bin/lld.wasm.gz', compression: 'gzip' },
					data: { asset: 'bin/lld.data.gz', compression: 'gzip' }
				}
			}
		})}\n`
	);
}

describe('syncWasmDDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('loads the Emscripten LLD contract from wasm-idle', async () => {
		const source = await readFile(path.resolve('scripts', 'sync-wasm-d.mjs'), 'utf8');

		expect(source).toContain("from './llvm-contracts/emscripten-lld.mjs'");
		expect(source).not.toMatch(/from\s+['"]@seo-rii\/wasm-llvm/u);
	});

	it('uses the canonical shared Emscripten LLD assets', async () => {
		const sourceDir = await makeTempDir();
		const installRoot = await makeTempDir();
		const targetDir = path.join(installRoot, 'wasm-d');
		const sharedLldDir = path.join(installRoot, 'shared', 'emscripten-lld');
		await mkdir(sharedLldDir, { recursive: true });
		const versionModulePath = path.join(await makeTempDir(), 'wasmDVersion.ts');
		const integrityModulePath = path.join(await makeTempDir(), 'wasmDIntegrity.ts');
		const lspIntegrityModulePath = path.join(
			await makeTempDir(),
			'bundledDRuntimeIntegrity.ts'
		);
		await writeCompleteRuntimeFixture(sourceDir, {
			js: 'shared-js   \n',
			wasm: 'shared-wasm',
			data: 'shared-data'
		});
		await writeFixtureFile(sharedLldDir, 'lld.js', 'shared-js\n');
		await writeFixtureFile(sharedLldDir, 'lld.wasm.gz', gzipSync('shared-wasm'));
		await writeFixtureFile(sharedLldDir, 'lld.data.gz', gzipSync('shared-data'));

		await syncWasmDDist({
			sourceDir,
			targetDir,
			versionModulePath,
			integrityModulePath,
			lspIntegrityModulePath,
			sharedLldDir
		});
		await expect(readFile(path.join(sharedLldDir, 'lld.wasm.gz'))).resolves.toEqual(
			gzipSync('shared-wasm')
		);
		await expect(readFile(path.join(sharedLldDir, 'lld.js'), 'utf8')).resolves.toBe(
			'shared-js\n'
		);

		const manifest = await readFile(
			path.join(targetDir, 'runtime/runtime-manifest.v1.json'),
			'utf8'
		);
		expect(manifest).toContain('../../shared/emscripten-lld/lld.wasm.gz');
		expect(manifest).toContain('../../shared/emscripten-lld/lld.data.gz');
		expect(manifest).toContain('../../shared/emscripten-lld/lld.js');
		const runtimeBuild = JSON.parse(
			await readFile(path.join(targetDir, 'runtime/runtime-build.json'), 'utf8')
		) as {
			assets: Array<{ asset: string; sha256: string }>;
			manifestSha256: string;
			sharedLlvmProfiles: Array<{ id: string }>;
		};
		expect(runtimeBuild.assets.map((asset) => asset.asset)).toEqual([
			'bin/ldc2.wasm.gz',
			'toolchain/toolchain.tar.gz',
			'../../shared/emscripten-lld/lld.js',
			'../../shared/emscripten-lld/lld.wasm.gz',
			'../../shared/emscripten-lld/lld.data.gz'
		]);
		expect(runtimeBuild.assets.find((asset) => asset.asset.endsWith('/lld.js'))?.sha256).toBe(
			createHash('sha256').update('shared-js\n').digest('hex')
		);
		expect(runtimeBuild.manifestSha256).toBe(
			createHash('sha256').update(manifest).digest('hex')
		);
		expect(runtimeBuild.sharedLlvmProfiles).toEqual([
			expect.objectContaining({ id: 'emscripten-lld' })
		]);
		expect(await readFile(integrityModulePath, 'utf8')).toContain(
			'export const WASM_D_OUTER_ASSET_RECEIPTS'
		);
		expect(await readFile(lspIntegrityModulePath, 'utf8')).toContain(
			'export const BUNDLED_D_OUTER_ASSET_RECEIPTS'
		);
		await expect(readFile(path.join(targetDir, 'runtime/bin/lld.js'))).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'runtime/bin/lld.wasm.gz'))).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'runtime/bin/lld.data.gz'))).rejects.toThrow();
	});

	it('rejects a linker that differs from the canonical shared asset', async () => {
		const sourceDir = await makeTempDir();
		const installRoot = await makeTempDir();
		const targetDir = path.join(installRoot, 'wasm-d');
		const sharedLldDir = path.join(installRoot, 'shared', 'emscripten-lld');
		const canonicalLldDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmDVersion.ts');
		const integrityModulePath = path.join(await makeTempDir(), 'wasmDIntegrity.ts');
		const lspIntegrityModulePath = path.join(
			await makeTempDir(),
			'bundledDRuntimeIntegrity.ts'
		);
		await writeCompleteRuntimeFixture(sourceDir, {
			js: 'shared-js',
			wasm: 'different',
			data: 'shared-data'
		});
		await writeFixtureFile(canonicalLldDir, 'lld.js', 'shared-js');
		await writeFixtureFile(canonicalLldDir, 'lld.wasm.gz', gzipSync('shared-wasm'));
		await writeFixtureFile(canonicalLldDir, 'lld.data.gz', gzipSync('shared-data'));

		await expect(
			syncWasmDDist({
				sourceDir,
				targetDir,
				versionModulePath,
				integrityModulePath,
				lspIntegrityModulePath,
				sharedLldDir,
				canonicalLldDir
			})
		).rejects.toThrow('differs from the canonical asset');
	});
});
