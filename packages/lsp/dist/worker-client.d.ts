import type { EditorLanguageServerHandle } from './types.js';
export type LanguageServerStatus = {
    state: 'disabled';
} | {
    state: 'loading';
    stage?: string;
    loaded?: number;
    total?: number;
} | {
    state: 'ready';
} | {
    state: 'error';
    message: string;
};
export interface LanguageServerProgressUpdate {
    stage?: string;
    loaded?: number;
    total?: number;
}
export interface WorkerLanguageServerClientOptions {
    createWorker: () => Worker;
    initOptions?: unknown;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function createLanguageServerProgressReporter(onStatus?: (status: LanguageServerStatus) => void): {
    loading: (stage?: string) => void;
    progress: ({ stage, loaded, total }?: LanguageServerProgressUpdate) => void;
    ready: () => void | undefined;
    error: (message: string) => void | undefined;
    disabled: () => void | undefined;
};
export declare function createWorkerLanguageServerClient(options: WorkerLanguageServerClientOptions): Promise<EditorLanguageServerHandle>;
//# sourceMappingURL=worker-client.d.ts.map