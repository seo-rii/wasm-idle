export type TinyGoRuntimeAssetLoaderResult =
	| string
	| URL
	| ArrayBuffer
	| Uint8Array
	| Blob
	| {
			url?: string | URL | null;
			data?: string | ArrayBuffer | Uint8Array | Blob | null;
			mimeType?: string;
	  }
	| null
	| undefined;

export type TinyGoRuntimeAssetLoader = (options: {
	assetPath: string;
	assetUrl: string;
	label: string;
	signal?: AbortSignal;
}) => TinyGoRuntimeAssetLoaderResult | Promise<TinyGoRuntimeAssetLoaderResult>;

export type TinyGoRuntimeAssetProgress = {
	assetPath: string;
	assetUrl: string;
	label: string;
	loaded: number;
	total: number | null;
};

export type TinyGoRuntimeAssetProgressCallback = (progress: TinyGoRuntimeAssetProgress) => void;

export type TinyGoRuntimeAssetPackReference = {
	index: string;
	asset: string;
	fileCount: number;
	totalBytes: number;
};

export interface TinyGoRuntimePackIndexEntry {
	runtimePath: string;
	offset: number;
	length: number;
}

export interface TinyGoRuntimePackIndex {
	format: 'wasm-tinygo-runtime-pack-index-v1' | 'wasm-rust-runtime-pack-index-v1';
	fileCount: number;
	totalBytes: number;
	entries: TinyGoRuntimePackIndexEntry[];
}

const runtimePackBytesCache = new Map<string, Promise<Uint8Array>>();
const runtimePackIndexCache = new Map<string, Promise<TinyGoRuntimePackIndex>>();
const cacheIdentityIds = new WeakMap<object, number>();
let nextCacheIdentityId = 0;

export const DEFAULT_MAX_TINYGO_ASSET_BYTES = 128 * 1024 * 1024;
export const MAX_TINYGO_RUNTIME_PACK_FILES = 65_536;
export const MAX_TINYGO_RUNTIME_PATH_LENGTH = 4_096;
const DEFAULT_TINYGO_ASSET_BUFFER_BYTES = 64 * 1024;

function cacheIdentity(value: object | undefined) {
	if (!value) return 'none';
	let id = cacheIdentityIds.get(value);
	if (!id) {
		id = ++nextCacheIdentityId;
		cacheIdentityIds.set(value, id);
	}
	return String(id);
}

function runtimePackCacheKey(options: {
	url: string;
	fetchImpl: typeof fetch;
	loader?: TinyGoRuntimeAssetLoader;
	signal?: AbortSignal;
	maxAssetBytes: number;
}) {
	return [
		options.url,
		options.maxAssetBytes,
		cacheIdentity(options.fetchImpl),
		cacheIdentity(options.loader),
		cacheIdentity(options.signal)
	].join('\0');
}

function enforceAssetSize(assetPath: string, bytes: Uint8Array, maxAssetBytes: number) {
	if (bytes.byteLength > maxAssetBytes) {
		throw new Error(
			`wasm-tinygo runtime asset ${assetPath} exceeds the ${maxAssetBytes} byte limit`
		);
	}
	return bytes;
}

function resolveMaxAssetBytes(maxAssetBytes?: number) {
	const resolved = maxAssetBytes ?? DEFAULT_MAX_TINYGO_ASSET_BYTES;
	if (!Number.isSafeInteger(resolved) || resolved < 0) {
		throw new Error('wasm-tinygo maxAssetBytes must be a non-negative safe integer');
	}
	return resolved;
}

function runtimeAssetAbortReason(signal: AbortSignal) {
	return signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
}

