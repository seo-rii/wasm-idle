/**
 * @param {{ browserUrl: string; chromiumExecutable?: string; disableHostCompile?: boolean; expectedCompilePath?: 'host' | 'browser' | 'either'; expectedOutput?: string; runTimeoutMs?: number; stdinText?: string }} options
 */
export function runTinyGoBrowserProbe({ browserUrl, chromiumExecutable, disableHostCompile, expectedCompilePath, expectedOutput, runTimeoutMs, stdinText }: {
    browserUrl: string;
    chromiumExecutable?: string;
    disableHostCompile?: boolean;
    expectedCompilePath?: 'host' | 'browser' | 'either';
    expectedOutput?: string;
    runTimeoutMs?: number;
    stdinText?: string;
}): Promise<{
    activeState: {
        crossOriginIsolated: boolean;
        sharedArrayBuffer: boolean;
        serviceWorkerControlled: boolean;
    };
    browserUrl: string;
    consoleTail: string[];
    finalUrl: string;
    hostCompileRequests: string[];
    pageErrors: string[];
    title: string;
    transcript: string;
}>;
export type BrowserConsoleMessage = {
    type: string;
    text: string;
};
