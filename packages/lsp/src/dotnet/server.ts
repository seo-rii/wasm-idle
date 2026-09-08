import { normalizeRootUrl } from '../assets.js';
import { LanguageServerAssetConfigurationError } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import type { DotnetLanguage } from './service.js';

export interface DotnetLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	currentUrl?: string;
	onStatus?: (status: LanguageServerStatus) => void;
}

const currentUrl = () => globalThis.location?.href || '';

export function resolveDotnetLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | DotnetLanguageServerOptions | undefined,
	baseUrl = ''
) {
	if (typeof options === 'object' && options.dotnet?.moduleUrl) {
		return baseUrl ? new URL(options.dotnet.moduleUrl, baseUrl).href : options.dotnet.moduleUrl;
	}
	const rootUrl =
		typeof options === 'string' ? options : typeof options === 'object' ? options.rootUrl : '';
	if (!rootUrl?.trim()) {
		throw new LanguageServerAssetConfigurationError(
			'.NET LSP',
			'an explicit dotnet.moduleUrl or rootUrl'
		);
	}
	const normalizedRootUrl = normalizeRootUrl(rootUrl);
	const path = `${normalizedRootUrl}/wasm-dotnet/index.js`;
	return baseUrl ? new URL(path, baseUrl).href : path;
}

async function createLanguageServer(
	language: DotnetLanguage,
	options?: EditorLanguageServerOptions | DotnetLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as DotnetLanguageServerOptions) : undefined;
	const baseUrl = hostOptions?.currentUrl ?? currentUrl();
	let debug = false;
	try {
		debug = new URL(baseUrl).searchParams.get('lsp-test') === '1';
	} catch {
		debug = false;
	}
	const createWorker =
		hostOptions?.createWorker ||
		(() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
	return await createWorkerLanguageServerClient({
		createWorker,
		initOptions: {
			language,
			moduleUrl: resolveDotnetLanguageServerModuleUrl(options, baseUrl),
			debug
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}

export const getCSharpLanguageServer = (
	options?: EditorLanguageServerOptions | DotnetLanguageServerOptions
) => createLanguageServer('csharp', options);

export const getFSharpLanguageServer = (
	options?: EditorLanguageServerOptions | DotnetLanguageServerOptions
) => createLanguageServer('fsharp', options);

export const getVisualBasicLanguageServer = (
	options?: EditorLanguageServerOptions | DotnetLanguageServerOptions
) => createLanguageServer('vbnet', options);
