async function readResponseBytes(response, onProgress) {
    const contentLength = response.headers.get('content-length');
    const total = contentLength ? Number(contentLength) : undefined;
    if (!response.body) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        onProgress?.({ loaded: bytes.byteLength, total: total ?? bytes.byteLength });
        return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        if (!value) {
            continue;
        }
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.({
            loaded,
            ...(total !== undefined ? { total } : {})
        });
    }
    if (chunks.length === 1) {
        return chunks[0];
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    if (loaded === 0) {
        onProgress?.({ loaded: 0, total: total ?? 0 });
    }
    return bytes;
}
export async function fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl = fetch, allowCompressedFallback = true, onProgress) {
    const resolvedAssetUrl = assetUrl.toString();
    const resolvedAssetUrlObject = new URL(resolvedAssetUrl);
    let response;
    try {
        response = await fetchImpl(resolvedAssetUrl);
    }
    catch (error) {
        throw new Error(`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}. This usually means the browser loaded a stale wasm-rust bundle or blocked a nested runtime asset request; hard refresh and resync the runtime assets.`);
    }
    const assetBytes = await readResponseBytes(response, onProgress);
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
            return await fetchRuntimeAssetBytes(compressedAssetUrl, assetLabel, fetchImpl, false, onProgress);
        }
        catch { }
    }
    if (!response.ok) {
        throw new Error(`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status}). This usually means the browser loaded a stale wasm-rust bundle or a nested runtime asset is missing.`);
    }
    if (responseLooksLikeHtml) {
        throw new Error(`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: expected a wasm-rust runtime asset but got HTML instead. This usually means the browser loaded a stale or wrong wasm-rust bundle, or the host rewrote a missing nested asset request to index.html; hard refresh and resync the runtime assets.`);
    }
    if (!new URL(resolvedAssetUrl).pathname.endsWith('.gz')) {
        return assetBytes;
    }
    if (assetBytes.byteLength < 2 || assetBytes[0] !== 0x1f || assetBytes[1] !== 0x8b) {
        return assetBytes;
    }
    if (typeof DecompressionStream !== 'function') {
        throw new Error(`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: this browser does not support DecompressionStream('gzip').`);
    }
    try {
        const assetBuffer = new Uint8Array(assetBytes).buffer;
        const decompressedResponse = new Response(new Blob([assetBuffer]).stream().pipeThrough(new DecompressionStream('gzip')));
        return new Uint8Array(await decompressedResponse.arrayBuffer());
    }
    catch (error) {
        throw new Error(`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export async function fetchRuntimeAssetJson(assetUrl, assetLabel, fetchImpl = fetch, onProgress) {
    return JSON.parse(new TextDecoder().decode(await fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl, true, onProgress)));
}
