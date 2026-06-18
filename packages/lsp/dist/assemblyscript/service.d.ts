import { type WorkerLanguageService } from '../lsp.js';
export interface AssemblyScriptWorkerOptions {
    extraFiles?: Record<string, string>;
}
interface AssemblyScriptCompilerIo {
    stdout?: {
        write(chunk: Uint8Array | string): void;
    };
    stderr?: {
        write(chunk: Uint8Array | string): void;
    };
    readFile?: (filePath: string) => string | null;
    writeFile?: (filePath: string, contents: Uint8Array | string) => void;
    listFiles?: (dirPath: string) => string[];
}
interface AssemblyScriptCompiler {
    main(args: string[], options: AssemblyScriptCompilerIo): Promise<{
        error?: Error;
    }> | {
        error?: Error;
    };
}
type LoadAssemblyScriptCompiler = () => Promise<AssemblyScriptCompiler>;
export declare function createAssemblyScriptWorkerService(loadCompiler?: LoadAssemblyScriptCompiler): WorkerLanguageService;
export {};
//# sourceMappingURL=service.d.ts.map