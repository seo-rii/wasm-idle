import { type LspDocumentContext, type WorkerLanguageService } from '../lsp.js';
export interface HaskellWorkerOptions {
    moduleUrl: string;
    rootfsUrl: string;
    bsdtarUrl: string;
    mainSoPath?: string;
    searchDirs?: string[];
    ghcArgs?: string;
}
interface HaskellWorkspaceFile {
    path: string;
    content: string;
}
interface HaskellCompilerDiagnostic {
    fileName?: string | null;
    lineNumber?: number;
    columnNumber?: number;
    endColumnNumber?: number;
    severity?: 'error' | 'warning' | 'other';
    message?: string;
}
interface HaskellCompilerResult {
    success: boolean;
    diagnostics?: HaskellCompilerDiagnostic[];
    stdout?: string;
    stderr?: string;
}
interface HaskellCompilerHost {
    compile(request: {
        code: string;
        activePath: string;
        workspaceFiles: HaskellWorkspaceFile[];
        ghcArgs: string;
        log: boolean;
        onProgress?: (progress: {
            stage?: string;
            completed?: number;
            total?: number;
        }) => void;
    }): Promise<HaskellCompilerResult>;
}
type LoadHaskellCompilerHost = (options: HaskellWorkerOptions, context: LspDocumentContext) => Promise<HaskellCompilerHost>;
export declare function parseHaskellDiagnostics(output: string): HaskellCompilerDiagnostic[];
export declare function createHaskellWorkerService(loadCompilerHost?: LoadHaskellCompilerHost): WorkerLanguageService;
export {};
//# sourceMappingURL=service.d.ts.map