import {
	CloseAction,
	ErrorAction,
	MonacoLanguageClient,
	type MessageTransports
} from '@hancomac/monaco-languageclient';
import {
	getGleamLanguageServer,
	type EditorLanguageServerHandle,
	type LanguageServerStatus
} from '@wasm-idle/lsp';
import type * as Monaco from 'monaco-editor';

import { installMonacoLanguageServices } from '$lib/lsp/monacoServices';

const GLEAM_WORKSPACE_URI = 'file:///workspace';
const GLEAM_FILE_URI = 'file:///workspace/main.gleam';

export type GleamLspStatus = LanguageServerStatus;

export class GleamLspSession {
	Monaco: typeof Monaco;
	baseUrl: string;
	manifestUrl?: string;
	onStatus?: (status: GleamLspStatus) => void;
	languageServer: EditorLanguageServerHandle | null = null;
	languageClient: MonacoLanguageClient | null = null;

	constructor(
		MonacoModule: typeof Monaco,
		baseUrl: string,
		manifestUrl?: string,
		onStatus?: (status: GleamLspStatus) => void
	) {
		this.Monaco = MonacoModule;
		this.baseUrl = baseUrl;
		this.manifestUrl = manifestUrl;
		this.onStatus = onStatus;
		installMonacoLanguageServices(MonacoModule);
	}

	createModel(value: string) {
		const uri = this.Monaco.Uri.parse(GLEAM_FILE_URI);
		this.Monaco.editor.getModel(uri)?.dispose();
		return this.Monaco.editor.createModel(value, 'gleam', uri);
	}

	async start() {
		if (this.languageServer) return;
		this.onStatus?.({ state: 'loading' });
		const languageServer = await getGleamLanguageServer({
			currentUrl: globalThis.location?.href || '',
			gleam: {
				baseUrl: this.baseUrl,
				manifestUrl: this.manifestUrl
			},
			onStatus: this.onStatus
		});
		this.languageServer = languageServer;

		const { reader, writer } = languageServer.transport as MessageTransports;
		this.languageClient = new MonacoLanguageClient({
			name: 'wasm-idle gleam',
			clientOptions: {
				documentSelector: ['gleam'],
				errorHandler: {
					error: () => ({ action: ErrorAction.Continue }),
					closed: () => ({ action: CloseAction.DoNotRestart })
				},
				workspaceFolder: {
					index: 0,
					name: 'workspace',
					uri: this.Monaco.Uri.parse(GLEAM_WORKSPACE_URI) as any
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
