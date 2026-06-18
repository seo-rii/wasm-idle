import {
	CloseAction,
	ErrorAction,
	MonacoLanguageClient,
	type MessageTransports
} from '@hancomac/monaco-languageclient';
import {
	getGoLanguageServer,
	type EditorLanguageServerHandle,
	type LanguageServerStatus
} from '@wasm-idle/lsp';
import type * as Monaco from 'monaco-editor';

import { installMonacoLanguageServices } from '$lib/lsp/monacoServices';
import type { GoTarget } from '$lib/playground/options';

const GO_WORKSPACE_URI = 'file:///workspace';
const GO_FILE_URI = 'file:///workspace/main.go';

export type GoLspStatus = LanguageServerStatus;

export class GoLspSession {
	Monaco: typeof Monaco;
	compilerUrl: string;
	target: GoTarget;
	onStatus?: (status: GoLspStatus) => void;
	languageServer: EditorLanguageServerHandle | null = null;
	languageClient: MonacoLanguageClient | null = null;

	constructor(
		MonacoModule: typeof Monaco,
		compilerUrl: string,
		target: GoTarget,
		onStatus?: (status: GoLspStatus) => void
	) {
		this.Monaco = MonacoModule;
		this.compilerUrl = compilerUrl;
		this.target = target;
		this.onStatus = onStatus;
		installMonacoLanguageServices(MonacoModule);
	}

	createModel(value: string) {
		const uri = this.Monaco.Uri.parse(GO_FILE_URI);
		this.Monaco.editor.getModel(uri)?.dispose();
		return this.Monaco.editor.createModel(value, 'go', uri);
	}

	async start() {
		if (this.languageServer) return;
		this.onStatus?.({ state: 'loading' });
		const languageServer = await getGoLanguageServer({
			currentUrl: globalThis.location?.href || '',
			go: {
				compilerUrl: this.compilerUrl,
				target: this.target
			},
			onStatus: this.onStatus
		});
		this.languageServer = languageServer;

		const { reader, writer } = languageServer.transport as MessageTransports;
		this.languageClient = new MonacoLanguageClient({
			name: 'wasm-idle go',
			clientOptions: {
				documentSelector: ['go'],
				errorHandler: {
					error: () => ({ action: ErrorAction.Continue }),
					closed: () => ({ action: CloseAction.DoNotRestart })
				},
				workspaceFolder: {
					index: 0,
					name: 'workspace',
					uri: this.Monaco.Uri.parse(GO_WORKSPACE_URI) as any
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
