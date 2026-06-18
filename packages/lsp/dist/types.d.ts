import type { MessageReader, MessageWriter } from 'vscode-jsonrpc';
import type { CompilerOptions } from 'typescript';
import type { LanguageToolAssetConfig } from './assets.js';
export interface EditorLanguageServerTransport {
    reader: MessageReader;
    writer: MessageWriter;
}
export interface EditorLanguageServerHandle {
    transport: EditorLanguageServerTransport;
    syncFile?: (path: string) => void;
    dispose: () => void;
}
export interface EditorLanguageServerRuntimeOptions {
    createWorker?: () => Worker;
    currentUrl?: string;
    rootUrl?: string;
    cpp?: LanguageToolAssetConfig;
    python?: {
        baseUrl?: string;
    };
    rust?: {
        compilerUrl?: string;
        targetTriple?: 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3';
        edition?: string;
    };
    go?: {
        compilerUrl?: string;
        target?: 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm';
    };
    typescript?: {
        compilerOptions?: CompilerOptions;
        extraLibs?: Record<string, string>;
    };
    javascript?: {
        compilerOptions?: CompilerOptions;
        extraLibs?: Record<string, string>;
    };
    wat?: {
        features?: Record<string, boolean>;
    };
    dotnet?: {
        moduleUrl?: string;
    };
    assemblyscript?: {
        extraFiles?: Record<string, string>;
    };
}
export type EditorLanguageServerOptions = string | EditorLanguageServerRuntimeOptions;
//# sourceMappingURL=types.d.ts.map