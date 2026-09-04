export const DEFAULT_GO_BROWSER_EXPECTED_OUTPUT: "fibonacci=11";
/**
 * @param {{ editorApiReady: boolean; language: string; source: string }} state
 */
export function isGoEditorStateReady({ editorApiReady, language, source }: {
    editorApiReady: boolean;
    language: string;
    source: string;
}): boolean;
/**
 * @param {import('playwright-core').Page} page
 * @param {number} timeoutMs
 */
export function waitForStableGoEditorSource(page: import("playwright-core").Page, timeoutMs: number): Promise<string>;
/**
 * @param {{ previousTranscript: string; previousFinishedCount: number }} options
 */
export function hasGoExecutionPhaseCompleted({ previousTranscript, previousFinishedCount }: {
    previousTranscript: string;
    previousFinishedCount: number;
}): boolean;
/**
 * @param {{ browserUrl: string; chromiumExecutable?: string; expectedOutput?: string; runTimeoutMs?: number; stdinText?: string; target?: 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm'; stdinMethod?: 'debug-hook' | 'keyboard' }} options
 */
export function runGoBrowserProbe({ browserUrl, chromiumExecutable, expectedOutput, runTimeoutMs, stdinText, target }: {
    browserUrl: string;
    chromiumExecutable?: string;
    expectedOutput?: string;
    runTimeoutMs?: number;
    stdinText?: string;
    target?: 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm';
    stdinMethod?: 'debug-hook' | 'keyboard';
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
    progressReadiness: import("./browser-progress-probe.mjs").LoadingProgressReadiness;
    progressTrace: import("./browser-progress-probe.mjs").LoadingProgressEntry[];
    selectedGoTarget: string;
    title: string;
    transcript: string;
}>;
export type BrowserConsoleMessage = {
    type: string;
    text: string;
};
