export const CLANGD_ASSETS = ['clangd.js', 'clangd.wasm.gz'];
export const CLANGD_VIRTUAL_BASE_URL = 'https://wasm-idle.invalid/clangd/';
const textEncoder = new TextEncoder();
export const normalizeBaseUrl = (baseUrl, currentUrl = '') => {
    const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return currentUrl ? new URL(normalized, currentUrl).href : normalized;
};
export const normalizeRootUrl = (rootUrl) => rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : rootUrl;
export const resolveRootToolBaseUrl = (rootUrl, toolPath, currentUrl = '') => normalizeBaseUrl(`${normalizeRootUrl(rootUrl) || ''}${toolPath}`, currentUrl);
async function fetchAsset(url, asset, reportProgress) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`Failed to load ${asset}: ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0) || undefined;
    const mimeType = response.headers.get('content-type') || undefined;
    if (!response.body) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        reportProgress(bytes.byteLength, contentLength ?? bytes.byteLength);
        return { bytes, mimeType };
    }
    const reader = response.body.getReader();
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
        reportProgress(receivedLength, contentLength);
    }
    const bytes = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, position);
        position += chunk.byteLength;
    }
    reportProgress(receivedLength, contentLength ?? receivedLength);
    return { bytes, mimeType };
}
async function normalizeLoaderResult(result, asset, reportProgress) {
    if (!result)
        return null;
    if (typeof result === 'string' || result instanceof URL) {
        return await fetchAsset(String(result), asset, reportProgress);
    }
    if (result instanceof ArrayBuffer) {
        const bytes = new Uint8Array(result);
        reportProgress(bytes.byteLength, bytes.byteLength);
        return { bytes };
    }
    if (result instanceof Uint8Array) {
        reportProgress(result.byteLength, result.byteLength);
        return { bytes: result };
    }
    if (result instanceof Blob) {
        const bytes = new Uint8Array(await result.arrayBuffer());
        reportProgress(bytes.byteLength, bytes.byteLength);
        return { bytes, mimeType: result.type || undefined };
    }
    if ('url' in result && result.url) {
        return await fetchAsset(String(result.url), asset, reportProgress);
    }
    if ('data' in result) {
        if (typeof result.data === 'string') {
            const bytes = textEncoder.encode(result.data);
            reportProgress(bytes.byteLength, bytes.byteLength);
            return { bytes, mimeType: result.mimeType };
        }
        if (result.data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(result.data);
            reportProgress(bytes.byteLength, bytes.byteLength);
            return { bytes, mimeType: result.mimeType };
        }
        if (result.data instanceof Uint8Array) {
            reportProgress(result.data.byteLength, result.data.byteLength);
            return { bytes: result.data, mimeType: result.mimeType };
        }
        const bytes = new Uint8Array(await result.data.arrayBuffer());
        reportProgress(bytes.byteLength, bytes.byteLength);
        return { bytes, mimeType: result.mimeType || result.data.type || undefined };
    }
    return null;
}
export async function loadLanguageToolAsset(runtime, asset, config, reportProgress) {
    if (config.loader) {
        const loaded = await normalizeLoaderResult(await config.loader({ runtime, asset, reportProgress }), asset, reportProgress);
        if (loaded)
            return loaded;
    }
    return await fetchAsset(new URL(asset, config.baseUrl).href, asset, reportProgress);
}
//# sourceMappingURL=assets.js.map