import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

	const sourceBase = new URL(baseUrl);
	if (!['https:', 'http:'].includes(sourceBase.protocol)) {
		throw new Error(`Unsupported ${selection.label} asset URL scheme: ${sourceBase.protocol}`);
	}
	if (!sourceBase.pathname.endsWith('/')) sourceBase.pathname += '/';

	let downloaded = 0;
	let reused = 0;
	for (const asset of assets) {
		if (
			!Number.isSafeInteger(asset.size) ||
			asset.size < 0 ||
			typeof asset.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(asset.sha256)
		) {
			throw new Error(`Invalid ${selection.label} receipt entry: ${asset.asset}`);
		}
		const targetPath = path.resolve(staticDir, selection.targetAsset(asset.asset));
		const relativeTarget = path.relative(staticDir, targetPath);
		if (
			relativeTarget === '..' ||
			relativeTarget.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relativeTarget)
		) {
			throw new Error(
				`${selection.label} asset escapes the static directory: ${asset.asset}`
			);
		}
		const existing = await stat(targetPath).catch(() => null);
		if (existing?.isFile() && existing.size === asset.size) {
			const digest = createHash('sha256')
				.update(await readFile(targetPath))
				.digest('hex');
			if (digest === asset.sha256) {
				reused += 1;
				continue;
			}
		}

		const sourceUrl = new URL(selection.sourceAsset(asset.asset), sourceBase);
		const response = await fetchImpl(sourceUrl, {
			headers: {
				Cookie: bypassCookie,
				'User-Agent': selection.userAgent
			},
			redirect: 'follow',
			signal: AbortSignal.timeout(timeoutMs)
		});
		const finalUrl = new URL(response.url || sourceUrl.href);
		if (
			finalUrl.origin !== sourceBase.origin ||
			!finalUrl.pathname.startsWith(sourceBase.pathname)
		) {
			throw new Error(
				`${selection.label} asset redirected outside its trusted base: ${finalUrl.href}`
			);
		}
		if (!response.ok) {
			throw new Error(`Failed to download ${sourceUrl.href}: ${response.status}`);
		}
		const declaredLength = Number(response.headers.get('content-length') || 0);
		const contentEncoding = response.headers.get('content-encoding');
		if (declaredLength && !contentEncoding && declaredLength !== asset.size) {
			throw new Error(
				`${selection.label} asset ${asset.asset} size mismatch: expected ${asset.size}, received ${declaredLength}`
			);
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		const digest = createHash('sha256').update(bytes).digest('hex');
		if (bytes.byteLength !== asset.size || digest !== asset.sha256) {
			throw new Error(
				`Downloaded ${selection.label} asset failed receipt validation: ${asset.asset}`
			);
		}

		await mkdir(path.dirname(targetPath), { recursive: true });
		const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
		try {
			await writeFile(temporaryPath, bytes);
			await rename(temporaryPath, targetPath);
		} finally {
			await rm(temporaryPath, { force: true });
		}
		downloaded += 1;
	}

	return { downloaded, reused };
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
