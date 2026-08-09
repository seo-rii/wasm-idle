import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	BUNDLED_D_INTEGRITY_VERSION,
	BUNDLED_D_OUTER_ASSET_RECEIPTS
} from '../../packages/lsp/src/bundledDRuntimeIntegrity';
import { WASM_D_INTEGRITY_VERSION, WASM_D_OUTER_ASSET_RECEIPTS } from './playground/wasmDIntegrity';

type Integrity = {
	bytes: number;
	sha256: string;
	uncompressedBytes: number;
	uncompressedSha256: string;
};

type Asset = {
	asset: string;
	compression?: 'gzip';
	integrity: Integrity;
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('checked-in wasm-d asset integrity', () => {
	it('can evaluate the verified runtime module from a non-hierarchical URL', async () => {
		const source = await readFile(path.resolve('static/wasm-d/index.js'));
		const module = await import(`data:text/javascript;base64,${source.toString('base64')}`);

		expect(module.createDCompiler).toBeTypeOf('function');
		expect(module.executeBrowserDArtifact).toBeTypeOf('function');
	});

	it('pins the app and LSP bootstrap trust roots to the checked-in bytes', async () => {
		const receiptEntries = await Promise.all(
			[
				['index.js', path.resolve('static/wasm-d/index.js')],
				[
					'runtime/runtime-manifest.v1.json',
					path.resolve('static/wasm-d/runtime/runtime-manifest.v1.json')
				]
			].map(async ([asset, filePath]) => {
				const bytes = await readFile(filePath);
				return [
					asset,
					{
						bytes: bytes.byteLength,
						sha256: sha256(bytes),
						uncompressedBytes: bytes.byteLength,
						uncompressedSha256: sha256(bytes)
					}
				] as const;
			})
		);
		const receipts = Object.fromEntries(receiptEntries);
		const version = sha256(
			Buffer.from(
				receiptEntries
					.map(([asset, receipt]) => `${asset}\0${receipt.bytes}\0${receipt.sha256}\n`)
					.join(''),
				'utf8'
			)
		).slice(0, 16);

		expect(WASM_D_OUTER_ASSET_RECEIPTS).toEqual(receipts);
		expect(BUNDLED_D_OUTER_ASSET_RECEIPTS).toEqual(receipts);
		expect(WASM_D_INTEGRITY_VERSION).toBe(version);
		expect(BUNDLED_D_INTEGRITY_VERSION).toBe(version);
	});

	it('pins every compiler asset at delivery and runtime stages', async () => {
		const runtimeDir = path.resolve('static/wasm-d/runtime');
		const manifestPath = path.join(runtimeDir, 'runtime-manifest.v1.json');
		const manifestBytes = await readFile(manifestPath);
		const manifest = JSON.parse(manifestBytes.toString('utf8'));
		const assets: Asset[] = [
			manifest.compiler.ldc2,
			manifest.compiler.toolchain,
			manifest.compiler.linker.js,
			manifest.compiler.linker.wasm,
			manifest.compiler.linker.data
		];

		expect(assets).toHaveLength(5);
		for (const asset of assets) {
			const deliveryBytes = await readFile(path.resolve(runtimeDir, asset.asset));
			const runtimeBytes =
				asset.compression === 'gzip'
					? new Uint8Array(gunzipSync(deliveryBytes))
					: new Uint8Array(deliveryBytes);

			expect(asset.integrity, asset.asset).toEqual({
				bytes: deliveryBytes.byteLength,
				sha256: sha256(deliveryBytes),
				uncompressedBytes: runtimeBytes.byteLength,
				uncompressedSha256: sha256(runtimeBytes)
			});
		}

		const build = JSON.parse(
			await readFile(path.join(runtimeDir, 'runtime-build.json'), 'utf8')
		);
		expect(build.manifestSha256).toBe(sha256(manifestBytes));
		for (const receipt of build.assets) {
			const asset = assets.find((candidate) => candidate.asset === receipt.asset);
			expect(asset, receipt.asset).toBeDefined();
			expect(receipt).toMatchObject({
				size: asset!.integrity.bytes,
				sha256: asset!.integrity.sha256,
				uncompressedSize: asset!.integrity.uncompressedBytes,
				uncompressedSha256: asset!.integrity.uncompressedSha256
			});
		}
	});
});
