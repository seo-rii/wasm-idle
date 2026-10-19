import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { D_PRODUCER_ARTIFACTS } from '../scripts/prepare-runtime.mjs';

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Create an explicit test pin; the production CLI always uses the checked-in lock. */
export async function writeProducerReceipt(sourceDir: string) {
	const artifacts = await Promise.all(
		D_PRODUCER_ARTIFACTS.map(async (assetPath) => {
			const bytes = await readFile(path.join(sourceDir, assetPath));
			const logical = assetPath.endsWith('.gz') ? gunzipSync(bytes) : undefined;
			return {
				path: assetPath,
				bytes: bytes.length,
				sha256: sha256(bytes),
				...(logical
					? { uncompressedBytes: logical.length, uncompressedSha256: sha256(logical) }
					: {})
			};
		})
	);
	const receipt = {
		schemaVersion: 1,
		format: 'wasm-llvm-d-browser-artifacts-v1',
		producerId: 'wasm-llvm/d-browser',
		manifestSha256: 'a'.repeat(64),
		sourceLockSha256: 'b'.repeat(64),
		artifacts
	};
	const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
	await writeFile(path.join(sourceDir, 'producer-receipt.json'), bytes);
	return {
		schemaVersion: 1,
		producerId: receipt.producerId,
		manifestSha256: receipt.manifestSha256,
		sourceLockSha256: receipt.sourceLockSha256,
		receiptSha256: sha256(bytes)
	};
}
