import {
	resolveRuntimeAssetLockPath,
	type ResolveRuntimeAssetLockOptions,
	type RuntimeAssetLockManifest
} from './runtime-asset-lock-manifest.js';

export interface LoadRuntimeAssetLockOptions extends ResolveRuntimeAssetLockOptions {
	/** Cancel this lookup without cancelling the shared inventory import. */
	signal?: AbortSignal;
}

function waitForManifest(
	pending: Promise<RuntimeAssetLockManifest>,
	signal?: AbortSignal
): Promise<RuntimeAssetLockManifest> {
	if (!signal) return pending;
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener('abort', abort);
			reject(
				signal.reason ?? new DOMException('Runtime asset lock load aborted', 'AbortError')
			);
		};
		signal.addEventListener('abort', abort, { once: true });
		pending.then(
			(manifest) => {
				signal.removeEventListener('abort', abort);
				resolve(manifest);
			},
			(error) => {
				signal.removeEventListener('abort', abort);
				reject(error);
			}
		);
		if (signal.aborted) abort();
	});
}

/** Keep failed imports retryable and share one pending import across concurrent asset loads. */
export function createRuntimeAssetLockLoader(
	load: () => Promise<RuntimeAssetLockManifest> = () =>
		import('./runtime-asset-lock.generated.js').then((module) => module.RUNTIME_ASSET_LOCK)
) {
	let pending: Promise<RuntimeAssetLockManifest> | undefined;
	return async (input: string | URL, options: LoadRuntimeAssetLockOptions) => {
		const signal = options.signal;
		signal?.throwIfAborted();
		const assetPath = resolveRuntimeAssetLockPath(input, options);
		if (assetPath === undefined) return undefined;
		let manifest = options.manifest;
		if (!manifest) {
			if (!pending) {
				const next = Promise.resolve().then(load);
				pending = next;
				void next.catch(() => {
					if (pending === next) pending = undefined;
				});
			}
			manifest = await waitForManifest(pending, signal);
		}
		signal?.throwIfAborted();
		return Object.prototype.hasOwnProperty.call(manifest.assets, assetPath)
			? manifest.assets[assetPath]
			: undefined;
	};
}

/** Load the bundled receipt inventory only when a built-in asset needs an inferred receipt. */
export const loadRuntimeAssetLockEntry = /* @__PURE__ */ createRuntimeAssetLockLoader();
