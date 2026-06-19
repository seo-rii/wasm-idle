import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface PhpLanguageServerConfig {
    version?: string;
}
export interface PhpLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getPhpLanguageServer(options?: EditorLanguageServerOptions | PhpLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map