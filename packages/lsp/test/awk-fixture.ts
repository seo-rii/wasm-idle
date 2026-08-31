import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AWK_RUNTIME_WORKER_PATH } from '@wasm-idle/core';

export const AWK_TEST_ASSET_NAMES = [
	'runtime-manifest.v2.json',
	AWK_RUNTIME_WORKER_PATH,
	'wasm_exec.js',
	'goawk.wasm.gz.bin'
] as const;

export type AwkTestAssetName = (typeof AWK_TEST_ASSET_NAMES)[number];

const staticDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../static/wasm-awk'
);

export const awkTestAssetBytes = Object.fromEntries(
	AWK_TEST_ASSET_NAMES.map((asset) => [
		asset,
		new Uint8Array(readFileSync(path.join(staticDir, asset)))
	])
) as Record<AwkTestAssetName, Uint8Array>;

export function createAwkTestAssetResponse(
	url: URL,
	overrides: Partial<Record<AwkTestAssetName, Uint8Array>> = {}
): Response | null {
	const asset = AWK_TEST_ASSET_NAMES.find((candidate) => url.pathname.endsWith(`/${candidate}`));
	if (!asset) return null;
	const bytes = Uint8Array.from(overrides[asset] ?? awkTestAssetBytes[asset]);
	const response = new Response(bytes, {
		status: 200,
		headers: {
			'content-length': String(bytes.byteLength),
			'content-type': asset.endsWith('.json')
				? 'application/json'
				: asset.endsWith('.js')
					? 'text/javascript'
					: 'application/octet-stream'
		}
	});
	Object.defineProperty(response, 'url', { value: url.href });
	return response;
}
