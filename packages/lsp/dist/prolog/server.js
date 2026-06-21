import { resolvePrologLanguageServerBaseUrl, resolvePrologLanguageServerWorkerUrl } from '../runtime.js';
import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
export async function getPrologLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            baseUrl: resolvePrologLanguageServerBaseUrl(options, hostOptions?.currentUrl),
            workerUrl: resolvePrologLanguageServerWorkerUrl(options, hostOptions?.currentUrl)
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map