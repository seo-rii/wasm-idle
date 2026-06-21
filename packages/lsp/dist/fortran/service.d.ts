import { type WorkerLanguageService } from '../lsp.js';
export interface FortranWorkerOptions {
    analyzerUrl?: string;
    parserWasmUrl?: string;
    grammarUrl?: string;
}
export interface FortranAnalyzerDiagnostic {
    message: string;
    lineNumber?: number;
    columnNumber?: number;
    severity?: 'error' | 'warning' | 'info';
}
export interface FortranAnalyzer {
    analyze(code: string, fileName: string): Promise<FortranAnalyzerDiagnostic[]> | FortranAnalyzerDiagnostic[];
    dispose?: () => void | Promise<void>;
}
export type LoadFortranAnalyzer = (options: FortranWorkerOptions) => Promise<FortranAnalyzer>;
export declare function createFortranWorkerService(loadAnalyzer?: LoadFortranAnalyzer): WorkerLanguageService;
//# sourceMappingURL=service.d.ts.map