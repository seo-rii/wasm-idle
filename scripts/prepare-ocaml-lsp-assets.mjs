#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { preparePinnedAssets } from './prepare-pinned-assets.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_RECEIPT_PATH = path.join(REPOSITORY_ROOT, 'scripts', 'ocaml-lsp-assets.lock.json');
const DEFAULT_STATIC_DIR = path.join(REPOSITORY_ROOT, 'static');
const RECEIPT_FORMAT = 'wasm-idle-ocaml-lsp-assets-v1';
const ASSET_PATH_PREFIX = 'wasm-of-js-of-ocaml/';

/**
 * @typedef {{ path: string; size: number; sha256: string }} OcamlLspReceiptAsset
 */

/**
 * @param {{
 *   receiptPath?: string;
 *   staticDir?: string;
 *   baseUrl?: string;
 *   bypassCookie?: string;
 *   fetchImpl?: typeof fetch;
 *   timeoutMs?: number;
 * }} [options]
 */
export async function prepareOcamlLspAssets({
	receiptPath = DEFAULT_RECEIPT_PATH,
	staticDir = DEFAULT_STATIC_DIR,
	baseUrl,
	bypassCookie = process.env.WASM_IDLE_TEST_BYPASS_COOKIE || '',
	fetchImpl = fetch,
	timeoutMs = 120_000
} = {}) {
	const receipt = /** @type {{
	 *   format?: string;
	 *   revision?: string;
	 *   assets?: OcamlLspReceiptAsset[];
	 * }} */ (JSON.parse(await readFile(receiptPath, 'utf8')));
	if (receipt.format !== RECEIPT_FORMAT) {
		throw new Error(`Unexpected OCaml LSP asset receipt format: ${receipt.format}`);
	}
	if (typeof receipt.revision !== 'string' || !/^[a-f0-9]{40}$/u.test(receipt.revision)) {
		throw new Error('OCaml LSP asset receipt must pin a 40-character deployment revision');
	}
	if (!Array.isArray(receipt.assets) || receipt.assets.length === 0) {
		throw new Error('OCaml LSP asset receipt is missing its asset list');
	}
	const seenPaths = new Set();
	for (const asset of receipt.assets) {
		if (
			typeof asset?.path !== 'string' ||
			!asset.path.startsWith(ASSET_PATH_PREFIX) ||
			path.posix.normalize(asset.path) !== asset.path
		) {
			throw new Error(`Invalid OCaml LSP asset path: ${asset?.path}`);
		}
		if (seenPaths.has(asset.path)) {
			throw new Error(`Duplicate OCaml LSP asset path: ${asset.path}`);
		}
		seenPaths.add(asset.path);
	}
	const sourceBaseUrl =
		baseUrl ||
		process.env.WASM_IDLE_OCAML_LSP_ASSET_BASE_URL ||
		`https://raw.githubusercontent.com/seo-rii/wasm-idle/${receipt.revision}/`;

	return preparePinnedAssets({
		assets: receipt.assets.map((asset) => ({
			sourcePath: asset.path,
			targetPath: asset.path,
			size: asset.size,
			sha256: asset.sha256
		})),
		targetRoot: staticDir,
		sourceBaseUrl,
		label: 'OCaml LSP',
		userAgent: 'wasm-idle-ocaml-lsp-assets',
		bypassCookie,
		fetchImpl,
		timeoutMs
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await prepareOcamlLspAssets();
	console.log(
		`Prepared OCaml LSP assets (${result.downloaded} downloaded, ${result.reused} reused).`
	);
}
