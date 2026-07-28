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
export async function prepareClangdAssets({
	receiptPath = DEFAULT_RECEIPT_PATH,
	staticDir = DEFAULT_STATIC_DIR,
	baseUrl = process.env.WASM_IDLE_TEST_ASSET_BASE_URL || DEFAULT_ASSET_BASE_URL,
	bypassCookie = process.env.WASM_IDLE_TEST_BYPASS_COOKIE || DEFAULT_BYPASS_COOKIE,
	fetchImpl = fetch,
	timeoutMs = 120_000
} = {}) {
	const receipt = /** @type {{ assets?: ClangdReceiptAsset[] }} */ (
		JSON.parse(await readFile(receiptPath, 'utf8'))
	);
	if (!Array.isArray(receipt?.assets)) {
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

	const sourceBase = new URL(baseUrl);
	if (!['https:', 'http:'].includes(sourceBase.protocol)) {
		throw new Error(`Unsupported clangd asset URL scheme: ${sourceBase.protocol}`);
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
			throw new Error(`Invalid clangd receipt entry: ${asset.asset}`);
		}
		const targetPath = path.resolve(staticDir, asset.asset);
		const relativeTarget = path.relative(staticDir, targetPath);
		if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
			throw new Error(`Clangd asset escapes the static directory: ${asset.asset}`);
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

		const sourceUrl = new URL(asset.asset, sourceBase);
		const response = await fetchImpl(sourceUrl, {
			headers: {
				Cookie: bypassCookie,
				'User-Agent': 'wasm-idle-clangd-assets'
			},
			redirect: 'follow',
			signal: AbortSignal.timeout(timeoutMs)
		});
		const finalUrl = new URL(response.url || sourceUrl.href);
		if (
			finalUrl.origin !== sourceBase.origin ||
			!finalUrl.pathname.startsWith(sourceBase.pathname)
		) {
			throw new Error(`Clangd asset redirected outside its trusted base: ${finalUrl.href}`);
		}
		if (!response.ok) {
			throw new Error(`Failed to download ${sourceUrl.href}: ${response.status}`);
		}
		const declaredLength = Number(response.headers.get('content-length') || 0);
		const contentEncoding = response.headers.get('content-encoding');
		if (declaredLength && !contentEncoding && declaredLength !== asset.size) {
			throw new Error(
				`Clangd asset ${asset.asset} size mismatch: expected ${asset.size}, received ${declaredLength}`
			);
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		const digest = createHash('sha256').update(bytes).digest('hex');
		if (bytes.byteLength !== asset.size || digest !== asset.sha256) {
			throw new Error(`Downloaded clangd asset failed receipt validation: ${asset.asset}`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = await prepareClangdAssets();
	console.log(
		`Prepared clangd browser assets (${result.downloaded} downloaded, ${result.reused} reused).`
	);
}
