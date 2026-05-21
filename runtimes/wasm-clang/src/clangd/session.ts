import type { MonacoLanguageClient } from '@hancomac/monaco-languageclient';
import type * as Monaco from 'monaco-editor';
import {
	BrowserMessageReader,
	BrowserMessageWriter
} from 'vscode-jsonrpc/lib/browser/main.js';

import {
	CLANGD_CPP_FILE_URI,
	CLANGD_WORKSPACE_URI,
	type ClangdStatus,
	normalizeClangdBaseUrl
} from './config.js';
import type {
	ClangdWorkerOutboundMessage,
	ClangdWorkerSyncFileMessage
} from './protocol.js';

let servicesInstalled = false;

export class ClangdSession {
	Monaco: typeof Monaco;
	baseUrl: string;
	onStatus?: (status: ClangdStatus) => void;
	worker: Worker | null = null;
	languageClient: MonacoLanguageClient | null = null;
	createWorker: () => Worker;

	constructor(
		MonacoModule: typeof Monaco,
		baseUrl: string,
		onStatus?: (status: ClangdStatus) => void,
		createWorker: () => Worker = () =>
			new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
	) {
		this.Monaco = MonacoModule;
		this.onStatus = onStatus;
		this.baseUrl = normalizeClangdBaseUrl(baseUrl);
		this.createWorker = createWorker;
	}

	createModel(value: string) {
		const uri = this.Monaco.Uri.parse(CLANGD_CPP_FILE_URI);
		this.Monaco.editor.getModel(uri)?.dispose();
		return this.Monaco.editor.createModel(value, 'cpp', uri);
	}

	syncFile(name: string) {
		const worker = this.worker;
		if (!worker) return;
		worker.postMessage({
			type: 'sync-file',
			name
		} satisfies ClangdWorkerSyncFileMessage);
	}

	async start() {
		if (this.worker) return;
		this.onStatus?.({ state: 'loading' });
		const {
			CloseAction,
			ErrorAction,
			MonacoLanguageClient,
			MonacoServices
		} = await import('@hancomac/monaco-languageclient');
		if (!servicesInstalled) {
			MonacoServices.install(this.Monaco);
			servicesInstalled = true;
		}
		const worker = this.createWorker();
		this.worker = worker;
		try {
			await new Promise<void>((resolve, reject) => {
				const cleanup = () => {
					worker.removeEventListener('message', handleMessage);
					worker.removeEventListener('error', handleError);
				};
				const handleMessage = (event: MessageEvent<ClangdWorkerOutboundMessage>) => {
					const data = event.data;
					if (data?.type === 'progress') {
						this.onStatus?.({ state: 'loading', loaded: data.value, total: data.max });
						return;
					}
					if (data?.type === 'ready') {
						cleanup();
						resolve();
						return;
					}
					if (data?.type === 'error') {
						cleanup();
						reject(new Error(data.message || 'clangd failed to start'));
					}
				};
				const handleError = (event: ErrorEvent) => {
					cleanup();
					reject(event.error || new Error(event.message || 'clangd worker failed'));
				};
				worker.addEventListener('message', handleMessage);
				worker.addEventListener('error', handleError);
				worker.postMessage({ type: 'init', baseUrl: this.baseUrl });
			});
		} catch (error) {
			this.worker?.terminate();
			this.worker = null;
			this.onStatus?.({
				state: 'error',
				message: error instanceof Error ? error.message : String(error)
			});
			throw error;
		}

		const reader = new BrowserMessageReader(worker);
		const writer = new BrowserMessageWriter(worker);
		this.languageClient = new MonacoLanguageClient({
			name: 'wasm-clang clangd',
			clientOptions: {
				documentSelector: ['cpp'],
				errorHandler: {
					error: () => ({ action: ErrorAction.Continue }),
					closed: () => ({ action: CloseAction.DoNotRestart })
				},
				workspaceFolder: {
					index: 0,
					name: 'workspace',
					uri: this.Monaco.Uri.parse(CLANGD_WORKSPACE_URI) as any
				}
			},
			connectionProvider: {
				get: async () => ({ reader, writer })
			}
		});
		this.languageClient.start();
		reader.onClose(() => {
			this.languageClient?.stop();
			this.onStatus?.({ state: 'disabled' });
		});
		this.onStatus?.({ state: 'ready' });
	}

	dispose() {
		this.languageClient?.stop();
		this.languageClient = null;
		this.worker?.terminate();
		this.worker = null;
		this.onStatus?.({ state: 'disabled' });
	}
}
