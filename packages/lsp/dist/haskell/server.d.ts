import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface HaskellLanguageServerConfig {
    moduleUrl?: string;
    rootfsUrl?: string;
    bsdtarUrl?: string;
    mainSoPath?: string;
    searchDirs?: string[];
    ghcArgs?: string;
}
export interface HaskellLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getHaskellLanguageServer(options?: EditorLanguageServerOptions | HaskellLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map