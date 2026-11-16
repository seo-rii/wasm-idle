import type { RuntimeAssetCacheOptions } from '@wasm-idle/core';
import { createLockVerifiedFetch } from './lockVerifiedFetch';

/**
 * wasm-go resolves the global fetch for its manifest, tools and sysroot packs, relative to
 * its module directory. Serve the pinned release files under that directory from the
 * persistent cache, so a reload does not download the 19 MB compiler again. wasm-go's own
 * per-URL JSON reuse stays in effect because no fetch is injected into it.
 */
export function createGoAssetFetch(
	compilerUrl: string,
	persistentCache: RuntimeAssetCacheOptions | undefined,
	network: typeof fetch
): typeof fetch {
	let assetRoot: URL;
	try {
		assetRoot = new URL('./', compilerUrl);
	} catch {
		return network;
	}
	if (assetRoot.protocol !== 'https:' && assetRoot.protocol !== 'http:') return network;
	return createLockVerifiedFetch({
		assetRoot: assetRoot.href,
		assetPrefix: 'wasm-go',
		validationKey: 'wasm-go-worker-v1',
		persistentCache,
		fetch: network
	});
}
