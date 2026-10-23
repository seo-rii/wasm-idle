import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
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
	// Keep the actual process and pthread Workers owned by the caller's event loop.
	// Worker.terminate() alone does not reliably terminate a tree of nested Workers.
	const processes = new Map<number, Worker>();
	const terminateProcesses = () => {
		for (const process of processes.values()) process.terminate();
		processes.clear();
	};
	const runtimeError = (event: MessageEvent) => {
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
		if (event.data?.type === 'error')
			(host as Lean4LanguageServerOptions | undefined)?.onStatus?.({
				state: 'error',
				message: event.data.message
			});
	};
	let handle;
	try {
		handle = await createWorkerLanguageServerClient({
			createWorker: () => {
				worker = (host?.createWorker ?? createDefaultWorker)();
				worker.addEventListener('message', runtimeError);
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
	} catch (cause) {
		terminateProcesses();
		worker?.removeEventListener('message', runtimeError);
		throw cause;
	}
	return {
		...handle,
		dispose() {
			terminateProcesses();
			worker?.removeEventListener('message', runtimeError);
			handle.dispose();
		}
	};
}
