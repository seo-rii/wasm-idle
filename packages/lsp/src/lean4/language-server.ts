import type {
	EditorLanguageServerHandle,
	EditorLanguageServerOptions,
	EditorLanguageServerRuntimeOptions
} from '../types.js';
import { Emitter } from '../jsonrpc.js';
import type { DataCallback, ResponseMessage } from 'vscode-jsonrpc';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import { resolveLean4RuntimeAssetConfig } from './assets.js';

export interface Lean4LanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

/** The upstream Lean 4 server, with browser workers replacing native child processes. */
export async function getLean4LanguageServer(
	options?: EditorLanguageServerOptions | Lean4LanguageServerOptions
) {
	const host = typeof options === 'object' ? options : undefined;
	const currentUrl = host?.currentUrl ?? globalThis.location?.href ?? '';
	const rootUrl = typeof options === 'string' ? options : host?.rootUrl;
	const config = resolveLean4RuntimeAssetConfig({ rootUrl, lean4: host?.lean4 }, currentUrl);
	const maxMemoryBytes = host?.lean4?.maxMemoryBytes ?? 1024 ** 3;
	if (
		!Number.isSafeInteger(maxMemoryBytes) ||
		maxMemoryBytes < 256 * 1024 ** 2 ||
		maxMemoryBytes > 4 * 1024 ** 3 ||
		maxMemoryBytes % 65536 !== 0
	)
		throw new TypeError(
			'Lean LSP memory must be a multiple of 64 KiB between 256 MiB and 4 GiB.'
		);
	let worker: Worker | undefined;
	let handle: EditorLanguageServerHandle | undefined;
	let disposed = false;
	let failure: Error | undefined;
	let receive: DataCallback | undefined;
	const pending = new Set<string | number>();
	const closed = new Emitter<void>();
	// Keep the actual process and pthread Workers owned by the caller's event loop.
	// Worker.terminate() alone does not reliably terminate a tree of nested Workers.
	const processes = new Map<number, Worker>();
	const terminateProcesses = () => {
		for (const process of processes.values()) process.terminate();
		processes.clear();
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		terminateProcesses();
		worker?.removeEventListener('message', runtimeError);
		worker?.removeEventListener('error', workerError);
		// JSON-RPC's close event alone does not reject outstanding client requests.
		// A crashed supervisor cannot answer, so settle only IDs without an upstream response.
		for (const id of pending) {
			const response: ResponseMessage = {
				jsonrpc: '2.0',
				id,
				error: { code: -32801, message: failure?.message ?? 'Lean LSP is closed.' }
			};
			receive?.(response);
		}
		pending.clear();
		closed.fire();
		handle?.dispose();
		closed.dispose();
	};
	const fail = (error: Error) => {
		if (disposed) return;
		failure = error;
		dispose();
		(host as Lean4LanguageServerOptions | undefined)?.onStatus?.({
			state: 'error',
			message: error.message
		});
	};
	const workerError = (event: ErrorEvent) =>
		fail(event.error instanceof Error ? event.error : new Error(event.message));
	const runtimeError = (event: MessageEvent) => {
		if (disposed) return;
		// Server stdout is JSON-RPC, including user #eval output. Its extension fields
		// cannot become supervisor commands or host lifecycle messages.
		if (event.data?.jsonrpc === '2.0') return;
		const control = event.data?.leanWorker;
		if (control) {
			const id = control.id;
			try {
				if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid Lean worker id.');
				if (control.type === 'create') {
					if (processes.has(id) || processes.size >= 80)
						throw new Error('Lean worker ownership limit exceeded.');
					const url = new URL(control.url, currentUrl);
					if (
						!['http:', 'https:', 'blob:'].includes(url.protocol) ||
						url.origin !== new URL(currentUrl).origin
					)
						throw new Error(
							'Lean process workers must remain on the application origin.'
						);
					const process = new Worker(url, {
						type: 'module',
						...(control.pthread ? { name: 'em-pthread' } : {})
					});
					processes.set(id, process);
					process.onmessage = ({ data }) =>
						worker?.postMessage({ type: 'lean-worker-event', id, data });
					process.onerror = (error) => {
						error.preventDefault();
						worker?.postMessage({
							type: 'lean-worker-event',
							id,
							error: error.message
						});
					};
				} else if (control.type === 'post') processes.get(id)?.postMessage(control.data);
				else if (control.type === 'terminate') {
					processes.get(id)?.terminate();
					processes.delete(id);
				}
			} catch (cause) {
				worker?.postMessage({ type: 'lean-worker-event', id, error: String(cause) });
			}
			return;
		}
		if (event.data?.type === 'error') fail(new Error(event.data.message));
	};
	try {
		handle = await createWorkerLanguageServerClient({
			createWorker: () => {
				worker = (host?.createWorker ?? createDefaultWorker)();
				worker.addEventListener('message', runtimeError);
				worker.addEventListener('error', workerError);
				return worker;
			},
			initOptions: {
				baseUrl: config.baseUrl,
				maxMemoryBytes,
				processStartupTimeoutMs: host?.startupTimeoutMs,
				assetTimeoutMs: host?.assetTimeoutMs,
				maxAssetBytes: host?.maxAssetBytes
			},
			onStatus: (host as Lean4LanguageServerOptions | undefined)?.onStatus,
			lifecycle: { ...host, rootUrl }
		});
		if (disposed) {
			handle.dispose();
			throw failure ?? new Error('Lean LSP was disposed during startup.');
		}
	} catch (cause) {
		dispose();
		throw cause;
	}
	const { reader, writer } = handle.transport;
	return {
		...handle,
		transport: {
			reader: {
				...reader,
				onClose: closed.event,
				listen(callback: DataCallback) {
					receive = callback;
					const subscription = reader.listen((message) => {
						const response = message as { id?: string | number; method?: string };
						if (!response.method && response.id !== undefined)
							pending.delete(response.id);
						callback(message);
					});
					return {
						dispose() {
							if (receive === callback) receive = undefined;
							subscription.dispose();
						}
					};
				},
				dispose() {
					receive = undefined;
					reader.dispose();
				}
			},
			writer: {
				onError: writer.onError,
				onClose: closed.event,
				async write(message: Parameters<typeof writer.write>[0]) {
					if (disposed) throw failure ?? new Error('Lean LSP is closed.');
					const request = message as { id?: string | number; method?: string };
					const id = request.method ? request.id : undefined;
					if (id !== undefined) pending.add(id);
					try {
						await writer.write(message);
					} catch (cause) {
						if (id !== undefined) pending.delete(id);
						throw cause;
					}
				},
				end: () => writer.end(),
				dispose: () => writer.dispose()
			}
		},
		dispose
	};
}
