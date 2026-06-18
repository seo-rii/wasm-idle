export interface ClangdPreloadedAssets {
    clangdJs: ArrayBuffer;
    clangdWasmGz: ArrayBuffer;
}
export interface ClangdWorkerInitMessage {
    type: 'init';
    baseUrl: string;
    assets?: ClangdPreloadedAssets;
}
export interface ClangdWorkerSyncFileMessage {
    type: 'sync-file';
    name: string;
}
export type ClangdWorkerInboundMessage = ClangdWorkerInitMessage | ClangdWorkerSyncFileMessage;
export type ClangdWorkerOutboundMessage = {
    type: 'progress';
    value: number;
    max?: number;
} | {
    type: 'ready';
    value: number;
} | {
    type: 'error';
    message: string;
};
//# sourceMappingURL=protocol.d.ts.map