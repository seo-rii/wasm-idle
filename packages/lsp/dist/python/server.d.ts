import type { EditorLanguageServerHandle, EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import type { PythonLspStatus } from './protocol.js';
export interface PythonLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    currentUrl?: string;
    onStatus?: (status: PythonLspStatus) => void;
}
export declare function createPythonLanguageServer(options?: EditorLanguageServerOptions | PythonLanguageServerOptions): Promise<EditorLanguageServerHandle>;
export declare const getPythonLanguageServer: typeof createPythonLanguageServer;
//# sourceMappingURL=server.d.ts.map