import { BrowserMessageReader, BrowserMessageWriter } from '../jsonrpc.js';
import { resolvePythonLanguageServerBaseUrl } from '../runtime.js';
import type {
	EditorLanguageServerHandle,
	EditorLanguageServerOptions,
	EditorLanguageServerRuntimeOptions
} from '../types.js';
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
	onStatus?: (status: PythonLspStatus) => void
) {
	onStatus?.({ state: 'loading' });
	let resolveReady = () => {};
	let rejectReady = (_error: Error) => {};
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const worker = createWorker();
	const cleanup = () => {
		worker.removeEventListener('message', readyListener);
		worker.removeEventListener('error', errorListener);
	};
	const readyListener = (event: MessageEvent<PythonLspWorkerOutboundMessage>) => {
		switch (event.data?.type) {
			case 'progress': {
				onStatus?.({ state: 'loading', stage: event.data.stage });
				break;
			}
			case 'ready': {
				cleanup();
				onStatus?.({ state: 'ready' });
				resolveReady();
				break;
			}
			case 'error': {
				cleanup();
				rejectReady(new Error(event.data?.error || 'Python LSP failed to initialize'));
				break;
			}
		}
	};
	const errorListener = (event: ErrorEvent) => {
		cleanup();
		rejectReady(event.error || new Error(event.message || 'Python LSP worker failed'));
	};
	worker.addEventListener('message', readyListener);
	worker.addEventListener('error', errorListener);
	worker.postMessage({ type: 'init', pyodideBaseUrl });
	await ready;
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
		hostOptions?.onStatus
	);
	const reader = new BrowserMessageReader(worker);
	const writer = new BrowserMessageWriter(worker);

	return {
		transport: { reader, writer },
		dispose: () => {
			worker.terminate();
			reader.dispose();
			writer.dispose();
			hostOptions?.onStatus?.({ state: 'disabled' });
		}
	};
}

export const getPythonLanguageServer = createPythonLanguageServer;
