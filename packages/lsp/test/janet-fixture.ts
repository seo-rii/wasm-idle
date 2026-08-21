import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const staticDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../static/wasm-janet'
);

export const JANET_TEST_ASSET_NAMES = [
	'runtime-manifest.v2.json',
	'janet.js',
	'janet.wasm.gz.bin',
	'runner-worker.js'
] as const;

export type JanetTestAssetName = (typeof JANET_TEST_ASSET_NAMES)[number];

export const janetTestAssetBytes = Object.fromEntries(
	JANET_TEST_ASSET_NAMES.map((asset) => [
		asset,
		Uint8Array.from(readFileSync(path.join(staticDirectory, asset)))
	])
) as Record<JanetTestAssetName, Uint8Array>;

export function createJanetTestAssetResponse(
	requestUrl: URL,
	overrides: Partial<Record<JanetTestAssetName, Uint8Array>> = {}
): Response | undefined {
	const marker = '/wasm-janet/';
	const markerIndex = requestUrl.pathname.lastIndexOf(marker);
	if (markerIndex < 0) return undefined;
	const asset = requestUrl.pathname.slice(markerIndex + marker.length) as JanetTestAssetName;
	if (!JANET_TEST_ASSET_NAMES.includes(asset)) return undefined;
	const bytes = overrides[asset] || janetTestAssetBytes[asset];
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
