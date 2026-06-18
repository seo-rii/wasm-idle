import { resolveGleamLanguageServerBaseUrl, resolveGleamLanguageServerManifestUrl } from '../runtime.js';
import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const currentUrl = () => globalThis.location?.href || '';
export async function getGleamLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const baseUrl = hostOptions?.currentUrl ?? currentUrl();
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            baseUrl: resolveGleamLanguageServerBaseUrl(options, baseUrl),
            manifestUrl: resolveGleamLanguageServerManifestUrl(options, baseUrl)
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map