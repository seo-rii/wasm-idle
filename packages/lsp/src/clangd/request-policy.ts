import type { DataCallback, Message, RequestMessage, ResponseMessage } from 'vscode-jsonrpc';
import type { EditorLanguageServerTransport } from '../types.js';

export interface ClangdRequestTrace {
	requestId?: number | string;
	method: string;
	uri?: string;
	version?: number;
	sentAt: number;
	finishedAt?: number;
	outcome?: 'response' | 'cancelled' | 'stale' | 'timeout' | 'error';
}

const featureMethods = new Set([
	'textDocument/hover',
	'textDocument/inlayHint',
	'inlayHint/resolve'
]);

/** Bounds editor feature requests independently of Worker startup and lifetime. */
export function createClangdRequestPolicy(
	transport: EditorLanguageServerTransport,
	options: {
		requestTimeoutMs?: number;
		initializeTimeoutMs?: number;
		onDelay?: (method: string | null) => void;
	} = {}
) {
	const trace: ClangdRequestTrace[] = [];
	const pending = new Map<
		number | string,
		{
			trace: ClangdRequestTrace;
			key: string;
			emptyResult: unknown;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	const retired = new Set<number | string>();
	const versions = new Map<string, number>();
	const hintDocuments = new Map<string, { uri?: string; version?: number }>();
	let callback: DataCallback | undefined;
	let disposed = false;
	const record = (entry: ClangdRequestTrace) => {
		trace.push(entry);
		if (trace.length > 128) trace.shift();
	};
	const finish = (id: number | string, outcome: ClangdRequestTrace['outcome']) => {
		const request = pending.get(id);
		if (!request) return;
		clearTimeout(request.timer);
		pending.delete(id);
		Object.assign(request.trace, { finishedAt: Date.now(), outcome });
		return request.trace;
	};
	const cancel = (
		id: number | string,
		outcome: 'cancelled' | 'stale' | 'timeout',
		notifyServer = true
	) => {
		const request = pending.get(id);
		if (!request) return;
		finish(id, outcome);
		retired.add(id);
		if (retired.size > 256) retired.delete(retired.values().next().value!);
		if (notifyServer)
			void transport.writer
				.write({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } } as Message)
				.catch(() => {});
		callback?.({
			jsonrpc: '2.0',
			id,
			// Monaco 0.55.1's native providers surface RPC cancellation errors as
			// unhandled errors. Settle features with their empty result instead.
			...(request.trace.method === 'initialize'
				? { error: { code: -32800, message: `initialize ${outcome}` } }
				: { result: request.emptyResult })
		} as ResponseMessage);
		if (outcome === 'timeout') options.onDelay?.(request.trace.method);
	};
	const dispose = () => {
		if (disposed) return;
		for (const id of [...pending.keys()]) cancel(id, 'cancelled');
		disposed = true;
		versions.clear();
		hintDocuments.clear();
	};
	const incoming = (message: Message) => {
		const data = message as Message & {
			id?: number | string;
			method?: string;
			params?: any;
			result?: any;
			error?: { code?: number };
		};
		if (disposed) return;
		if (data.id != null && !data.method) {
			if (retired.has(data.id)) return;
			if (data.error && [-32800, -32801, -32802].includes(data.error.code!)) {
				cancel(data.id, data.error.code === -32801 ? 'stale' : 'cancelled', false);
				return;
			}
			const request = finish(data.id, data.error ? 'error' : 'response');
			if (request && featureMethods.has(request.method)) {
				options.onDelay?.(null);
				if (request.method === 'textDocument/inlayHint' && Array.isArray(data.result)) {
					for (const hint of data.result) {
						hintDocuments.set(JSON.stringify(hint), {
							uri: request.uri,
							version: request.version
						});
						if (hintDocuments.size > 256)
							hintDocuments.delete(hintDocuments.keys().next().value!);
					}
				}
			}
		} else if (data.method === 'textDocument/publishDiagnostics') {
			const { uri, version } = data.params || {};
			if (typeof version === 'number' && versions.has(uri) && version < versions.get(uri)!)
				return;
			record({
				method: data.method,
				uri,
				version,
				sentAt: Date.now(),
				finishedAt: Date.now(),
				outcome: 'response'
			});
		}
		callback?.(message);
	};
	const write = async (message: Message) => {
		const data = message as RequestMessage & { params?: any };
		const emptyResult = data.method?.endsWith('/resolve')
			? data.params
			: data.method?.startsWith('textDocument/semanticTokens/')
				? { data: [] }
				: null;
		if (disposed) {
			// Providers already scheduled by the old Monaco model can run after a
			// language switch. They must finish without reaching the retired Worker.
			if (data.id != null) {
				record({
					requestId: data.id,
					method: data.method,
					uri: data.params?.textDocument?.uri,
					sentAt: Date.now(),
					finishedAt: Date.now(),
					outcome: 'cancelled'
				});
				callback?.({ jsonrpc: '2.0', id: data.id, result: emptyResult } as ResponseMessage);
			}
			return;
		}
		const document = data.params?.textDocument;
		if (
			['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose'].includes(
				data.method
			)
		) {
			for (const [id, request] of pending) {
				if (request.trace.uri === document?.uri && featureMethods.has(request.trace.method))
					cancel(id, 'stale');
			}
			if (data.method === 'textDocument/didClose') versions.delete(document?.uri);
			else if (typeof document?.version === 'number')
				versions.set(document.uri, document.version);
			record({
				method: data.method,
				uri: document?.uri,
				version: document?.version,
				sentAt: Date.now()
			});
		}
		if (data.method === '$/cancelRequest') {
			if (pending.has(data.params?.id)) cancel(data.params.id, 'cancelled');
			else await transport.writer.write(message);
			return;
		}
		if (data.id != null) {
			const hint =
				data.method === 'inlayHint/resolve'
					? hintDocuments.get(JSON.stringify(data.params))
					: undefined;
			const uri = document?.uri ?? hint?.uri;
			const version = hint?.version ?? versions.get(uri);
			const entry: ClangdRequestTrace = {
				requestId: data.id,
				method: data.method,
				uri,
				version,
				sentAt: Date.now()
			};
			record(entry);
			if (featureMethods.has(data.method) && data.method !== 'inlayHint/resolve') {
				for (const [id, request] of pending) {
					if (
						request.trace.method === data.method &&
						request.trace.uri === uri &&
						(data.method === 'textDocument/hover' ||
							request.key === JSON.stringify(data.params))
					)
						cancel(id, 'cancelled');
				}
			}
			const timeout =
				data.method === 'initialize'
					? (options.initializeTimeoutMs ?? 30_000)
					: (options.requestTimeoutMs ?? 8_000);
			if (pending.size >= 128) cancel(pending.keys().next().value!, 'cancelled');
			const id = data.id;
			pending.set(id, {
				trace: entry,
				key: featureMethods.has(data.method) ? JSON.stringify(data.params) : '',
				emptyResult,
				timer: setTimeout(() => cancel(id, 'timeout'), timeout)
			});
			// The pinned client can start providers as soon as initialize returns,
			// before its document synchronization has sent didOpen.
			if (document?.uri && !versions.has(document.uri)) {
				cancel(data.id, 'cancelled', false);
				return;
			}
			if (hint?.uri && hint.version !== versions.get(hint.uri)) {
				cancel(data.id, 'stale', false);
				return;
			}
		}
		try {
			await transport.writer.write(message);
		} catch (error) {
			if (data.id != null) finish(data.id, 'error');
			throw error;
		}
	};
	return {
		trace,
		cancelEditorRequests: () => {
			for (const [id, request] of pending) {
				if (['textDocument/hover', 'inlayHint/resolve'].includes(request.trace.method))
					cancel(id, 'cancelled');
			}
		},
		dispose,
		transport: {
			reader: {
				onError: transport.reader.onError,
				onClose: transport.reader.onClose,
				onPartialMessage: transport.reader.onPartialMessage,
				listen: (listener: DataCallback) => {
					callback = listener;
					return transport.reader.listen(incoming);
				},
				dispose: () => {
					dispose();
					transport.reader.dispose();
				}
			},
			writer: {
				onError: transport.writer.onError,
				onClose: transport.writer.onClose,
				write,
				end: () => {
					dispose();
					transport.writer.end();
				},
				dispose: () => {
					dispose();
					transport.writer.dispose();
				}
			}
		} satisfies EditorLanguageServerTransport
	};
}
