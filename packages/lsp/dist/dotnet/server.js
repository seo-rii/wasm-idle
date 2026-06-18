import { normalizeBaseUrl, normalizeRootUrl } from '../assets.js';
import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const currentUrl = () => globalThis.location?.href || '';
export function resolveDotnetLanguageServerModuleUrl(options, baseUrl = '') {
    if (typeof options === 'object' && options.dotnet?.moduleUrl) {
        return baseUrl ? new URL(options.dotnet.moduleUrl, baseUrl).href : options.dotnet.moduleUrl;
    }
    const rootUrl = typeof options === 'string' ? options : typeof options === 'object' ? options.rootUrl : '';
    const path = `${normalizeRootUrl(rootUrl || '')}/wasm-dotnet/index.js`;
    return baseUrl ? new URL(path, baseUrl).href : normalizeBaseUrl(path).replace(/\/$/u, '');
}
async function createLanguageServer(language, options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const baseUrl = hostOptions?.currentUrl ?? currentUrl();
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            language,
            moduleUrl: resolveDotnetLanguageServerModuleUrl(options, baseUrl)
        },
        onStatus: hostOptions?.onStatus
    });
}
export const getCSharpLanguageServer = (options) => createLanguageServer('csharp', options);
export const getFSharpLanguageServer = (options) => createLanguageServer('fsharp', options);
export const getVisualBasicLanguageServer = (options) => createLanguageServer('vbnet', options);
//# sourceMappingURL=server.js.map