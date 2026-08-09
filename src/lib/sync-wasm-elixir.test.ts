import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { STATIC_RUNTIME_MIN_COMPRESS_BYTES } from '../../scripts/compress-static-runtime-assets.mjs';
import { syncWasmElixirDist, WASM_ELIXIR_ASSET_FILES } from '../../scripts/sync-wasm-elixir.mjs';

const tempDirs: string[] = [];

function sha256(bytes: Buffer | Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-elixir-'));
	tempDirs.push(root);
	const sourceDir = path.join(root, 'source');
	const popcornDistDir = path.join(root, 'popcorn');
	const targetDir = path.join(root, 'static', 'wasm-elixir');
	const versionModulePath = path.join(root, 'src', 'wasmElixirVersion.ts');
	const lspIntegrityModulePath = path.join(root, 'lsp', 'bundledElixirRuntimeIntegrity.ts');
	await mkdir(sourceDir, { recursive: true });
	await mkdir(popcornDistDir, { recursive: true });
	const assets = {
		'bundle.avm': Buffer.alloc(STATIC_RUNTIME_MIN_COMPRESS_BYTES + 3, 0x11),
		'AtomVM.mjs': Buffer.alloc(STATIC_RUNTIME_MIN_COMPRESS_BYTES + 5, 0x22),
		'AtomVM.wasm': Buffer.alloc(STATIC_RUNTIME_MIN_COMPRESS_BYTES + 7, 0x33)
	};
	await writeFile(path.join(sourceDir, 'bundle.avm'), assets['bundle.avm']);
	await writeFile(path.join(popcornDistDir, 'AtomVM.mjs'), assets['AtomVM.mjs']);
	await writeFile(path.join(popcornDistDir, 'AtomVM.wasm'), assets['AtomVM.wasm']);
	return {
		root,
		sourceDir,
		popcornDistDir,
		targetDir,
		versionModulePath,
		lspIntegrityModulePath,
		assets
	};
}

