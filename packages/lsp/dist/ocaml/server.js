import { resolveOcamlLanguageServerManifestUrl, resolveOcamlLanguageServerModuleUrl } from '../runtime.js';
import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const resolveConfig = (options) => (typeof options === 'object' ? options.ocaml || {} : {});
export async function getOcamlLanguageServer(options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const config = resolveConfig(options);
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            moduleUrl: resolveOcamlLanguageServerModuleUrl(options, hostOptions?.currentUrl),
            manifestUrl: resolveOcamlLanguageServerManifestUrl(options, hostOptions?.currentUrl),
            target: config.target,
            effectsMode: config.effectsMode,
            wasmBinaryenMode: config.wasmBinaryenMode,
            packages: config.packages
        },
        onStatus: hostOptions?.onStatus
    });
}
//# sourceMappingURL=server.js.map