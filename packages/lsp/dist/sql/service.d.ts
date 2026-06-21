import type { DuckDBBundles } from '@duckdb/duckdb-wasm';
import { type WorkerLanguageService } from '../lsp.js';
export type SqlLanguageServerDialect = 'sql' | 'sqlite' | 'duckdb';
export interface SqlWorkerOptions {
    dialect?: SqlLanguageServerDialect;
    wasmUrl?: string;
    duckdbBundles?: DuckDBBundles;
}
export interface SqlEngineDiagnostic {
    message: string;
    lineNumber?: number;
    columnNumber?: number;
    severity?: 'error' | 'warning' | 'info';
}
export interface SqlEngine {
    validate(code: string, fileName: string): Promise<SqlEngineDiagnostic[]> | SqlEngineDiagnostic[];
    dispose?: () => void | Promise<void>;
}
export type LoadSqlEngine = (options: SqlWorkerOptions) => Promise<SqlEngine>;
export declare function createSqlWorkerService(loadEngine?: LoadSqlEngine): WorkerLanguageService;
//# sourceMappingURL=service.d.ts.map