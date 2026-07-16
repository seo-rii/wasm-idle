export declare const EMSCRIPTEN_LLD_PROFILE: Readonly<{
	id: 'emscripten-lld';
	version: 2;
	llvmVersion: '16.0.4';
	llvmCommit: 'ae42196bc493ffe877a7e3dff8be32035dea4d07';
	assets: readonly ['lld.js', 'lld.wasm.gz', 'lld.data.gz'];
}>;
export declare const SHARED_LLD_JS_ASSET = '../../shared/emscripten-lld/lld.js';
export declare const SHARED_LLD_WASM_ASSET = '../../shared/emscripten-lld/lld.wasm.gz';
export declare const SHARED_LLD_DATA_ASSET = '../../shared/emscripten-lld/lld.data.gz';
export interface EmscriptenLldAssetReferences {
	js: string;
	wasm: string;
	data: string;
}
export interface ValidateEmscriptenLldAssetsOptions {
	sourceAssetDir: string;
	sharedAssetDir: string;
}
export interface SyncCanonicalEmscriptenLldAssetsOptions {
	canonicalAssetDir: string;
	targetAssetDir: string;
}
export interface RewriteEmscriptenLldAssetsOptions {
	targetAssetDir: string;
	manifestPath: string;
	localJsAsset: string;
	localWasmAsset: string;
	localDataAsset: string;
	sharedAssetReferences?: EmscriptenLldAssetReferences;
}
export declare function validateSharedEmscriptenLldAssets({
	sourceAssetDir,
	sharedAssetDir
}: ValidateEmscriptenLldAssetsOptions): Promise<boolean>;
export declare function syncCanonicalEmscriptenLldAssets({
	canonicalAssetDir,
	targetAssetDir
}: SyncCanonicalEmscriptenLldAssetsOptions): Promise<{
	canonicalAssetDir: string;
	targetAssetDir: string;
	assets: readonly ['lld.js', 'lld.wasm.gz', 'lld.data.gz'];
}>;
export declare function rewriteSharedEmscriptenLldAssets({
	targetAssetDir,
	manifestPath,
	localJsAsset,
	localWasmAsset,
	localDataAsset,
	sharedAssetReferences
}: RewriteEmscriptenLldAssetsOptions): Promise<void>;
