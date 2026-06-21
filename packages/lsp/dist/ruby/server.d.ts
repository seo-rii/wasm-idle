import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface RubyLanguageServerConfig {
    wasmUrl?: string;
}
export interface RubyLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getRubyLanguageServer(options?: EditorLanguageServerOptions | RubyLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map