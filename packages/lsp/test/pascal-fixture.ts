import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const staticDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../static/wasm-pascal'
);

export const PASCAL_TEST_ASSET_NAMES = [
	'runtime-manifest.v2.json',
	'compiler.js.gz.bin',
	'rtl.js.bin',
	'system.pas.bin',
	'runner-worker.js'
] as const;

export type PascalTestAssetName = (typeof PASCAL_TEST_ASSET_NAMES)[number];

export const pascalTestAssetBytes = Object.fromEntries(
	PASCAL_TEST_ASSET_NAMES.map((asset) => [
		asset,
		Uint8Array.from(readFileSync(path.join(staticDirectory, asset)))
	])
) as Record<PascalTestAssetName, Uint8Array>;

export function createPascalTestAssetResponse(
	requestUrl: URL,
	overrides: Partial<Record<PascalTestAssetName, Uint8Array>> = {}
): Response | undefined {
	const marker = '/wasm-pascal/';
	const markerIndex = requestUrl.pathname.lastIndexOf(marker);
	if (markerIndex < 0) return undefined;
	const asset = requestUrl.pathname.slice(markerIndex + marker.length) as PascalTestAssetName;
	if (!PASCAL_TEST_ASSET_NAMES.includes(asset)) return undefined;
	const bytes = overrides[asset] || pascalTestAssetBytes[asset];
	const response = new Response(Uint8Array.from(bytes), {
		headers: {
			'content-length': String(bytes.byteLength),
			'content-type': asset.endsWith('.json')
				? 'application/json'
				: asset.endsWith('.js')
					? 'text/javascript'
					: 'application/octet-stream'
		}
	});
	Object.defineProperty(response, 'url', { value: requestUrl.href });
	return response;
}
