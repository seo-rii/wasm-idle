import { BrowserMessageReader, BrowserMessageWriter } from './jsonrpc.js';
export async function createWorkerLanguageServerClient(options) {
    options.onStatus?.({ state: 'loading' });
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
                        options.onStatus?.({
                            state: 'loading',
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
        options.onStatus?.({ state: 'error', message });
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
    options.onStatus?.({ state: 'ready' });
    return {
        transport: { reader: filteredReader, writer },
        dispose: () => {
            worker.terminate();
            reader.dispose();
            writer.dispose();
            options.onStatus?.({ state: 'disabled' });
        }
    };
}
//# sourceMappingURL=worker-client.js.map