import {
	CloseAction,
	ErrorAction,
	MonacoLanguageClient,
	MonacoServices
} from '@hancomac/monaco-languageclient';
import type * as Monaco from 'monaco-editor';
import { BrowserMessageReader, BrowserMessageWriter } from 'vscode-jsonrpc/browser';

import {
	CLANGD_CPP_FILE_URI,
	CLANGD_WORKSPACE_URI,
	DEFAULT_CLANGD_BASE_URL,
	type ClangdStatus,
	normalizeClangdBaseUrl
} from '$lib/clangd/config';
import ClangdWorker from '$lib/clangd/worker?worker';

let servicesInstalled = false;

export class ClangdSession {
	Monaco: typeof Monaco;
	baseUrl: string;
	onStatus?: (status: ClangdStatus) => void;
	worker: Worker | null = null;
	languageClient: MonacoLanguageClient | null = null;

	constructor(
		MonacoModule: typeof Monaco,
		onStatus?: (status: ClangdStatus) => void,
		baseUrl = DEFAULT_CLANGD_BASE_URL
	) {
		this.Monaco = MonacoModule;
		this.onStatus = onStatus;
		this.baseUrl = normalizeClangdBaseUrl(baseUrl);
		if (!servicesInstalled) {
			MonacoServices.install(MonacoModule);
			servicesInstalled = true;
		}
	}

	createModel(value: string) {
		const uri = this.Monaco.Uri.parse(CLANGD_CPP_FILE_URI);
		this.Monaco.editor.getModel(uri)?.dispose();
		return this.Monaco.editor.createModel(value, 'cpp', uri);
	}

	async start() {
		if (this.worker) return;
		this.onStatus?.({ state: 'loading' });
		const worker = new ClangdWorker();
		this.worker = worker;
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				worker.removeEventListener('message', handleMessage);
				worker.removeEventListener('error', handleError);
			};
			const handleMessage = (event: MessageEvent<any>) => {
				const { type, value, max, message } = event.data || {};
				if (type === 'progress') {
					this.onStatus?.({ state: 'loading', loaded: value, total: max });
					return;
				}
				if (type === 'ready') {
					cleanup();
					resolve();
					return;
				}
				if (type === 'error') {
					cleanup();
					reject(new Error(message || 'clangd failed to start'));
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

		const reader = new BrowserMessageReader(worker);
		const writer = new BrowserMessageWriter(worker);
		this.languageClient = new MonacoLanguageClient({
			name: 'wasm-idle clangd',
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
	}
}
