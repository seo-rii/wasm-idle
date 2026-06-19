import { type WorkerLanguageService } from '../lsp.js';
export interface LuaWorkerOptions {
    moduleUrl: string;
}
interface LuaCompilerDiagnostic {
    fileName?: string | null;
    lineNumber?: number;
    columnNumber?: number;
    endColumnNumber?: number;
    severity?: 'error' | 'warning' | 'other';
    message?: string;
}
interface LuaCompilerResult {
    success: boolean;
    artifact?: unknown;
    diagnostics?: LuaCompilerDiagnostic[];
    stdout?: string;
    stderr?: string;
}
interface LuaCompiler {
    compile(request: {
        code: string;
        fileName: string;
        log: boolean;
    }): Promise<LuaCompilerResult>;
}
type LoadLuaCompiler = (moduleUrl: string) => Promise<LuaCompiler>;
export declare function createLuaWorkerService(loadCompiler?: LoadLuaCompiler): WorkerLanguageService;
export {};
//# sourceMappingURL=service.d.ts.map