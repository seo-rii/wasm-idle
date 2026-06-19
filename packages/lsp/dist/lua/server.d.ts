import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface LuaLanguageServerConfig {
    moduleUrl?: string;
}
export interface LuaLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getLuaLanguageServer(options?: EditorLanguageServerOptions | LuaLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map