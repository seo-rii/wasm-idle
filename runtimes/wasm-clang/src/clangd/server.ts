import { BrowserMessageReader, BrowserMessageWriter } from 'vscode-jsonrpc/lib/browser/main.js';

import { normalizeClangdBaseUrl, type ClangdStatus } from './config.js';
import type { ClangdWorkerOutboundMessage, ClangdWorkerSyncFileMessage } from './protocol.js';

export interface ClangdLanguageServerHandle {
	transport: {
		reader: BrowserMessageReader;
		writer: BrowserMessageWriter;
	};
	syncFile: (name: string) => void;
	dispose: () => void;
}

export interface ClangdLanguageServerOptions {
	baseUrl?: string;
	createWorker?: () => Worker;
	onStatus?: (status: ClangdStatus) => void;
}

const createDefaultClangdWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const startClangdWorker = (
	baseUrl: string,
	createWorker: () => Worker,
	onStatus?: (status: ClangdStatus) => void
) =>
	new Promise<Worker>((resolve, reject) => {
		const worker = createWorker();
		let settled = false;

		const disposeListeners = () => {
			worker.removeEventListener('message', handleMessage);
			worker.removeEventListener('error', handleError);
		};

		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			disposeListeners();
			worker.terminate();
			onStatus?.({ state: 'error', message: error.message });
			reject(error);
		};

		const handleMessage = (event: MessageEvent<ClangdWorkerOutboundMessage>) => {
			const message = event.data;
			if (message?.type === 'progress') {
				onStatus?.({
					state: 'loading',
					loaded: message.value,
					...(message.max ? { total: message.max } : {})
				});
				return;
			}
			if (message?.type === 'ready') {
				if (settled) return;
				settled = true;
				disposeListeners();
				onStatus?.({ state: 'ready' });
				resolve(worker);
				return;
			}
			if (message?.type === 'error') {
				fail(new Error(message.message));
			}
		};

		const handleError = (event: ErrorEvent) => {
			fail(event.error instanceof Error ? event.error : new Error(event.message));
		};

		worker.addEventListener('message', handleMessage);
		worker.addEventListener('error', handleError);
		onStatus?.({ state: 'loading' });
		worker.postMessage({ type: 'init', baseUrl });
	});

export const createClangdLanguageServer = async (
	options: string | ClangdLanguageServerOptions = {}
): Promise<ClangdLanguageServerHandle> => {
	const config = typeof options === 'string' ? { baseUrl: options } : options;
	const baseUrl = normalizeClangdBaseUrl(config.baseUrl || '/clangd/');
	const worker = await startClangdWorker(
		baseUrl,
		config.createWorker || createDefaultClangdWorker,
		config.onStatus
	);
	const reader = new BrowserMessageReader(worker);
	const writer = new BrowserMessageWriter(worker);

	return {
		transport: { reader, writer },
		syncFile(name: string) {
			worker.postMessage({ type: 'sync-file', name } satisfies ClangdWorkerSyncFileMessage);
		},
		dispose() {
			reader.dispose();
			writer.end();
			writer.dispose();
			worker.terminate();
			config.onStatus?.({ state: 'disabled' });
		}
	};
};

export const getClangdLanguageServer = createClangdLanguageServer;
