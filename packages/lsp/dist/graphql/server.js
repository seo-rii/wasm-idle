import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const resolveConfig = (options) => typeof options === 'object' ? options.graphql || {} : {};
export async function getGraphqlLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const config = resolveConfig(options);
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            schema: config.schema
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map