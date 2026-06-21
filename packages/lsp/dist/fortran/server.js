import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const resolveConfig = (options) => typeof options === 'object' ? options.fortran || {} : {};
export async function getFortranLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const config = resolveConfig(options);
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            analyzerUrl: config.analyzerUrl,
            parserWasmUrl: config.parserWasmUrl,
            grammarUrl: config.grammarUrl
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map