/**
 * @param {{ browserUrl: string; chromiumExecutable?: string; expectedOutput?: string; runTimeoutMs?: number; stdinText?: string; target?: 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' }} options
 */
export function runGoBrowserProbe({ browserUrl, chromiumExecutable, expectedOutput, runTimeoutMs, stdinText, target }: {
    browserUrl: string;
    chromiumExecutable?: string;
    expectedOutput?: string;
    runTimeoutMs?: number;
    stdinText?: string;
    target?: 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm';
}): Promise<{
    activeState: {
        crossOriginIsolated: boolean;
        sharedArrayBuffer: boolean;
        serviceWorkerControlled: boolean;
    };
    availableGoTargets: string[];
    browserUrl: string;
    consoleTail: string[];
    finalUrl: string;
    goConsoleErrors: string[];
    moduleResolutionErrors: string[];
    pageErrors: string[];
    selectedGoTarget: string;
    title: string;
    transcript: string;
}>;
export type BrowserConsoleMessage = {
    type: string;
    text: string;
};
