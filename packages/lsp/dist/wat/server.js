import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
export async function getWatLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            features: hostOptions?.wat?.features
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map