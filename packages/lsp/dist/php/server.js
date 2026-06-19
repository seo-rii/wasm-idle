import { resolvePhpLanguageServerVersion } from '../runtime.js';
import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
export async function getPhpLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            version: resolvePhpLanguageServerVersion(options)
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map