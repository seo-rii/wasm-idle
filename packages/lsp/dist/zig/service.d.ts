import { type LspDocumentContext, type WorkerLanguageService } from '../lsp.js';
export type ZigLanguageServerTargetTriple = 'wasm64-wasi';
export interface ZigWorkerOptions {
    compilerUrl: string;
    stdlibUrl: string;
    targetTriple?: ZigLanguageServerTargetTriple;
    compileArgs?: string[];
}
interface ZigWorkspaceFile {
    path: string;
    content: string;
}
interface ZigCompilerDiagnostic {
    fileName?: string | null;
    lineNumber?: number;
    columnNumber?: number;
    endColumnNumber?: number;
    severity?: 'error' | 'warning' | 'other';
    message?: string;
}
interface ZigCompilerResult {
    success: boolean;
    diagnostics?: ZigCompilerDiagnostic[];
    stdout?: string;
    stderr?: string;
}
interface ZigCompilerHost {
    compile(request: {
        code: string;
        activePath: string;
        workspaceFiles: ZigWorkspaceFile[];
        targetTriple: ZigLanguageServerTargetTriple;
        compileArgs: string[];
        log: boolean;
        onProgress?: (progress: {
            stage?: string;
            completed?: number;
            total?: number;
        }) => void;
    }): Promise<ZigCompilerResult>;
}
type LoadZigCompilerHost = (options: ZigWorkerOptions, context: LspDocumentContext) => Promise<ZigCompilerHost>;
export declare function createZigWorkerService(loadCompilerHost?: LoadZigCompilerHost): WorkerLanguageService;
export {};
//# sourceMappingURL=service.d.ts.map