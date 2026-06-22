import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SHARED_LLD_WASM_ASSET = '../../shared/emscripten-lld/lld.wasm.gz';
export const SHARED_LLD_DATA_ASSET = '../../shared/emscripten-lld/lld.data.gz';

const sharedAssetNames = ['lld.wasm.gz', 'lld.data.gz'];

export async function validateSharedEmscriptenLldAssets({ sourceAssetDir, sharedAssetDir }) {
	const sourceStats = await Promise.all(
		sharedAssetNames.map((asset) => stat(path.join(sourceAssetDir, asset)).catch(() => null))
	);
	if (sourceStats.every((assetStats) => !assetStats)) return false;
	if (sourceStats.some((assetStats) => !assetStats?.isFile())) {
		throw new Error(`incomplete Emscripten LLD assets in ${sourceAssetDir}`);
	}

	for (const asset of sharedAssetNames) {
		const sourceBytes = await readFile(path.join(sourceAssetDir, asset));
		const sharedBytes = await readFile(path.join(sharedAssetDir, asset)).catch(() => null);
		if (!sharedBytes) {
			throw new Error(
				`shared Emscripten LLD asset was not found at ${path.join(sharedAssetDir, asset)}`
			);
		}
		if (!sourceBytes.equals(sharedBytes)) {
			throw new Error(
				`Emscripten LLD asset ${asset} differs from the canonical asset in ${sharedAssetDir}`
			);
		}
	}
	return true;
}

export async function rewriteSharedEmscriptenLldAssets({
	targetAssetDir,
	manifestPath,
	localWasmAsset,
	localDataAsset
}) {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	let replacements = 0;
	const replaceReferences = (value) => {
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length; index += 1) {
				value[index] = replaceReferences(value[index]);
			}
			return value;
		}
		if (value && typeof value === 'object') {
			for (const [key, child] of Object.entries(value)) {
				value[key] = replaceReferences(child);
			}
			return value;
		}
		if (value === localWasmAsset) {
			replacements += 1;
			return SHARED_LLD_WASM_ASSET;
		}
		if (value === localDataAsset) {
			replacements += 1;
			return SHARED_LLD_DATA_ASSET;
		}
		return value;
	};
	replaceReferences(manifest);
	if (replacements === 0) {
		throw new Error(`no Emscripten LLD references were found in ${manifestPath}`);
	}

	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	await Promise.all(
		sharedAssetNames.map((asset) => rm(path.join(targetAssetDir, asset), { force: true }))
	);
}
