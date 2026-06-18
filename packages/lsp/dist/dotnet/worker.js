import { startWorkerLanguageServer } from '../lsp.js';
import { createDotnetWorkerService } from './service.js';
const workerGlobal = globalThis;
const rawPostMessage = workerGlobal.postMessage.bind(workerGlobal);
workerGlobal.document ??= {
    addEventListener() { },
    baseURI: workerGlobal.location?.href || '',
    dispatchEvent() {
        return true;
    },
    location: workerGlobal.location,
    querySelectorAll() {
        return [];
    },
    removeEventListener() { }
};
workerGlobal.postMessage = (message, transfer) => {
    const record = message;
    if (record && typeof record === 'object' && record.jsonrpc === '2.0') {
        rawPostMessage(message, transfer);
    }
};
startWorkerLanguageServer(createDotnetWorkerService('csharp'), {
    addEventListener: workerGlobal.addEventListener.bind(workerGlobal),
    postMessage: rawPostMessage
});
//# sourceMappingURL=worker.js.map