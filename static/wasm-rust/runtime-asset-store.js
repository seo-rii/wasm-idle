import { resolveVersionedAssetUrl } from './asset-url.js';
import { fetchRuntimeAssetBytes, fetchRuntimeAssetJson } from './runtime-asset.js';
const runtimePackBytesCache = new Map();
const runtimePackIndexCache = new Map();
function expectObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`invalid ${label} in wasm-rust runtime pack index`);
    }
    return value;
}
function expectString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`invalid ${label} in wasm-rust runtime pack index`);
    }
    return value;
}
function expectNonNegativeInteger(value, label) {
    if (typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        !Number.isFinite(value)) {
        throw new Error(`invalid ${label} in wasm-rust runtime pack index`);
    }
    return value;
}
export function clearRuntimeAssetPackCache() {
    runtimePackBytesCache.clear();
    runtimePackIndexCache.clear();
}
export function parseRuntimePackIndex(value) {
    const root = expectObject(value, 'root');
    if (root.format !== 'wasm-rust-runtime-pack-index-v1' &&
        root.format !== 'wasm-rust-runtime-delta-pack-index-v1') {
        throw new Error('invalid root.format in wasm-rust runtime pack index');
    }
    if (!Array.isArray(root.entries)) {
        throw new Error('invalid root.entries in wasm-rust runtime pack index');
    }
    const totalBytes = expectNonNegativeInteger(root.totalBytes, 'root.totalBytes');
    const fileCount = expectNonNegativeInteger(root.fileCount, 'root.fileCount');
    if (fileCount !== root.entries.length) {
        throw new Error('invalid root.fileCount in wasm-rust runtime pack index');
    }
    const isDelta = root.format === 'wasm-rust-runtime-delta-pack-index-v1';
    const entries = root.entries.map((entry, index) => {
        const object = expectObject(entry, `root.entries[${index}]`);
        const parsedEntry = {
            runtimePath: expectString(object.runtimePath, `root.entries[${index}].runtimePath`),
            offset: expectNonNegativeInteger(object.offset, `root.entries[${index}].offset`),
            length: expectNonNegativeInteger(object.length, `root.entries[${index}].length`)
        };
        if (!isDelta) {
            return parsedEntry;
        }
        return {
            ...parsedEntry,
            decodedLength: expectNonNegativeInteger(object.decodedLength, `root.entries[${index}].decodedLength`),
            ...(object.baseRuntimePath === undefined
                ? {}
                : {
                    baseRuntimePath: expectString(object.baseRuntimePath, `root.entries[${index}].baseRuntimePath`)
                })
        };
    });
    const seenRuntimePaths = new Set();
    for (const entry of entries) {
        if (seenRuntimePaths.has(entry.runtimePath)) {
            throw new Error(`invalid root.entries runtimePath ${entry.runtimePath} in wasm-rust runtime pack index`);
        }
        seenRuntimePaths.add(entry.runtimePath);
        if (entry.offset > totalBytes || entry.length > totalBytes - entry.offset) {
            throw new Error(`invalid runtime pack range for ${entry.runtimePath}: ${entry.offset}+${entry.length} exceeds ${totalBytes}`);
        }
    }
    if (isDelta) {
        const decodedTotalBytes = expectNonNegativeInteger(root.decodedTotalBytes, 'root.decodedTotalBytes');
        const deltaEntries = entries;
        let entryDecodedTotalBytes = 0;
        for (const entry of deltaEntries) {
            if (entry.decodedLength > decodedTotalBytes - entryDecodedTotalBytes) {
                throw new Error(`invalid root.decodedTotalBytes in wasm-rust runtime pack index: entry lengths exceed ${decodedTotalBytes}`);
            }
            entryDecodedTotalBytes += entry.decodedLength;
        }
        if (entryDecodedTotalBytes !== decodedTotalBytes) {
            throw new Error(`invalid root.decodedTotalBytes in wasm-rust runtime pack index: expected ${decodedTotalBytes} but entries decode to ${entryDecodedTotalBytes}`);
        }
        return {
            format: 'wasm-rust-runtime-delta-pack-index-v1',
            fileCount,
            totalBytes,
            decodedTotalBytes,
            entries: deltaEntries
        };
    }
    return {
        format: 'wasm-rust-runtime-pack-index-v1',
        fileCount,
        totalBytes,
        entries: entries
    };
}
async function loadRuntimePackBytes(runtimeBaseUrl, pack, fetchImpl, onProgress) {
    const assetUrl = resolveVersionedAssetUrl(runtimeBaseUrl, pack.asset).toString();
    let cachedBytes = runtimePackBytesCache.get(assetUrl);
    if (!cachedBytes) {
        cachedBytes = fetchRuntimeAssetBytes(assetUrl, `wasm-rust runtime pack ${pack.asset}`, fetchImpl, true, onProgress);
        runtimePackBytesCache.set(assetUrl, cachedBytes);
        cachedBytes.catch(() => {
            if (runtimePackBytesCache.get(assetUrl) === cachedBytes) {
                runtimePackBytesCache.delete(assetUrl);
            }
        });
    }
    return cachedBytes;
}
async function loadRuntimePackIndex(runtimeBaseUrl, pack, fetchImpl) {
    const indexUrl = resolveVersionedAssetUrl(runtimeBaseUrl, pack.index).toString();
    let cachedIndex = runtimePackIndexCache.get(indexUrl);
    if (!cachedIndex) {
        cachedIndex = fetchRuntimeAssetJson(indexUrl, `wasm-rust runtime pack index ${pack.index}`, fetchImpl).then((value) => parseRuntimePackIndex(value));
        runtimePackIndexCache.set(indexUrl, cachedIndex);
        cachedIndex.catch(() => {
            if (runtimePackIndexCache.get(indexUrl) === cachedIndex) {
                runtimePackIndexCache.delete(indexUrl);
            }
        });
    }
    return cachedIndex;
}
async function loadRuntimePackEntriesRecursive(runtimeBaseUrl, pack, fetchImpl, onProgressForPack, ancestorIndexUrls) {
    const indexUrl = resolveVersionedAssetUrl(runtimeBaseUrl, pack.index).toString();
    if (ancestorIndexUrls.has(indexUrl)) {
        throw new Error(`invalid wasm-rust runtime pack ${pack.index}: cyclic delta base reference`);
    }
    ancestorIndexUrls.add(indexUrl);
    try {
        const onProgress = onProgressForPack(pack);
        const baseEntriesPromise = pack.delta
            ? loadRuntimePackEntriesRecursive(runtimeBaseUrl, pack.delta.base, fetchImpl, onProgressForPack, ancestorIndexUrls)
            : Promise.resolve(undefined);
        const [index, packBytes, baseEntries] = await Promise.all([
            loadRuntimePackIndex(runtimeBaseUrl, pack, fetchImpl),
            loadRuntimePackBytes(runtimeBaseUrl, pack, fetchImpl, onProgress),
            baseEntriesPromise
        ]);
        if (index.fileCount !== pack.fileCount) {
            throw new Error(`invalid wasm-rust runtime pack ${pack.index}: expected ${pack.fileCount} files but got ${index.fileCount}`);
        }
        if (index.totalBytes !== pack.totalBytes) {
            throw new Error(`invalid wasm-rust runtime pack ${pack.index}: expected ${pack.totalBytes} bytes but got ${index.totalBytes}`);
        }
        if (index.format === 'wasm-rust-runtime-pack-index-v1') {
            if (pack.delta) {
                throw new Error(`invalid wasm-rust runtime pack ${pack.index}: delta reference requires a delta pack index`);
            }
            if (pack.decodedTotalBytes !== undefined &&
                pack.decodedTotalBytes !== index.totalBytes) {
                throw new Error(`invalid wasm-rust runtime pack ${pack.index}: expected ${pack.decodedTotalBytes} decoded bytes but got ${index.totalBytes}`);
            }
            if (packBytes.byteLength < index.totalBytes) {
                throw new Error(`invalid wasm-rust runtime pack ${pack.asset}: expected at least ${index.totalBytes} bytes but got ${packBytes.byteLength}`);
            }
            return index.entries.map((entry) => ({
                runtimePath: entry.runtimePath,
                bytes: packBytes.subarray(entry.offset, entry.offset + entry.length)
            }));
        }
        if (!pack.delta) {
            throw new Error(`invalid wasm-rust runtime pack ${pack.index}: delta pack index requires a delta reference`);
        }
        if (pack.delta.format !== 'copy-literal-v1') {
            throw new Error(`invalid wasm-rust runtime pack ${pack.index}: unsupported delta format ${String(pack.delta.format)}`);
        }
        if (pack.decodedTotalBytes !== undefined &&
            pack.decodedTotalBytes !== index.decodedTotalBytes) {
            throw new Error(`invalid wasm-rust runtime pack ${pack.index}: expected ${pack.decodedTotalBytes} decoded bytes but got ${index.decodedTotalBytes}`);
        }
        if (packBytes.byteLength !== index.totalBytes) {
            throw new Error(`invalid wasm-rust runtime delta pack ${pack.asset}: expected exactly ${index.totalBytes} encoded bytes but got ${packBytes.byteLength}`);
        }
        const baseEntryByRuntimePath = new Map((baseEntries || []).map((entry) => [entry.runtimePath, entry]));
        const decodedEntries = [];
        let decodedTotalBytes = 0;
        for (const entry of index.entries) {
            const baseEntry = entry.baseRuntimePath
                ? baseEntryByRuntimePath.get(entry.baseRuntimePath)
                : undefined;
            if (entry.baseRuntimePath && !baseEntry) {
                throw new Error(`invalid wasm-rust runtime delta pack ${pack.index}: base runtime path ${entry.baseRuntimePath} for ${entry.runtimePath} was not found`);
            }
            const encodedBytes = packBytes.subarray(entry.offset, entry.offset + entry.length);
            const encodedView = new DataView(encodedBytes.buffer, encodedBytes.byteOffset, encodedBytes.byteLength);
            let decodedBytes;
            try {
                decodedBytes = new Uint8Array(entry.decodedLength);
            }
            catch {
                throw new Error(`invalid wasm-rust runtime delta pack ${pack.index}: decoded length ${entry.decodedLength} for ${entry.runtimePath} is too large`);
            }
            let encodedOffset = 0;
            let decodedOffset = 0;
            while (encodedOffset < encodedBytes.byteLength) {
                const operationOffset = encodedOffset;
                const operation = encodedBytes[encodedOffset++];
                if (operation === 0) {
                    if (encodedBytes.byteLength - encodedOffset < 4) {
                        throw new Error(`invalid wasm-rust runtime delta pack ${pack.asset}: truncated literal operation at offset ${operationOffset} for ${entry.runtimePath}`);
                    }
                    const literalLength = encodedView.getUint32(encodedOffset, true);
                    encodedOffset += 4;
                    if (literalLength > encodedBytes.byteLength - encodedOffset) {
                        throw new Error(`invalid wasm-rust runtime delta pack ${pack.asset}: literal operation at offset ${operationOffset} exceeds the encoded entry for ${entry.runtimePath}`);
                    }
                    if (literalLength > decodedBytes.byteLength - decodedOffset) {
                        throw new Error(`invalid wasm-rust runtime delta pack ${pack.asset}: literal operation at offset ${operationOffset} exceeds decoded length ${entry.decodedLength} for ${entry.runtimePath}`);
                    }
                    decodedBytes.set(encodedBytes.subarray(encodedOffset, encodedOffset + literalLength), decodedOffset);
                    encodedOffset += literalLength;
                    decodedOffset += literalLength;
                    continue;
                }
                if (operation === 1) {
                    if (encodedBytes.byteLength - encodedOffset < 8) {
                        throw new Error(`invalid wasm-rust runtime delta pack ${pack.asset}: truncated copy operation at offset ${operationOffset} for ${entry.runtimePath}`);
                    }
                    const baseOffset = encodedView.getUint32(encodedOffset, true);
                    const copyLength = encodedView.getUint32(encodedOffset + 4, true);
                    encodedOffset += 8;
                    if (!baseEntry) {
                        throw new Error(`invalid wasm-rust runtime delta pack ${pack.index}: copy operation for ${entry.runtimePath} requires baseRuntimePath`);
                    }
                    if (baseOffset > baseEntry.bytes.byteLength ||
                        copyLength > baseEntry.bytes.byteLength - baseOffset) {
                        throw new Error(`invalid wasm-rust runtime delta pack ${pack.asset}: copy range ${baseOffset}+${copyLength} exceeds ${baseEntry.bytes.byteLength} bytes for base runtime path ${entry.baseRuntimePath}`);
                    }
                    if (copyLength > decodedBytes.byteLength - decodedOffset) {
                        throw new Error(`invalid wasm-rust runtime delta pack ${pack.asset}: copy operation at offset ${operationOffset} exceeds decoded length ${entry.decodedLength} for ${entry.runtimePath}`);
                    }
                    decodedBytes.set(baseEntry.bytes.subarray(baseOffset, baseOffset + copyLength), decodedOffset);
                    decodedOffset += copyLength;
                    continue;
                }
                throw new Error(`invalid wasm-rust runtime delta pack ${pack.asset}: unknown operation ${String(operation)} at offset ${operationOffset} for ${entry.runtimePath}`);
            }
            if (decodedOffset !== entry.decodedLength) {
                throw new Error(`invalid wasm-rust runtime delta pack ${pack.asset}: decoded ${decodedOffset} bytes but expected ${entry.decodedLength} for ${entry.runtimePath}`);
            }
            decodedTotalBytes += decodedBytes.byteLength;
            decodedEntries.push({ runtimePath: entry.runtimePath, bytes: decodedBytes });
        }
        if (decodedTotalBytes !== index.decodedTotalBytes) {
            throw new Error(`invalid wasm-rust runtime delta pack ${pack.asset}: decoded ${decodedTotalBytes} bytes but expected ${index.decodedTotalBytes}`);
        }
        return decodedEntries;
    }
    finally {
        ancestorIndexUrls.delete(indexUrl);
    }
}
export async function loadRuntimePackEntries(runtimeBaseUrl, pack, fetchImpl = fetch, onProgress) {
    if (!pack.delta) {
        return loadRuntimePackEntriesRecursive(runtimeBaseUrl, pack, fetchImpl, () => onProgress, new Set());
    }
    const packs = new Map();
    const pendingPacks = [pack];
    while (pendingPacks.length > 0) {
        const currentPack = pendingPacks.pop();
        const key = resolveVersionedAssetUrl(runtimeBaseUrl, currentPack.index).toString();
        if (packs.has(key))
            continue;
        packs.set(key, currentPack);
        if (currentPack.delta)
            pendingPacks.push(currentPack.delta.base);
    }
    const fractions = new Map([...packs.keys()].map((key) => [key, 0]));
    const weights = new Map([...packs].map(([key, reference]) => [key, Math.max(reference.totalBytes, 1)]));
    const aggregateTotal = [...weights.values()].reduce((total, weight) => total + weight, 0);
    const onProgressForPack = (currentPack) => {
        if (!onProgress)
            return undefined;
        const key = resolveVersionedAssetUrl(runtimeBaseUrl, currentPack.index).toString();
        return ({ loaded, total }) => {
            const fraction = total && total > 0 ? Math.min(Math.max(loaded / total, 0), 1) : loaded > 0 ? 1 : 0;
            fractions.set(key, Math.max(fractions.get(key) || 0, fraction));
            let aggregateLoaded = 0;
            for (const [packKey, weight] of weights) {
                aggregateLoaded += weight * (fractions.get(packKey) || 0);
            }
            onProgress({ loaded: aggregateLoaded, total: aggregateTotal });
        };
    };
    return loadRuntimePackEntriesRecursive(runtimeBaseUrl, pack, fetchImpl, onProgressForPack, new Set());
}
