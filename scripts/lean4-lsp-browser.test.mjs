import { test } from 'node:test';

test(
	'original Lean 4 SDK in Chromium',
	{ skip: process.env.WASM_IDLE_LEAN4_LSP_BROWSER !== '1', timeout: 360000 },
	async () => {
		const { runLean4LspBrowserProbe } = await import('./test-lean4-lsp-browser.mjs');
		await runLean4LspBrowserProbe();
	}
);
