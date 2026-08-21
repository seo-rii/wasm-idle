import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const staticDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../static/wasm-perl'
);

export const PERL_TEST_ASSET_NAMES = [
	'runtime-manifest.v2.json',
	'emperl.js.gz.bin',
	'emperl.wasm.gz.bin',
	'emperl.data.gz.bin',
	'runner-worker.js'
] as const;

export type PerlTestAssetName = (typeof PERL_TEST_ASSET_NAMES)[number];

export const perlTestAssetBytes = Object.fromEntries(
	PERL_TEST_ASSET_NAMES.map((asset) => [
		asset,
		Uint8Array.from(readFileSync(path.join(staticDirectory, asset)))
	])
) as Record<PerlTestAssetName, Uint8Array>;

export function createPerlTestAssetResponse(
	requestUrl: URL,
	overrides: Partial<Record<PerlTestAssetName, Uint8Array>> = {}
): Response | undefined {
	const marker = '/wasm-perl/';
	const markerIndex = requestUrl.pathname.lastIndexOf(marker);
	if (markerIndex < 0) return undefined;
	const asset = requestUrl.pathname.slice(markerIndex + marker.length) as PerlTestAssetName;
	if (!PERL_TEST_ASSET_NAMES.includes(asset)) return undefined;
	const bytes = overrides[asset] || perlTestAssetBytes[asset];
	const contentType = asset.endsWith('.json')
		? 'application/json'
		: asset.endsWith('.js')
			? 'text/javascript'
			: 'application/octet-stream';
	const response = new Response(Uint8Array.from(bytes), {
		headers: {
			'content-length': String(bytes.byteLength),
			'content-type': contentType
		}
	});
	Object.defineProperty(response, 'url', { value: requestUrl.href });
	return response;
}
