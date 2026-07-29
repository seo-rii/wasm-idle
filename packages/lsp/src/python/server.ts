import { BrowserMessageReader, BrowserMessageWriter } from '../jsonrpc.js';
import { waitForLanguageServerStartup } from '../lifecycle.js';
import { resolvePythonLanguageServerBaseUrl } from '../runtime.js';
import type {
	EditorLanguageServerHandle,
	EditorLanguageServerOptions,
	EditorLanguageServerRuntimeOptions
} from '../types.js';
import { createLanguageServerProgressReporter } from '../worker-client.js';
import type { PythonLspStatus, PythonLspWorkerOutboundMessage } from './protocol.js';

export interface PythonLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	currentUrl?: string;
	onStatus?: (status: PythonLspStatus) => void;
}

const currentUrl = () => globalThis.location?.href || '';

const createDefaultPythonLspWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function isPythonLanguageServerOptions(
	options: EditorLanguageServerOptions | PythonLanguageServerOptions | undefined
): options is PythonLanguageServerOptions {
	return typeof options === 'object' && !!options;
}

async function createServer(
	pyodideBaseUrl: string,
	createWorker: () => Worker,
	onStatus: ((status: PythonLspStatus) => void) | undefined,
	lifecycle: Pick<EditorLanguageServerRuntimeOptions, 'signal' | 'startupTimeoutMs'>
) {
	const status = createLanguageServerProgressReporter(onStatus);
	status.loading();
	let worker: Worker | undefined;
	let cleanup = () => {};
	try {
		await waitForLanguageServerStartup(
			() =>
				new Promise<void>((resolve, reject) => {
					const activeWorker = createWorker();
					worker = activeWorker;
					const readyListener = (event: MessageEvent<PythonLspWorkerOutboundMessage>) => {
						switch (event.data?.type) {
							case 'progress': {
								status.progress({ stage: event.data.stage });
								break;
							}
							case 'ready': {
								cleanup();
								status.ready();
								resolve();
								break;
							}
							case 'error': {
								cleanup();
								reject(
									new Error(
										event.data?.error || 'Python LSP failed to initialize'
									)
								);
								break;
							}
						}
					};
					const errorListener = (event: ErrorEvent) => {
						cleanup();
						reject(
							event.error || new Error(event.message || 'Python LSP worker failed')
						);
					};
					cleanup = () => {
						activeWorker.removeEventListener('message', readyListener);
						activeWorker.removeEventListener('error', errorListener);
					};
					activeWorker.addEventListener('message', readyListener);
					activeWorker.addEventListener('error', errorListener);
					activeWorker.postMessage({ type: 'init', pyodideBaseUrl });
				}),
			{ signal: lifecycle.signal, timeoutMs: lifecycle.startupTimeoutMs }
		);
	} catch (error) {
		worker?.terminate();
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		cleanup();
	}
	if (!worker) throw new Error('Python LSP worker did not start');
	return worker;
}

export async function createPythonLanguageServer(
	options?: EditorLanguageServerOptions | PythonLanguageServerOptions
): Promise<EditorLanguageServerHandle> {
	const hostOptions = isPythonLanguageServerOptions(options) ? options : undefined;
	const pyodideBaseUrl = resolvePythonLanguageServerBaseUrl(
		options,
		hostOptions?.currentUrl ?? currentUrl()
	);
	const worker = await createServer(
		pyodideBaseUrl,
		hostOptions?.createWorker || createDefaultPythonLspWorker,
		hostOptions?.onStatus,
		{ signal: hostOptions?.signal, startupTimeoutMs: hostOptions?.startupTimeoutMs }
	);
	const reader = new BrowserMessageReader(worker);
	const writer = new BrowserMessageWriter(worker);

	let disposed = false;
	return {
		transport: { reader, writer },
		dispose: () => {
			if (disposed) return;
			disposed = true;
			worker.terminate();
			reader.dispose();
			writer.dispose();
			hostOptions?.onStatus?.({ state: 'disabled' });
		}
	};
}

export const getPythonLanguageServer = createPythonLanguageServer;
