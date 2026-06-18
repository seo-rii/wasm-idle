import type { WorkerLanguageService } from '../lsp.js';
export type DotnetLanguage = 'csharp' | 'vbnet';
export interface DotnetWorkerOptions {
    language: DotnetLanguage;
    moduleUrl: string;
}
interface DotnetDiagnostic {
    lineNumber?: number;
    columnNumber?: number;
    endColumnNumber?: number;
    severity?: 'error' | 'warning' | 'other';
    message?: string;
}
interface DotnetCompilerResult {
    success: boolean;
    stderr?: string;
    diagnostics?: DotnetDiagnostic[];
}
interface DotnetCompiler {
    compile(request: {
        code: string;
        language: DotnetLanguage;
        target: 'browser-wasm';
        prepare?: boolean;
        onProgress?: (progress: {
            stage?: string;
            completed?: number;
            total?: number;
        }) => void;
    }): Promise<DotnetCompilerResult>;
}
interface DotnetRuntimeModule {
    createDotnetCompiler(): DotnetCompiler;
}
type LoadDotnetModule = (moduleUrl: string) => Promise<DotnetRuntimeModule>;
export declare function createDotnetWorkerService(defaultLanguage: DotnetLanguage, loadModule?: LoadDotnetModule): WorkerLanguageService;
export {};
//# sourceMappingURL=service.d.ts.map