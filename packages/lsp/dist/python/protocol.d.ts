export type PythonLspStatus = {
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
export interface PythonLspWorkerInitMessage {
    type: 'init';
    pyodideBaseUrl: string;
}
export type PythonLspWorkerInboundMessage = PythonLspWorkerInitMessage | Record<string, unknown>;
export type PythonLspWorkerOutboundMessage = {
    type: 'progress';
    stage: string;
} | {
    type: 'ready';
} | {
    type: 'error';
    error: string;
};
//# sourceMappingURL=protocol.d.ts.map