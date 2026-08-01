import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareOcamlLspAssets } from '../../scripts/prepare-ocaml-lsp-assets.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

describe('prepareOcamlLspAssets', () => {
	it('downloads assets from the receipt-pinned deployment revision', async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-ocaml-lsp-assets-'));
		temporaryDirectories.push(root);
		const receiptPath = path.join(root, 'ocaml-lsp-assets.lock.json');
		const staticDir = path.join(root, 'static');
		const revision = 'a'.repeat(40);
		const assetPath = 'wasm-of-js-of-ocaml/browser-native/src/index.js';
		const bytes = new TextEncoder().encode('export const ready = true;');
		await writeFile(
			receiptPath,
			JSON.stringify({
				format: 'wasm-idle-ocaml-lsp-assets-v1',
				revision,
				assets: [
					{
						path: assetPath,
						size: bytes.byteLength,
						sha256: createHash('sha256').update(bytes).digest('hex')
					}
				]
			})
		);
		const fetchImpl = vi.fn(async () => new Response(bytes));

		await expect(prepareOcamlLspAssets({ receiptPath, staticDir, fetchImpl })).resolves.toEqual(
			{ downloaded: 1, reused: 0 }
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			new URL(`https://raw.githubusercontent.com/seo-rii/wasm-idle/${revision}/${assetPath}`),
			expect.any(Object)
		);
		expect(await readFile(path.join(staticDir, assetPath), 'utf8')).toBe(
			'export const ready = true;'
		);
	});

	it('pins the complete browser compiler graph used by the full LSP suite', async () => {
		const receipt = JSON.parse(
			await readFile('scripts/ocaml-lsp-assets.lock.json', 'utf8')
		) as {
			format: string;
			revision: string;
			assets: Array<{ path: string; size: number; sha256: string }>;
		};
		const paths = receipt.assets.map((asset) => asset.path);

		expect(receipt.format).toBe('wasm-idle-ocaml-lsp-assets-v1');
		expect(receipt.revision).toMatch(/^[a-f0-9]{40}$/u);
		expect(paths).toEqual(
			expect.arrayContaining([
				'wasm-of-js-of-ocaml/browser-native/src/index.js',
				'wasm-of-js-of-ocaml/browser-native/src/compiler-worker.js',
				'wasm-of-js-of-ocaml/browser-native/browser-harness/native-tool-worker.js',
				'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json',
				'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-runtime-pack.v1.bin.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-runtime-pack.v1.index.json',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/ocamlc.byte.browser.js.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/js_of_ocaml.bc.browser.js.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm_of_ocaml.bc.browser.js.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-opt.browser.js.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-merge.browser.js.gz',
				'wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-metadce.browser.js.gz'
			])
		);
		for (const asset of receipt.assets) {
			expect(asset.path).toMatch(/^wasm-of-js-of-ocaml\//u);
			expect(asset.size).toBeGreaterThan(0);
			expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/u);
		}
	});
});
