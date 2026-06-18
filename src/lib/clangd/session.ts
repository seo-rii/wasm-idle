import {
	CloseAction,
	ErrorAction,
	MonacoLanguageClient,
	MonacoServices,
	type MessageTransports
} from '@hancomac/monaco-languageclient';
import {
	getCppLanguageServer,
	type EditorLanguageServerHandle,
	type LanguageToolAssetConfig
} from '@wasm-idle/lsp';
import type * as Monaco from 'monaco-editor';

import { CLANGD_CPP_FILE_URI, CLANGD_WORKSPACE_URI, type ClangdStatus } from '$lib/clangd/config';

let servicesInstalled = false;

export class ClangdSession {
	Monaco: typeof Monaco;
	assetConfig: LanguageToolAssetConfig;
	onStatus?: (status: ClangdStatus) => void;
	languageServer: EditorLanguageServerHandle | null = null;
	languageClient: MonacoLanguageClient | null = null;

	constructor(
		MonacoModule: typeof Monaco,
		baseUrl: string | LanguageToolAssetConfig,
		onStatus?: (status: ClangdStatus) => void
	) {
		this.Monaco = MonacoModule;
		this.onStatus = onStatus;
		this.assetConfig = typeof baseUrl === 'string' ? { baseUrl } : baseUrl;
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
		if (this.languageServer) return;
		this.onStatus?.({ state: 'loading' });
		const languageServer = await getCppLanguageServer({
			cpp: this.assetConfig,
			currentUrl: globalThis.location?.href || '',
			onStatus: this.onStatus
		});
		this.languageServer = languageServer;

		const { reader, writer } = languageServer.transport as MessageTransports;
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
		this.languageServer?.dispose();
		this.languageServer = null;
	}
}
