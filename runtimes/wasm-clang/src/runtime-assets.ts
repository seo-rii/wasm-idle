import {
	resolveRuntimeBaseUrl,
	resolveVersionedAssetUrl,
	runtimeManifestUrl
} from './url.js';
import type { RuntimeManifestV1 } from './types.js';

export interface RuntimeAssetUrls {
	manifest: string;
	memfs: string;
	clang: string;
	lld: string;
	sysroot: string;
	clangdJs: string;
	clangdWasm: string;
}

export function resolveRuntimeAssetUrls(
	baseUrl?: string | URL,
	manifest?: RuntimeManifestV1
): RuntimeAssetUrls {
	const runtimeBaseUrl = resolveRuntimeBaseUrl(baseUrl);
	return {
		manifest: runtimeManifestUrl(runtimeBaseUrl).toString(),
		memfs: resolveVersionedAssetUrl(
			runtimeBaseUrl,
			manifest?.compiler.memfs.asset || 'bin/memfs.zip'
		).toString(),
		clang: resolveVersionedAssetUrl(
			runtimeBaseUrl,
			manifest?.compiler.clang.asset || 'bin/clang.zip'
		).toString(),
		lld: resolveVersionedAssetUrl(
			runtimeBaseUrl,
			manifest?.compiler.lld.asset || 'bin/lld.zip'
		).toString(),
		sysroot: resolveVersionedAssetUrl(
			runtimeBaseUrl,
			manifest?.compiler.sysroot.asset || 'bin/sysroot.tar.zip'
		).toString(),
		clangdJs: resolveVersionedAssetUrl(
			runtimeBaseUrl,
			manifest?.clangd.js || 'clangd/clangd.js'
		).toString(),
		clangdWasm: resolveVersionedAssetUrl(
			runtimeBaseUrl,
			manifest?.clangd.wasm || 'clangd/clangd.wasm.gz'
		).toString()
	};
}
