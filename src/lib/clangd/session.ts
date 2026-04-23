import {
	CloseAction,
	ErrorAction,
	MonacoLanguageClient,
	MonacoServices
} from '@hancomac/monaco-languageclient';
import type * as Monaco from 'monaco-editor';

import { CLANGD_CPP_FILE_URI, CLANGD_WORKSPACE_URI, type ClangdStatus } from '$lib/clangd/config';
import ClangdWorker from '$lib/clangd/worker?worker';
import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import {
	resolveRuntimeAssetConfig,
	type ResolvedRuntimeAssetConfig,
	type RuntimeAssetConfig
} from '$lib/playground/assets';
import { BrowserMessageReader, BrowserMessageWriter } from '$lib/utils/vscodeJsonrpcBrowser';

let servicesInstalled = false;

export class ClangdSession {
	Monaco: typeof Monaco;
	baseUrl: string;
	assetConfig: ResolvedRuntimeAssetConfig;
	assetBridge: WorkerAssetBridge | null = null;
	onStatus?: (status: ClangdStatus) => void;
	worker: Worker | null = null;
	languageClient: MonacoLanguageClient | null = null;

	constructor(
		MonacoModule: typeof Monaco,
		baseUrl: string | RuntimeAssetConfig,
		onStatus?: (status: ClangdStatus) => void
	) {
		this.Monaco = MonacoModule;
		this.onStatus = onStatus;
		this.assetConfig = resolveRuntimeAssetConfig(
			'clangd',
			{ clangd: typeof baseUrl === 'string' ? { baseUrl } : baseUrl },
			globalThis.location?.href || ''
		);
		this.baseUrl = this.assetConfig.baseUrl;
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
		this.assetBridge = new WorkerAssetBridge(worker, 'clangd', this.assetConfig, {
			set: (value) => this.onStatus?.({ state: 'loading', loaded: value, total: 1 })
		});
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				worker.removeEventListener('message', handleMessage);
				worker.removeEventListener('error', handleError);
			};
			const handleMessage = (event: MessageEvent<any>) => {
				if (this.assetBridge?.handleMessage(event)) return;
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
			worker.postMessage({
				type: 'init',
				baseUrl: this.baseUrl,
				assets: {
					baseUrl: this.assetConfig.baseUrl,
					useAssetBridge: this.assetConfig.useAssetBridge
				}
			});
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
		this.assetBridge = null;
	}
}
