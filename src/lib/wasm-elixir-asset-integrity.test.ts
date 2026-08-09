import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
	BUNDLED_ELIXIR_ASSET_RECEIPTS,
	BUNDLED_ELIXIR_ASSET_VERSION
} from '../../packages/lsp/src/bundledElixirRuntimeIntegrity';
import { WASM_ELIXIR_ASSET_FILES } from '../../scripts/sync-wasm-elixir.mjs';
import {
	WASM_ELIXIR_ASSET_RECEIPTS,
	WASM_ELIXIR_ASSET_VERSION
} from './playground/wasmElixirVersion';

describe('checked-in wasm-elixir asset receipts', () => {
	it('pins the deployed bytes, build receipt, app, and LSP to one fingerprint', async () => {
		const runtimeDir = path.resolve('static', 'wasm-elixir');
		const actualReceipts: Record<
			string,
			{
				bytes: number;
				sha256: string;
				uncompressedBytes: number;
				uncompressedSha256: string;
			}
		> = {};

		for (const fileName of WASM_ELIXIR_ASSET_FILES) {
			const gzipPath = path.join(runtimeDir, `${fileName}.gz`);
			const compressed = await readFile(gzipPath).catch((error: NodeJS.ErrnoException) => {
				if (error.code === 'ENOENT') return null;
				throw error;
			});
			const logical = compressed
				? gunzipSync(compressed)
				: await readFile(path.join(runtimeDir, fileName));
			const delivery = compressed || gzipSync(logical, { level: 9 });
			actualReceipts[fileName] = {
				bytes: delivery.byteLength,
				sha256: createHash('sha256').update(delivery).digest('hex'),
				uncompressedBytes: logical.byteLength,
				uncompressedSha256: createHash('sha256').update(logical).digest('hex')
			};
		}

		const runtimeBuild = JSON.parse(
			await readFile(path.join(runtimeDir, 'runtime-build.json'), 'utf8')
		) as {
			schemaVersion: number;
			fingerprint: string;
			assets: typeof actualReceipts;
		};
		const fingerprintHash = createHash('sha256');
		fingerprintHash.update('wasm-elixir-asset-receipts-v1\0');
		for (const fileName of WASM_ELIXIR_ASSET_FILES) {
			const receipt = actualReceipts[fileName];
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
		const fingerprint = fingerprintHash.digest('hex').slice(0, 16);

		expect(runtimeBuild).toEqual({
			schemaVersion: 1,
			fingerprint,
			assets: actualReceipts
		});
		expect(WASM_ELIXIR_ASSET_RECEIPTS).toEqual(actualReceipts);
		expect(BUNDLED_ELIXIR_ASSET_RECEIPTS).toEqual(actualReceipts);
		expect(WASM_ELIXIR_ASSET_VERSION).toBe(fingerprint);
		expect(BUNDLED_ELIXIR_ASSET_VERSION).toBe(fingerprint);
	});
});
