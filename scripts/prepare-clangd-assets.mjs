import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { preparePinnedAssets } from './prepare-pinned-assets.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_RECEIPT_PATH = path.join(REPOSITORY_ROOT, 'static', 'clang', 'runtime-build.json');
const DEFAULT_STATIC_DIR = path.join(REPOSITORY_ROOT, 'static');
const DEFAULT_ASSET_MANIFEST_PATH = path.join(
	REPOSITORY_ROOT,
	'scripts',
	'browser-test-assets.v1.json'
);

/**
 * @typedef {{ asset: string; size: number; sha256: string }} ClangdReceiptAsset
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
export async function prepareClangdAssets(options = {}) {
	const {
		receiptPath = DEFAULT_RECEIPT_PATH,
		staticDir = DEFAULT_STATIC_DIR,
		baseUrl = process.env.WASM_IDLE_TEST_ASSET_BASE_URL,
		bypassCookie = process.env.WASM_IDLE_TEST_BYPASS_COOKIE || '',
		fetchImpl = fetch,
		timeoutMs = 120_000
	} = options;
	const receipt = /** @type {{ assets?: ClangdReceiptAsset[] }} */ (
		JSON.parse(await readFile(receiptPath, 'utf8'))
	);
	if (!Array.isArray(receipt.assets)) {
		throw new Error('Clang runtime receipt is missing its asset list');
	}
	const assets = receipt.assets.filter(
		(asset) => typeof asset?.asset === 'string' && asset.asset.startsWith('clangd/')
	);
	if (
		assets.length !== 2 ||
		!assets.some((asset) => asset.asset === 'clangd/clangd.js') ||
		!assets.some((asset) => asset.asset === 'clangd/clangd.wasm.gz')
	) {
		throw new Error('Clang runtime receipt must declare exactly the two clangd browser assets');
	}

	return preparePinnedAssets({
		assets: assets.map((asset) => ({
			sourcePath: asset.asset,
			targetPath: asset.asset,
			size: asset.size,
			sha256: asset.sha256
		})),
		targetRoot: staticDir,
		sourceBaseUrl:
			baseUrl ||
			JSON.parse(await readFile(DEFAULT_ASSET_MANIFEST_PATH, 'utf8')).defaultBaseUrl,
		label: 'clangd',
		userAgent: 'wasm-idle-clangd-assets',
		bypassCookie,
		fetchImpl,
		timeoutMs
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await prepareClangdAssets();
	console.log(
		`Prepared clangd browser assets (${result.downloaded} downloaded, ${result.reused} reused).`
	);
}
