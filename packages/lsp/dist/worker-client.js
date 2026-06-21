import { BrowserMessageReader, BrowserMessageWriter } from './jsonrpc.js';
export function createLanguageServerProgressReporter(onStatus) {
    let fallbackLoaded = 0;
    const loading = (stage = 'startup') => {
        fallbackLoaded = 0;
        onStatus?.({ state: 'loading', stage, loaded: 0, total: 1 });
    };
    const progress = ({ stage, loaded, total } = {}) => {
        if (typeof loaded === 'number' &&
            Number.isFinite(loaded) &&
            typeof total === 'number' &&
            Number.isFinite(total) &&
            total > 0) {
            fallbackLoaded = Math.max(fallbackLoaded, Math.min(loaded / total, 0.92));
            onStatus?.({
                state: 'loading',
                ...(stage ? { stage } : {}),
                loaded,
                total
            });
            return;
        }
        fallbackLoaded = fallbackLoaded === 0 ? 0.08 : Math.min(fallbackLoaded + 0.18, 0.92);
        onStatus?.({
            state: 'loading',
            ...(stage ? { stage } : {}),
            loaded: fallbackLoaded,
            total: 1
        });
    };
    return {
        loading,
        progress,
        ready: () => onStatus?.({ state: 'ready' }),
        error: (message) => onStatus?.({ state: 'error', message }),
        disabled: () => onStatus?.({ state: 'disabled' })
    };
}
export async function createWorkerLanguageServerClient(options) {
    const status = createLanguageServerProgressReporter(options.onStatus);
    status.loading();
    const worker = options.createWorker();
    try {
        await new Promise((resolve, reject) => {
            const cleanup = () => {
                worker.removeEventListener('message', handleMessage);
                worker.removeEventListener('error', handleError);
            };
            const handleMessage = (event) => {
                switch (event.data?.type) {
                    case 'progress':
                        status.progress({
                            stage: event.data.stage,
                            loaded: event.data.loaded,
                            total: event.data.total
                        });
                        return;
                    case 'ready':
                        cleanup();
                        resolve();
                        return;
                    case 'error':
                        cleanup();
                        reject(new Error(event.data.message || 'Language server failed to initialize'));
                }
            };
            const handleError = (event) => {
                cleanup();
                reject(event.error || new Error(event.message || 'Language server worker failed'));
            };
            worker.addEventListener('message', handleMessage);
            worker.addEventListener('error', handleError);
            worker.postMessage({ type: 'init', options: options.initOptions });
        });
    }
    catch (error) {
        worker.terminate();
        const message = error instanceof Error ? error.message : String(error);
        status.error(message);
        throw error;
    }
    const reader = new BrowserMessageReader(worker);
    const filteredReader = {
        onError: reader.onError,
        onClose: reader.onClose,
        onPartialMessage: reader.onPartialMessage,
        listen(callback) {
            return reader.listen((message) => {
                const record = message;
                if (record && typeof record === 'object' && record.jsonrpc === '2.0') {
                    callback(message);
                }
            });
        },
        dispose() {
            reader.dispose();
        }
    };
    const writer = new BrowserMessageWriter(worker);
    status.ready();
    return {
        transport: { reader: filteredReader, writer },
        dispose: () => {
            worker.terminate();
            reader.dispose();
            writer.dispose();
            status.disabled();
        }
    };
}
//# sourceMappingURL=worker-client.js.map