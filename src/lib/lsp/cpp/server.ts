import type {
	EditorLanguageServerRuntimeOptions,
	EditorLanguageServerHandle
} from '$lib/lsp/types';
import { resolveCppLanguageServerBaseUrl } from '$lib/lsp/runtime';
import ClangdWorker from '$lib/clangd/worker?worker';
import { BrowserMessageReader, BrowserMessageWriter } from 'vscode-jsonrpc/browser';

const currentUrl = () => globalThis.location?.href || '';

async function createServer(baseUrl: string) {
	let resolveReady = () => {};
	let rejectReady = (_error: Error) => {};
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const worker = new ClangdWorker();
	const cleanup = () => {
		worker.removeEventListener('message', readyListener);
		worker.removeEventListener('error', errorListener);
	};
	const readyListener = (event: MessageEvent<any>) => {
		switch (event.data?.type) {
			case 'ready': {
				cleanup();
				resolveReady();
				break;
			}
			case 'error': {
				cleanup();
				rejectReady(new Error(event.data?.message || 'clangd failed to initialize'));
				break;
			}
		}
	};
	const errorListener = (event: ErrorEvent) => {
		cleanup();
		rejectReady(event.error || new Error(event.message || 'clangd worker failed'));
	};
	worker.addEventListener('message', readyListener);
	worker.addEventListener('error', errorListener);
	worker.postMessage({ type: 'init', baseUrl });
	await ready;
	return worker;
}

export async function getCppLanguageServer(
	options?: string | EditorLanguageServerRuntimeOptions
): Promise<EditorLanguageServerHandle> {
	const baseUrl = resolveCppLanguageServerBaseUrl(options, currentUrl());
	const worker = await createServer(baseUrl);
	const reader = new BrowserMessageReader(worker);
	const writer = new BrowserMessageWriter(worker);

	return {
		transport: { reader, writer },
		syncFile: (path: string) => {
			worker.postMessage({ type: 'sync-file', name: path });
		},
		dispose: () => {
			worker.terminate();
			reader.dispose();
			writer.dispose();
		}
	};
}
