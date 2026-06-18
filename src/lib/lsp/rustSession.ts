import {
	CloseAction,
	ErrorAction,
	MonacoLanguageClient,
	type MessageTransports
} from '@hancomac/monaco-languageclient';
import {
	getRustLanguageServer,
	type EditorLanguageServerHandle,
	type LanguageServerStatus
} from '@wasm-idle/lsp';
import type * as Monaco from 'monaco-editor';

import { installMonacoLanguageServices } from '$lib/lsp/monacoServices';
import type { RustTargetTriple } from '$lib/playground/options';

const RUST_WORKSPACE_URI = 'file:///workspace';
const RUST_FILE_URI = 'file:///workspace/main.rs';

export type RustLspStatus = LanguageServerStatus;

export class RustLspSession {
	Monaco: typeof Monaco;
	compilerUrl: string;
	targetTriple: RustTargetTriple;
	onStatus?: (status: RustLspStatus) => void;
	languageServer: EditorLanguageServerHandle | null = null;
	languageClient: MonacoLanguageClient | null = null;

	constructor(
		MonacoModule: typeof Monaco,
		compilerUrl: string,
		targetTriple: RustTargetTriple,
		onStatus?: (status: RustLspStatus) => void
	) {
		this.Monaco = MonacoModule;
		this.compilerUrl = compilerUrl;
		this.targetTriple = targetTriple;
		this.onStatus = onStatus;
		installMonacoLanguageServices(MonacoModule);
	}

	createModel(value: string) {
		const uri = this.Monaco.Uri.parse(RUST_FILE_URI);
		this.Monaco.editor.getModel(uri)?.dispose();
		return this.Monaco.editor.createModel(value, 'rust', uri);
	}

	async start() {
		if (this.languageServer) return;
		this.onStatus?.({ state: 'loading' });
		const languageServer = await getRustLanguageServer({
			currentUrl: globalThis.location?.href || '',
			rust: {
				compilerUrl: this.compilerUrl,
				targetTriple: this.targetTriple
			},
			onStatus: this.onStatus
		});
		this.languageServer = languageServer;

		const { reader, writer } = languageServer.transport as MessageTransports;
		this.languageClient = new MonacoLanguageClient({
			name: 'wasm-idle rust',
			clientOptions: {
				documentSelector: ['rust'],
				errorHandler: {
					error: () => ({ action: ErrorAction.Continue }),
					closed: () => ({ action: CloseAction.DoNotRestart })
				},
				workspaceFolder: {
					index: 0,
					name: 'workspace',
					uri: this.Monaco.Uri.parse(RUST_WORKSPACE_URI) as any
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
