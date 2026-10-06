// Pinned by scripts/sync-wasm-hy.mjs. Both wheels are pure Python and install into the bundled
// Pyodide runtime; they are served from static/wasm-hy/ and never fetched from PyPI at runtime.
export const WASM_HY_VERSION = '1.3.1';

export interface HyWheelReceipt {
	readonly fileName: string;
	readonly bytes: number;
	readonly sha256: string;
}

export const WASM_HY_WHEELS: readonly HyWheelReceipt[] = Object.freeze([
	Object.freeze({
		fileName: 'funcparserlib-1.0.1-py2.py3-none-any.whl',
		bytes: 17842,
		sha256: '95da15d3f0d00b9b6f4bf04005c708af3faa115f7b45692ace064ebe758c68e8'
	}),
	Object.freeze({
		fileName: 'hy-1.3.1-py3-none-any.whl',
		bytes: 122343,
		sha256: 'fef54e98b2080cd3993d5ce5a4310ef2b0fc756c972203b86fedc0e0f2908f53'
	})
]);
