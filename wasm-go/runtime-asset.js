import { resolveVersionedAssetUrl } from './asset-url.js';
const runtimePackBytesCache = new Map();
const runtimePackIndexCache = new Map();
const DEFAULT_MAX_ASSET_BYTES = 128 * 1024 * 1024;
function resolveMaxAssetBytes(options) {
    const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
    if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
        throw new Error('wasm-go maxAssetBytes must be a positive safe integer');
    }
    return maxAssetBytes;
}
function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw signal.reason ?? new DOMException('wasm-go runtime asset load aborted', 'AbortError');
    }
}
function waitForSignal(operation, signal) {
    if (!signal)
        return operation;
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            signal.removeEventListener('abort', abort);
            callback();
        };
        const abort = () => finish(() => reject(signal.reason ??
            new DOMException('wasm-go runtime asset load aborted', 'AbortError')));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted)
            abort();
        operation.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
    });
}
function createAssetDeadline(options, assetLabel) {
    if (options.assetTimeoutMs === undefined) {
        return { signal: options.signal, cleanup: () => undefined };
    }
    if (!Number.isSafeInteger(options.assetTimeoutMs) || options.assetTimeoutMs <= 0) {
        throw new Error('wasm-go assetTimeoutMs must be a positive safe integer');
    }
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(options.signal?.reason ??
        new DOMException('wasm-go runtime asset load aborted', 'AbortError'));
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    if (options.signal?.aborted)
        forwardAbort();
    const timeout = setTimeout(() => controller.abort(new DOMException(`${assetLabel} timed out after ${options.assetTimeoutMs} ms`, 'TimeoutError')), options.assetTimeoutMs);
    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', forwardAbort);
        }
    };
}
async function readBoundedStream(stream, assetLabel, maxAssetBytes, signal, reportProgress, total) {
    const reader = stream.getReader();
    let receivedLength = 0;
    let capacity = Math.min(total ?? 64 * 1024, maxAssetBytes);
    let output = new Uint8Array(Math.max(1, capacity));
    const abort = () => {
        void reader.cancel(signal?.reason).catch(() => { });
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            throwIfAborted(signal);
            const { done, value } = await reader.read();
            throwIfAborted(signal);
            if (done)
                break;
            if (!value?.byteLength)
                continue;
            if (value.byteLength > maxAssetBytes - receivedLength) {
                void reader.cancel('asset byte limit exceeded').catch(() => { });
                throw new Error(`${assetLabel} exceeds the hard asset limit ${maxAssetBytes} bytes`);
            }
            const nextLength = receivedLength + value.byteLength;
            if (nextLength > output.byteLength) {
                capacity = Math.min(maxAssetBytes, Math.max(nextLength, Math.max(output.byteLength * 2, 64 * 1024)));
                const grown = new Uint8Array(capacity);
                grown.set(output.subarray(0, receivedLength));
                output = grown;
            }
            output.set(value, receivedLength);
            receivedLength = nextLength;
            reportProgress?.(receivedLength, total);
        }
        reportProgress?.(receivedLength, total ?? receivedLength);
        return output.slice(0, receivedLength);
    }
    finally {
        signal?.removeEventListener('abort', abort);
        reader.releaseLock();
    }
}
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
export async function fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl = fetch, allowCompressedFallback = true, reportProgress, options = {}) {
    const maxAssetBytes = resolveMaxAssetBytes(options);
    const deadline = createAssetDeadline(options, assetLabel);
    const signal = deadline.signal;
    try {
        throwIfAborted(signal);
        const resolvedAssetUrl = assetUrl.toString();
        const resolvedAssetUrlObject = new URL(resolvedAssetUrl);
        let response;
        try {
            const responsePromise = fetchImpl(resolvedAssetUrl, { signal });
            void responsePromise.then((lateResponse) => {
                if (signal?.aborted) {
                    void lateResponse.body?.cancel(signal.reason).catch(() => { });
                }
            }, () => undefined);
            response = await waitForSignal(responsePromise, signal);
        }
        catch (error) {
            throwIfAborted(signal);
            throw new Error(`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}. This usually means the browser loaded a stale wasm-go bundle or blocked a nested runtime asset request; hard refresh and resync the runtime assets.`);
        }
        const contentLength = Number(response.headers.get('content-length') || 0) || undefined;
        if (contentLength !== undefined && contentLength > maxAssetBytes) {
            void response.body?.cancel('asset byte limit exceeded').catch(() => { });
            throw new Error(`${assetLabel} exceeds the hard asset limit ${maxAssetBytes} bytes`);
        }
        let assetBytes;
        if (!response.body) {
            assetBytes = new Uint8Array(await waitForSignal(response.arrayBuffer(), signal));
            throwIfAborted(signal);
            if (assetBytes.byteLength > maxAssetBytes) {
                throw new Error(`${assetLabel} exceeds the hard asset limit ${maxAssetBytes} bytes`);
            }
            reportProgress?.(assetBytes.byteLength, assetBytes.byteLength);
        }
        else {
            assetBytes = await readBoundedStream(response.body, assetLabel, maxAssetBytes, signal, reportProgress, contentLength);
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
            return await fetchRuntimeAssetBytes(compressedAssetUrl, assetLabel, fetchImpl, false, reportProgress, { ...options, signal });
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
            return await readBoundedStream(new Blob([compressedBytes.buffer])
                .stream()
                .pipeThrough(new DecompressionStream('gzip')), assetLabel, maxAssetBytes, signal, reportProgress);
        }
        catch (error) {
            throwIfAborted(signal);
            throw new Error(`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    finally {
        deadline.cleanup();
    }
}
export async function fetchRuntimeAssetJson(assetUrl, assetLabel, fetchImpl = fetch, reportProgress, options = {}) {
    return JSON.parse(new TextDecoder().decode(await fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl, true, reportProgress, options)));
}
async function verifyPackIntegrity(bytes, expected, label) {
    if (!expected)
        return;
    if (!globalThis.crypto?.subtle)
        throw new Error(`${label} integrity requires Web Crypto`);
    const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
    const actual = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
    if (actual !== expected)
        throw new Error(`${label} SHA-256 mismatch`);
}
async function loadRuntimePackBytes(baseUrl, pack, fetchImpl, reportProgress, options = {}) {
    const assetUrl = resolveVersionedAssetUrl(baseUrl, pack.asset).toString();
    const cacheKey = `${assetUrl}\n${pack.sha256 ?? ''}\n${resolveMaxAssetBytes(options)}\n${options.assetTimeoutMs ?? ''}`;
    let cached = runtimePackBytesCache.get(cacheKey);
    const reusedCachedBytes = Boolean(cached);
    if (!cached) {
        cached = fetchRuntimeAssetBytes(assetUrl, `wasm-go runtime pack ${pack.asset}`, fetchImpl, true, reportProgress, options).then(async (bytes) => {
            await verifyPackIntegrity(bytes, pack.sha256, `runtime pack ${pack.asset}`);
            return bytes;
        });
        if (!options.signal)
            runtimePackBytesCache.set(cacheKey, cached);
        cached.catch(() => {
            if (runtimePackBytesCache.get(cacheKey) === cached) {
                runtimePackBytesCache.delete(cacheKey);
            }
        });
    }
    const bytes = await waitForSignal(cached, options.signal);
    if (options.signal && !options.signal.aborted && !runtimePackBytesCache.has(cacheKey)) {
        runtimePackBytesCache.set(cacheKey, Promise.resolve(bytes));
    }
    if (reusedCachedBytes) {
        reportProgress?.(bytes.byteLength, bytes.byteLength);
    }
    return bytes;
}
export async function loadRuntimePackIndex(baseUrl, pack, fetchImpl = fetch, reportProgress, options = {}) {
    const indexUrl = resolveVersionedAssetUrl(baseUrl, pack.index).toString();
    const cacheKey = `${indexUrl}\n${pack.indexSha256 ?? ''}\n${resolveMaxAssetBytes(options)}\n${options.assetTimeoutMs ?? ''}`;
    let cached = runtimePackIndexCache.get(cacheKey);
    const reusedCachedIndex = Boolean(cached);
    if (!cached) {
        cached = fetchRuntimeAssetBytes(indexUrl, `wasm-go runtime pack index ${pack.index}`, fetchImpl, true, reportProgress, options).then(async (bytes) => {
            await verifyPackIntegrity(bytes, pack.indexSha256, `runtime pack index ${pack.index}`);
            return parseRuntimePackIndex(JSON.parse(new TextDecoder().decode(bytes)));
        });
        if (!options.signal)
            runtimePackIndexCache.set(cacheKey, cached);
        cached.catch(() => {
            if (runtimePackIndexCache.get(cacheKey) === cached) {
                runtimePackIndexCache.delete(cacheKey);
            }
        });
    }
    const index = await waitForSignal(cached, options.signal);
    if (options.signal && !options.signal.aborted && !runtimePackIndexCache.has(cacheKey)) {
        runtimePackIndexCache.set(cacheKey, Promise.resolve(index));
    }
    if (reusedCachedIndex) {
        reportProgress?.(index.fileCount, index.fileCount);
    }
    return index;
}
function runtimePackKey(baseUrl, pack) {
    return `${resolveVersionedAssetUrl(baseUrl, pack.index)}\n${resolveVersionedAssetUrl(baseUrl, pack.asset)}`;
}
async function loadRuntimePackEntriesRecursive(baseUrl, pack, fetchImpl, ancestorPacks, reportProgressForPack, options) {
    const packKey = runtimePackKey(baseUrl, pack);
    if (ancestorPacks.has(packKey)) {
        throw new Error(`recursive runtime pack delta reference for ${pack.index}`);
    }
    const nestedAncestorPacks = new Set(ancestorPacks);
    nestedAncestorPacks.add(packKey);
    const reportProgress = reportProgressForPack(pack);
    const [index, bytes] = await Promise.all([
        loadRuntimePackIndex(baseUrl, pack, fetchImpl, reportProgress?.index, options),
        loadRuntimePackBytes(baseUrl, pack, fetchImpl, reportProgress?.asset, options)
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
    if (decodedTotalBytes > resolveMaxAssetBytes(options)) {
        throw new Error(`runtime pack ${pack.asset} decoded bytes exceed the hard asset limit ${resolveMaxAssetBytes(options)} bytes`);
    }
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
    const baseEntries = await loadRuntimePackEntriesRecursive(baseUrl, pack.delta.base, fetchImpl, nestedAncestorPacks, reportProgressForPack, options);
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
export async function loadRuntimePackEntries(baseUrl, pack, fetchImpl = fetch, reportProgress, options = {}) {
    if (!pack.delta) {
        return loadRuntimePackEntriesRecursive(baseUrl, pack, fetchImpl, new Set(), () => reportProgress, options);
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
    return loadRuntimePackEntriesRecursive(baseUrl, pack, fetchImpl, new Set(), reportProgressForPack, options);
}
/** Load selected chunks with bounded concurrency; the legacy pack decoder also handles JS deltas. */
export async function loadRuntimeSysrootChunks(baseUrl, chunks, fetchImpl = fetch, reportProgress, options = {}) {
    const maxAssetBytes = resolveMaxAssetBytes(options);
    const totalBytes = chunks.reduce((total, chunk) => {
        if (chunk.delta && chunk.decodedTotalBytes === undefined) {
            throw new Error('wasm-go delta sysroot chunk requires decodedTotalBytes');
        }
        return total + (chunk.decodedTotalBytes ?? chunk.totalBytes);
    }, 0);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxAssetBytes) {
        throw new Error('wasm-go selected sysroot chunks exceed the hard asset limit');
    }
    const loaded = new Array(chunks.length);
    let loadedBytes = 0;
    let cursor = 0;
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted)
        abort();
    try {
        throwIfAborted(controller.signal);
        await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
            while (cursor < chunks.length) {
                throwIfAborted(controller.signal);
                const index = cursor++;
                const chunk = chunks[index];
                const entries = await loadRuntimePackEntries(baseUrl, chunk, fetchImpl, {
                    index: (received, total) => reportProgress?.(chunk.index, received, total),
                    asset: (received, total) => reportProgress?.(chunk.asset, received, total)
                }, { ...options, signal: controller.signal });
                const expectedPaths = new Set(chunk.runtimePaths);
                if (entries.length !== expectedPaths.size ||
                    entries.some((entry) => !expectedPaths.has(entry.runtimePath))) {
                    throw new Error(`runtime chunk ${chunk.asset} paths differ from its manifest`);
                }
                for (const entry of entries) {
                    if (entry.bytes.byteLength > maxAssetBytes - loadedBytes) {
                        throw new Error('wasm-go selected sysroot chunks exceed the hard asset limit');
                    }
                    loadedBytes += entry.bytes.byteLength;
                }
                loaded[index] = entries;
            }
        }));
        return loaded.flat();
    }
    catch (error) {
        controller.abort(error);
        throw error;
    }
    finally {
        options.signal?.removeEventListener('abort', abort);
    }
}
//# sourceMappingURL=runtime-asset.js.map