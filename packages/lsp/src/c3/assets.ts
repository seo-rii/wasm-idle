import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';
export const C3_LSP_VERSION = '0.4.0';
export type C3LspAssetReceipts = Readonly<
	Record<'c3_lsp.mjs' | 'c3_lsp.wasm' | 'stdlib.json.gz.bin', RuntimeAssetIntegrityEntry>
>;
export const C3_LSP_ASSET_RECEIPTS: C3LspAssetReceipts = Object.freeze({
	'c3_lsp.mjs': Object.freeze({
		bytes: 59746,
		sha256: '3908187e77957e3c2cfd58ee053971752233ea48cf18f174a5f2a207c03f46f7'
	}),
	'c3_lsp.wasm': Object.freeze({
		bytes: 275565,
		sha256: '2a15e2240a63ca40d3fa800ad172fc5a36a86de2f63343ef23a075e4c82a12a2'
	}),
	'stdlib.json.gz.bin': Object.freeze({
		bytes: 561963,
		sha256: '3c350d0356dd9b7bc23cb084ee39a79c43314d49ccf250c4897c2528ba786785'
	})
});
