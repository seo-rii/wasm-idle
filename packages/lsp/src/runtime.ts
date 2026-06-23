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

export function resolveDLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-d/index.js`, currentUrl);
	}
	if (options?.d?.moduleUrl) {
		return resolveFileUrl(options.d.moduleUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-d/index.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-d/index.js', currentUrl);
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

export function resolveElixirLanguageServerBundleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-elixir/bundle.avm`,
			currentUrl
		);
	}
	if (options?.elixir?.bundleUrl) {
		return resolveFileUrl(options.elixir.bundleUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-elixir/bundle.avm`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-elixir/bundle.avm', currentUrl);
}

export function resolveElixirLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	return typeof options === 'object' && options.elixir?.workerUrl
		? resolveFileUrl(options.elixir.workerUrl, currentUrl)
		: '';
}

export function resolveErlangLanguageServerBundleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-elixir/bundle.avm`,
			currentUrl
		);
	}
	if (options?.erlang?.bundleUrl) {
		return resolveFileUrl(options.erlang.bundleUrl, currentUrl);
	}
	if (options?.elixir?.bundleUrl) {
		return resolveFileUrl(options.elixir.bundleUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-elixir/bundle.avm`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-elixir/bundle.avm', currentUrl);
}

export function resolveErlangLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options !== 'object') return '';
	return resolveFileUrl(options.erlang?.workerUrl || options.elixir?.workerUrl || '', currentUrl);
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

export function resolveJanetLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-janet/`, currentUrl);
	}
	if (options?.janet?.baseUrl) {
		return resolveFileUrl(options.janet.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-janet/`, currentUrl);
	}
	return resolveFileUrl('/wasm-janet/', currentUrl);
}

export function resolveJanetLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-janet/runner-worker.js`,
			currentUrl
		);
	}
	if (options?.janet?.workerUrl) {
		return resolveFileUrl(options.janet.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-janet/runner-worker.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-janet/runner-worker.js', currentUrl);
}

export function resolveLispLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-lisp/index.js`, currentUrl);
	}
	if (options?.lisp?.moduleUrl) {
		return resolveFileUrl(options.lisp.moduleUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-lisp/index.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-lisp/index.js', currentUrl);
}

export function resolveOctaveLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveRootToolBaseUrl(options, '/wasm-octave/runtime/', currentUrl);
	}
	if (options?.octave?.baseUrl) {
		return normalizeBaseUrl(options.octave.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveRootToolBaseUrl(options.rootUrl, '/wasm-octave/runtime/', currentUrl);
	}
	return normalizeBaseUrl('/wasm-octave/runtime/', currentUrl);
}

export function resolveOctaveLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-octave/runner-worker.js`,
			currentUrl
		);
	}
	if (options?.octave?.workerUrl) {
		return resolveFileUrl(options.octave.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-octave/runner-worker.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-octave/runner-worker.js', currentUrl);
}

export function resolveOctaveLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options.octave?.manifestUrl) {
		return resolveFileUrl(options.octave.manifestUrl, currentUrl);
	}
	return resolveFileUrl(
		`${resolveOctaveLanguageServerBaseUrl(options, currentUrl)}runtime-manifest.v1.json`,
		currentUrl
	);
}

export function resolveOcamlLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const path = '/wasm-of-js-of-ocaml/browser-native/src/index.js';
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}${path}`, currentUrl);
	}
	if (options?.ocaml?.moduleUrl) {
		return resolveFileUrl(options.ocaml.moduleUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}${path}`, currentUrl);
	}
	return resolveFileUrl(path, currentUrl);
}

export function resolveOcamlLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const path = '/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json';
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}${path}`, currentUrl);
	}
	if (options?.ocaml?.manifestUrl) {
		return resolveFileUrl(options.ocaml.manifestUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}${path}`, currentUrl);
	}
	return resolveFileUrl(path, currentUrl);
}

export function resolveHaskellLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-haskell/dyld.mjs`,
			currentUrl
		);
	}
	if (options?.haskell?.moduleUrl) {
		return resolveFileUrl(options.haskell.moduleUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-haskell/dyld.mjs`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-haskell/dyld.mjs', currentUrl);
}

export function resolveHaskellLanguageServerRootfsUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-haskell/rootfs.tar.zst`,
			currentUrl
		);
	}
	if (options?.haskell?.rootfsUrl) {
		return resolveFileUrl(options.haskell.rootfsUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-haskell/rootfs.tar.zst`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-haskell/rootfs.tar.zst', currentUrl);
}

export function resolveHaskellLanguageServerBsdtarUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-haskell/bsdtar.wasm`,
			currentUrl
		);
	}
	if (options?.haskell?.bsdtarUrl) {
		return resolveFileUrl(options.haskell.bsdtarUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-haskell/bsdtar.wasm`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-haskell/bsdtar.wasm', currentUrl);
}

export function resolveFortranLanguageServerAnalyzerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-fortran/analyzer.js`, currentUrl);
	}
	if (options?.fortran?.analyzerUrl) {
		return resolveFileUrl(options.fortran.analyzerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-fortran/analyzer.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-fortran/analyzer.js', currentUrl);
}

export function resolvePrologLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-prolog/`, currentUrl);
	}
	if (options?.prolog?.baseUrl) {
		return resolveFileUrl(options.prolog.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-prolog/`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-prolog/', currentUrl);
}

export function resolvePrologLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-prolog/runner-worker.js`,
			currentUrl
		);
	}
	if (options?.prolog?.workerUrl) {
		return resolveFileUrl(options.prolog.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-prolog/runner-worker.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-prolog/runner-worker.js', currentUrl);
}

export function resolveRubyLanguageServerWasmUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options.ruby?.wasmUrl) {
		return resolveFileUrl(options.ruby.wasmUrl, currentUrl);
	}
	return '';
}

export function resolveRLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/webr/`, currentUrl);
	}
	if (options?.r?.baseUrl) {
		return resolveFileUrl(options.r.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}/webr/`, currentUrl);
	}
	return resolveFileUrl('/webr/', currentUrl);
}

export function resolveAwkLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-awk/`, currentUrl);
	}
	if (options?.awk?.baseUrl) {
		return resolveFileUrl(options.awk.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-awk/`, currentUrl);
	}
	return resolveFileUrl('/wasm-awk/', currentUrl);
}

export function resolveAwkLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-awk/runner-worker.js`,
			currentUrl
		);
	}
	if (options?.awk?.workerUrl) {
		return resolveFileUrl(options.awk.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-awk/runner-worker.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-awk/runner-worker.js', currentUrl);
}

export function resolvePerlLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-perl/`, currentUrl);
	}
	if (options?.perl?.baseUrl) {
		return resolveFileUrl(options.perl.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-perl/`, currentUrl);
	}
	return resolveFileUrl('/wasm-perl/', currentUrl);
}

export function resolvePerlLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-perl/runner-worker.js`,
			currentUrl
		);
	}
	if (options?.perl?.workerUrl) {
		return resolveFileUrl(options.perl.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-perl/runner-worker.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-perl/runner-worker.js', currentUrl);
}

export function resolveTclLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-tcl/`, currentUrl);
	}
	if (options?.tcl?.baseUrl) {
		return normalizeBaseUrl(options.tcl.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-tcl/`, currentUrl);
	}
	return normalizeBaseUrl('/wasm-tcl/', currentUrl);
}

export function resolveTclLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-tcl/runner-worker.js`,
			currentUrl
		);
	}
	if (options?.tcl?.workerUrl) {
		return resolveFileUrl(options.tcl.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-tcl/runner-worker.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-tcl/runner-worker.js', currentUrl);
}

export function resolvePascalLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-pascal/`, currentUrl);
	}
	if (options?.pascal?.baseUrl) {
		return normalizeBaseUrl(options.pascal.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-pascal/`,
			currentUrl
		);
	}
	return normalizeBaseUrl('/wasm-pascal/', currentUrl);
}

export function resolvePascalLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-pascal/runner-worker.js`,
			currentUrl
		);
	}
	if (options?.pascal?.workerUrl) {
		return resolveFileUrl(options.pascal.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-pascal/runner-worker.js`,
			currentUrl
		);
	}
	return resolveFileUrl('/wasm-pascal/runner-worker.js', currentUrl);
}

export type { EditorLanguageServerRuntimeOptions };
