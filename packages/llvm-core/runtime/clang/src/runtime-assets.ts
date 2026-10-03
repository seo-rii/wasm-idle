import { resolveRuntimeBaseUrl, resolveVersionedAssetUrl, runtimeManifestUrl } from './url.js';
import type { RuntimeManifestV1 } from './types.js';

export interface RuntimeAssetUrls {
	manifest: string;
	memfs: string;
	clang: string;
	lld: string;
	sysroot: string;
	cSysroot?: string;
	cppAddon?: string;
	printscanLongDouble?: string;
	clangdJs: string;
	clangdWasm: string;
}

export function resolveRuntimeAssetUrls(
	baseUrl: string | URL,
	manifest?: RuntimeManifestV1
): RuntimeAssetUrls {
	const runtimeBaseUrl = resolveRuntimeBaseUrl(baseUrl);
	const profiles = manifest?.compiler.sysroot.profiles;
	if (
		profiles &&
		(typeof profiles.c?.asset !== 'string' ||
			!profiles.c.asset ||
			typeof profiles.cppAddon?.asset !== 'string' ||
			!profiles.cppAddon.asset)
	) {
		throw new TypeError('Clang sysroot profiles require both C and C++ add-on assets');
	}
	return {
		manifest: runtimeManifestUrl(runtimeBaseUrl).toString(),
		memfs: resolveVersionedAssetUrl(
			runtimeBaseUrl,
			manifest?.compiler.memfs.asset || 'bin/memfs.wasm.gz'
		).toString(),
		clang: resolveVersionedAssetUrl(
			runtimeBaseUrl,
			manifest?.compiler.clang.asset || 'bin/clang.wasm.gz'
		).toString(),
		lld: resolveVersionedAssetUrl(
			runtimeBaseUrl,
			manifest?.compiler.lld.asset || 'bin/lld.wasm.gz'
		).toString(),
		sysroot: resolveVersionedAssetUrl(
			runtimeBaseUrl,
			manifest?.compiler.sysroot.asset || 'bin/sysroot.tar.gz'
		).toString(),
		...(profiles
			? {
					cSysroot: resolveVersionedAssetUrl(runtimeBaseUrl, profiles.c.asset).toString(),
					cppAddon: resolveVersionedAssetUrl(
						runtimeBaseUrl,
						profiles.cppAddon.asset
					).toString()
				}
			: {}),
		...(manifest?.compiler.sysroot.printscanLongDouble
			? {
					printscanLongDouble: resolveVersionedAssetUrl(
						runtimeBaseUrl,
						manifest.compiler.sysroot.printscanLongDouble.asset
					).toString()
				}
			: {}),
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
