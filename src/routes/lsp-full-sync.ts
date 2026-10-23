import type { EditorLanguageServerHandle } from '@wasm-idle/lsp';

interface DocumentSnapshot {
	uri: string;
	text: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object'
		? (value as Record<string, unknown>)
		: undefined;
}

/** Monaco 0.55 emits ranged changes even when the server negotiates Full sync. */
export function adaptMonacoFullDocumentSync(
	handle: EditorLanguageServerHandle,
	getDocument: (uri: string) => DocumentSnapshot | undefined
): void {
	const { reader, writer } = handle.transport;
	const listen = reader.listen.bind(reader);
	const write = writer.write.bind(writer);
	let initializeId: string | number | undefined;
	let fullSync = false;

	reader.listen = (callback) =>
		listen((message) => {
			const response = record(message);
			if (
				initializeId !== undefined &&
				response?.id === initializeId &&
				!('method' in response)
			) {
				const capabilities = record(record(response.result)?.capabilities);
				const sync = capabilities?.textDocumentSync;
				fullSync = sync === 1 || record(sync)?.change === 1;
				initializeId = undefined;
			}
			callback(message);
		});

	writer.write = (message) => {
		const request = record(message);
		if (
			request?.method === 'initialize' &&
			(typeof request.id === 'string' || typeof request.id === 'number')
		) {
			initializeId = request.id;
			fullSync = false;
		}
		if (fullSync && request?.method === 'textDocument/didChange') {
			const params = record(request.params);
			const document = record(params?.textDocument);
			const snapshot =
				typeof document?.uri === 'string' ? getDocument(document.uri) : undefined;
			// ManagedModel lowercases notification URIs; retain its URI and version.
			if (
				params &&
				typeof document?.uri === 'string' &&
				snapshot &&
				document.uri.toLowerCase() === snapshot.uri.toLowerCase()
			) {
				const outgoing = {
					...message,
					params: { ...params, contentChanges: [{ text: snapshot.text }] }
				};
				return write(outgoing);
			}
		}
		return write(message);
	};
}
