import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const staticDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../static/wasm-prolog'
);

export const PROLOG_TEST_ASSET_NAMES = [
	'runtime-manifest.v2.json',
	'swipl-web.js',
	'swipl-web.wasm.gz.bin',
	'swipl-web.data.gz.bin',
	'runner-worker.js'
] as const;

export type PrologTestAssetName = (typeof PROLOG_TEST_ASSET_NAMES)[number];

export const prologTestAssetBytes = Object.fromEntries(
	PROLOG_TEST_ASSET_NAMES.map((asset) => [
		asset,
		Uint8Array.from(readFileSync(path.join(staticDirectory, asset)))
	])
) as Record<PrologTestAssetName, Uint8Array>;

export function createPrologTestAssetResponse(
	requestUrl: URL,
	overrides: Partial<Record<PrologTestAssetName, Uint8Array>> = {}
): Response | undefined {
	const asset = path.basename(requestUrl.pathname) as PrologTestAssetName;
	if (!PROLOG_TEST_ASSET_NAMES.includes(asset)) return undefined;
	const bytes = overrides[asset] || prologTestAssetBytes[asset];
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
