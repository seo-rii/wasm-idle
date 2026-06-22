import { BrowserMessageReader, BrowserMessageWriter } from './jsonrpc.js';
import { isProgressValue, nextFallbackProgress, progressRatio } from './progress.js';
import type { EditorLanguageServerHandle } from './types.js';
import type { MessageReader } from 'vscode-jsonrpc';

export type LanguageServerStatus =
	| { state: 'disabled' }
	| { state: 'loading'; stage?: string; loaded?: number; total?: number }
	| { state: 'ready' }
	| { state: 'error'; message: string };

export interface LanguageServerProgressUpdate {
	stage?: string;
	loaded?: number;
	total?: number;
}

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

export function createLanguageServerProgressReporter(
	onStatus?: (status: LanguageServerStatus) => void
) {
	let fallbackLoaded = 0;
	const loading = (stage = 'startup') => {
		fallbackLoaded = 0;
		onStatus?.({ state: 'loading', stage, loaded: 0, total: 1 });
	};
	const progress = ({ stage, loaded, total }: LanguageServerProgressUpdate = {}) => {
		if (isProgressValue(loaded) && isProgressValue(total) && total > 0) {
			fallbackLoaded = Math.max(fallbackLoaded, progressRatio(loaded, total, 0.92));
			onStatus?.({
				state: 'loading',
				...(stage ? { stage } : {}),
				loaded,
				total
			});
			return;
		}
		fallbackLoaded = nextFallbackProgress(fallbackLoaded, stage, 0.92);
		onStatus?.({
			state: 'loading',
			...(stage ? { stage } : {}),
			loaded: fallbackLoaded,
			total: 1
		});
	};

	return {
		loading,
		progress,
		ready: () => onStatus?.({ state: 'ready' }),
		error: (message: string) => onStatus?.({ state: 'error', message }),
		disabled: () => onStatus?.({ state: 'disabled' })
	};
}

export async function createWorkerLanguageServerClient(
	options: WorkerLanguageServerClientOptions
): Promise<EditorLanguageServerHandle> {
	const status = createLanguageServerProgressReporter(options.onStatus);
	status.loading();
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
						status.progress({
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
		status.error(message);
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
	status.ready();
	return {
		transport: { reader: filteredReader, writer },
		dispose: () => {
			worker.terminate();
			reader.dispose();
			writer.dispose();
			status.disabled();
		}
	};
}
