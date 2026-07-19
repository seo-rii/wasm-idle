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
    if (root.format !== 'wasm-go-runtime-pack-index-v1' &&
        root.format !== 'wasm-go-runtime-delta-pack-index-v1') {
        throw new Error('invalid root.format in wasm-go runtime pack index');
    }
    if (!Array.isArray(root.entries)) {
        throw new Error('invalid root.entries in wasm-go runtime pack index');
    }
    const totalBytes = expectNonNegativeInteger(root.totalBytes, 'root.totalBytes');
    const parsedEntries = root.entries.map((entry, index) => {
        const object = expectObject(entry, `root.entries[${index}]`);
        return {
            object,
            runtimePath: expectString(object.runtimePath, `root.entries[${index}].runtimePath`),
            offset: expectNonNegativeInteger(object.offset, `root.entries[${index}].offset`),
            length: expectNonNegativeInteger(object.length, `root.entries[${index}].length`)
        };
    });
    const fileCount = expectNonNegativeInteger(root.fileCount, 'root.fileCount');
    if (fileCount !== parsedEntries.length) {
        throw new Error('invalid root.fileCount in wasm-go runtime pack index');
    }
    const seenRuntimePaths = new Set();
    for (const entry of parsedEntries) {
        if (seenRuntimePaths.has(entry.runtimePath)) {
            throw new Error(`invalid root.entries runtimePath ${entry.runtimePath} in wasm-go runtime pack index`);
        }
        seenRuntimePaths.add(entry.runtimePath);
        if (entry.offset > totalBytes || entry.length > totalBytes - entry.offset) {
            throw new Error(`invalid runtime pack range for ${entry.runtimePath}: ${entry.offset}+${entry.length} exceeds ${totalBytes}`);
        }
    }
    if (root.format === 'wasm-go-runtime-pack-index-v1') {
        const entries = parsedEntries.map((entry) => ({
            runtimePath: entry.runtimePath,
            offset: entry.offset,
            length: entry.length
        }));
        return {
            format: 'wasm-go-runtime-pack-index-v1',
            fileCount,
            totalBytes,
            entries
        };
    }
    const decodedTotalBytes = expectNonNegativeInteger(root.decodedTotalBytes, 'root.decodedTotalBytes');
    let entryDecodedTotalBytes = 0;
    const entries = parsedEntries.map((entry, index) => {
        const decodedLength = expectNonNegativeInteger(entry.object.decodedLength, `root.entries[${index}].decodedLength`);
        if (decodedLength > decodedTotalBytes - entryDecodedTotalBytes) {
            throw new Error('invalid root.decodedTotalBytes in wasm-go runtime pack index');
        }
        entryDecodedTotalBytes += decodedLength;
        return {
            runtimePath: entry.runtimePath,
            offset: entry.offset,
            length: entry.length,
            decodedLength,
            ...(entry.object.baseRuntimePath !== undefined
                ? {
                    baseRuntimePath: expectString(entry.object.baseRuntimePath, `root.entries[${index}].baseRuntimePath`)
                }
                : {})
        };
    });
    if (entryDecodedTotalBytes !== decodedTotalBytes) {
        throw new Error('invalid root.decodedTotalBytes in wasm-go runtime pack index');
    }
    return {
        format: 'wasm-go-runtime-delta-pack-index-v1',
        fileCount,
        totalBytes,
        decodedTotalBytes,
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
function runtimePackKey(baseUrl, pack) {
    return `${resolveVersionedAssetUrl(baseUrl, pack.index)}\n${resolveVersionedAssetUrl(baseUrl, pack.asset)}`;
}
async function loadRuntimePackEntriesRecursive(baseUrl, pack, fetchImpl, ancestorPacks, reportProgressForPack) {
    const packKey = runtimePackKey(baseUrl, pack);
    if (ancestorPacks.has(packKey)) {
        throw new Error(`recursive runtime pack delta reference for ${pack.index}`);
    }
    const nestedAncestorPacks = new Set(ancestorPacks);
    nestedAncestorPacks.add(packKey);
    const reportProgress = reportProgressForPack(pack);
    const [index, bytes] = await Promise.all([
        loadRuntimePackIndex(baseUrl, pack, fetchImpl, reportProgress?.index),
        loadRuntimePackBytes(baseUrl, pack, fetchImpl, reportProgress?.asset)
    ]);
    if (index.fileCount !== pack.fileCount) {
        throw new Error(`runtime pack index ${pack.index} expected fileCount ${pack.fileCount} but loaded ${index.fileCount}`);
    }
    if (index.totalBytes !== pack.totalBytes) {
        throw new Error(`runtime pack index ${pack.index} expected totalBytes ${pack.totalBytes} but loaded ${index.totalBytes}`);
    }
    if (bytes.byteLength !== index.totalBytes) {
        throw new Error(`runtime pack ${pack.asset} expected ${index.totalBytes} bytes but loaded ${bytes.byteLength}`);
    }
    const decodedTotalBytes = index.format === 'wasm-go-runtime-delta-pack-index-v1'
        ? index.decodedTotalBytes
        : index.totalBytes;
    if (pack.decodedTotalBytes !== undefined && pack.decodedTotalBytes !== decodedTotalBytes) {
        throw new Error(`runtime pack index ${pack.index} expected decodedTotalBytes ${pack.decodedTotalBytes} but loaded ${decodedTotalBytes}`);
    }
    if (index.format === 'wasm-go-runtime-pack-index-v1') {
        if (pack.delta !== undefined) {
            throw new Error(`runtime pack index ${pack.index} is an identity pack but its reference declares a delta`);
        }
        return index.entries.map((entry) => ({
            runtimePath: entry.runtimePath,
            bytes: bytes.subarray(entry.offset, entry.offset + entry.length)
        }));
    }
    if (!pack.delta || pack.delta.format !== 'copy-literal-v1') {
        throw new Error(`runtime delta pack index ${pack.index} requires a copy-literal-v1 base reference`);
    }
    const baseEntries = await loadRuntimePackEntriesRecursive(baseUrl, pack.delta.base, fetchImpl, nestedAncestorPacks, reportProgressForPack);
    const baseEntriesByRuntimePath = new Map(baseEntries.map((entry) => [entry.runtimePath, entry]));
    const decodedEntries = [];
    for (const entry of index.entries) {
        const baseRuntimePath = entry.baseRuntimePath ?? entry.runtimePath;
        const baseEntry = baseEntriesByRuntimePath.get(baseRuntimePath);
        if (entry.baseRuntimePath !== undefined && !baseEntry) {
            throw new Error(`runtime delta entry ${entry.runtimePath} references missing base runtime path ${baseRuntimePath}`);
        }
        const encodedBytes = bytes.subarray(entry.offset, entry.offset + entry.length);
        const encodedView = new DataView(encodedBytes.buffer, encodedBytes.byteOffset, encodedBytes.byteLength);
        const decodedBytes = new Uint8Array(entry.decodedLength);
        let encodedOffset = 0;
        let decodedOffset = 0;
        while (encodedOffset < encodedBytes.byteLength) {
            const operationOffset = encodedOffset;
            const operation = encodedBytes[encodedOffset++];
            if (operation === 0) {
                if (encodedBytes.byteLength - encodedOffset < 4) {
                    throw new Error(`malformed runtime delta stream for ${entry.runtimePath} at ${operationOffset}: truncated literal length`);
                }
                const literalLength = encodedView.getUint32(encodedOffset, true);
                encodedOffset += 4;
                if (literalLength > encodedBytes.byteLength - encodedOffset) {
                    throw new Error(`malformed runtime delta stream for ${entry.runtimePath} at ${operationOffset}: literal exceeds encoded entry length`);
                }
                if (literalLength > decodedBytes.byteLength - decodedOffset) {
                    throw new Error(`malformed runtime delta stream for ${entry.runtimePath} at ${operationOffset}: literal exceeds decodedLength ${entry.decodedLength}`);
                }
                decodedBytes.set(encodedBytes.subarray(encodedOffset, encodedOffset + literalLength), decodedOffset);
                encodedOffset += literalLength;
                decodedOffset += literalLength;
                continue;
            }
            if (operation === 1) {
                if (encodedBytes.byteLength - encodedOffset < 8) {
                    throw new Error(`malformed runtime delta stream for ${entry.runtimePath} at ${operationOffset}: truncated copy range`);
                }
                const baseOffset = encodedView.getUint32(encodedOffset, true);
                const copyLength = encodedView.getUint32(encodedOffset + 4, true);
                encodedOffset += 8;
                if (!baseEntry) {
                    throw new Error(`malformed runtime delta stream for ${entry.runtimePath} at ${operationOffset}: copy references missing base runtime path ${baseRuntimePath}`);
                }
                if (baseOffset > baseEntry.bytes.byteLength ||
                    copyLength > baseEntry.bytes.byteLength - baseOffset) {
                    throw new Error(`malformed runtime delta stream for ${entry.runtimePath} at ${operationOffset}: copy range ${baseOffset}+${copyLength} exceeds base length ${baseEntry.bytes.byteLength}`);
                }
                if (copyLength > decodedBytes.byteLength - decodedOffset) {
                    throw new Error(`malformed runtime delta stream for ${entry.runtimePath} at ${operationOffset}: copy exceeds decodedLength ${entry.decodedLength}`);
                }
                decodedBytes.set(baseEntry.bytes.subarray(baseOffset, baseOffset + copyLength), decodedOffset);
                decodedOffset += copyLength;
                continue;
            }
            throw new Error(`malformed runtime delta stream for ${entry.runtimePath} at ${operationOffset}: unknown operation ${operation}`);
        }
        if (decodedOffset !== entry.decodedLength) {
            throw new Error(`malformed runtime delta stream for ${entry.runtimePath}: decoded ${decodedOffset} bytes, expected ${entry.decodedLength}`);
        }
        decodedEntries.push({
            runtimePath: entry.runtimePath,
            bytes: decodedBytes
        });
    }
    return decodedEntries;
}
export async function loadRuntimePackEntries(baseUrl, pack, fetchImpl = fetch, reportProgress) {
    if (!pack.delta) {
        return loadRuntimePackEntriesRecursive(baseUrl, pack, fetchImpl, new Set(), () => reportProgress);
    }
    const packs = new Map();
    const pendingPacks = [pack];
    while (pendingPacks.length > 0) {
        const currentPack = pendingPacks.pop();
        const key = runtimePackKey(baseUrl, currentPack);
        if (packs.has(key))
            continue;
        packs.set(key, currentPack);
        if (currentPack.delta)
            pendingPacks.push(currentPack.delta.base);
    }
    const indexFractions = new Map([...packs.keys()].map((key) => [key, 0]));
    const assetFractions = new Map([...packs.keys()].map((key) => [key, 0]));
    const indexWeights = new Map([...packs].map(([key, reference]) => [key, Math.max(reference.fileCount, 1)]));
    const assetWeights = new Map([...packs].map(([key, reference]) => [key, Math.max(reference.totalBytes, 1)]));
    const indexTotal = [...indexWeights.values()].reduce((total, weight) => total + weight, 0);
    const assetTotal = [...assetWeights.values()].reduce((total, weight) => total + weight, 0);
    const reportIndexProgress = reportProgress?.index;
    const reportAssetProgress = reportProgress?.asset;
    const reportProgressForPack = (currentPack) => {
        const key = runtimePackKey(baseUrl, currentPack);
        return {
            ...(reportIndexProgress
                ? {
                    index: (loaded, total) => {
                        const fraction = total && total > 0
                            ? Math.min(Math.max(loaded / total, 0), 1)
                            : loaded > 0
                                ? 1
                                : 0;
                        indexFractions.set(key, Math.max(indexFractions.get(key) || 0, fraction));
                        let aggregateLoaded = 0;
                        for (const [packKey, weight] of indexWeights) {
                            aggregateLoaded += weight * (indexFractions.get(packKey) || 0);
                        }
                        reportIndexProgress(aggregateLoaded, indexTotal);
                    }
                }
                : {}),
            ...(reportAssetProgress
                ? {
                    asset: (loaded, total) => {
                        const fraction = total && total > 0
                            ? Math.min(Math.max(loaded / total, 0), 1)
                            : loaded > 0
                                ? 1
                                : 0;
                        assetFractions.set(key, Math.max(assetFractions.get(key) || 0, fraction));
                        let aggregateLoaded = 0;
                        for (const [packKey, weight] of assetWeights) {
                            aggregateLoaded += weight * (assetFractions.get(packKey) || 0);
                        }
                        reportAssetProgress(aggregateLoaded, assetTotal);
                    }
                }
                : {})
        };
    };
    return loadRuntimePackEntriesRecursive(baseUrl, pack, fetchImpl, new Set(), reportProgressForPack);
}
//# sourceMappingURL=runtime-asset.js.map