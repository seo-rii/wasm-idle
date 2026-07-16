import { normalizeBaseUrl, normalizeRootUrl } from '../assets.js';
import { startWorkerLanguageServer } from '../lsp.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { createWorkerLanguageServerClient, type LanguageServerStatus } from '../worker-client.js';
import { createDotnetWorkerService, type DotnetLanguage } from './service.js';

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
	let debug = false;
	try {
		debug = new URL(baseUrl).searchParams.get('lsp-test') === '1';
	} catch {
		debug = false;
	}
	const createWorker =
		hostOptions?.createWorker ||
		(() => {
			// A threaded dotnet runtime must own the browser UI thread. MessageChannel keeps
			// the existing worker JSON-RPC contract without nesting Emscripten in a Worker.
			const { port1, port2 } = new MessageChannel();
			startWorkerLanguageServer(createDotnetWorkerService(language), port2);
			port1.start();
			port2.start();
			return Object.assign(port1, {
				terminate() {
					port1.close();
					port2.close();
				}
			}) as unknown as Worker;
		});
	return await createWorkerLanguageServerClient({
		createWorker,
		initOptions: {
			language,
			moduleUrl: resolveDotnetLanguageServerModuleUrl(options, baseUrl),
			debug
		},
		onStatus: hostOptions?.onStatus
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
