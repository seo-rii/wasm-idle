import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { preparePinnedAssets } from './prepare-pinned-assets.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_RECEIPT_PATH = path.join(REPOSITORY_ROOT, 'static', 'clang', 'runtime-build.json');
const DEFAULT_STATIC_DIR = path.join(REPOSITORY_ROOT, 'static');
const DEFAULT_ASSET_BASE_URL = 'https://seorii.page/wasm-idle/';
const DEFAULT_BYPASS_COOKIE = 'dev_bypass_waf=seorii_bypass_token_is_this';

/**
 * @typedef {{ asset: string; size: number; sha256: string }} ClangReceiptAsset
 */

/**
 * @typedef {{
 *   receiptPath?: string;
 *   staticDir?: string;
 *   baseUrl?: string;
 *   bypassCookie?: string;
 *   fetchImpl?: typeof fetch;
 *   timeoutMs?: number;
 * }} PrepareClangAssetsOptions
 */

/**
 * @typedef {{
 *   label: string;
 *   expectedAssets: readonly string[];
 *   belongsToGroup: (asset: string) => boolean;
 *   sourceAsset: (asset: string) => string;
 *   targetAsset: (asset: string) => string;
 *   userAgent: string;
 * }} ClangAssetSelection
 */

/** @type {ClangAssetSelection} */
const CLANGD_ASSET_SELECTION = {
	label: 'clangd',
	expectedAssets: ['clangd/clangd.js', 'clangd/clangd.wasm.gz'],
	belongsToGroup: (asset) => asset.startsWith('clangd/'),
	sourceAsset: (asset) => asset,
	targetAsset: (asset) => asset,
	userAgent: 'wasm-idle-clangd-assets'
};

/** @type {ClangAssetSelection} */
const COMPILER_ASSET_SELECTION = {
	label: 'compiler',
	expectedAssets: ['clang.wasm.gz', 'lld.wasm.gz', 'memfs.wasm.gz', 'sysroot.tar.gz'],
	belongsToGroup: (asset) => !asset.includes('/'),
	sourceAsset: (asset) => `clang/bin/${asset}`,
	targetAsset: (asset) => `clang/bin/${asset}`,
	userAgent: 'wasm-idle-clang-compiler-assets'
};

/**
 * @param {PrepareClangAssetsOptions} options
 * @param {ClangAssetSelection} selection
 */
async function prepareClangAssets(options, selection) {
	const {
		receiptPath = DEFAULT_RECEIPT_PATH,
		staticDir = DEFAULT_STATIC_DIR,
		baseUrl = process.env.WASM_IDLE_TEST_ASSET_BASE_URL || DEFAULT_ASSET_BASE_URL,
		bypassCookie = process.env.WASM_IDLE_TEST_BYPASS_COOKIE || DEFAULT_BYPASS_COOKIE,
		fetchImpl = fetch,
		timeoutMs = 120_000
	} = options;
	const receipt = /** @type {{ assets?: ClangReceiptAsset[] }} */ (
		JSON.parse(await readFile(receiptPath, 'utf8'))
	);
	if (!Array.isArray(receipt.assets)) {
		throw new Error('Clang runtime receipt is missing its asset list');
	}
	const assets = receipt.assets.filter(
		(asset) => typeof asset?.asset === 'string' && selection.belongsToGroup(asset.asset)
	);
	if (
		assets.length !== selection.expectedAssets.length ||
		selection.expectedAssets.some(
			(expectedAsset) => !assets.some((asset) => asset.asset === expectedAsset)
		)
	) {
		throw new Error(
			`Clang runtime receipt must declare exactly the ${selection.expectedAssets.length} ${selection.label} browser assets`
		);
	}

	return preparePinnedAssets({
		assets: assets.map((asset) => ({
			sourcePath: selection.sourceAsset(asset.asset),
			targetPath: selection.targetAsset(asset.asset),
			size: asset.size,
			sha256: asset.sha256
		})),
		targetRoot: staticDir,
		sourceBaseUrl: baseUrl,
		label: selection.label,
		userAgent: selection.userAgent,
		bypassCookie,
		fetchImpl,
		timeoutMs
	});
}

/** @param {PrepareClangAssetsOptions} [options] */
export async function prepareClangdAssets(options = {}) {
	return prepareClangAssets(options, CLANGD_ASSET_SELECTION);
}

/** @param {PrepareClangAssetsOptions} [options] */
export async function prepareClangCompilerAssets(options = {}) {
	return prepareClangAssets(options, COMPILER_ASSET_SELECTION);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await prepareClangdAssets();
	console.log(
		`Prepared clangd browser assets (${result.downloaded} downloaded, ${result.reused} reused).`
	);
}
