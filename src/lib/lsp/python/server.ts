import type {
	EditorLanguageServerHandle,
	EditorLanguageServerRuntimeOptions
} from '$lib/lsp/types';
import { resolvePythonLanguageServerBaseUrl } from '$lib/lsp/runtime';
import PythonLspWorker from './main.worker?worker';
import { BrowserMessageReader, BrowserMessageWriter } from '$lib/utils/vscodeJsonrpcBrowser';

const currentUrl = () => globalThis.location?.href || '';

async function createServer(pyodideBaseUrl: string) {
	let resolveReady = () => {};
	let rejectReady = (_error: Error) => {};
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const worker = new PythonLspWorker();
	const cleanup = () => {
		worker.removeEventListener('message', readyListener);
		worker.removeEventListener('error', errorListener);
	};
	const readyListener = (event: MessageEvent) => {
		switch (event.data?.type) {
			case 'ready': {
				cleanup();
				resolveReady();
				break;
			}
			case 'error': {
				cleanup();
				rejectReady(
					new Error(event.data?.error || 'Python LSP worker failed to initialize')
				);
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

export async function getPythonLanguageServer(
	options?: string | EditorLanguageServerRuntimeOptions
): Promise<EditorLanguageServerHandle> {
	const pyodideBaseUrl = resolvePythonLanguageServerBaseUrl(options, currentUrl());
	const worker = await createServer(pyodideBaseUrl);
	const reader = new BrowserMessageReader(worker);
	const writer = new BrowserMessageWriter(worker);

	return {
		transport: { reader, writer },
		dispose: () => {
			worker.terminate();
			reader.dispose();
			writer.dispose();
		}
	};
}
