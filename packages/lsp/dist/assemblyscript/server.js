import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
export async function getAssemblyScriptLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            extraFiles: hostOptions?.assemblyscript?.extraFiles
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map