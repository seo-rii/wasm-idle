import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbEhWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbEhWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import duckdbMvpWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdbMvpWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

export const bundles: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: duckdbMvpWasmUrl,
		mainWorker: duckdbMvpWorkerUrl
	},
	eh: {
		mainModule: duckdbEhWasmUrl,
		mainWorker: duckdbEhWorkerUrl
	}
};

export { duckdb };
