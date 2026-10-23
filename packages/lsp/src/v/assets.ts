import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';
export const V_LSP_VERSION = '0.0.6';
export type VLspAssetReceipts = Readonly<
	Record<'v_analyzer.mjs' | 'v_analyzer.wasm' | 'stdlib.json.gz.bin', RuntimeAssetIntegrityEntry>
>;
export const V_LSP_ASSET_RECEIPTS: VLspAssetReceipts = Object.freeze({
	'v_analyzer.mjs': Object.freeze({
		bytes: 75647,
		sha256: '99a2447cc8040f3af1ce4570f32fa852a2a58d75c890d1a4d02862ea0071fb7e'
	}),
	'v_analyzer.wasm': Object.freeze({
		bytes: 2919935,
		sha256: '76278f3933137eef0685dbfd0f3d7e32dee682ff759e8ac80758a663a6445d88'
	}),
	'stdlib.json.gz.bin': Object.freeze({
		bytes: 2731779,
		sha256: '7098b54f1a246619c8414b937742a0ab2634c9b8948d08ad8f9466c8e23225e3'
	})
});
