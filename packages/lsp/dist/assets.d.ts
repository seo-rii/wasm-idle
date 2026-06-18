export type LanguageToolAssetRuntime = 'clangd';
export interface LanguageToolAssetLoadRequest {
    runtime: LanguageToolAssetRuntime;
    asset: string;
    reportProgress: (loaded: number, total?: number) => void;
}
export interface LanguageToolAssetDataResult {
    data: string | ArrayBuffer | Uint8Array | Blob;
    mimeType?: string;
}
export interface LanguageToolAssetUrlResult {
    url: string | URL;
}
export type LanguageToolAssetLoaderResult = LanguageToolAssetDataResult | LanguageToolAssetUrlResult | string | URL | ArrayBuffer | Uint8Array | Blob | null | undefined;
export type LanguageToolAssetLoader = (request: LanguageToolAssetLoadRequest) => LanguageToolAssetLoaderResult | Promise<LanguageToolAssetLoaderResult>;
export interface LanguageToolAssetConfig {
    baseUrl?: string;
    loader?: LanguageToolAssetLoader;
}
export interface ResolvedLanguageToolAssetConfig {
    baseUrl: string;
    loader?: LanguageToolAssetLoader;
}
export interface LoadedLanguageToolAsset {
    bytes: Uint8Array;
    mimeType?: string;
}
export declare const CLANGD_ASSETS: readonly ["clangd.js", "clangd.wasm.gz"];
export declare const CLANGD_VIRTUAL_BASE_URL = "https://wasm-idle.invalid/clangd/";
export declare const normalizeBaseUrl: (baseUrl: string, currentUrl?: string) => string;
export declare const normalizeRootUrl: (rootUrl: string) => string;
export declare const resolveRootToolBaseUrl: (rootUrl: string, toolPath: string, currentUrl?: string) => string;
export declare function loadLanguageToolAsset(runtime: LanguageToolAssetRuntime, asset: string, config: ResolvedLanguageToolAssetConfig, reportProgress: (loaded: number, total?: number) => void): Promise<LoadedLanguageToolAsset>;
//# sourceMappingURL=assets.d.ts.map