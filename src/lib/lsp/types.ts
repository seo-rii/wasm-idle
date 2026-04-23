import type { MessageTransports } from '@hancomac/monaco-languageclient';
import type { RuntimeAssetLoader } from '$lib/playground/assets';

export interface EditorLanguageServerHandle {
	transport: string | MessageTransports;
	syncFile?: (path: string) => void;
	dispose: () => void;
}

export interface EditorLanguageServerRuntimeOptions {
	rootUrl?: string;
	cpp?: {
		baseUrl?: string;
		loader?: RuntimeAssetLoader;
	};
	python?: {
		baseUrl?: string;
	};
}
