export async function fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl = fetch) {
    const resolvedAssetUrl = assetUrl.toString();
    let response;
    try {
        response = await fetchImpl(resolvedAssetUrl);
    }
    catch (error) {
        throw new Error(`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}. This usually means the browser loaded a stale wasm-rust bundle or blocked a nested runtime asset request; hard refresh and resync the runtime assets.`);
    }
    if (!response.ok) {
        throw new Error(`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status}). This usually means the browser loaded a stale wasm-rust bundle or a nested runtime asset is missing.`);
    }
    const assetBytes = new Uint8Array(await response.arrayBuffer());
    if (!new URL(resolvedAssetUrl).pathname.endsWith('.gz')) {
        return assetBytes;
    }
    if (typeof DecompressionStream !== 'function') {
        throw new Error(`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: this browser does not support DecompressionStream('gzip').`);
    }
    try {
        const decompressedResponse = new Response(new Blob([assetBytes]).stream().pipeThrough(new DecompressionStream('gzip')));
        return new Uint8Array(await decompressedResponse.arrayBuffer());
    }
    catch (error) {
        throw new Error(`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export async function fetchRuntimeAssetJson(assetUrl, assetLabel, fetchImpl = fetch) {
    return JSON.parse(new TextDecoder().decode(await fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl)));
}
