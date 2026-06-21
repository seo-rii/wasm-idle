import { type WorkerLanguageService } from '../lsp.js';
export interface PrologWorkerOptions {
    baseUrl: string;
    workerUrl: string;
}
export interface PrologDiagnosticRunnerRequest {
    baseUrl: string;
    workerUrl: string;
    code: string;
    activePath: string;
}
export interface PrologDiagnosticRunnerResult {
    error?: string;
}
export type RunPrologDiagnostics = (request: PrologDiagnosticRunnerRequest) => Promise<PrologDiagnosticRunnerResult>;
export declare function createPrologWorkerService(runDiagnostics?: RunPrologDiagnostics): WorkerLanguageService;
//# sourceMappingURL=service.d.ts.map