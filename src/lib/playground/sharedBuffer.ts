export type WasmIdleSharedBuffer = ArrayBuffer | SharedArrayBuffer;

export const isSharedArrayBufferAvailable = () =>
	typeof globalThis.SharedArrayBuffer === 'function' &&
	(typeof globalThis.crossOriginIsolated !== 'boolean' || globalThis.crossOriginIsolated);

export const createWasmIdleSharedBuffer = (byteLength: number): WasmIdleSharedBuffer =>
	isSharedArrayBufferAvailable()
		? new SharedArrayBuffer(byteLength)
		: new ArrayBuffer(byteLength);

export const isSharedBufferBacked = (buffer: ArrayBufferLike | undefined | null) =>
	typeof globalThis.SharedArrayBuffer === 'function' && buffer instanceof SharedArrayBuffer;

export const isSharedBufferBackedView = (view: ArrayBufferView | undefined | null) =>
	isSharedBufferBacked(view?.buffer);

export const requireSharedArrayBuffer = (feature: string) => {
	if (isSharedArrayBufferAvailable()) return;
	throw new Error(
		`${feature} requires SharedArrayBuffer. This browser context is not cross-origin isolated; provide stdin before starting the program and avoid interactive controls in this environment.`
	);
};
