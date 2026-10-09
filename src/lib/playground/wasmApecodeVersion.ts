// The unchanged APECode package is built deterministically by scripts/sync-wasm-apecode.mjs.
export const WASM_APECODE_VERSION = '0.1.0';

export interface ApecodeWheelReceipt {
	readonly fileName: string;
	readonly bytes: number;
	readonly sha256: string;
}

export const WASM_APECODE_WHEELS: readonly ApecodeWheelReceipt[] = Object.freeze([
	Object.freeze({
		fileName: 'apecode-0.1.0-py3-none-any.whl',
		bytes: 7484,
		sha256: '30aecb8eeff9a40cd55bb5fe5c18104f6c8308bdba9e71ac0b95d077badae30c'
	})
]);
