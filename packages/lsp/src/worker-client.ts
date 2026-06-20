import { BrowserMessageReader, BrowserMessageWriter } from './jsonrpc.js';
import type { EditorLanguageServerHandle } from './types.js';
import type { MessageReader } from 'vscode-jsonrpc';

export type LanguageServerStatus =
	| { state: 'disabled' }
	| { state: 'loading'; stage?: string; loaded?: number; total?: number }
	| { state: 'ready' }
	| { state: 'error'; message: string };

export interface WorkerLanguageServerClientOptions {
	createWorker: () => Worker;
	initOptions?: unknown;
	onStatus?: (status: LanguageServerStatus) => void;
}

interface WorkerControlMessage {
	type?: 'ready' | 'error' | 'progress';
	message?: string;
	stage?: string;
	loaded?: number;
	total?: number;
}

export async function createWorkerLanguageServerClient(
	options: WorkerLanguageServerClientOptions
): Promise<EditorLanguageServerHandle> {
	options.onStatus?.({ state: 'loading' });
	const worker = options.createWorker();
	try {
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				worker.removeEventListener('message', handleMessage);
				worker.removeEventListener('error', handleError);
			};
			const handleMessage = (event: MessageEvent<WorkerControlMessage>) => {
				switch (event.data?.type) {
					case 'progress':
						options.onStatus?.({
							state: 'loading',
							stage: event.data.stage,
							loaded: event.data.loaded,
							total: event.data.total
						});
						return;
					case 'ready':
						cleanup();
						resolve();
						return;
					case 'error':
						cleanup();
						reject(new Error(event.data.message || 'Language server failed to initialize'));
				}
			};
			const handleError = (event: ErrorEvent) => {
				cleanup();
				reject(event.error || new Error(event.message || 'Language server worker failed'));
			};
			worker.addEventListener('message', handleMessage);
			worker.addEventListener('error', handleError);
			worker.postMessage({ type: 'init', options: options.initOptions });
		});
	} catch (error) {
		worker.terminate();
		const message = error instanceof Error ? error.message : String(error);
		options.onStatus?.({ state: 'error', message });
		throw error;
	}

	const reader = new BrowserMessageReader(worker);
	const filteredReader: MessageReader = {
		onError: reader.onError,
		onClose: reader.onClose,
		onPartialMessage: reader.onPartialMessage,
		listen(callback) {
			return reader.listen((message) => {
				const record = message as { jsonrpc?: unknown } | null;
				if (record && typeof record === 'object' && record.jsonrpc === '2.0') {
					callback(message);
				}
			});
		},
		dispose() {
			reader.dispose();
		}
	};
	const writer = new BrowserMessageWriter(worker);
	options.onStatus?.({ state: 'ready' });
	return {
		transport: { reader: filteredReader, writer },
		dispose: () => {
			worker.terminate();
			reader.dispose();
			writer.dispose();
			options.onStatus?.({ state: 'disabled' });
		}
	};
}