async function invokeRuntimeAssetLoader(
	loader: TinyGoRuntimeAssetLoader,
	options: Parameters<TinyGoRuntimeAssetLoader>[0]
) {
	const { signal } = options;
	if (!signal) return await loader(options);
	if (signal.aborted) throw runtimeAssetAbortReason(signal);
	let cancelOnAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		cancelOnAbort = () => reject(runtimeAssetAbortReason(signal));
		signal.addEventListener('abort', cancelOnAbort, { once: true });
	});
	try {
		const result = await Promise.race([Promise.resolve(loader(options)), aborted]);
		if (signal.aborted) throw runtimeAssetAbortReason(signal);
		return result;
	} catch (error) {
		if (signal.aborted) throw runtimeAssetAbortReason(signal);
		throw error;
	} finally {
		if (cancelOnAbort) signal.removeEventListener('abort', cancelOnAbort);
	}
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-tinygo runtime pack index`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid ${label} in wasm-tinygo runtime pack index`);
	}
	return value;
}

function expectNonNegativeInteger(value: unknown, label: string): number {
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < 0 ||
		!Number.isFinite(value)
	) {
		throw new Error(`invalid ${label} in wasm-tinygo runtime pack index`);
	}
	return value;
}

export function clearTinyGoRuntimePackCache() {
	runtimePackBytesCache.clear();
	runtimePackIndexCache.clear();
}

export function parseTinyGoRuntimePackIndex(value: unknown): TinyGoRuntimePackIndex {
	const root = expectObject(value, 'root');
	if (
		root.format !== 'wasm-tinygo-runtime-pack-index-v1' &&
		root.format !== 'wasm-rust-runtime-pack-index-v1'
	) {
		throw new Error('invalid root.format in wasm-tinygo runtime pack index');
	}
	if (!Array.isArray(root.entries)) {
		throw new Error('invalid root.entries in wasm-tinygo runtime pack index');
	}
	const totalBytes = expectNonNegativeInteger(root.totalBytes, 'root.totalBytes');
	const fileCount = expectNonNegativeInteger(root.fileCount, 'root.fileCount');
	if (fileCount !== root.entries.length) {
		throw new Error('invalid root.fileCount in wasm-tinygo runtime pack index');
	}
	if (fileCount > MAX_TINYGO_RUNTIME_PACK_FILES) {
		throw new Error(
			`invalid root.fileCount in wasm-tinygo runtime pack index: ${fileCount} exceeds ${MAX_TINYGO_RUNTIME_PACK_FILES}`
		);
	}
	const entries = root.entries.map((entry, index) => {
		const object = expectObject(entry, `root.entries[${index}]`);
		const runtimePath = expectString(object.runtimePath, `root.entries[${index}].runtimePath`);
		const expectsAbsolutePath = root.format === 'wasm-rust-runtime-pack-index-v1';
		const pathWithoutRoot = expectsAbsolutePath ? runtimePath.slice(1) : runtimePath;
		const pathSegments = pathWithoutRoot.split('/');
		if (
			runtimePath.length > MAX_TINYGO_RUNTIME_PATH_LENGTH ||
			runtimePath.includes('\0') ||
			runtimePath.includes('\\') ||
			runtimePath.includes('?') ||
			runtimePath.includes('#') ||
			runtimePath.includes('%') ||
			(expectsAbsolutePath ? !runtimePath.startsWith('/') : runtimePath.startsWith('/')) ||
			pathSegments.some(
				(segment, segmentIndex) =>
					segment === '' ||
					segment === '.' ||
					segment === '..' ||
					(segmentIndex === 0 && segment.includes(':'))
			)
		) {
			throw new Error(
				`invalid root.entries[${index}].runtimePath in wasm-tinygo runtime pack index`
			);
		}
		return {
			runtimePath,
			offset: expectNonNegativeInteger(object.offset, `root.entries[${index}].offset`),
			length: expectNonNegativeInteger(object.length, `root.entries[${index}].length`)
		};
	});
	const seenRuntimePaths = new Set<string>();
	let expectedOffset = 0;
	for (const entry of entries) {
		if (seenRuntimePaths.has(entry.runtimePath)) {
			throw new Error(
				`invalid root.entries runtimePath ${entry.runtimePath} in wasm-tinygo runtime pack index`
			);
		}
		seenRuntimePaths.add(entry.runtimePath);
		if (entry.offset > totalBytes || entry.length > totalBytes - entry.offset) {
			throw new Error(
				`invalid runtime pack range for ${entry.runtimePath}: ${entry.offset}+${entry.length} exceeds ${totalBytes}`
			);
		}
		if (entry.offset !== expectedOffset) {
			throw new Error(
				`invalid runtime pack range for ${entry.runtimePath}: expected offset ${expectedOffset} but got ${entry.offset}`
			);
		}
		expectedOffset += entry.length;
	}
	if (expectedOffset !== totalBytes) {
		throw new Error(
			`invalid root.totalBytes in wasm-tinygo runtime pack index: entries cover ${expectedOffset} bytes but expected ${totalBytes}`
		);
	}
	return {
		format: root.format,
		fileCount,
		totalBytes,
		entries
	};
}

