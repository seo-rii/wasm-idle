import type { MessageTransports } from '@hancomac/monaco-languageclient';

export interface EditorLanguageServerHandle {
	transport: string | MessageTransports;
	syncFile?: (path: string) => void;
	dispose: () => void;
}

export interface EditorLanguageServerRuntimeOptions {
	rootUrl?: string;
	cpp?: {
		baseUrl?: string;
	};
	python?: {
		baseUrl?: string;
	};
}
