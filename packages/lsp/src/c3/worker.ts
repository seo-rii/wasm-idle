import { createC3LspHost } from './host.js';

const scope = globalThis as unknown as {
	addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	postMessage(message: unknown): void;
};
let host: Awaited<ReturnType<typeof createC3LspHost>> | undefined;
let initializing = false;
const openDocuments = new Set<string>();
const beforeOpen: Array<{
	id: string | number;
	params: { textDocument: { uri: string } };
}> = [];

function dispatch(message: unknown) {
	for (const response of host!.dispatch(message)) scope.postMessage(response);
}

scope.addEventListener('message', async (event) => {
	const message = event.data;
	try {
		if (message?.type === 'init') {
			if (initializing) throw new Error('C3 LSP worker was already initialized');
			initializing = true;
			if (
				!['moduleBytes', 'wasmBytes', 'stdlibBytes'].every(
					(name) => message.options?.[name] instanceof Uint8Array
				)
			) {
				throw new Error('C3 LSP worker requires verified server assets');
			}
			scope.postMessage({ type: 'progress', stage: 'c3-lsp-initialize' });
			host = await createC3LspHost(message.options);
			scope.postMessage({ type: 'ready' });
			return;
		}
		if (!host || message?.jsonrpc !== '2.0') return;
		if (message.method === 'exit') {
			dispatch(message);
			beforeOpen.length = 0;
			openDocuments.clear();
			host = undefined;
			return;
		}
		// Monaco can request features while attaching providers, before didOpen.
		// Let the original handler run only after its document buffer exists.
		const uri = message.params?.textDocument?.uri;
		if (message.id !== undefined && typeof uri === 'string' && !openDocuments.has(uri)) {
			if (beforeOpen.length >= 128) throw new Error('Too many requests before didOpen');
			beforeOpen.push(message);
			return;
		}
		if (message.method === '$/cancelRequest') {
			const index = beforeOpen.findIndex((request) => request.id === message.params?.id);
			if (index >= 0) {
				const request = beforeOpen.splice(index, 1)[0];
				scope.postMessage({
					jsonrpc: '2.0',
					id: request.id,
					error: { code: -32800, message: 'Request cancelled' }
				});
				return;
			}
		}
		dispatch(message);
		if (message.method === 'textDocument/didOpen' && typeof uri === 'string') {
			openDocuments.add(uri);
			for (let index = 0; index < beforeOpen.length;) {
				if (beforeOpen[index].params.textDocument.uri !== uri) {
					index++;
					continue;
				}
				const request = beforeOpen.splice(index, 1)[0];
				try {
					dispatch(request);
				} catch (error) {
					scope.postMessage({
						jsonrpc: '2.0',
						id: request.id,
						error: { code: -32603, message: String(error) }
					});
				}
			}
		} else if (message.method === 'textDocument/didClose') {
			openDocuments.delete(uri);
		}
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (message?.jsonrpc === '2.0' && message.id !== undefined) {
			scope.postMessage({
				jsonrpc: '2.0',
				id: message.id,
				error: { code: -32603, message: detail }
			});
		} else {
			scope.postMessage({ type: 'error', message: detail });
		}
	}
});
