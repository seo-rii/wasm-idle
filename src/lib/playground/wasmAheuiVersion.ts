// The original aheui 1.2.5 package is rebuilt deterministically by scripts/sync-wasm-aheui.mjs.
// Its pure Python wheel runs unchanged on the existing browser Pyodide runtime.
export const WASM_AHEUI_VERSION = '1.2.5';

export interface AheuiWheelReceipt {
	readonly fileName: string;
	readonly bytes: number;
	readonly sha256: string;
}

export const WASM_AHEUI_WHEELS: readonly AheuiWheelReceipt[] = Object.freeze([
	Object.freeze({
		fileName: 'aheui-1.2.5-py3-none-any.whl',
		bytes: 24259,
		sha256: '118d21234ba7e8252542286c825d01ea078b3b9468b56afdd1fae28238f869a3'
	})
]);
