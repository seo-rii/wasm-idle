import type {
	EditorLanguageServerRuntimeOptions,
	EditorLanguageServerHandle
} from '$lib/lsp/types';
import { getCppLanguageServer } from '$lib/lsp/cpp/server';
import { getPythonLanguageServer } from '$lib/lsp/python/server';

export async function getEditorLanguageServer(
	language: string,
	options?: string | EditorLanguageServerRuntimeOptions
): Promise<EditorLanguageServerHandle | null> {
	const normalized = language.toLowerCase();

	if (normalized === 'c' || normalized === 'cpp') {
		return getCppLanguageServer(options);
	}

	if (normalized === 'python') {
		return getPythonLanguageServer(options);
	}

	return null;
}
