import {
	CLANGD_VIRTUAL_BASE_URL,
	normalizeBaseUrl,
	normalizeRootUrl,
	resolveRootToolBaseUrl,
	type ResolvedLanguageToolAssetConfig
} from './assets.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from './types.js';

export function resolveCppLanguageServerRuntimeAssetConfig(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
): ResolvedLanguageToolAssetConfig {
	if (typeof options === 'string') {
		return {
			baseUrl: resolveRootToolBaseUrl(options, '/clangd/', currentUrl)
		};
	}

	const runtimeConfig = options?.cpp;
	if (runtimeConfig?.baseUrl) {
		return {
			baseUrl: normalizeBaseUrl(runtimeConfig.baseUrl, currentUrl),
			loader: runtimeConfig.loader
		};
	}

	if (options?.rootUrl) {
		return {
			baseUrl: resolveRootToolBaseUrl(options.rootUrl, '/clangd/', currentUrl),
			loader: runtimeConfig?.loader
		};
	}

	if (runtimeConfig?.loader) {
		return {
			baseUrl: CLANGD_VIRTUAL_BASE_URL,
			loader: runtimeConfig.loader
		};
	}

	return {
		baseUrl: normalizeBaseUrl('/clangd/', currentUrl)
	};
}

export function resolveCppLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	return resolveCppLanguageServerRuntimeAssetConfig(options, currentUrl).baseUrl;
}

export function resolvePythonLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveRootToolBaseUrl(options, '/pyodide/', currentUrl);
	}
	if (options?.python?.baseUrl) {
		return normalizeBaseUrl(options.python.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveRootToolBaseUrl(options.rootUrl, '/pyodide/', currentUrl);
	}
	return normalizeBaseUrl('/pyodide/', currentUrl);
}

const resolveFileUrl = (value: string, currentUrl = '') =>
	currentUrl ? new URL(value, currentUrl).href : value;

export function resolveRustLanguageServerCompilerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-rust/index.js`, currentUrl);
	}
	if (options?.rust?.compilerUrl) {
		return resolveFileUrl(options.rust.compilerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-rust/index.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-rust/index.js', currentUrl);
}

export function resolveGoLanguageServerCompilerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-go/index.js`, currentUrl);
	}
	if (options?.go?.compilerUrl) {
		return resolveFileUrl(options.go.compilerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-go/index.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-go/index.js', currentUrl);
}

export function resolveGleamLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveRootToolBaseUrl(options, '/wasm-gleam/', currentUrl);
	}
	if (options?.gleam?.baseUrl) {
		return normalizeBaseUrl(options.gleam.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveRootToolBaseUrl(options.rootUrl, '/wasm-gleam/', currentUrl);
	}
	return normalizeBaseUrl('/wasm-gleam/', currentUrl);
}

export function resolveGleamLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options.gleam?.manifestUrl) {
		return resolveFileUrl(options.gleam.manifestUrl, currentUrl);
	}
	return resolveFileUrl(
		`${resolveGleamLanguageServerBaseUrl(options, currentUrl)}source-manifest.v1.json`,
		currentUrl
	);
}

export function resolveZigLanguageServerCompilerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-zig/zig_small.wasm`,
			currentUrl
		);
	}
	if (options?.zig?.compilerUrl) {
		return resolveFileUrl(options.zig.compilerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-zig/zig_small.wasm`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-zig/zig_small.wasm', currentUrl);
}

export function resolveZigLanguageServerStdlibUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-zig/std.zip`, currentUrl);
	}
	if (options?.zig?.stdlibUrl) {
		return resolveFileUrl(options.zig.stdlibUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-zig/std.zip`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-zig/std.zip', currentUrl);
}

export function resolveLuaLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-lua/index.js`, currentUrl);
	}
	if (options?.lua?.moduleUrl) {
		return resolveFileUrl(options.lua.moduleUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-lua/index.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-lua/index.js', currentUrl);
}

export function resolvePhpLanguageServerVersion(options: EditorLanguageServerOptions | undefined) {
	return typeof options === 'object' && options.php?.version ? options.php.version : '8.4';
}

export type { EditorLanguageServerRuntimeOptions };
