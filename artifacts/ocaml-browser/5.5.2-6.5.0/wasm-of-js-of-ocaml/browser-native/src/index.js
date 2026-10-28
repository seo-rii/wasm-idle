import { createCompileHandler } from './compiler-worker.js';
export * from './types.js';
export * from '../runtime/system-dispatch.js';
export * from '../runtime/fs/memory-fs.js';
export * from '../runtime/system-dispatch-browser-worker.js';
export async function compile(request, options = {}) {
    const worker = options.worker;
    if (worker) {
        return await new Promise((resolve, reject) => {
            const handleMessage = (event) => {
                const message = event.data;
                if (!message) {
                    return;
                }
                if (message.type === 'result') {
                    worker.removeEventListener('message', handleMessage);
                    resolve(message.result);
                    return;
                }
                if (message.type === 'error') {
                    worker.removeEventListener('message', handleMessage);
                    reject(new Error(message.error));
                }
            };
            worker.addEventListener('message', handleMessage);
            worker.postMessage({
                type: 'compile',
                request,
                ...(options.manifest ? { manifest: options.manifest } : {})
            });
        });
    }
    const compileHandlerOptions = {};
    if (options.createFileSystem) {
        compileHandlerOptions.createFileSystem = options.createFileSystem;
    }
    if (options.system) {
        compileHandlerOptions.system = options.system;
    }
    if (options.toolchainRoot) {
        compileHandlerOptions.toolchainRoot = options.toolchainRoot;
    }
    const handleCompile = createCompileHandler(compileHandlerOptions);
    return await handleCompile(request, options.manifest);
}
export function createCompilerWorker() {
    return new Worker(new URL('./compiler-worker.js', import.meta.url), {
        type: 'module'
    });
}
