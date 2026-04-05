import { resolveVersionedAssetUrl } from './asset-url.js';
const runtimePackBytesCache = new Map();
const runtimePackIndexCache = new Map();
function expectObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`invalid ${label} in wasm-go runtime pack index`);
    }
    return value;
}
function expectString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`invalid ${label} in wasm-go runtime pack index`);
    }
    return value;
}
function expectNonNegativeInteger(value, label) {
    if (typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        !Number.isFinite(value)) {
        throw new Error(`invalid ${label} in wasm-go runtime pack index`);
    }
    return value;
}
export function clearRuntimePackCache() {
    runtimePackBytesCache.clear();
    runtimePackIndexCache.clear();
}
export function parseRuntimePackIndex(value) {
    const root = expectObject(value, 'root');
    if (root.format !== 'wasm-go-runtime-pack-index-v1') {
        throw new Error('invalid root.format in wasm-go runtime pack index');
    }
    if (!Array.isArray(root.entries)) {
        throw new Error('invalid root.entries in wasm-go runtime pack index');
    }
    const totalBytes = expectNonNegativeInteger(root.totalBytes, 'root.totalBytes');
    const entries = root.entries.map((entry, index) => {
        const object = expectObject(entry, `root.entries[${index}]`);
        return {
            runtimePath: expectString(object.runtimePath, `root.entries[${index}].runtimePath`),
            offset: expectNonNegativeInteger(object.offset, `root.entries[${index}].offset`),
            length: expectNonNegativeInteger(object.length, `root.entries[${index}].length`)
        };
    });
    const fileCount = expectNonNegativeInteger(root.fileCount, 'root.fileCount');
    if (fileCount !== entries.length) {
        throw new Error('invalid root.fileCount in wasm-go runtime pack index');
    }
    const seenRuntimePaths = new Set();
    for (const entry of entries) {
        if (seenRuntimePaths.has(entry.runtimePath)) {
            throw new Error(`invalid root.entries runtimePath ${entry.runtimePath} in wasm-go runtime pack index`);
        }
        seenRuntimePaths.add(entry.runtimePath);
        if (entry.offset + entry.length > totalBytes) {
            throw new Error(`invalid runtime pack range for ${entry.runtimePath}: ${entry.offset}+${entry.length} exceeds ${totalBytes}`);
        }
    }
    return {
        format: 'wasm-go-runtime-pack-index-v1',
        fileCount,
        totalBytes,
        entries
    };
}
export async function fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl = fetch, allowCompressedFallback = true, reportProgress) {
    const resolvedAssetUrl = assetUrl.toString();
    const resolvedAssetUrlObject = new URL(resolvedAssetUrl);
    let response;
    try {
        response = await fetchImpl(resolvedAssetUrl);
    }
    catch (error) {
        throw new Error(`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}. This usually means the browser loaded a stale wasm-go bundle or blocked a nested runtime asset request; hard refresh and resync the runtime assets.`);
    }
    let assetBytes;
    if (!response.body) {
        assetBytes = new Uint8Array(await response.arrayBuffer());
        reportProgress?.(assetBytes.byteLength, assetBytes.byteLength);
    }
    else {
        const reader = response.body.getReader();
        const contentLength = Number(response.headers.get('content-length') || 0) || undefined;
        let receivedLength = 0;
        const chunks = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            const chunk = Uint8Array.from(value);
            chunks.push(chunk);
            receivedLength += chunk.byteLength;
            reportProgress?.(receivedLength, contentLength);
        }
        assetBytes = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
            assetBytes.set(chunk, position);
            position += chunk.byteLength;
        }
        reportProgress?.(receivedLength, contentLength ?? receivedLength);
    }
    const assetPreview = new TextDecoder()
        .decode(assetBytes.slice(0, 128))
        .replace(/^\uFEFF/, '')
        .trimStart()
        .toLowerCase();
    const responseLooksLikeHtml = assetPreview.startsWith('<!doctype html') ||
        assetPreview.startsWith('<html') ||
        assetPreview.startsWith('<head') ||
        assetPreview.startsWith('<body');
    if (allowCompressedFallback &&
        !resolvedAssetUrlObject.pathname.endsWith('.gz') &&
        (!response.ok || responseLooksLikeHtml)) {
        const compressedAssetUrl = new URL(resolvedAssetUrl);
        compressedAssetUrl.pathname = `${compressedAssetUrl.pathname}.gz`;
        try {
            return await fetchRuntimeAssetBytes(compressedAssetUrl, assetLabel, fetchImpl, false, reportProgress);
        }
        catch { }
    }
    if (!response.ok) {
        throw new Error(`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status}). This usually means the browser loaded a stale wasm-go bundle or a nested runtime asset is missing.`);
    }
    if (responseLooksLikeHtml) {
        throw new Error(`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: expected a wasm-go runtime asset but got HTML instead. This usually means the browser loaded a stale or wrong wasm-go bundle, or the host rewrote a missing nested asset request to index.html; hard refresh and resync the runtime assets.`);
    }
    if (!resolvedAssetUrlObject.pathname.endsWith('.gz')) {
        return assetBytes;
    }
    if (assetBytes.byteLength < 2 || assetBytes[0] !== 0x1f || assetBytes[1] !== 0x8b) {
        return assetBytes;
    }
    if (typeof DecompressionStream !== 'function') {
        throw new Error(`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: this browser does not support DecompressionStream('gzip').`);
    }
    try {
        const compressedBytes = new Uint8Array(assetBytes.byteLength);
        compressedBytes.set(assetBytes);
        const decompressedResponse = new Response(new Blob([compressedBytes.buffer]).stream().pipeThrough(new DecompressionStream('gzip')));
        return new Uint8Array(await decompressedResponse.arrayBuffer());
    }
    catch (error) {
        throw new Error(`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export async function fetchRuntimeAssetJson(assetUrl, assetLabel, fetchImpl = fetch, reportProgress) {
    return JSON.parse(new TextDecoder().decode(await fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl, true, reportProgress)));
}
async function loadRuntimePackBytes(baseUrl, pack, fetchImpl, reportProgress) {
    const assetUrl = resolveVersionedAssetUrl(baseUrl, pack.asset).toString();
    let cached = runtimePackBytesCache.get(assetUrl);
    const reusedCachedBytes = Boolean(cached);
    if (!cached) {
        cached = fetchRuntimeAssetBytes(assetUrl, `wasm-go runtime pack ${pack.asset}`, fetchImpl, true, reportProgress);
        runtimePackBytesCache.set(assetUrl, cached);
        cached.catch(() => {
            if (runtimePackBytesCache.get(assetUrl) === cached) {
                runtimePackBytesCache.delete(assetUrl);
            }
        });
    }
    const bytes = await cached;
    if (reusedCachedBytes) {
        reportProgress?.(bytes.byteLength, bytes.byteLength);
    }
    return bytes;
}
export async function loadRuntimePackIndex(baseUrl, pack, fetchImpl = fetch, reportProgress) {
    const indexUrl = resolveVersionedAssetUrl(baseUrl, pack.index).toString();
    let cached = runtimePackIndexCache.get(indexUrl);
    const reusedCachedIndex = Boolean(cached);
    if (!cached) {
        cached = fetchRuntimeAssetJson(indexUrl, `wasm-go runtime pack index ${pack.index}`, fetchImpl, reportProgress).then((value) => parseRuntimePackIndex(value));
        runtimePackIndexCache.set(indexUrl, cached);
        cached.catch(() => {
            if (runtimePackIndexCache.get(indexUrl) === cached) {
                runtimePackIndexCache.delete(indexUrl);
            }
        });
    }
    const index = await cached;
    if (reusedCachedIndex) {
        reportProgress?.(index.fileCount, index.fileCount);
    }
    return index;
}
export async function loadRuntimePackEntries(baseUrl, pack, fetchImpl = fetch, reportProgress) {
    const [index, bytes] = await Promise.all([
        loadRuntimePackIndex(baseUrl, pack, fetchImpl, reportProgress?.index),
        loadRuntimePackBytes(baseUrl, pack, fetchImpl, reportProgress?.asset)
    ]);
    return index.entries.map((entry) => ({
        runtimePath: entry.runtimePath,
        bytes: bytes.slice(entry.offset, entry.offset + entry.length)
    }));
}
//# sourceMappingURL=runtime-asset.js.map