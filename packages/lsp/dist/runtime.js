import { CLANGD_VIRTUAL_BASE_URL, normalizeBaseUrl, normalizeRootUrl, resolveRootToolBaseUrl } from './assets.js';
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
const resolveFileUrl = (value, currentUrl = '') => currentUrl ? new URL(value, currentUrl).href : value;
export function resolveRustLanguageServerCompilerUrl(options, currentUrl = '') {
    if (typeof options === 'string') {
        return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-rust/index.js`, currentUrl);
    }
    if (options?.rust?.compilerUrl) {
        return resolveFileUrl(options.rust.compilerUrl, currentUrl);
    }
    if (options?.rootUrl) {
        return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-rust/index.js`, currentUrl);
    }
    return resolveFileUrl('/wasm-rust/index.js', currentUrl);
}
export function resolveGoLanguageServerCompilerUrl(options, currentUrl = '') {
    if (typeof options === 'string') {
        return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-go/index.js`, currentUrl);
    }
    if (options?.go?.compilerUrl) {
        return resolveFileUrl(options.go.compilerUrl, currentUrl);
    }
    if (options?.rootUrl) {
        return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-go/index.js`, currentUrl);
    }
    return resolveFileUrl('/wasm-go/index.js', currentUrl);
}
//# sourceMappingURL=runtime.js.map