import { CLANGD_VIRTUAL_BASE_URL, normalizeBaseUrl, resolveRootToolBaseUrl } from './assets.js';
export function resolveCppLanguageServerRuntimeAssetConfig(options, currentUrl = '') {
    if (typeof options === 'string') {
        return {
            baseUrl: resolveRootToolBaseUrl(options, '/clangd/', currentUrl)
        };
    }
    const runtimeConfig = options?.cpp;
    if (runtimeConfig?.baseUrl) {
        return {
            baseUrl: normalizeBaseUrl(runtimeConfig.baseUrl, currentUrl),
            loader: runtimeConfig.loader
        };
    }
    if (options?.rootUrl) {
        return {
            baseUrl: resolveRootToolBaseUrl(options.rootUrl, '/clangd/', currentUrl),
            loader: runtimeConfig?.loader
        };
    }
    if (runtimeConfig?.loader) {
        return {
            baseUrl: CLANGD_VIRTUAL_BASE_URL,
            loader: runtimeConfig.loader
        };
    }
    return {
        baseUrl: normalizeBaseUrl('/clangd/', currentUrl)
    };
}
export function resolveCppLanguageServerBaseUrl(options, currentUrl = '') {
    return resolveCppLanguageServerRuntimeAssetConfig(options, currentUrl).baseUrl;
}
export function resolvePythonLanguageServerBaseUrl(options, currentUrl = '') {
    if (typeof options === 'string') {
        return resolveRootToolBaseUrl(options, '/pyodide/', currentUrl);
    }
    if (options?.python?.baseUrl) {
        return normalizeBaseUrl(options.python.baseUrl, currentUrl);
    }
    if (options?.rootUrl) {
        return resolveRootToolBaseUrl(options.rootUrl, '/pyodide/', currentUrl);
    }
    return normalizeBaseUrl('/pyodide/', currentUrl);
}
//# sourceMappingURL=runtime.js.map