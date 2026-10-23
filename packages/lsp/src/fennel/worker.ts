import { configureWorkerLanguageToolPersistentAssets } from '../persistent-assets.js';
import { createFennelServer, type FennelServer, type FennelServerOptions } from './host.js';

let server: FennelServer | undefined;
let started = false;
let queue = Promise.resolve();
const openedDocuments = new Set<string>();
const beforeOpen: Array<{
	jsonrpc: string;
	id: string | number;
	params: { textDocument: { uri: string } };
}> = [];

self.addEventListener('message', (event: MessageEvent) => {
	const message = event.data;
	if (message?.type === 'init') {
		if (started) return;
		started = true;
		queue = queue
			.then(async () => {
				configureWorkerLanguageToolPersistentAssets(message.persistentAssets);
				server = await createFennelServer(message.options as FennelServerOptions);
				self.postMessage({ type: 'ready' });
			})
			.catch((error) => {
				self.postMessage({
					type: 'error',
					message: String(error instanceof Error ? error.message : error)
				});
			});
		return;
	}
	if (message?.jsonrpc !== '2.0') return;
	queue = queue
		.then(() => {
			if (!server) throw new Error('Fennel LSP is not ready');
			if (message.method === 'exit') {
				beforeOpen.length = 0;
				openedDocuments.clear();
				server.dispose();
				server = undefined;
				return;
			}
			// Monaco may request features immediately after initialize, before its
			// document synchronization sends didOpen. Keep those requests pending so
			// the unchanged upstream handlers always see the actual document.
			const uri = message.params?.textDocument?.uri;
			if (message.id !== undefined && typeof uri === 'string' && !openedDocuments.has(uri)) {
				if (beforeOpen.length >= 128) throw new Error('Too many requests before didOpen');
				beforeOpen.push(message);
				return;
			}
			if (message.method === '$/cancelRequest') {
				const index = beforeOpen.findIndex((request) => request.id === message.params?.id);
				if (index >= 0) {
					const [request] = beforeOpen.splice(index, 1);
					self.postMessage({
						jsonrpc: '2.0',
						id: request.id,
						error: { code: -32800, message: 'Request cancelled' }
					});
					return;
				}
			}
			for (const response of server.handle(message)) self.postMessage(response);
			if (message.method === 'textDocument/didOpen' && typeof uri === 'string') {
				openedDocuments.add(uri);
				for (let index = 0; index < beforeOpen.length;) {
					if (beforeOpen[index].params.textDocument.uri !== uri) {
						index++;
						continue;
					}
					const request = beforeOpen.splice(index, 1)[0];
					try {
						for (const response of server.handle(request)) self.postMessage(response);
					} catch (error) {
						self.postMessage({
							jsonrpc: '2.0',
							id: request.id,
							error: { code: -32603, message: String(error) }
						});
					}
				}
			}
			if (message.method === 'textDocument/didClose') openedDocuments.delete(uri);
		})
		.catch((error) => {
			if (message.id !== undefined)
				self.postMessage({
					jsonrpc: '2.0',
					id: message.id,
					error: {
						code: -32603,
						message: String(error instanceof Error ? error.message : error)
					}
				});
			else self.postMessage({ type: 'error', message: String(error) });
		});
});
