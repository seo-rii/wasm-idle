import type { PyodideConfig, PyodideInterface } from 'pyodide';

export const PYODIDE_LOAD_ASSETS = [
	'pyodide.asm.js',
	'pyodide-lock.json',
	'pyodide.asm.wasm',
	'python_stdlib.zip'
] as const;

export const PYODIDE_PACKAGE_ASSETS = [
	'ffi.d.ts',
	'package.json',
	'pyodide-lock.json',
	'pyodide.asm.js',
	'pyodide.asm.wasm',
	'pyodide.d.ts',
	'pyodide.js',
	'pyodide.mjs',
	'python_stdlib.zip'
] as const;

export type PyodideLoadAsset = (typeof PYODIDE_LOAD_ASSETS)[number];
export type PyodidePackageAsset = (typeof PYODIDE_PACKAGE_ASSETS)[number];

export interface PyodideAssetResolverOptions {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
}

export type PyodideLoader = (options?: PyodideConfig) => Promise<PyodideInterface>;

export interface WasmIdlePyodideLoadOptions extends Omit<PyodideConfig, 'indexURL'> {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
	indexURL?: string;
	loadPyodide?: PyodideLoader;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

export function normalizePyodideBaseUrl(
	baseUrl: string | URL = '/pyodide/',
	currentUrl?: string | URL
) {
	const normalized = ensureTrailingSlash(stringifyUrl(baseUrl));
	if (currentUrl) return new URL(normalized, stringifyUrl(currentUrl)).href;
	return normalized;
}

export function resolvePyodideAssetUrl(
	asset: PyodidePackageAsset | string,
	options: PyodideAssetResolverOptions = {}
) {
	if (ABSOLUTE_URL_PATTERN.test(asset)) return asset;
	const baseUrl = normalizePyodideBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(asset, baseUrl).href;
	return `${baseUrl}${asset.replace(/^\/+/, '')}`;
}

export function createPyodideAssetManifest(options: PyodideAssetResolverOptions = {}) {
	return Object.fromEntries(
		PYODIDE_PACKAGE_ASSETS.map((asset) => [asset, resolvePyodideAssetUrl(asset, options)])
	) as Record<PyodidePackageAsset, string>;
}

export async function loadWasmIdlePyodide(
	options: WasmIdlePyodideLoadOptions = {}
): Promise<PyodideInterface> {
	const { baseUrl, currentUrl, indexURL, loadPyodide, ...config } = options;
	const loader = loadPyodide ?? (await import('pyodide')).loadPyodide;
	const resolvedIndexURL = indexURL ?? normalizePyodideBaseUrl(baseUrl, currentUrl);
	return loader({ ...config, indexURL: resolvedIndexURL });
}
