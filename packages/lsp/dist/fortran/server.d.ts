import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface FortranLanguageServerConfig {
    analyzerUrl?: string;
    parserWasmUrl?: string;
    grammarUrl?: string;
}
export interface FortranLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getFortranLanguageServer(options?: EditorLanguageServerOptions | FortranLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map