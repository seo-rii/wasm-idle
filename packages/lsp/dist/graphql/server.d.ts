import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface GraphqlLanguageServerConfig {
    schema?: string;
}
export interface GraphqlLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getGraphqlLanguageServer(options?: EditorLanguageServerOptions | GraphqlLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map