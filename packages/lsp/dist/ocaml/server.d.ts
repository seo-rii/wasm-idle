import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { type LanguageServerStatus } from '../worker-client.js';
import type { OcamlLanguageServerBinaryenMode, OcamlLanguageServerEffectsMode, OcamlLanguageServerTarget } from './service.js';
export interface OcamlLanguageServerConfig {
    moduleUrl?: string;
    manifestUrl?: string;
    target?: OcamlLanguageServerTarget;
    effectsMode?: OcamlLanguageServerEffectsMode;
    wasmBinaryenMode?: OcamlLanguageServerBinaryenMode;
    packages?: string[];
}
export interface OcamlLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function getOcamlLanguageServer(options?: EditorLanguageServerOptions | OcamlLanguageServerOptions): Promise<import("../types.js").EditorLanguageServerHandle>;
//# sourceMappingURL=server.d.ts.map