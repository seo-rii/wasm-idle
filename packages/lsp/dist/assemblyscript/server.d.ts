import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface AssemblyScriptLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getAssemblyScriptLanguageServer(options?: EditorLanguageServerOptions | AssemblyScriptLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map