async function normalizeLoaderResult(
	result: TinyGoRuntimeAssetLoaderResult,
	assetPath: string,
	maxAssetBytes: number,
	signal?: AbortSignal
): Promise<{ bytes?: Uint8Array; url?: string; mimeType?: string } | null> {
	if (!result) return null;
	if (typeof result === 'string' || result instanceof URL) {
		return { url: String(result) };
	}
	if (result instanceof ArrayBuffer) {
		return { bytes: enforceAssetSize(assetPath, new Uint8Array(result), maxAssetBytes) };
	}
	if (result instanceof Uint8Array) {
		enforceAssetSize(assetPath, result, maxAssetBytes);
		return { bytes: result };
	}
	if (result instanceof Blob) {
		if (result.size > maxAssetBytes) {
			throw new Error(
				`wasm-tinygo runtime asset ${assetPath} exceeds the ${maxAssetBytes} byte limit`
			);
		}
		return {
			bytes: await readBoundedAssetStream({
				stream: result.stream(),
				assetLabel: `wasm-tinygo runtime asset ${assetPath}`,
				maxAssetBytes,
				sizeKind: 'download',
				total: result.size,
				signal
			}),
			mimeType: result.type || undefined
		};
	}
	if (typeof result === 'object') {
		const url = result.url ? String(result.url) : undefined;
		if (url) return { url };
		if (result.data === undefined || result.data === null) return null;
		if (typeof result.data === 'string') {
			if (result.data.length > maxAssetBytes) {
				throw new Error(
					`wasm-tinygo runtime asset ${assetPath} exceeds the ${maxAssetBytes} byte limit`
				);
			}
			return {
				bytes: enforceAssetSize(
					assetPath,
					new TextEncoder().encode(result.data),
					maxAssetBytes
				),
				mimeType: result.mimeType
			};
		}
		if (result.data instanceof ArrayBuffer) {
			return {
				bytes: enforceAssetSize(assetPath, new Uint8Array(result.data), maxAssetBytes),
				mimeType: result.mimeType
			};
		}
		if (result.data instanceof Uint8Array) {
			enforceAssetSize(assetPath, result.data, maxAssetBytes);
			return { bytes: result.data, mimeType: result.mimeType };
		}
		if (result.data.size > maxAssetBytes) {
			throw new Error(
				`wasm-tinygo runtime asset ${assetPath} exceeds the ${maxAssetBytes} byte limit`
			);
		}
		return {
			bytes: await readBoundedAssetStream({
				stream: result.data.stream(),
				assetLabel: `wasm-tinygo runtime asset ${assetPath}`,
				maxAssetBytes,
				sizeKind: 'download',
				total: result.data.size,
				signal
			}),
			mimeType: result.mimeType || result.data.type || undefined
		};
	}
	throw new Error(`unsupported wasm-tinygo asset loader result for ${assetPath}`);
}

