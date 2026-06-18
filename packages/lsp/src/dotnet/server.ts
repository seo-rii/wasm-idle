import { normalizeBaseUrl, normalizeRootUrl } from '../assets.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';
import type { DotnetLanguage } from './service.js';

export interface DotnetLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	currentUrl?: string;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const currentUrl = () => globalThis.location?.href || '';

export function resolveDotnetLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | DotnetLanguageServerOptions | undefined,
	baseUrl = ''
) {
	if (typeof options === 'object' && options.dotnet?.moduleUrl) {
		return baseUrl
			? new URL(options.dotnet.moduleUrl, baseUrl).href
			: options.dotnet.moduleUrl;
	}
	const rootUrl =
		typeof options === 'string' ? options : typeof options === 'object' ? options.rootUrl : '';
	const path = `${normalizeRootUrl(rootUrl || '')}/wasm-dotnet/index.js`;
	return baseUrl ? new URL(path, baseUrl).href : normalizeBaseUrl(path).replace(/\/$/u, '');
}

async function createLanguageServer(
	language: DotnetLanguage,
	options?: EditorLanguageServerOptions | DotnetLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as DotnetLanguageServerOptions) : undefined;
	const baseUrl = hostOptions?.currentUrl ?? currentUrl();
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			language,
			moduleUrl: resolveDotnetLanguageServerModuleUrl(options, baseUrl)
		},
		onStatus: hostOptions?.onStatus
	});
}

export const getCSharpLanguageServer = (
	options?: EditorLanguageServerOptions | DotnetLanguageServerOptions
) => createLanguageServer('csharp', options);

export const getVisualBasicLanguageServer = (
	options?: EditorLanguageServerOptions | DotnetLanguageServerOptions
) => createLanguageServer('vbnet', options);
