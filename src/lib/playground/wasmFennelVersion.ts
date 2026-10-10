/**
 * Pinned receipt for the official single-file Fennel compiler (`fennel.lua`).
 *
 * The asset is the unmodified upstream release from https://fennel-lang.org/downloads/
 * (MIT), gzip-compressed with `gzip -9 -n`. Fennel runs on the bundled wasm-lua
 * (wasmoon) Lua VM, so this receipt only covers the compiler source.
 */
export const WASM_FENNEL_COMPILER_RECEIPT = Object.freeze({
	fennelVersion: '1.6.1',
	path: 'wasm-fennel/fennel-1.6.1.lua.gz',
	bytes: 62385,
	sha256: '108b12fe2acb5c47c74c461d7ecbf5e00fb72102a9b927df985b9b4b858e49c0',
	uncompressedBytes: 301522,
	uncompressedSha256: 'c3d45602041e7d8ef8a212563573df040c48a85c648a29fb4597ebed4bc38ec2'
});

export type WasmFennelCompilerReceipt = {
	readonly fennelVersion: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly uncompressedBytes: number;
	readonly uncompressedSha256: string;
};

export const WASM_FENNEL_ASSET_VERSION = WASM_FENNEL_COMPILER_RECEIPT.sha256.slice(0, 16);
