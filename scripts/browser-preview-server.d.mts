/**
 * @param {string} browserUrl
 */
export function shouldReuseProvidedBrowserUrl(browserUrl: string): boolean;
/**
 * @param {string[]} scriptNames
 * @param {{ timeoutMs?: number }} options
 */
export function runBrowserPreparationScripts(scriptNames: string[], { timeoutMs }?: {
    timeoutMs?: number;
}): Promise<void>;
/**
 * @param {{ origin?: string; basePath?: string; timeoutMs?: number; serverMode?: 'dev' | 'preview' }} options
 */
export function startBrowserPreviewServer({ origin, basePath, timeoutMs, serverMode }?: {
    origin?: string;
    basePath?: string;
    timeoutMs?: number;
    serverMode?: 'dev' | 'preview';
}): Promise<{
    origin: string;
    browserUrl: string;
    close: () => Promise<void>;
}>;
