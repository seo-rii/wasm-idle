import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const EMSCRIPTEN_LLD_PROFILE = Object.freeze({
	id: 'emscripten-lld',
	version: 2,
	llvmVersion: '16.0.4',
	llvmCommit: 'ae42196bc493ffe877a7e3dff8be32035dea4d07',
	assets: ['lld.js', 'lld.wasm.gz', 'lld.data.gz']
});
export const SHARED_LLD_JS_ASSET = '../../shared/emscripten-lld/lld.js';
export const SHARED_LLD_WASM_ASSET = '../../shared/emscripten-lld/lld.wasm.gz';
export const SHARED_LLD_DATA_ASSET = '../../shared/emscripten-lld/lld.data.gz';
export async function validateSharedEmscriptenLldAssets({ sourceAssetDir, sharedAssetDir }) {
	const sourceStats = await Promise.all(
		EMSCRIPTEN_LLD_PROFILE.assets.map((asset) =>
			stat(path.join(sourceAssetDir, asset)).catch(() => null)
		)
	);
	const binaryStats = sourceStats.slice(1);
	if (binaryStats.every((assetStats) => !assetStats)) return false;
	if (sourceStats.some((assetStats) => !assetStats?.isFile())) {
		throw new Error(`incomplete Emscripten LLD assets in ${sourceAssetDir}`);
	}
	for (const asset of EMSCRIPTEN_LLD_PROFILE.assets) {
		let sourceBytes = await readFile(path.join(sourceAssetDir, asset));
		let sharedBytes = await readFile(path.join(sharedAssetDir, asset)).catch(() => null);
		if (!sharedBytes) {
			throw new Error(
				`shared Emscripten LLD asset was not found at ${path.join(sharedAssetDir, asset)}`
			);
		}
		if (asset === 'lld.js') {
			sourceBytes = Buffer.from(sourceBytes.toString('utf8').replace(/[ \t]+$/gm, ''));
			sharedBytes = Buffer.from(sharedBytes.toString('utf8').replace(/[ \t]+$/gm, ''));
		}
		if (!sourceBytes.equals(sharedBytes)) {
			throw new Error(
				`Emscripten LLD asset ${asset} differs from the canonical asset in ${sharedAssetDir}`
			);
		}
	}
	return true;
}
export async function syncCanonicalEmscriptenLldAssets({ canonicalAssetDir, targetAssetDir }) {
	await mkdir(targetAssetDir, { recursive: true });
	for (const asset of EMSCRIPTEN_LLD_PROFILE.assets) {
		const sourcePath = path.join(canonicalAssetDir, asset);
		const sourceStats = await stat(sourcePath).catch(() => null);
		if (!sourceStats?.isFile()) {
			throw new Error(`canonical Emscripten LLD asset was not found at ${sourcePath}`);
		}
		await cp(sourcePath, path.join(targetAssetDir, asset));
	}
	return { canonicalAssetDir, targetAssetDir, assets: EMSCRIPTEN_LLD_PROFILE.assets };
}
export async function rewriteSharedEmscriptenLldAssets({
	targetAssetDir,
	manifestPath,
	localJsAsset,
	localWasmAsset,
	localDataAsset,
	sharedAssetReferences = {
		js: SHARED_LLD_JS_ASSET,
		wasm: SHARED_LLD_WASM_ASSET,
		data: SHARED_LLD_DATA_ASSET
	}
}) {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const replacements = { js: 0, wasm: 0, data: 0 };
	const replaceReferences = (value) => {
		if (Array.isArray(value)) {
			return value.map(replaceReferences);
		}
		if (value && typeof value === 'object') {
			for (const [key, child] of Object.entries(value)) {
				value[key] = replaceReferences(child);
			}
			return value;
		}
		if (value === localJsAsset) {
			replacements.js += 1;
			return sharedAssetReferences.js;
		}
		if (value === localWasmAsset) {
			replacements.wasm += 1;
			return sharedAssetReferences.wasm;
		}
		if (value === localDataAsset) {
			replacements.data += 1;
			return sharedAssetReferences.data;
		}
		return value;
	};
	const rewrittenManifest = replaceReferences(manifest);
	const missingReferences = Object.entries(replacements)
		.filter(([, count]) => count === 0)
		.map(([asset]) => asset);
	if (missingReferences.length > 0) {
		throw new Error(
			`Emscripten LLD references were not found in ${manifestPath}: ${missingReferences.join(', ')}`
		);
	}
	await writeFile(manifestPath, `${JSON.stringify(rewrittenManifest, null, 2)}\n`, 'utf8');
	await Promise.all(
		EMSCRIPTEN_LLD_PROFILE.assets.map((asset) =>
			rm(path.join(targetAssetDir, asset), { force: true })
		)
	);
}