async function readBoundedAssetStream(options: {
	stream: ReadableStream<Uint8Array>;
	assetLabel: string;
	maxAssetBytes: number;
	sizeKind: 'download' | 'decompressed';
	total?: number;
	signal?: AbortSignal;
	onChunk?: (loaded: number, total: number | null) => void;
}) {
	const reader = options.stream.getReader();
	let cancellation: Promise<void> | undefined;
	const cancelReader = (reason?: unknown) => {
		cancellation ??= reader.cancel(reason).catch(() => {});
		return cancellation;
	};
	const cancelOnAbort = () => {
		void cancelReader(
			options.signal?.reason ?? new Error('wasm-tinygo runtime asset load was aborted')
		);
	};
	options.signal?.addEventListener('abort', cancelOnAbort, { once: true });
	let bytes = new Uint8Array(
		Math.min(options.maxAssetBytes, options.total ?? DEFAULT_TINYGO_ASSET_BUFFER_BYTES)
	);
	let loaded = 0;
	try {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
		}
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = loaded + value.byteLength;
			if (nextLength > options.maxAssetBytes) {
				throw new Error(
					`${options.assetLabel} ${options.sizeKind} size exceeds the ${options.maxAssetBytes} byte limit`
				);
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					options.maxAssetBytes,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, loaded));
				bytes = grown;
			}
			bytes.set(value, loaded);
			loaded = nextLength;
			options.onChunk?.(loaded, options.total ?? null);
		}
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
		}
		options.onChunk?.(loaded, options.total ?? loaded);
		return bytes.subarray(0, loaded);
	} catch (error) {
		await cancelReader(error);
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
		}
		throw error;
	} finally {
		options.signal?.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}
}

