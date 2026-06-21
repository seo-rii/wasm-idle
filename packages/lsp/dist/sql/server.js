import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const resolveConfig = (options) => typeof options === 'object' ? options.sql || {} : {};
export async function getSqlLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const config = resolveConfig(options);
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            dialect: config.dialect || 'sqlite',
            wasmUrl: config.wasmUrl,
            duckdbBundles: config.duckdbBundles
        },
        onStatus: hostOptions?.onStatus
    });
}
export async function getDuckDbLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const config = resolveConfig(options);
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            dialect: 'duckdb',
            wasmUrl: config.wasmUrl,
            duckdbBundles: config.duckdbBundles
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map