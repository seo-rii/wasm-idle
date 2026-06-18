import { type WorkerLanguageService } from '../lsp.js';
export type RustLanguageServerTargetTriple = 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3';
export interface RustWorkerOptions {
    compilerUrl: string;
    targetTriple?: RustLanguageServerTargetTriple;
    edition?: string;
}
export declare function createRustWorkerService(): WorkerLanguageService;
//# sourceMappingURL=service.d.ts.map