describe('syncWasmElixirDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('publishes one deterministic receipt graph to the runtime and both consumers', async () => {
		const fixture = await createFixture();
		const first = await syncWasmElixirDist(fixture);
		const expectedReceipts = Object.fromEntries(
			WASM_ELIXIR_ASSET_FILES.map((fileName) => {
				const logical = fixture.assets[fileName as keyof typeof fixture.assets];
				const delivery = gzipSync(logical, { level: 9 });
				return [
					fileName,
					{
						bytes: delivery.byteLength,
						sha256: sha256(delivery),
						uncompressedBytes: logical.byteLength,
						uncompressedSha256: sha256(logical)
					}
				];
			})
		);
		const fingerprintHash = createHash('sha256');
		fingerprintHash.update('wasm-elixir-asset-receipts-v1\0');
		for (const fileName of WASM_ELIXIR_ASSET_FILES) {
			const receipt = expectedReceipts[fileName];
			fingerprintHash.update(fileName);
			fingerprintHash.update('\0');
			fingerprintHash.update(String(receipt.bytes));
			fingerprintHash.update('\0');
			fingerprintHash.update(receipt.sha256);
			fingerprintHash.update('\0');
			fingerprintHash.update(String(receipt.uncompressedBytes));
			fingerprintHash.update('\0');
			fingerprintHash.update(receipt.uncompressedSha256);
			fingerprintHash.update('\n');
		}
		const expectedFingerprint = fingerprintHash.digest('hex').slice(0, 16);
		const buildBefore = await readFile(
			path.join(fixture.targetDir, 'runtime-build.json'),
			'utf8'
		);
		const appModuleBefore = await readFile(fixture.versionModulePath, 'utf8');
		const lspModuleBefore = await readFile(fixture.lspIntegrityModulePath, 'utf8');

		expect(first.fingerprint).toBe(expectedFingerprint);
		expect(first.receipts).toEqual(expectedReceipts);
		expect(JSON.parse(buildBefore)).toEqual({
			schemaVersion: 1,
			fingerprint: expectedFingerprint,
			assets: expectedReceipts
		});
		expect((await readdir(fixture.targetDir)).sort()).toEqual(
			[...WASM_ELIXIR_ASSET_FILES, 'runtime-build.json'].sort()
		);
		expect(appModuleBefore).toContain(
			`export const WASM_ELIXIR_ASSET_VERSION = '${expectedFingerprint}'`
		);
		expect(appModuleBefore).toContain(
			`uncompressedSha256: '${expectedReceipts['AtomVM.mjs'].uncompressedSha256}'`
		);
		expect(lspModuleBefore).toContain(
			`export const BUNDLED_ELIXIR_ASSET_VERSION = '${expectedFingerprint}'`
		);

		const second = await syncWasmElixirDist(fixture);
		expect(second.fingerprint).toBe(first.fingerprint);
		expect(await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')).toBe(
			buildBefore
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(appModuleBefore);
		expect(await readFile(fixture.lspIntegrityModulePath, 'utf8')).toBe(lspModuleBefore);
	});

	it('derives receipts from the installed snapshot instead of a later source mutation', async () => {
		const fixture = await createFixture();
		const installedBundle = Buffer.from(fixture.assets['bundle.avm']);
		let mutated = false;
		const result = await syncWasmElixirDist({
			...fixture,
			copyAsset: async (source, destination, options) => {
				await cp(source, destination, options);
				if (mutated || path.basename(String(source)) !== 'bundle.avm') return;
				mutated = true;
				await writeFile(path.join(fixture.sourceDir, 'bundle.avm'), Buffer.alloc(1, 0xff));
			}
		});

		expect(mutated).toBe(true);
		expect(await readFile(path.join(fixture.targetDir, 'bundle.avm'))).toEqual(installedBundle);
		expect(result.receipts?.['bundle.avm'].uncompressedSha256).toBe(sha256(installedBundle));
	});

	it('restores the runtime and both generated modules when the final swap fails', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'existing.txt'), 'existing runtime');
		await mkdir(path.dirname(fixture.versionModulePath), { recursive: true });
		await mkdir(path.dirname(fixture.lspIntegrityModulePath), { recursive: true });
		await writeFile(fixture.versionModulePath, 'existing app module');
		await writeFile(fixture.lspIntegrityModulePath, 'existing lsp module');

		await expect(
			syncWasmElixirDist({
				...fixture,
				renamePath: async (source, destination) => {
					if (String(source).startsWith(`${fixture.lspIntegrityModulePath}.next-`)) {
						throw new Error('injected LSP module swap failure');
					}
					await rename(source, destination);
				}
			})
		).rejects.toThrow('injected LSP module swap failure');

		await expect(readFile(path.join(fixture.targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing runtime'
		);
		await expect(readFile(fixture.versionModulePath, 'utf8')).resolves.toBe(
			'existing app module'
		);
		await expect(readFile(fixture.lspIntegrityModulePath, 'utf8')).resolves.toBe(
			'existing lsp module'
		);
		for (const parentDirectory of [
			path.dirname(fixture.targetDir),
			path.dirname(fixture.versionModulePath),
			path.dirname(fixture.lspIntegrityModulePath)
		]) {
			expect(
				(await readdir(parentDirectory)).filter(
					(entry) => entry.includes('.next-') || entry.includes('.previous-')
				)
			).toEqual([]);
		}
	});

	it('rejects assets below the compression boundary before replacing the installation', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'existing.txt'), 'existing runtime');
		await writeFile(path.join(fixture.popcornDistDir, 'AtomVM.mjs'), Buffer.alloc(8, 0x44));

		await expect(syncWasmElixirDist(fixture)).rejects.toThrow(
			`AtomVM.mjs must be at least ${STATIC_RUNTIME_MIN_COMPRESS_BYTES} bytes`
		);
		await expect(readFile(path.join(fixture.targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing runtime'
		);
	});
});
