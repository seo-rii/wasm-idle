/**
 * @param {{ browserUrl: string; chromiumExecutable?: string; expectedOutput?: string; runTimeoutMs?: number; backend?: 'js' | 'wasm'; code?: string; stdinText?: string; sendEof?: boolean; stdinMethod?: 'debug-hook' | 'keyboard' }} options
 */
export function runOcamlBrowserProbe({ browserUrl, chromiumExecutable, expectedOutput, runTimeoutMs, backend, code }: {
    browserUrl: string;
    chromiumExecutable?: string;
    expectedOutput?: string;
    runTimeoutMs?: number;
    backend?: "js" | "wasm";
    code?: string;
    stdinText?: string;
    sendEof?: boolean;
    stdinMethod?: 'debug-hook' | 'keyboard';
}): Promise<{
    activeState: {
        crossOriginIsolated: boolean;
        sharedArrayBuffer: boolean;
        serviceWorkerControlled: boolean;
    };
    binaryenBridgeRequests: BrowserNetworkRequest[];
    binaryenBridgeResponses: BrowserNetworkResponse[];
    binaryenToolRequests: BrowserNetworkRequest[];
    binaryenToolResponses: BrowserNetworkResponse[];
    browserUrl: string;
    consoleTail: string[];
    finalUrl: string;
    moduleResolutionErrors: string[];
    ocamlConsoleErrors: string[];
    pageErrors: string[];
    selectedOcamlBackend: string;
    storedCode: string;
    title: string;
    transcript: string;
}>;
export type BrowserConsoleMessage = {
    type: string;
    text: string;
};
export type BrowserNetworkRequest = {
    method: string;
    url: string;
};
export type BrowserNetworkResponse = {
    status: number;
    url: string;
};
