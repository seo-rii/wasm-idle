export interface LspPosition {
    line: number;
    character: number;
}
export interface LspRange {
    start: LspPosition;
    end: LspPosition;
}
export interface LspDiagnostic {
    range: LspRange;
    severity?: 1 | 2 | 3 | 4;
    code?: string | number;
    source?: string;
    message: string;
}
export interface LspTextEdit {
    range: LspRange;
    newText: string;
}
export interface LspDocument {
    uri: string;
    languageId: string;
    version: number;
    text: string;
}
export interface LspDocumentContext {
    documents: ReadonlyMap<string, LspDocument>;
    publishDiagnostics: (uri: string, diagnostics: LspDiagnostic[]) => void;
    reportProgress: (stage: string, loaded?: number, total?: number) => void;
}
export interface WorkerLanguageService {
    name: string;
    version?: string;
    diagnosticDelay?: number;
    capabilities?: Record<string, unknown>;
    initialize?: (options: unknown, context: LspDocumentContext) => void | Promise<void>;
    diagnostics?: (document: LspDocument, context: LspDocumentContext) => LspDiagnostic[] | Promise<LspDiagnostic[]>;
    completion?: (document: LspDocument, position: LspPosition, context: LspDocumentContext) => unknown | Promise<unknown>;
    hover?: (document: LspDocument, position: LspPosition, context: LspDocumentContext) => unknown | Promise<unknown>;
    definition?: (document: LspDocument, position: LspPosition, context: LspDocumentContext) => unknown | Promise<unknown>;
    signatureHelp?: (document: LspDocument, position: LspPosition, context: LspDocumentContext) => unknown | Promise<unknown>;
    documentSymbols?: (document: LspDocument, context: LspDocumentContext) => unknown | Promise<unknown>;
    formatting?: (document: LspDocument, options: Record<string, unknown>, context: LspDocumentContext) => LspTextEdit[] | Promise<LspTextEdit[]>;
    close?: (document: LspDocument, context: LspDocumentContext) => void | Promise<void>;
    dispose?: () => void | Promise<void>;
}
interface WorkerScope {
    addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
    postMessage(message: unknown): void;
}
interface ContentChange {
    range?: LspRange | null;
    text: string;
}
export declare function positionAt(text: string, offset: number): LspPosition;
export declare function offsetAt(text: string, position: LspPosition): number;
export declare function applyContentChanges(text: string, changes: ContentChange[]): string;
export declare function uriToPath(uri: string): string;
export declare function pathToUri(path: string): string;
export declare function fullDocumentRange(text: string): LspRange;
export declare function startWorkerLanguageServer(service: WorkerLanguageService, scope?: WorkerScope): void;
export {};
//# sourceMappingURL=lsp.d.ts.map