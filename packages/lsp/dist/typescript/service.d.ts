import * as ts from 'typescript';
import { type LspDocument, type WorkerLanguageService } from '../lsp.js';
export type TypeScriptLanguage = 'javascript' | 'typescript';
export interface TypeScriptWorkerOptions {
    language: TypeScriptLanguage;
    compilerOptions?: ts.CompilerOptions;
    extraLibs?: Record<string, string>;
    libFiles?: Record<string, string>;
}
type LoadTypeScriptLibs = () => Promise<Record<string, string>>;
export declare function createTypeScriptWorkerService(defaultLanguage: TypeScriptLanguage, loadLibs?: LoadTypeScriptLibs): WorkerLanguageService;
export declare function replaceWholeDocument(document: LspDocument, newText: string): {
    range: import("../lsp.js").LspRange;
    newText: string;
}[];
export {};
//# sourceMappingURL=service.d.ts.map