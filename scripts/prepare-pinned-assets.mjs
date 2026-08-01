import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {{
 *   sourcePath: string;
 *   targetPath: string;
 *   size: number;
 *   sha256: string;
 * }} PinnedAsset
 */

/**
 * @param {{
 *   assets: readonly PinnedAsset[];
 *   targetRoot: string;
 *   sourceBaseUrl: string;
 *   label: string;
 *   userAgent: string;
 *   bypassCookie?: string;
 *   fetchImpl?: typeof fetch;
 *   timeoutMs?: number;
 * }} options
 */
export async function preparePinnedAssets({
	assets,
	targetRoot,
	sourceBaseUrl,
	label,
	userAgent,
	bypassCookie = '',
	fetchImpl = fetch,
	timeoutMs = 120_000
}) {
	const sourceBase = new URL(sourceBaseUrl);
	if (!['https:', 'http:'].includes(sourceBase.protocol)) {
		throw new Error(`Unsupported ${label} asset URL scheme: ${sourceBase.protocol}`);
	}
	if (!sourceBase.pathname.endsWith('/')) sourceBase.pathname += '/';

	let downloaded = 0;
	let reused = 0;
	for (const asset of assets) {
		if (
			typeof asset.sourcePath !== 'string' ||
			!asset.sourcePath ||
			typeof asset.targetPath !== 'string' ||
			!asset.targetPath ||
			!Number.isSafeInteger(asset.size) ||
			asset.size < 0 ||
			typeof asset.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(asset.sha256)
		) {
			throw new Error(
				`Invalid ${label} receipt entry: ${asset.targetPath || asset.sourcePath}`
			);
		}

		const sourceUrl = new URL(asset.sourcePath, sourceBase);
		if (
			sourceUrl.origin !== sourceBase.origin ||
			!sourceUrl.pathname.startsWith(sourceBase.pathname)
		) {
			throw new Error(`${label} asset escapes its trusted source: ${asset.sourcePath}`);
		}
		const targetPath = path.resolve(targetRoot, asset.targetPath);
		const relativeTarget = path.relative(targetRoot, targetPath);
		if (
			relativeTarget === '..' ||
			relativeTarget.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relativeTarget)
		) {
			throw new Error(`${label} asset escapes the target directory: ${asset.targetPath}`);
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

		/** @type {Record<string, string>} */
		const headers = { 'User-Agent': userAgent };
		if (bypassCookie) headers.Cookie = bypassCookie;
		const response = await fetchImpl(sourceUrl, {
			headers,
			redirect: 'follow',
			signal: AbortSignal.timeout(timeoutMs)
		});
		const finalUrl = new URL(response.url || sourceUrl.href);
		if (
			finalUrl.origin !== sourceBase.origin ||
			!finalUrl.pathname.startsWith(sourceBase.pathname)
		) {
			throw new Error(`${label} asset redirected outside its trusted base: ${finalUrl.href}`);
		}
		if (!response.ok) {
			throw new Error(`Failed to download ${sourceUrl.href}: ${response.status}`);
		}
		const declaredLength = Number(response.headers.get('content-length') || 0);
		const contentEncoding = response.headers.get('content-encoding');
		if (declaredLength && !contentEncoding && declaredLength !== asset.size) {
			throw new Error(
				`${label} asset ${asset.targetPath} size mismatch: expected ${asset.size}, received ${declaredLength}`
			);
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		const digest = createHash('sha256').update(bytes).digest('hex');
		if (bytes.byteLength !== asset.size || digest !== asset.sha256) {
			throw new Error(
				`Downloaded ${label} asset failed receipt validation: ${asset.targetPath}`
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
