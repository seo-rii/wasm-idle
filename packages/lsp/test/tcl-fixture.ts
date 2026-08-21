import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const staticDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../static/wasm-tcl'
);

export const TCL_TEST_ASSET_NAMES = [
	'runtime-manifest.v2.json',
	'require.js',
	'tcl/wacl-custom.data.bin',
	'tcl/wacl-library.data.gz.bin',
	'tcl/wacl.js',
	'tcl/wacl.wasm.gz.bin',
	'runner-worker.js'
] as const;

export type TclTestAssetName = (typeof TCL_TEST_ASSET_NAMES)[number];

export const tclTestAssetBytes = Object.fromEntries(
	TCL_TEST_ASSET_NAMES.map((asset) => [
		asset,
		Uint8Array.from(readFileSync(path.join(staticDirectory, asset)))
	])
) as Record<TclTestAssetName, Uint8Array>;

export function createTclTestAssetResponse(
	requestUrl: URL,
	overrides: Partial<Record<TclTestAssetName, Uint8Array>> = {}
): Response | undefined {
	const marker = '/wasm-tcl/';
	const markerIndex = requestUrl.pathname.lastIndexOf(marker);
	if (markerIndex < 0) return undefined;
	const asset = requestUrl.pathname.slice(markerIndex + marker.length) as TclTestAssetName;
	if (!TCL_TEST_ASSET_NAMES.includes(asset)) return undefined;
	const bytes = overrides[asset] || tclTestAssetBytes[asset];
	const contentType = asset.endsWith('.json')
		? 'application/json'
		: asset.endsWith('.js')
			? 'text/javascript'
			: asset.includes('.wasm.')
				? 'application/wasm'
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
