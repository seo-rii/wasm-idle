import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
import type { ZigLanguageServerTargetTriple } from './service.js';
export interface ZigLanguageServerConfig {
    compilerUrl?: string;
    stdlibUrl?: string;
    targetTriple?: ZigLanguageServerTargetTriple;
    compileArgs?: string[];
}
export interface ZigLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getZigLanguageServer(options?: EditorLanguageServerOptions | ZigLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map