import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
export interface DotnetLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    currentUrl?: string;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function resolveDotnetLanguageServerModuleUrl(options: EditorLanguageServerOptions | DotnetLanguageServerOptions | undefined, baseUrl?: string): string;
export declare const getCSharpLanguageServer: (options?: EditorLanguageServerOptions | DotnetLanguageServerOptions) => Promise<import("../types.js").EditorLanguageServerHandle>;
export declare const getVisualBasicLanguageServer: (options?: EditorLanguageServerOptions | DotnetLanguageServerOptions) => Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map