import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
import type { GoLanguageServerTarget } from './service.js';
export interface GoLanguageServerConfig {
    compilerUrl?: string;
    target?: GoLanguageServerTarget;
}
export interface GoLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getGoLanguageServer(options?: EditorLanguageServerOptions | GoLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map