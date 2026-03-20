/**
 * @typedef {{ type: string; text: string }} BrowserConsoleMessage
 */
/**
 * @param {string} explicitPath
 */
export function resolveChromiumExecutable(explicitPath?: string): Promise<string>;
/**
 * @param {{ browserUrl: string; runTimeoutMs?: number; chromiumExecutable?: string; stdinText?: string; sendEof?: boolean; expectedOutput?: string }} options
 */
export function runRustBrowserProbe({ browserUrl, runTimeoutMs, chromiumExecutable, stdinText, sendEof, expectedOutput }: {
    browserUrl: string;
    runTimeoutMs?: number;
    chromiumExecutable?: string;
    stdinText?: string;
    sendEof?: boolean;
    expectedOutput?: string;
}): Promise<{
    url: string;
    finalUrl: string;
    title: string;
    activeState: {
        crossOriginIsolated: boolean;
        sharedArrayBuffer: boolean;
        serviceWorkerControlled: boolean;
    };
    pageErrors: string[];
    transcript: string;
    consoleTail: string[];
    bootstrapErrors: string[];
    rustConsoleErrors: string[];
}>;
export type BrowserConsoleMessage = {
    type: string;
    text: string;
};
