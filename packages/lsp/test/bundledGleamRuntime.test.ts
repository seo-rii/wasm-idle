import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { BUNDLED_GLEAM_MANIFEST_FINGERPRINT } from '../src/bundledGleamRuntime.js';

interface GleamAssetReceipt {
	path: string;
	size: number;
	sha256: string;
}

describe('bundled Gleam runtime identity', () => {
	it('pins the canonical v2 manifest receipt graph', async () => {
		const manifest = JSON.parse(
			await readFile(
				new URL('../../../static/wasm-gleam/source-manifest.v2.json', import.meta.url),
				'utf8'
			)
		) as {
			format: string;
			compilerVersion: string;
			fingerprint: string;
			assets: GleamAssetReceipt[];
		};
		const assets = [...manifest.assets].sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0
		);
		const canonical = `wasm-idle:gleam-runtime-manifest:v2\nformat\0${manifest.format}\ncompilerVersion\0${manifest.compilerVersion}\n${assets
			.map((receipt) => `${receipt.path}\0${receipt.size}\0${receipt.sha256}\n`)
			.join('')}`;
		const fingerprint = createHash('sha256').update(canonical).digest('hex');

		expect(manifest.format).toBe('wasm-gleam-runtime-manifest-v2');
		expect(manifest.fingerprint).toBe(BUNDLED_GLEAM_MANIFEST_FINGERPRINT);
		expect(fingerprint).toBe(BUNDLED_GLEAM_MANIFEST_FINGERPRINT);
	});
});
