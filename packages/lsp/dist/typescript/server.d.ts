import type { CompilerOptions } from 'typescript';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface TypeScriptLanguageServerConfig {
    compilerOptions?: CompilerOptions;
    extraLibs?: Record<string, string>;
    libUrl?: string;
}
export interface TypeScriptLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare const getTypeScriptLanguageServer: (options?: EditorLanguageServerOptions | TypeScriptLanguageServerOptions) => Promise<import("../types.js").EditorLanguageServerHandle>;
export declare const getJavaScriptLanguageServer: (options?: EditorLanguageServerOptions | TypeScriptLanguageServerOptions) => Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map