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
export interface WorkerLanguageServerClientOptions {
    createWorker: () => Worker;
    initOptions?: unknown;
    onStatus?: (status: LanguageServerStatus) => void;
}
export declare function createWorkerLanguageServerClient(options: WorkerLanguageServerClientOptions): Promise<EditorLanguageServerHandle>;
//# sourceMappingURL=worker-client.d.ts.map