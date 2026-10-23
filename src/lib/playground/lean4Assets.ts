// Keep execution and editor asset verification, URL policy, and persistent-cache identity aligned.
export {
	LEAN4_RUNTIME_MANIFEST,
	LEAN4_INITIAL_MEMORY_BYTES,
	LEAN4_DEFAULT_WASM_MEMORY_BYTES,
	resolveLean4RuntimeAssetConfig,
	preflightLean4RuntimeAssets
} from '@wasm-idle/lsp/lean4';
