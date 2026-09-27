import { BUNDLED_CLANG_ASSET_INTEGRITY } from './clangAssetIntegrity';

/** A custom loader or custom trust profile must keep using the asset bridge. */
export function shouldStreamBundledClang(config: {
	loader?: unknown;
	integrity?: unknown;
	allowedBaseUrls?: readonly string[];
}) {
	return (
		!config.loader &&
		config.allowedBaseUrls === undefined &&
		config.integrity === BUNDLED_CLANG_ASSET_INTEGRITY
	);
}
