import { BrowserMessageReader, BrowserMessageWriter } from '../jsonrpc.js';
import { resolvePythonLanguageServerBaseUrl } from '../runtime.js';
import { createLanguageServerProgressReporter } from '../worker-client.js';
const currentUrl = () => globalThis.location?.href || '';
const createDefaultPythonLspWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
function isPythonLanguageServerOptions(options) {
    return typeof options === 'object' && !!options;
}
async function createServer(pyodideBaseUrl, createWorker, onStatus) {
    const status = createLanguageServerProgressReporter(onStatus);
    status.loading();
    let resolveReady = () => { };
    let rejectReady = (_error) => { };
    const ready = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const worker = createWorker();
    const cleanup = () => {
        worker.removeEventListener('message', readyListener);
        worker.removeEventListener('error', errorListener);
    };
    const readyListener = (event) => {
        switch (event.data?.type) {
            case 'progress': {
                status.progress({ stage: event.data.stage });
                break;
            }
            case 'ready': {
                cleanup();
                status.ready();
                resolveReady();
                break;
            }
            case 'error': {
                cleanup();
                rejectReady(new Error(event.data?.error || 'Python LSP failed to initialize'));
                break;
            }
        }
    };
    const errorListener = (event) => {
        cleanup();
        rejectReady(event.error || new Error(event.message || 'Python LSP worker failed'));
    };
    worker.addEventListener('message', readyListener);
    worker.addEventListener('error', errorListener);
    worker.postMessage({ type: 'init', pyodideBaseUrl });
    await ready;
    return worker;
}
export async function createPythonLanguageServer(options) {
    const hostOptions = isPythonLanguageServerOptions(options) ? options : undefined;
    const pyodideBaseUrl = resolvePythonLanguageServerBaseUrl(options, hostOptions?.currentUrl ?? currentUrl());
    const worker = await createServer(pyodideBaseUrl, hostOptions?.createWorker || createDefaultPythonLspWorker, hostOptions?.onStatus);
    const reader = new BrowserMessageReader(worker);
    const writer = new BrowserMessageWriter(worker);
    return {
        transport: { reader, writer },
        dispose: () => {
            worker.terminate();
            reader.dispose();
            writer.dispose();
            hostOptions?.onStatus?.({ state: 'disabled' });
        }
    };
}
export const getPythonLanguageServer = createPythonLanguageServer;
//# sourceMappingURL=server.js.map