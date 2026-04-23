import type { EditorLanguageServerRuntimeOptions } from './types';
import { resolveRuntimeAssetConfig, type ResolvedRuntimeAssetConfig } from '$lib/playground/assets';

const normalizeBaseUrl = (baseUrl: string, currentUrl = '') => {
	const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	return currentUrl ? new URL(normalized, currentUrl).href : normalized;
};

const normalizeRootUrl = (rootUrl: string) =>
	rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : rootUrl;

const resolveRuntimeRootBaseUrl = (rootUrl: string, suffix: string, currentUrl = '') =>
	normalizeBaseUrl(`${normalizeRootUrl(rootUrl) || ''}${suffix}`, currentUrl);

export function resolveCppLanguageServerBaseUrl(
	options: string | EditorLanguageServerRuntimeOptions | undefined,
	currentUrl = ''
) {
	return resolveCppLanguageServerRuntimeAssetConfig(options, currentUrl).baseUrl;
}

export function resolveCppLanguageServerRuntimeAssetConfig(
	options: string | EditorLanguageServerRuntimeOptions | undefined,
	currentUrl = ''
): ResolvedRuntimeAssetConfig {
	if (typeof options === 'string') {
		return resolveRuntimeAssetConfig('clangd', options, currentUrl);
	}
	return resolveRuntimeAssetConfig(
		'clangd',
		{
			rootUrl: options?.rootUrl,
			clangd: options?.cpp
		},
		currentUrl
	);
}

export function resolvePythonLanguageServerBaseUrl(
	options: string | EditorLanguageServerRuntimeOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveRuntimeRootBaseUrl(options, '/pyodide/', currentUrl);
	}
	if (options?.python?.baseUrl) {
		return normalizeBaseUrl(options.python.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveRuntimeRootBaseUrl(options.rootUrl, '/pyodide/', currentUrl);
	}
	return normalizeBaseUrl('/pyodide/', currentUrl);
}