async function fetchRuntimeAssetBytes(
	assetUrl: string,
	assetLabel: string,
	fetchImpl: typeof fetch,
	options: {
		allowCompressedFallback?: boolean;
		onProgress?: TinyGoRuntimeAssetProgressCallback;
		signal?: AbortSignal;
		maxAssetBytes: number;
	}
): Promise<Uint8Array<ArrayBuffer>> {
	let resolvedAssetUrlObject: URL;
	try {
		resolvedAssetUrlObject = new URL(assetUrl, globalThis.location?.href);
	} catch {
		throw new Error('wasm-tinygo runtime asset URLs must be absolute outside a browser');
	}
	if (
		resolvedAssetUrlObject.protocol !== 'http:' &&
		resolvedAssetUrlObject.protocol !== 'https:'
	) {
		throw new Error(
			`unsupported wasm-tinygo runtime asset URL scheme: ${resolvedAssetUrlObject.protocol}`
		);
	}
	if (resolvedAssetUrlObject.username || resolvedAssetUrlObject.password) {
		throw new Error('wasm-tinygo runtime asset URLs must not include credentials');
	}
	if (resolvedAssetUrlObject.hash) {
		throw new Error('wasm-tinygo runtime asset URLs must not include fragments');
	}
	if (options.signal?.aborted) {
		throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
	}
	const resolvedAssetUrl = resolvedAssetUrlObject.href;
	const emitProgress = (loaded: number, total: number | null) => {
		if (!options.onProgress) return;
		try {
			options.onProgress({
				assetPath: resolvedAssetUrlObject.pathname.replace(/^\/+/, ''),
				assetUrl: resolvedAssetUrl,
				label: assetLabel,
				loaded,
				total
			});
		} catch {}
	};
	let response: Response;
	try {
		response = await fetchImpl(resolvedAssetUrl, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: options.signal
		});
	} catch (error) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
		}
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}. This usually means the browser loaded a stale wasm-tinygo bundle or blocked a nested runtime asset request; hard refresh and resync the runtime assets.`
		);
	}
	if (response.url) {
		let finalUrl: string;
		try {
			finalUrl = new URL(response.url).href;
		} catch {
			await response.body?.cancel().catch(() => {});
			throw new Error(
				`wasm-tinygo runtime asset ${assetLabel} returned an invalid final URL`
			);
		}
		if (finalUrl !== resolvedAssetUrl) {
			await response.body?.cancel().catch(() => {});
			throw new Error(
				`wasm-tinygo runtime asset ${assetLabel} returned an unexpected final URL`
			);
		}
	}
	const contentLengthValue = response.headers.get('content-length');
	let contentLength: number | undefined;
	if (contentLengthValue !== null) {
		contentLength = Number(contentLengthValue);
		if (!/^\d+$/u.test(contentLengthValue) || !Number.isSafeInteger(contentLength)) {
			await response.body?.cancel().catch(() => {});
			throw new Error(
				`wasm-tinygo runtime asset ${assetLabel} has an invalid Content-Length`
			);
		}
	}
	if (contentLength !== undefined && contentLength > options.maxAssetBytes) {
		await response.body?.cancel().catch(() => {});
		throw new Error(
			`${assetLabel} download size exceeds the ${options.maxAssetBytes} byte limit`
		);
	}
	let assetBytes: Uint8Array<ArrayBuffer>;
	if (response.body) {
		assetBytes = await readBoundedAssetStream({
			stream: response.body,
			assetLabel,
			maxAssetBytes: options.maxAssetBytes,
			sizeKind: 'download',
			total: contentLength,
			signal: options.signal,
			onChunk: emitProgress
		});
	} else {
		assetBytes = new Uint8Array();
		emitProgress(0, contentLength ?? 0);
	}
	const assetPreview = new TextDecoder()
		.decode(assetBytes.subarray(0, 128))
		.replace(/^\uFEFF/, '')
		.trimStart()
		.toLowerCase();
	const responseLooksLikeHtml =
		assetPreview.startsWith('<!doctype html') ||
		assetPreview.startsWith('<html') ||
		assetPreview.startsWith('<head') ||
		assetPreview.startsWith('<body');
	if (
		(options.allowCompressedFallback ?? true) &&
		!resolvedAssetUrlObject.pathname.endsWith('.gz') &&
		(!response.ok || responseLooksLikeHtml)
	) {
		const compressedAssetUrl = new URL(resolvedAssetUrl);
		compressedAssetUrl.pathname = `${compressedAssetUrl.pathname}.gz`;
		try {
			return await fetchRuntimeAssetBytes(
				compressedAssetUrl.toString(),
				assetLabel,
				fetchImpl,
				{
					...options,
					allowCompressedFallback: false
				}
			);
		} catch (error) {
			if (options.signal?.aborted) throw error;
		}
	}
	if (!response.ok) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status}). This usually means the browser loaded a stale wasm-tinygo bundle or a nested runtime asset is missing.`
		);
	}
	if (responseLooksLikeHtml) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: expected a wasm-tinygo runtime asset but got HTML instead. This usually means the browser loaded a stale or wrong wasm-tinygo bundle, or the host rewrote a missing nested asset request to index.html; hard refresh and resync the runtime assets.`
		);
	}
	if (!resolvedAssetUrlObject.pathname.endsWith('.gz')) {
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
		const decompressed = new Blob([
			assetBytes.buffer.slice(
				assetBytes.byteOffset,
				assetBytes.byteOffset + assetBytes.byteLength
			)
		])
			.stream()
			.pipeThrough(new DecompressionStream('gzip'));
		return await readBoundedAssetStream({
			stream: decompressed,
			assetLabel,
			maxAssetBytes: options.maxAssetBytes,
			sizeKind: 'decompressed',
			signal: options.signal
		});
	} catch (error) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
		}
		throw new Error(
			`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

async function loadRuntimePackBytes(
	assetBaseUrl: string,
	pack: TinyGoRuntimeAssetPackReference,
	fetchImpl: typeof fetch,
	loader?: TinyGoRuntimeAssetLoader,
	onProgress?: TinyGoRuntimeAssetProgressCallback,
	signal?: AbortSignal,
	maxAssetBytes = DEFAULT_MAX_TINYGO_ASSET_BYTES
) {
	const assetUrl = new URL(pack.asset, assetBaseUrl).toString();
	const cacheKey = runtimePackCacheKey({
		url: assetUrl,
		fetchImpl,
		loader,
		signal,
		maxAssetBytes
	});
	let cachedBytes = runtimePackBytesCache.get(cacheKey);
	if (!cachedBytes) {
		cachedBytes = loadRuntimeAssetBytes({
			assetPath: pack.asset,
			assetUrl,
			label: `wasm-tinygo runtime pack ${pack.asset}`,
			fetchImpl,
			loader,
			packs: null,
			onProgress,
			signal,
			maxAssetBytes
		});
		runtimePackBytesCache.set(cacheKey, cachedBytes);
		cachedBytes.catch(() => {
			if (runtimePackBytesCache.get(cacheKey) === cachedBytes) {
				runtimePackBytesCache.delete(cacheKey);
			}
		});
	}
	return cachedBytes;
}

