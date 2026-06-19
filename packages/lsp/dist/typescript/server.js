import { createWorkerLanguageServerClient } from '../worker-client.js';
const createDefaultWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
function resolveConfig(language, options) {
    if (!options || typeof options === 'string')
        return {};
    return language === 'typescript' ? options.typescript || {} : options.javascript || {};
}
async function createLanguageServer(language, options) {
    const hostOptions = typeof options === 'object' ? options : undefined;
    const config = resolveConfig(language, options);
    return await createWorkerLanguageServerClient({
        createWorker: hostOptions?.createWorker || createDefaultWorker,
        initOptions: {
            language,
            compilerOptions: config.compilerOptions,
            extraLibs: config.extraLibs,
            libUrl: config.libUrl
        },
        onStatus: hostOptions?.onStatus
    });
}
export const getTypeScriptLanguageServer = (options) => createLanguageServer('typescript', options);
export const getJavaScriptLanguageServer = (options) => createLanguageServer('javascript', options);
//# sourceMappingURL=server.js.map