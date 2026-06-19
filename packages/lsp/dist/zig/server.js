import { resolveZigLanguageServerCompilerUrl, resolveZigLanguageServerStdlibUrl } from '../runtime.js';
import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const resolveConfig = (options) => (typeof options === 'object' ? options.zig || {} : {});
export async function getZigLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const config = resolveConfig(options);
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            compilerUrl: resolveZigLanguageServerCompilerUrl(options, hostOptions?.currentUrl),
            stdlibUrl: resolveZigLanguageServerStdlibUrl(options, hostOptions?.currentUrl),
            targetTriple: config.targetTriple,
            compileArgs: config.compileArgs
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map