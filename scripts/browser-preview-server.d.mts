/**
 * @param {{ origin?: string; basePath?: string; timeoutMs?: number }} options
 */
export function startBrowserPreviewServer({ origin, basePath, timeoutMs }?: {
    origin?: string;
    basePath?: string;
    timeoutMs?: number;
}): Promise<{
    origin: string;
    browserUrl: string;
    close: () => Promise<void>;
}>;
