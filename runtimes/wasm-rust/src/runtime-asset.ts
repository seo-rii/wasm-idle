export interface RuntimeAssetDownloadProgress {
	loaded: number;
	total?: number;
}

export const DEFAULT_MAX_RUNTIME_ASSET_BYTES = 128 * 1024 * 1024;

export interface RuntimeAssetFetchOptions {
	maxAssetBytes?: number;
}

async function readBoundedStream(
	stream: ReadableStream<Uint8Array>,
	assetLabel: string,
	maxAssetBytes: number,
	sizeKind: 'download' | 'decompressed',
	total?: number,
	onProgress?: (progress: RuntimeAssetDownloadProgress) => void
): Promise<Uint8Array<ArrayBuffer>> {
	const reader = stream.getReader();
	let bytes = new Uint8Array(total ?? 0);
	let loaded = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = loaded + value.byteLength;
			if (!Number.isSafeInteger(nextLength) || nextLength > maxAssetBytes) {
				throw new Error(
					`wasm-rust runtime asset ${assetLabel} ${sizeKind} size exceeds the ${maxAssetBytes} byte limit`
				);
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					maxAssetBytes,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, loaded));
				bytes = grown;
			}
			bytes.set(value, loaded);
			loaded = nextLength;
			onProgress?.({
				loaded,
				...(total !== undefined ? { total } : {})
			});
		}
		if (loaded === 0) {
			onProgress?.({ loaded: 0, total: total ?? 0 });
		}
		return bytes.subarray(0, loaded);
	} catch (error) {
		try {
			await reader.cancel(error);
		} catch {}
		throw error;
	} finally {
		reader.releaseLock();
	}
}

async function readResponseBytes(
	response: Response,
	assetLabel: string,
	maxAssetBytes: number,
	onProgress?: (progress: RuntimeAssetDownloadProgress) => void
): Promise<Uint8Array<ArrayBuffer>> {
	const contentLength = response.headers.get('content-length');
	let total: number | undefined;
	if (contentLength !== null) {
		const normalized = contentLength.trim();
		const parsed = Number(normalized);
		if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(parsed)) {
			await response.body?.cancel().catch(() => undefined);
			throw new Error(
				`wasm-rust runtime asset has an invalid Content-Length: ${contentLength}`
			);
		}
		total = parsed;
	}
	if (total !== undefined && total > maxAssetBytes) {
		await response.body?.cancel().catch(() => undefined);
		throw new Error(
			`wasm-rust runtime asset ${assetLabel} download size exceeds the ${maxAssetBytes} byte limit`
		);
	}
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxAssetBytes) {
			throw new Error(
				`wasm-rust runtime asset ${assetLabel} download size exceeds the ${maxAssetBytes} byte limit`
			);
		}
		onProgress?.({ loaded: bytes.byteLength, total: total ?? bytes.byteLength });
		return bytes;
	}
	return readBoundedStream(
		response.body,
		assetLabel,
		maxAssetBytes,
		'download',
		total,
		onProgress
	);
}

