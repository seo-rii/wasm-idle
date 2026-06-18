import type { MessageReader, MessageWriter } from 'vscode-jsonrpc';
import type { CompilerOptions } from 'typescript';
import type { LanguageToolAssetConfig } from './assets.js';

export interface EditorLanguageServerTransport {
	reader: MessageReader;
	writer: MessageWriter;
}

export interface EditorLanguageServerHandle {
	transport: EditorLanguageServerTransport;
	syncFile?: (path: string) => void;
	dispose: () => void;
}

export interface EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	currentUrl?: string;
	rootUrl?: string;
	cpp?: LanguageToolAssetConfig;
	python?: {
		baseUrl?: string;
	};
	typescript?: {
		compilerOptions?: CompilerOptions;
		extraLibs?: Record<string, string>;
	};
	javascript?: {
		compilerOptions?: CompilerOptions;
		extraLibs?: Record<string, string>;
	};
	wat?: {
		features?: Record<string, boolean>;
	};
	dotnet?: {
		moduleUrl?: string;
	};
	assemblyscript?: {
		extraFiles?: Record<string, string>;
	};
}

export type EditorLanguageServerOptions = string | EditorLanguageServerRuntimeOptions;
