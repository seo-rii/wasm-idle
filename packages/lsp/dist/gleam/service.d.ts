import { type WorkerLanguageService } from '../lsp.js';
export interface GleamWorkerOptions {
    baseUrl: string;
    manifestUrl?: string;
}
export interface GleamCompiler {
    reset_filesystem(projectId: number): void;
    delete_project?(projectId: number): void;
    write_file(projectId: number, path: string, content: string): void;
    write_module(projectId: number, moduleName: string, code: string): void;
    compile_package(projectId: number, target: string): void;
    default?(wasmUrl: string): Promise<void>;
}
export type LoadGleamCompiler = (baseUrl: string) => Promise<GleamCompiler>;
export declare function resolveGleamCompilerUrl(baseUrl: string): string;
export declare function createGleamWorkerService(loadCompiler?: LoadGleamCompiler): WorkerLanguageService;
//# sourceMappingURL=service.d.ts.map