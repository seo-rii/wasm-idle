import { resolveHaskellLanguageServerBsdtarUrl, resolveHaskellLanguageServerModuleUrl, resolveHaskellLanguageServerRootfsUrl } from '../runtime.js';
import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const resolveConfig = (options) => (typeof options === 'object' ? options.haskell || {} : {});
export async function getHaskellLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const config = resolveConfig(options);
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            moduleUrl: resolveHaskellLanguageServerModuleUrl(options, hostOptions?.currentUrl),
            rootfsUrl: resolveHaskellLanguageServerRootfsUrl(options, hostOptions?.currentUrl),
            bsdtarUrl: resolveHaskellLanguageServerBsdtarUrl(options, hostOptions?.currentUrl),
            mainSoPath: config.mainSoPath,
            searchDirs: config.searchDirs,
            ghcArgs: config.ghcArgs
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map