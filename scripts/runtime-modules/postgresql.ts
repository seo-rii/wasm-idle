// The package export map does not expose dist/* subpaths, so reference the
// exact files PGlite itself loads and let Vite emit them as hashed assets.
export const pgliteWasmUrl = new URL(
	'../../node_modules/@electric-sql/pglite/dist/pglite.wasm',
	import.meta.url
).href;
export const pgliteInitdbWasmUrl = new URL(
	'../../node_modules/@electric-sql/pglite/dist/initdb.wasm',
	import.meta.url
).href;
export const pgliteDataUrl = new URL(
	'../../node_modules/@electric-sql/pglite/dist/pglite.data',
	import.meta.url
).href;

// Keep the entry module small; the PGlite client and Emscripten glue load on demand.
export async function loadPGlite() {
	return (await import('@electric-sql/pglite')).PGlite;
}
