import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
import type { RustLanguageServerTargetTriple } from './service.js';
export interface RustLanguageServerConfig {
    compilerUrl?: string;
    targetTriple?: RustLanguageServerTargetTriple;
    edition?: string;
}
export interface RustLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getRustLanguageServer(options?: EditorLanguageServerOptions | RustLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map