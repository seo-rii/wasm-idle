import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { preparePinnedAssets } from './prepare-pinned-assets.mjs';
import {
	CLANGD_HEADER_ASSET,
	validateClangdHeaderMetadata,
	verifyClangdHeaderAsset
} from './llvm-contracts/clangd-header-asset-contract.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_RECEIPT_PATH = path.join(REPOSITORY_ROOT, 'static', 'clang', 'runtime-build.json');
const DEFAULT_STATIC_DIR = path.join(REPOSITORY_ROOT, 'static');
const DEFAULT_SOURCE_DIR = path.resolve(
	REPOSITORY_ROOT,
	'..',
	'wasm-llvm',
	'artifacts',
	'clang-browser'
);
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
 *   sourceDir?: string;
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
		sourceDir = baseUrl ? undefined : process.env.WASM_IDLE_TEST_CLANGD_SOURCE_DIR,
		bypassCookie = process.env.WASM_IDLE_TEST_BYPASS_COOKIE || '',
		fetchImpl = fetch,
		timeoutMs = 120_000
	} = options;
	const receipt =
		/** @type {{ assets?: ClangdReceiptAsset[]; toolchain?: { clangd?: { headers?: unknown } } }} */ (
			JSON.parse(await readFile(receiptPath, 'utf8'))
		);
	if (!Array.isArray(receipt.assets)) {
		throw new Error('Clang runtime receipt is missing its asset list');
	}
	const assets = receipt.assets.filter(
		(asset) => typeof asset?.asset === 'string' && asset.asset.startsWith('clangd/')
	);
	const headers =
		receipt.toolchain?.clangd?.headers === undefined
			? undefined
			: validateClangdHeaderMetadata(receipt.toolchain.clangd.headers);
	const requiredAssets = [
		'clangd/clangd.js',
		'clangd/clangd.wasm.gz',
		...(headers ? [CLANGD_HEADER_ASSET] : [])
	];
	if (
		assets.length !== requiredAssets.length ||
		requiredAssets.some((name) => !assets.some((asset) => asset.asset === name))
	)
		throw new Error(
			'Clang runtime receipt must declare exactly its supported clangd browser assets'
		);
	if (headers) {
		const asset = assets.find((asset) => asset.asset === CLANGD_HEADER_ASSET);
		if (!asset || asset.size !== headers.bytes || asset.sha256 !== headers.sha256)
			throw new Error('Clang runtime header receipt does not match its asset metadata');
	}

	// Local producers can supply unreleased assets without repinning an immutable
	// published URL. Explicit remote bases retain their existing loader contract.
	const localSource =
		sourceDir ||
		(!baseUrl && (await stat(DEFAULT_SOURCE_DIR).catch(() => null))?.isDirectory()
			? DEFAULT_SOURCE_DIR
			: undefined);
	if (headers && !baseUrl && !localSource) {
		throw new Error(
			'Separate clangd headers require the local wasm-llvm producer artifacts; ' +
				'set WASM_IDLE_TEST_CLANGD_SOURCE_DIR or an explicit WASM_IDLE_TEST_ASSET_BASE_URL.'
		);
	}
	const result = await preparePinnedAssets({
		assets: assets.map((asset) => ({
			sourcePath: asset.asset,
			targetPath: asset.asset,
			size: asset.size,
			sha256: asset.sha256
		})),
		targetRoot: staticDir,
		sourceBaseUrl: localSource
			? 'https://wasm-idle.invalid/local-clangd/'
			: baseUrl ||
				JSON.parse(await readFile(DEFAULT_ASSET_MANIFEST_PATH, 'utf8')).defaultBaseUrl,
		label: 'clangd',
		userAgent: 'wasm-idle-clangd-assets',
		bypassCookie,
		...(localSource ? { maxAttempts: 1 } : {}),
		fetchImpl: localSource
			? async (input) => {
					const url = new URL(input instanceof Request ? input.url : input);
					const sourceBase = new URL('https://wasm-idle.invalid/local-clangd/');
					const asset = url.pathname.slice(sourceBase.pathname.length);
					if (
						url.origin !== sourceBase.origin ||
						!url.pathname.startsWith(sourceBase.pathname) ||
						!requiredAssets.includes(asset)
					)
						throw new Error('Invalid local clangd producer asset path');
					let bytes;
					try {
						bytes = await readFile(path.join(localSource, asset));
					} catch (error) {
						throw new Error(`Local clangd producer asset is missing: ${asset}`, {
							cause: error
						});
					}
					if (headers && asset === CLANGD_HEADER_ASSET)
						verifyClangdHeaderAsset(bytes, headers);
					return new Response(bytes);
				}
			: fetchImpl,
		timeoutMs
	}).catch((error) => {
		if (!localSource) throw error;
		throw new Error(
			`Could not prepare receipt-pinned clangd assets from ${localSource}; ` +
				'verify the producer matches static/clang/runtime-build.json: ' +
				(error instanceof Error ? error.message : String(error)),
			{ cause: error }
		);
	});
	if (headers)
		verifyClangdHeaderAsset(await readFile(path.join(staticDir, CLANGD_HEADER_ASSET)), headers);
	return localSource
		? {
				downloaded: 0,
				reused: result.reused,
				...(result.downloaded ? { copied: result.downloaded } : {})
			}
		: result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await prepareClangdAssets();
	console.log(
		`Prepared clangd browser assets (${result.downloaded} downloaded, ${'copied' in result ? result.copied : 0} copied, ${result.reused} reused).`
	);
}