async function loadRuntimePackIndex(
	assetBaseUrl: string,
	pack: TinyGoRuntimeAssetPackReference,
	fetchImpl: typeof fetch,
	loader?: TinyGoRuntimeAssetLoader,
	onProgress?: TinyGoRuntimeAssetProgressCallback,
	signal?: AbortSignal,
	maxAssetBytes = DEFAULT_MAX_TINYGO_ASSET_BYTES
) {
	const indexUrl = new URL(pack.index, assetBaseUrl).toString();
	const cacheKey = runtimePackCacheKey({
		url: indexUrl,
		fetchImpl,
		loader,
		signal,
		maxAssetBytes
	});
	let cachedIndex = runtimePackIndexCache.get(cacheKey);
	if (!cachedIndex) {
		cachedIndex = loadRuntimeAssetBytes({
			assetPath: pack.index,
			assetUrl: indexUrl,
			label: `wasm-tinygo runtime pack index ${pack.index}`,
			fetchImpl,
			loader,
			packs: null,
			assetBaseUrl,
			onProgress,
			signal,
			maxAssetBytes
		}).then((value) =>
			parseTinyGoRuntimePackIndex(JSON.parse(new TextDecoder().decode(value)))
		);
		runtimePackIndexCache.set(cacheKey, cachedIndex);
		cachedIndex.catch(() => {
			if (runtimePackIndexCache.get(cacheKey) === cachedIndex) {
				runtimePackIndexCache.delete(cacheKey);
			}
		});
	}
	return cachedIndex;
}

async function loadRuntimePackEntries(
	assetBaseUrl: string,
	pack: TinyGoRuntimeAssetPackReference,
	fetchImpl: typeof fetch,
	loader?: TinyGoRuntimeAssetLoader,
	onProgress?: TinyGoRuntimeAssetProgressCallback,
	signal?: AbortSignal,
	maxAssetBytes = DEFAULT_MAX_TINYGO_ASSET_BYTES
): Promise<Map<string, Uint8Array>> {
	if (typeof pack.index !== 'string' || pack.index.length === 0 || pack.index.includes('\0')) {
		throw new Error('invalid wasm-tinygo runtime pack index reference');
	}
	if (typeof pack.asset !== 'string' || pack.asset.length === 0 || pack.asset.includes('\0')) {
		throw new Error(`invalid wasm-tinygo runtime pack asset reference for ${pack.index}`);
	}
	if (
		typeof pack.fileCount !== 'number' ||
		!Number.isSafeInteger(pack.fileCount) ||
		pack.fileCount < 0 ||
		pack.fileCount > MAX_TINYGO_RUNTIME_PACK_FILES
	) {
		throw new Error(`invalid wasm-tinygo runtime pack fileCount for ${pack.index}`);
	}
	if (
		typeof pack.totalBytes !== 'number' ||
		!Number.isSafeInteger(pack.totalBytes) ||
		pack.totalBytes < 0
	) {
		throw new Error(`invalid wasm-tinygo runtime pack totalBytes for ${pack.index}`);
	}
	if (pack.totalBytes > maxAssetBytes) {
		throw new Error(
			`wasm-tinygo runtime pack ${pack.asset} exceeds the ${maxAssetBytes} byte limit`
		);
	}
	const [index, packBytes] = await Promise.all([
		loadRuntimePackIndex(
			assetBaseUrl,
			pack,
			fetchImpl,
			loader,
			onProgress,
			signal,
			maxAssetBytes
		),
		loadRuntimePackBytes(
			assetBaseUrl,
			pack,
			fetchImpl,
			loader,
			onProgress,
			signal,
			maxAssetBytes
		)
	]);
	if (index.fileCount !== pack.fileCount) {
		throw new Error(
			`invalid wasm-tinygo runtime pack ${pack.index}: expected ${pack.fileCount} files but got ${index.fileCount}`
		);
	}
	if (index.totalBytes !== pack.totalBytes) {
		throw new Error(
			`invalid wasm-tinygo runtime pack ${pack.index}: expected ${pack.totalBytes} bytes but got ${index.totalBytes}`
		);
	}
	if (packBytes.byteLength !== index.totalBytes) {
		throw new Error(
			`invalid wasm-tinygo runtime pack ${pack.asset}: expected exactly ${index.totalBytes} bytes but got ${packBytes.byteLength}`
		);
	}
	const entries = new Map<string, Uint8Array>();
	for (const entry of index.entries) {
		entries.set(
			entry.runtimePath,
			packBytes.subarray(entry.offset, entry.offset + entry.length)
		);
	}
	return entries;
}

