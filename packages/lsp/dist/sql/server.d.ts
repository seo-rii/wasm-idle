import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
import type { SqlLanguageServerDialect } from './service.js';
import type { DuckDBBundles } from '@duckdb/duckdb-wasm';
export interface SqlLanguageServerConfig {
    dialect?: SqlLanguageServerDialect;
    wasmUrl?: string;
    duckdbBundles?: DuckDBBundles;
}
export interface SqlLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getSqlLanguageServer(options?: EditorLanguageServerOptions | SqlLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
export declare function getDuckDbLanguageServer(options?: EditorLanguageServerOptions | SqlLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map