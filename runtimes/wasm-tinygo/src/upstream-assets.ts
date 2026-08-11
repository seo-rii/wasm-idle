import {
	DEFAULT_MAX_TINYGO_ASSET_BYTES,
	loadRuntimeAssetBytes,
	type TinyGoRuntimeAssetLoader,
	type TinyGoRuntimeAssetProgressCallback
} from './runtime-assets.ts';
import {
	parseTinyGoUpstreamAssetManifest,
	type TinyGoUpstreamAssetEvidence
} from './upstream-contract.ts';
import type { TinyGoUpstreamToolchainAssets } from './upstream-runtime.ts';

export const DEFAULT_TINYGO_UPSTREAM_MANIFEST_PATH =
	'tools/upstream/upstream-toolchain.v2.json' as const;
const MAX_UPSTREAM_MANIFEST_BYTES = 1024 * 1024;

function normalizeBaseUrl(value: string) {
	return value.endsWith('/') ? value : `${value}/`;
}

function resolveRelativeAssetPath(manifestPath: string, evidence: TinyGoUpstreamAssetEvidence) {
	const separator = manifestPath.lastIndexOf('/');
	const directory = separator === -1 ? '' : manifestPath.slice(0, separator + 1);
	return `${directory}${evidence.path}`;
}

export async function loadTinyGoUpstreamToolchainAssets(options: {
	assetBaseUrl: string;
	manifestPath?: string;
	fetchImpl?: typeof fetch;
	loader?: TinyGoRuntimeAssetLoader;
	onProgress?: TinyGoRuntimeAssetProgressCallback;
	signal?: AbortSignal;
	maxAssetBytes?: number;
}): Promise<TinyGoUpstreamToolchainAssets> {
	const assetBaseUrl = normalizeBaseUrl(options.assetBaseUrl);
	const manifestPath = options.manifestPath ?? DEFAULT_TINYGO_UPSTREAM_MANIFEST_PATH;
	const manifestUrl = new URL(manifestPath, assetBaseUrl).toString();
	const manifestBytes = await loadRuntimeAssetBytes({
		assetPath: manifestPath,
		assetUrl: manifestUrl,
		label: 'upstream TinyGo toolchain manifest',
		...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
		...(options.loader ? { loader: options.loader } : {}),
		...(options.onProgress ? { onProgress: options.onProgress } : {}),
		...(options.signal ? { signal: options.signal } : {}),
		maxAssetBytes: MAX_UPSTREAM_MANIFEST_BYTES
	});
	let manifestValue: unknown;
	try {
		manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes));
	} catch (error) {
		throw new Error('upstream TinyGo toolchain manifest is not valid JSON', { cause: error });
	}
	const manifest = parseTinyGoUpstreamAssetManifest(manifestValue);
	const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_TINYGO_ASSET_BYTES;
	const load = async (label: string, evidence: TinyGoUpstreamAssetEvidence) => {
		const assetPath = resolveRelativeAssetPath(manifestPath, evidence);
		return await loadRuntimeAssetBytes({
			assetPath,
			assetUrl: new URL(evidence.path, manifestUrl).toString(),
			label,
			...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
			...(options.loader ? { loader: options.loader } : {}),
			...(options.onProgress ? { onProgress: options.onProgress } : {}),
			...(options.signal ? { signal: options.signal } : {}),
			maxAssetBytes
		});
	};
	const [producerReceipt, packageGraphReceipt, compiler, packageGraph, rootArchive, lld] =
		await Promise.all([
			load('upstream TinyGo producer receipt', manifest.producerReceipt),
			load('upstream TinyGo package-graph producer receipt', manifest.packageGraphReceipt),
			load('upstream TinyGo compiler', manifest.assets.compiler),
			load('upstream Go package-graph provider', manifest.assets.packageGraph),
			load('upstream TinyGo root archive', manifest.assets.rootArchive),
			load('raw WASI LLD', manifest.assets.lld)
		]);
	return {
		manifest,
		producerReceipt,
		packageGraphReceipt,
		compiler,
		packageGraph,
		rootArchive,
		lld
	};
}
