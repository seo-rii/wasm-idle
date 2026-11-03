import type { RuntimeAssetIntegrityEntry } from './runtime-assets.js';

/** The bytes returned by a download, or the logical bytes of a compressed/layered asset. */
export interface RuntimeAssetLockEntry extends RuntimeAssetIntegrityEntry {
	readonly bytes: number;
	/** Physical gzip payloads retain both compressed and decoded integrity receipts. */
	readonly encoding?: 'gzip';
	/** Manifest-relative physical payload for a logical gzip alias. */
	readonly deliveryPath?: string;
	/** Logical assets that are delivered as a range in a shared gzip pack. */
	readonly layer?: { readonly path: string; readonly offset: number; readonly bytes: number };
}

export interface RuntimeAssetLockManifest {
	readonly schemaVersion: 1;
	readonly version: string;
	readonly assets: Readonly<Record<string, RuntimeAssetLockEntry>>;
}

export interface ResolveRuntimeAssetLockOptions {
	/** Explicit deployment root. A matching filename on another origin is never sufficient. */
	assetRoot: string | URL;
	/** Manifest directory when assetRoot names one runtime instead of the whole deployment. */
	assetPrefix?: string;
	/** Explicitly supplied lock for a host's custom runtime distribution. */
	manifest?: RuntimeAssetLockManifest;
}

/**
 * Resolve a release-relative asset path inside an explicitly configured deployment root.
 * Query-bearing, credentialed and fragment-bearing URLs are intentionally not inferred.
 */
export function resolveRuntimeAssetLockPath(
	input: string | URL,
	options: ResolveRuntimeAssetLockOptions
): string | undefined {
	try {
		const root = new URL(options.assetRoot);
		if (
			!/^https?:$/u.test(root.protocol) ||
			root.username ||
			root.password ||
			root.search ||
			root.hash
		) {
			return undefined;
		}
		if (!root.pathname.endsWith('/')) root.pathname += '/';
		const url = new URL(input, root);
		if (
			url.origin !== root.origin ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			!url.pathname.startsWith(root.pathname)
		) {
			return undefined;
		}
		const relativePath = url.pathname.slice(root.pathname.length);
		// Do not guess server-specific handling of encoded path separators or dot segments.
		if (!relativePath || /[%\\\0]/u.test(relativePath)) return undefined;
		const prefix = options.assetPrefix?.replace(/\/$/u, '') ?? '';
		if (
			prefix &&
			(prefix.startsWith('/') ||
				/[%\\\0]/u.test(prefix) ||
				prefix.split('/').some((part) => !part || part === '.' || part === '..'))
		) {
			return undefined;
		}
		return prefix ? `${prefix}/${relativePath}` : relativePath;
	} catch {
		return undefined;
	}
}

/** Look up an explicit inventory without importing the bundled release table. */
export function resolveRuntimeAssetLockEntryFromManifest(
	input: string | URL,
	options: ResolveRuntimeAssetLockOptions & { manifest: RuntimeAssetLockManifest }
): RuntimeAssetLockEntry | undefined {
	const assetPath = resolveRuntimeAssetLockPath(input, options);
	if (assetPath === undefined) return undefined;
	try {
		const assets = options.manifest.assets;
		return Object.prototype.hasOwnProperty.call(assets, assetPath)
			? assets[assetPath]
			: undefined;
	} catch {
		return undefined;
	}
}
