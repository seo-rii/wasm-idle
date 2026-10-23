import { createForthLspHost } from './host.js';

const scope = globalThis as unknown as {
	addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	postMessage(message: unknown): void;
};
let host: Awaited<ReturnType<typeof createForthLspHost>> | undefined;
let initializing = false;
const openDocuments = new Set<string>();
const beforeOpen: Array<{
	id?: string | number;
	method: string;
	params: { textDocument: { uri: string; version?: number } };
}> = [];

function dispatch(message: unknown) {
	for (const response of host!.dispatch(message)) scope.postMessage(response);
}

scope.addEventListener('message', async (event) => {
	const message = event.data;
	try {
		if (message?.type === 'init') {
			if (initializing) throw new Error('Forth LSP worker was already initialized');
			initializing = true;
			if (!(message.options?.wasmBytes instanceof Uint8Array)) {
				throw new Error('Forth LSP worker requires verified WASM bytes');
			}
			scope.postMessage({ type: 'progress', stage: 'forth-lsp-initialize' });
			host = await createForthLspHost(message.options.wasmBytes);
			scope.postMessage({ type: 'ready' });
			return;
		}
		if (!host || message?.jsonrpc !== '2.0') return;
		if (message.method === 'exit') {
			beforeOpen.length = 0;
			openDocuments.clear();
			host = undefined;
			return;
		}
		// Monaco can send edits and feature requests while attaching providers,
		// before didOpen. Upstream must have a buffer before it receives either.
		const uri = message.params?.textDocument?.uri;
		if (
			(message.id !== undefined || message.method === 'textDocument/didChange') &&
			typeof uri === 'string' &&
			!openDocuments.has(uri)
		) {
			if (beforeOpen.length >= 128) throw new Error('Too many messages before didOpen');
			beforeOpen.push(message);
			return;
		}
		if (message.method === '$/cancelRequest') {
			const index = beforeOpen.findIndex(
				(request) => request.id !== undefined && request.id === message.params?.id
			);
			if (index >= 0) {
				const [request] = beforeOpen.splice(index, 1);
				scope.postMessage({
					jsonrpc: '2.0',
					id: request.id,
					error: { code: -32800, message: 'Request cancelled' }
				});
				return;
			}
		}
		if (message.method === 'textDocument/didClose') {
			for (let index = beforeOpen.length - 1; index >= 0; index--) {
				if (beforeOpen[index].params.textDocument.uri !== uri) continue;
				const [pending] = beforeOpen.splice(index, 1);
				if (pending.id !== undefined)
					scope.postMessage({
						jsonrpc: '2.0',
						id: pending.id,
						error: { code: -32800, message: 'Document closed before didOpen' }
					});
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
				const pending = beforeOpen.splice(index, 1)[0];
				// The attach snapshot may already contain an early incremental edit.
				// Only replay edits newer than the snapshot to avoid applying it twice.
				if (
					pending.method === 'textDocument/didChange' &&
					typeof pending.params.textDocument.version === 'number' &&
					typeof message.params.textDocument.version === 'number' &&
					pending.params.textDocument.version <= message.params.textDocument.version
				)
					continue;
				try {
					dispatch(pending);
				} catch (error) {
					const detail = error instanceof Error ? error.message : String(error);
					if (pending.id !== undefined)
						scope.postMessage({
							jsonrpc: '2.0',
							id: pending.id,
							error: { code: -32603, message: detail }
						});
					else scope.postMessage({ type: 'error', message: detail });
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
