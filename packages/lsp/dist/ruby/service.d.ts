import { type WorkerLanguageService } from '../lsp.js';
export interface RubyWorkerOptions {
    wasmUrl?: string;
}
export interface RubySyntaxDiagnostic {
    message: string;
    lineNumber?: number;
    columnNumber?: number;
    severity?: 'error' | 'warning' | 'info';
}
export interface RubySyntaxChecker {
    check(code: string, fileName: string): Promise<RubySyntaxDiagnostic[]> | RubySyntaxDiagnostic[];
    dispose?: () => void | Promise<void>;
}
export type LoadRubySyntaxChecker = (options: RubyWorkerOptions) => Promise<RubySyntaxChecker>;
export declare function createRubyWorkerService(loadChecker?: LoadRubySyntaxChecker): WorkerLanguageService;
//# sourceMappingURL=service.d.ts.map