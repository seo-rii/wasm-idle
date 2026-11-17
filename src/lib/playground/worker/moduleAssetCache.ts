import type { RuntimeAssetCacheOptions } from '@wasm-idle/core';
import { createLockVerifiedFetch } from './lockVerifiedFetch';

/**
 * Serve the pinned release files under a runtime module's directory from the persistent
 * cache. Runtime loaders such as wasm-go, the .NET boot loader and Emscripten resolve the
 * global fetch when they request their payloads, so a dedicated runtime Worker installs
 * the result as its global fetch before it imports the module. `assetPrefix` is the
 * module directory's path in the bundled release lock, for example `wasm-go`.
 */
export function createModuleAssetFetch(
	moduleUrl: string,
	assetPrefix: string,
	persistentCache: RuntimeAssetCacheOptions | undefined,
	network: typeof fetch
): typeof fetch {
	let assetRoot: URL;
	try {
		assetRoot = new URL('./', moduleUrl);
	} catch {
		return network;
	}
	if (assetRoot.protocol !== 'https:' && assetRoot.protocol !== 'http:') return network;
	return createLockVerifiedFetch({
		assetRoot: assetRoot.href,
		assetPrefix,
		validationKey: `${assetPrefix}-worker-v1`,
		persistentCache,
		fetch: network
	});
}
