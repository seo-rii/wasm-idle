import { startWorkerLanguageServer } from '../lsp.js';
import { createDotnetWorkerService } from './service.js';

const workerGlobal = globalThis as any;
const rawPostMessage = workerGlobal.postMessage.bind(workerGlobal);

workerGlobal.dotnetSidecar = true;
workerGlobal.document ??= {
	addEventListener() {},
	baseURI: workerGlobal.location?.href || '',
	dispatchEvent() {
		return true;
	},
	location: workerGlobal.location,
	querySelectorAll() {
		return [];
	},
	removeEventListener() {}
};

startWorkerLanguageServer(createDotnetWorkerService('csharp'), {
	addEventListener: workerGlobal.addEventListener.bind(workerGlobal),
	postMessage: rawPostMessage
});
