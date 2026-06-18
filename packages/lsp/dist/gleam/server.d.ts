import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface GleamLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    currentUrl?: string;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getGleamLanguageServer(options?: EditorLanguageServerOptions | GleamLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map