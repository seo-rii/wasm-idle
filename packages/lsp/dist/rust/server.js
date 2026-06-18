import { resolveRustLanguageServerCompilerUrl } from '../runtime.js';
import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
function resolveConfig(options) {
    return typeof options === 'object' ? options.rust || {} : {};
}
export async function getRustLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const config = resolveConfig(options);
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            compilerUrl: resolveRustLanguageServerCompilerUrl(options, hostOptions?.currentUrl),
            targetTriple: config.targetTriple,
            edition: config.edition
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map