export async function fetchRuntimeAssetBytes(
	assetUrl: string | URL,
	assetLabel: string,
	fetchImpl: typeof fetch = fetch,
	allowCompressedFallback = true,
	onProgress?: (progress: RuntimeAssetDownloadProgress) => void,
	options: RuntimeAssetFetchOptions = {}
) {
	const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_RUNTIME_ASSET_BYTES;
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new Error(`wasm-rust runtime asset has an invalid maxAssetBytes: ${maxAssetBytes}`);
	}
	let resolvedAssetUrlObject: URL;
	try {
		resolvedAssetUrlObject = new URL(assetUrl.toString());
	} catch {
		throw new Error('wasm-rust runtime asset URLs must be absolute');
	}
	if (
		resolvedAssetUrlObject.protocol !== 'http:' &&
		resolvedAssetUrlObject.protocol !== 'https:'
	) {
		throw new Error(
			`unsupported wasm-rust runtime asset URL scheme: ${resolvedAssetUrlObject.protocol}`
		);
	}
	if (resolvedAssetUrlObject.username || resolvedAssetUrlObject.password) {
		throw new Error('wasm-rust runtime asset URLs must not include credentials');
	}
	if (resolvedAssetUrlObject.hash) {
		throw new Error('wasm-rust runtime asset URLs must not include fragments');
	}
	const resolvedAssetUrl = resolvedAssetUrlObject.href;
	let response: Response;
	try {
		response = await fetchImpl(resolvedAssetUrl, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
	} catch (error) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}. This usually means the browser loaded a stale wasm-rust bundle or blocked a nested runtime asset request; hard refresh and resync the runtime assets.`
		);
	}
	if (response.url) {
		let finalUrl: URL;
		try {
			finalUrl = new URL(response.url);
		} catch {
			await response.body?.cancel().catch(() => undefined);
			throw new Error(
				`wasm-rust runtime asset ${assetLabel} returned an invalid final URL: ${response.url}`
			);
		}
		if (finalUrl.href !== resolvedAssetUrl) {
			await response.body?.cancel().catch(() => undefined);
			throw new Error(
				`wasm-rust runtime asset ${assetLabel} returned an unexpected final URL: ${response.url}`
			);
		}
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => undefined);
		if (allowCompressedFallback && !resolvedAssetUrlObject.pathname.endsWith('.gz')) {
			const compressedAssetUrl = new URL(resolvedAssetUrl);
			compressedAssetUrl.pathname = `${compressedAssetUrl.pathname}.gz`;
			try {
				return await fetchRuntimeAssetBytes(
					compressedAssetUrl,
					assetLabel,
					fetchImpl,
					false,
					onProgress,
					options
				);
			} catch {}
		}
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status}). This usually means the browser loaded a stale wasm-rust bundle or a nested runtime asset is missing.`
		);
	}
	const assetBytes = await readResponseBytes(response, assetLabel, maxAssetBytes, onProgress);
	const assetPreview = new TextDecoder()
		.decode(assetBytes.slice(0, 128))
		.replace(/^\uFEFF/, '')
		.trimStart()
		.toLowerCase();
	const responseLooksLikeHtml =
		assetPreview.startsWith('<!doctype html') ||
		assetPreview.startsWith('<html') ||
		assetPreview.startsWith('<head') ||
		assetPreview.startsWith('<body');
	if (
		allowCompressedFallback &&
		!resolvedAssetUrlObject.pathname.endsWith('.gz') &&
		responseLooksLikeHtml
	) {
		const compressedAssetUrl = new URL(resolvedAssetUrl);
		compressedAssetUrl.pathname = `${compressedAssetUrl.pathname}.gz`;
		try {
			return await fetchRuntimeAssetBytes(
				compressedAssetUrl,
				assetLabel,
				fetchImpl,
				false,
				onProgress,
				options
			);
		} catch {}
	}
	if (responseLooksLikeHtml) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: expected a wasm-rust runtime asset but got HTML instead. This usually means the browser loaded a stale or wrong wasm-rust bundle, or the host rewrote a missing nested asset request to index.html; hard refresh and resync the runtime assets.`
		);
	}
	if (!new URL(resolvedAssetUrl).pathname.endsWith('.gz')) {
		return assetBytes;
	}
	if (assetBytes.byteLength < 2 || assetBytes[0] !== 0x1f || assetBytes[1] !== 0x8b) {
		return assetBytes;
	}
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: this browser does not support DecompressionStream('gzip').`
		);
	}
	try {
		const assetBuffer = new Uint8Array(assetBytes).buffer;
		const decompressedStream = new Blob([assetBuffer])
			.stream()
			.pipeThrough(new DecompressionStream('gzip'));
		return await readBoundedStream(
			decompressedStream,
			assetLabel,
			maxAssetBytes,
			'decompressed'
		);
	} catch (error) {
		throw new Error(
			`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export async function fetchRuntimeAssetJson<T>(
	assetUrl: string | URL,
	assetLabel: string,
	fetchImpl: typeof fetch = fetch,
	onProgress?: (progress: RuntimeAssetDownloadProgress) => void,
	options: RuntimeAssetFetchOptions = {}
): Promise<T> {
	return JSON.parse(
		new TextDecoder().decode(
			await fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl, true, onProgress, options)
		)
	) as T;
}
