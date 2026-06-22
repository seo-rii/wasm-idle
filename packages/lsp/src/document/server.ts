import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { DocumentLanguageId } from './service.js';

export interface DocumentLanguageServerConfig {
	language?: DocumentLanguageId;
}

export interface DocumentLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	document?: DocumentLanguageServerConfig;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const resolveConfig = (
	options: EditorLanguageServerOptions | undefined,
	language: DocumentLanguageId
) => ({
	language:
		typeof options === 'object'
			? options.document?.language || language
			: language
});

export async function getDocumentLanguageServer(
	language: DocumentLanguageId,
	options?: EditorLanguageServerOptions | DocumentLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as DocumentLanguageServerOptions) : undefined;
	const config = resolveConfig(options, language);
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: config,
		onStatus: hostOptions?.onStatus
	});
}

type DocumentLanguageServerInputOptions =
	| EditorLanguageServerOptions
	| DocumentLanguageServerOptions;

export const getJsonLanguageServer = (options?: DocumentLanguageServerInputOptions) =>
	getDocumentLanguageServer('json', options);

export const getYamlLanguageServer = (options?: DocumentLanguageServerInputOptions) =>
	getDocumentLanguageServer('yaml', options);

export const getTomlLanguageServer = (options?: DocumentLanguageServerInputOptions) =>
	getDocumentLanguageServer('toml', options);

export const getHtmlLanguageServer = (options?: DocumentLanguageServerInputOptions) =>
	getDocumentLanguageServer('html', options);

export const getCssLanguageServer = (options?: DocumentLanguageServerInputOptions) =>
	getDocumentLanguageServer('css', options);

export const getMarkdownLanguageServer = (options?: DocumentLanguageServerInputOptions) =>
	getDocumentLanguageServer('markdown', options);
