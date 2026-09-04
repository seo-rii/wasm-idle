import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

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
 *   maxAttempts?: number;
 *   retryDelayMs?: number;
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
	timeoutMs = 120_000,
	maxAttempts = 3,
	retryDelayMs = 1_000
}) {
	if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
		throw new Error('maxAttempts must be an integer between 1 and 10');
	}
	if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 60_000) {
		throw new Error('retryDelayMs must be an integer between 0 and 60000');
	}
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
		/** @type {Uint8Array | undefined} */
		let bytes;
		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
			/** @type {Response} */
			let response;
			try {
				response = await fetchImpl(sourceUrl, {
					headers,
					redirect: 'follow',
					signal: AbortSignal.timeout(timeoutMs)
				});
			} catch (error) {
				if (attempt === maxAttempts) {
					throw new Error(
						`Failed to download ${sourceUrl.href} after ${maxAttempts} attempts`,
						{ cause: error }
					);
				}
				if (retryDelayMs > 0) {
					await new Promise((resolve) =>
						setTimeout(resolve, Math.min(retryDelayMs * 2 ** (attempt - 1), 60_000))
					);
				}
				continue;
			}

			const finalUrl = new URL(response.url || sourceUrl.href);
			if (
				finalUrl.origin !== sourceBase.origin ||
				!finalUrl.pathname.startsWith(sourceBase.pathname)
			) {
				throw new Error(
					`${label} asset redirected outside its trusted base: ${finalUrl.href}`
				);
			}
			if (!response.ok) {
				if (!TRANSIENT_HTTP_STATUSES.has(response.status) || attempt === maxAttempts) {
					throw new Error(`Failed to download ${sourceUrl.href}: ${response.status}`);
				}
				await response.body?.cancel().catch(() => undefined);
				if (retryDelayMs > 0) {
					await new Promise((resolve) =>
						setTimeout(resolve, Math.min(retryDelayMs * 2 ** (attempt - 1), 60_000))
					);
				}
				continue;
			}

			const declaredLength = Number(response.headers.get('content-length') || 0);
			const contentEncoding = response.headers.get('content-encoding');
			if (declaredLength && !contentEncoding && declaredLength !== asset.size) {
				throw new Error(
					`${label} asset ${asset.targetPath} size mismatch: expected ${asset.size}, received ${declaredLength}`
				);
			}
			try {
				bytes = new Uint8Array(await response.arrayBuffer());
			} catch (error) {
				if (attempt === maxAttempts) {
					throw new Error(
						`Failed to read ${sourceUrl.href} after ${maxAttempts} attempts`,
						{ cause: error }
					);
				}
				if (retryDelayMs > 0) {
					await new Promise((resolve) =>
						setTimeout(resolve, Math.min(retryDelayMs * 2 ** (attempt - 1), 60_000))
					);
				}
				continue;
			}
			break;
		}
		if (!bytes) {
			throw new Error(`Failed to download ${sourceUrl.href}`);
		}
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
