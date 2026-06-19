import { type LspDocumentContext, type WorkerLanguageService } from '../lsp.js';
export type OcamlLanguageServerTarget = 'js' | 'wasm';
export type OcamlLanguageServerEffectsMode = 'cps' | 'jspi';
export type OcamlLanguageServerBinaryenMode = 'fast' | 'full';
export interface OcamlWorkerOptions {
    moduleUrl: string;
    manifestUrl: string;
    target?: OcamlLanguageServerTarget;
    effectsMode?: OcamlLanguageServerEffectsMode;
    wasmBinaryenMode?: OcamlLanguageServerBinaryenMode;
    packages?: string[];
}
interface OcamlCompilerDiagnostic {
    file?: string | null;
    fileName?: string | null;
    line?: number;
    lineNumber?: number;
    column?: number;
    columnNumber?: number;
    endColumn?: number;
    endColumnNumber?: number;
    severity?: 'error' | 'warning' | 'other';
    message?: string;
}
interface OcamlCompilerResult {
    success: boolean;
    stdout?: string;
    stderr?: string;
    diagnostics?: OcamlCompilerDiagnostic[];
}
interface OcamlWorkspaceFile {
    path: string;
    content: string;
}
interface OcamlCompilerHost {
    compile(request: {
        activePath: string;
        workspaceFiles: OcamlWorkspaceFile[];
        target: OcamlLanguageServerTarget;
        effectsMode: OcamlLanguageServerEffectsMode;
        wasmBinaryenMode: OcamlLanguageServerBinaryenMode;
        packages: string[];
    }): Promise<OcamlCompilerResult>;
}
type LoadOcamlCompilerHost = (options: OcamlWorkerOptions, context: LspDocumentContext) => Promise<OcamlCompilerHost>;
export declare function createOcamlWorkerService(loadCompilerHost?: LoadOcamlCompilerHost): WorkerLanguageService;
export {};
//# sourceMappingURL=service.d.ts.map