export async function loadRuntimeAssetBytes(options: {
	assetPath: string;
	assetUrl: string;
	label: string;
	fetchImpl?: typeof fetch;
	loader?: TinyGoRuntimeAssetLoader;
	assetBaseUrl?: string;
	packs?: TinyGoRuntimeAssetPackReference[] | null;
	onProgress?: TinyGoRuntimeAssetProgressCallback;
	signal?: AbortSignal;
	maxAssetBytes?: number;
}): Promise<Uint8Array> {
	const maxAssetBytes = resolveMaxAssetBytes(options.maxAssetBytes);
	if (options.signal?.aborted) {
		throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
	}
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	if (!fetchImpl) {
		throw new Error('wasm-tinygo runtime asset loading requires fetch');
	}
	const loader = options.loader;
	if (options.packs?.length) {
		if (!options.assetBaseUrl) {
			throw new Error('wasm-tinygo asset packs require assetBaseUrl');
		}
		for (const pack of options.packs) {
			const entries = await loadRuntimePackEntries(
				options.assetBaseUrl,
				pack,
				fetchImpl,
				loader,
				options.onProgress,
				options.signal,
				maxAssetBytes
			);
			const packed = entries.get(options.assetPath);
			if (packed) return packed;
		}
	}
	if (loader) {
		const normalized = await normalizeLoaderResult(
			await invokeRuntimeAssetLoader(loader, {
				assetPath: options.assetPath,
				assetUrl: options.assetUrl,
				label: options.label,
				signal: options.signal
			}),
			options.assetPath,
			maxAssetBytes,
			options.signal
		);
		if (normalized?.bytes) return normalized.bytes;
		if (normalized?.url) {
			return await fetchRuntimeAssetBytes(normalized.url, options.label, fetchImpl, {
				allowCompressedFallback: true,
				onProgress: options.onProgress,
				signal: options.signal,
				maxAssetBytes
			});
		}
	}
	return await fetchRuntimeAssetBytes(options.assetUrl, options.label, fetchImpl, {
		allowCompressedFallback: true,
		onProgress: options.onProgress,
		signal: options.signal,
		maxAssetBytes
	});
}

export async function resolveRuntimeAssetUrl(options: {
	assetPath: string;
	assetUrl: string;
	label: string;
	loader?: TinyGoRuntimeAssetLoader;
	signal?: AbortSignal;
	maxAssetBytes?: number;
}): Promise<string> {
	const maxAssetBytes = resolveMaxAssetBytes(options.maxAssetBytes);
	if (options.signal?.aborted) {
		throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
	}
	const loader = options.loader;
	if (!loader) return options.assetUrl;
	const normalized = await normalizeLoaderResult(
		await invokeRuntimeAssetLoader(loader, {
			assetPath: options.assetPath,
			assetUrl: options.assetUrl,
			label: options.label,
			signal: options.signal
		}),
		options.assetPath,
		maxAssetBytes,
		options.signal
	);
	if (!normalized) return options.assetUrl;
	if (normalized.url) return normalized.url;
	throw new Error(
		`wasm-tinygo asset loader returned bytes for ${options.assetPath}; worker assets must be provided as URLs`
	);
}
