import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface WatLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getWatLanguageServer(options?: EditorLanguageServerOptions | WatLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map