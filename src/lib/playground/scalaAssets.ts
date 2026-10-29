import {
	fetchPinnedRuntimeAsset,
	RuntimeConfigurationError,
	type RuntimeAssetCacheOptions
} from '@wasm-idle/core';
import {
	SCALA_ASSET_BASE_URL,
	SCALA_ASSET_RECEIPTS,
	SCALA_ASSET_REVISION
} from './worker/scala/asset-receipts.js';

export { SCALA_ASSET_BASE_URL, SCALA_ASSET_RECEIPTS, SCALA_ASSET_REVISION };
export type ScalaCompilerPayload = Record<string, Uint8Array>;

export interface ScalaCompilerAssetOptions {
	baseUrl?: string;
	persistentCache?: RuntimeAssetCacheOptions;
	signal?: AbortSignal;
	maxAssetBytes?: number;
	fetch?: typeof globalThis.fetch;
	onProgress?: (loaded: number, total: number) => void;
}

/** Capability preflight precedes every cache/network load of the large compiler. */
export function assertScalaBrowserSupport(
	wasm: typeof WebAssembly | undefined = globalThis.WebAssembly
): void {
	const features = wasm as unknown as Record<string, unknown> | undefined;
	const missing = ['JSTag', 'Suspending', 'promising'].filter((name) =>
		name === 'JSTag' ? features?.[name] === undefined : typeof features?.[name] !== 'function'
	);
	if (missing.length)
		throw new RuntimeConfigurationError(
			`Scala 3 requires WebAssembly ${missing.join(', ')}. This browser cannot run the Scala.js compiler.`,
			{ runtimeId: 'SCALA' }
		);
}

/** Fetches exactly the pinned graph; verified bytes, never remote URLs, cross into the Worker. */
export async function createScalaCompilerPayload(
	options: ScalaCompilerAssetOptions = {}
): Promise<ScalaCompilerPayload> {
	assertScalaBrowserSupport();
	options.signal?.throwIfAborted();
	let base: URL;
	try {
		base = new URL(options.baseUrl ?? SCALA_ASSET_BASE_URL, globalThis.location?.href);
	} catch {
		throw new RuntimeConfigurationError('Scala asset base URL is invalid.', {
			runtimeId: 'SCALA'
		});
	}
	if (
		!['http:', 'https:'].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash
	)
		throw new RuntimeConfigurationError(
			'Scala assets require an uncredentialed HTTP(S) base URL without query or fragment.',
			{ runtimeId: 'SCALA' }
		);
	if (!base.pathname.endsWith('/')) base.pathname += '/';
	const total = SCALA_ASSET_RECEIPTS.reduce((sum, receipt) => sum + receipt.bytes, 0);
	let loaded = 0;
	const payload: ScalaCompilerPayload = {};
	// Sequential loading bounds transient buffers and makes cancellation deterministic.
	for (const receipt of SCALA_ASSET_RECEIPTS) {
		const bytes = await fetchPinnedRuntimeAsset({
			url: new URL(receipt.path, base).href,
			receipt: { bytes: receipt.bytes, sha256: receipt.sha256 },
			persistentCache: options.persistentCache,
			signal: options.signal,
			maxAssetBytes: options.maxAssetBytes,
			fetch: options.fetch,
			onProgress: (size) => options.onProgress?.(loaded + size, total)
		});
		options.signal?.throwIfAborted();
		payload[receipt.path] = bytes;
		loaded += receipt.bytes;
	}
	return payload;
}
