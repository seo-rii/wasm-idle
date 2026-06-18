import type { EditorLanguageServerHandle, EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import type { ClangdStatus } from './config.js';
export interface ClangdLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    currentUrl?: string;
    onStatus?: (status: ClangdStatus) => void;
}
export declare function createClangdLanguageServer(options?: EditorLanguageServerOptions | ClangdLanguageServerOptions): Promise<EditorLanguageServerHandle>;
export declare const getCppLanguageServer: typeof createClangdLanguageServer;
//# sourceMappingURL=server.d.ts.map