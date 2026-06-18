import { type WorkerLanguageService } from '../lsp.js';
export type GoLanguageServerTarget = 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm';
export interface GoWorkerOptions {
    compilerUrl: string;
    target?: GoLanguageServerTarget;
}
export declare function createGoWorkerService(): WorkerLanguageService;
//# sourceMappingURL=service.d.ts.map