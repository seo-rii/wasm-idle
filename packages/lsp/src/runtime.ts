import {
	CLANGD_VIRTUAL_BASE_URL,
	normalizeBaseUrl,
	normalizeRootUrl,
	resolveRootToolBaseUrl,
	type ResolvedLanguageToolAssetConfig
} from './assets.js';
import { BUNDLED_CLANGD_ASSET_INTEGRITY } from './bundledClangdAssetIntegrity.js';
import { BUNDLED_ELIXIR_ASSET_VERSION } from './bundledElixirRuntimeIntegrity.js';
import { BUNDLED_GLEAM_MANIFEST_FINGERPRINT } from './bundledGleamRuntime.js';
import { BUNDLED_LISP_MANIFEST_FINGERPRINT } from './bundledLispRuntime.js';
import {
	BUNDLED_JANET_MANIFEST_FINGERPRINT,
	BUNDLED_JANET_RUNTIME_BUNDLE
} from './bundledJanetRuntime.js';
import {
	BUNDLED_PROLOG_MANIFEST_FINGERPRINT,
	BUNDLED_PROLOG_RUNTIME_PROFILE,
	BUNDLED_PROLOG_RUNNER_RECEIPT
} from './bundledPrologRuntime.js';
import {
	BUNDLED_PERL_MANIFEST_FINGERPRINT,
	BUNDLED_PERL_RUNTIME_BUNDLE
} from './bundledPerlRuntime.js';
import {
	BUNDLED_PASCAL_MANIFEST_FINGERPRINT,
	BUNDLED_PASCAL_RUNTIME_BUNDLE
} from './bundledPascalRuntime.js';
import {
	BUNDLED_TCL_MANIFEST_FINGERPRINT,
	BUNDLED_TCL_RUNTIME_BUNDLE
} from './bundledTclRuntime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from './types.js';
import {
	RUBY_RUNTIME_MANIFEST_PATH,
	RUBY_RUNTIME_MODULE_STORAGE_PATH,
	RUBY_RUNTIME_PROFILE,
	RUBY_RUNTIME_WASM_STORAGE_PATH,
	snapshotJanetRuntimePreflightProfile,
	snapshotPascalRuntimePreflightProfile,
	snapshotPerlRuntimePreflightProfile,
	snapshotPrologRuntimePreflightProfile,
	snapshotRubyRuntimePreflightProfile,
	snapshotTclRuntimePreflightProfile,
	type JanetRuntimePreflightProfile,
	type PascalRuntimePreflightProfile,
	type PerlRuntimePreflightProfile,
	type PrologRuntimePreflightProfile,
	type RubyRuntimePreflightProfile,
	type TclRuntimePreflightProfile
} from '@wasm-idle/core';

export class LanguageServerAssetConfigurationError extends Error {
	readonly provider: string;

	constructor(provider: string, requirement: string) {
		super(`${provider} requires ${requirement}`);
		this.name = 'LanguageServerAssetConfigurationError';
		this.provider = provider;
	}
}

const resolveAllowedBaseUrls = (urls: string[] | undefined, currentUrl: string) =>
	urls?.map((url) => normalizeBaseUrl(url, currentUrl));

const resolveCppAssetIntegrity = (config: EditorLanguageServerRuntimeOptions['cpp']) => {
	if (config?.integrity) return config.integrity;
	if (!config?.baseUrl && !config?.loader) return BUNDLED_CLANGD_ASSET_INTEGRITY;
	return undefined;
};

export function resolveCppLanguageServerRuntimeAssetConfig(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
): ResolvedLanguageToolAssetConfig {
	if (typeof options === 'string') {
		return {
			baseUrl: resolveRootToolBaseUrl(options, '/clangd/', currentUrl),
			integrity: BUNDLED_CLANGD_ASSET_INTEGRITY
		};
	}

	const runtimeConfig = options?.cpp;
	const integrity = resolveCppAssetIntegrity(runtimeConfig);
	const allowedBaseUrls = resolveAllowedBaseUrls(runtimeConfig?.allowedBaseUrls, currentUrl);
	if (runtimeConfig?.baseUrl) {
		return {
			baseUrl: normalizeBaseUrl(runtimeConfig.baseUrl, currentUrl),
			loader: runtimeConfig.loader,
			allowedBaseUrls,
			integrity
		};
	}

	if (options?.rootUrl) {
		return {
			baseUrl: resolveRootToolBaseUrl(options.rootUrl, '/clangd/', currentUrl),
			loader: runtimeConfig?.loader,
			allowedBaseUrls,
			integrity
		};
	}

	if (runtimeConfig?.loader) {
		return {
			baseUrl: CLANGD_VIRTUAL_BASE_URL,
			loader: runtimeConfig.loader,
			allowedBaseUrls,
			integrity
		};
	}

	throw new LanguageServerAssetConfigurationError(
		'clangd',
		'an explicit cpp.baseUrl, cpp.loader, or rootUrl'
	);
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
	throw new LanguageServerAssetConfigurationError(
		'Python LSP',
		'an explicit python.baseUrl or rootUrl'
	);
}

const resolveFileUrl = (value: string, currentUrl = '') => {
	const configured = value.trim();
	if (!configured) return '';
	if (currentUrl) return new URL(configured, currentUrl).href;
	if (configured.startsWith('/')) return configured;
	try {
		return new URL(configured).href;
	} catch {
		throw new LanguageServerAssetConfigurationError(
			'External LSP asset URL',
			'an absolute or root-relative URL, or currentUrl for a document-relative URL'
		);
	}
};

const resolveApplicationAssetUrl = (path: string, _currentUrl = '') => {
	throw new LanguageServerAssetConfigurationError(
		`External LSP asset ${path}`,
		'an explicit provider URL or rootUrl'
	);
};

const resolveStaticRuntimeModuleUrl = (
	options: EditorLanguageServerOptions | undefined,
	moduleUrl: string | undefined,
	path: string,
	currentUrl = ''
) => {
	if (moduleUrl) return resolveFileUrl(moduleUrl, currentUrl);
	const rootUrl = typeof options === 'string' ? options : options?.rootUrl || '';
	return rootUrl
		? resolveFileUrl(`${normalizeRootUrl(rootUrl)}${path}`, currentUrl)
		: resolveApplicationAssetUrl(path, currentUrl);
};

export function resolveAssemblyScriptLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	return resolveStaticRuntimeModuleUrl(
		options,
		typeof options === 'object' ? options.assemblyscript?.moduleUrl : undefined,
		'/wasm-assemblyscript/runtime.mjs',
		currentUrl
	);
}

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
	return resolveApplicationAssetUrl('/wasm-rust/index.js', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-go/index.js', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-d/index.js', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-gleam/', currentUrl);
}

export function resolveGleamLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options.gleam?.manifestUrl) {
		return resolveFileUrl(options.gleam.manifestUrl, currentUrl);
	}
	return resolveFileUrl(
		`${resolveGleamLanguageServerBaseUrl(options, currentUrl)}source-manifest.v2.json`,
		currentUrl
	);
}

export function resolveGleamLanguageServerManifestFingerprint(
	options: EditorLanguageServerOptions | undefined
) {
	const fingerprint =
		typeof options === 'object' ? options.gleam?.manifestFingerprint?.trim() || '' : '';
	if (/^[a-f0-9]{64}$/u.test(fingerprint)) return fingerprint;
	const usesBundledRoot =
		typeof options === 'string' ||
		(typeof options === 'object' &&
			!!options.rootUrl &&
			!options.gleam?.baseUrl &&
			!options.gleam?.manifestUrl);
	if (usesBundledRoot && !fingerprint) return BUNDLED_GLEAM_MANIFEST_FINGERPRINT;
	throw new LanguageServerAssetConfigurationError(
		'Gleam LSP',
		'an explicit 64-character gleam.manifestFingerprint'
	);
}

export function resolveElixirLanguageServerBundleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-elixir/bundle.avm?v=${BUNDLED_ELIXIR_ASSET_VERSION}`,
			currentUrl
		);
	}
	if (options?.elixir?.bundleUrl) {
		return resolveFileUrl(options.elixir.bundleUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-elixir/bundle.avm?v=${BUNDLED_ELIXIR_ASSET_VERSION}`,
			currentUrl
		);
	}
	return resolveApplicationAssetUrl('/wasm-elixir/bundle.avm', currentUrl);
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
			`${normalizeRootUrl(options) || ''}/wasm-elixir/bundle.avm?v=${BUNDLED_ELIXIR_ASSET_VERSION}`,
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
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-elixir/bundle.avm?v=${BUNDLED_ELIXIR_ASSET_VERSION}`,
			currentUrl
		);
	}
	return resolveApplicationAssetUrl('/wasm-elixir/bundle.avm', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-zig/zig_small.wasm', currentUrl);
}

export function resolveZigLanguageServerStdlibUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-zig/std.tar.gz`, currentUrl);
	}
	if (options?.zig?.stdlibUrl) {
		return resolveFileUrl(options.zig.stdlibUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-zig/std.tar.gz`,
			currentUrl
		);
	}
	return resolveApplicationAssetUrl('/wasm-zig/std.tar.gz', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-lua/index.js', currentUrl);
}

export function resolveJanetLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-janet/`, currentUrl);
	}
	if (options?.janet?.baseUrl) {
		return normalizeBaseUrl(options.janet.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-janet/`, currentUrl);
	}
	return resolveApplicationAssetUrl('/wasm-janet/', currentUrl);
}

export function resolveJanetLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const bundledWorkerVersion = resolveJanetLanguageServerWorkerReceipt(options).sha256;
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-janet/runner-worker.js?v=${bundledWorkerVersion}`,
			currentUrl
		);
	}
	if (options?.janet?.workerUrl) {
		return resolveFileUrl(options.janet.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-janet/runner-worker.js?v=${bundledWorkerVersion}`,
			currentUrl
		);
	}
	return resolveApplicationAssetUrl(
		`/wasm-janet/runner-worker.js?v=${bundledWorkerVersion}`,
		currentUrl
	);
}

export function resolveJanetLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options.janet?.manifestUrl) {
		return resolveFileUrl(options.janet.manifestUrl, currentUrl);
	}
	return resolveFileUrl(
		`${resolveJanetLanguageServerBaseUrl(options, currentUrl)}runtime-manifest.v2.json?v=${resolveJanetLanguageServerManifestFingerprint(options)}`,
		currentUrl
	);
}

const usesCustomJanetRuntimeUrls = (options: EditorLanguageServerOptions | undefined) =>
	typeof options === 'object' &&
	Boolean(options.janet?.baseUrl || options.janet?.workerUrl || options.janet?.manifestUrl);

export function resolveJanetLanguageServerManifestFingerprint(
	options: EditorLanguageServerOptions | undefined
) {
	const configured =
		typeof options === 'object' ? options.janet?.manifestFingerprint?.trim() || '' : '';
	if (/^[a-f0-9]{64}$/u.test(configured)) return configured;
	if (!configured && !usesCustomJanetRuntimeUrls(options)) {
		return BUNDLED_JANET_MANIFEST_FINGERPRINT;
	}
	throw new LanguageServerAssetConfigurationError(
		'Janet LSP',
		'an explicit 64-character janet.manifestFingerprint for custom runtime URLs'
	);
}

export function resolveJanetLanguageServerWorkerReceipt(
	options: EditorLanguageServerOptions | undefined
) {
	const configured = typeof options === 'object' ? options.janet?.workerReceipt : undefined;
	if (configured) return configured;
	if (!usesCustomJanetRuntimeUrls(options) && !hasConfiguredJanetTrust(options)) {
		return BUNDLED_JANET_RUNTIME_BUNDLE.workerReceipt;
	}
	throw new LanguageServerAssetConfigurationError(
		'Janet LSP',
		'a complete runtime profile and runner receipt bundle'
	);
}

function hasConfiguredJanetTrust(options: EditorLanguageServerOptions | undefined): boolean {
	const configured = typeof options === 'object' ? options.janet : undefined;
	return (
		!!configured &&
		[
			configured.manifestFingerprint,
			configured.profileId,
			configured.artifactRevision,
			configured.janetVersion,
			configured.emscriptenVersion,
			configured.manifestReceipt,
			configured.javascriptReceipt,
			configured.wasmReceipt,
			configured.workerReceipt
		].some((value) => value !== undefined)
	);
}

export function resolveJanetLanguageServerPreflightProfile(
	options: EditorLanguageServerOptions | undefined
): JanetRuntimePreflightProfile {
	const configured = typeof options === 'object' ? options.janet : undefined;
	const manifestFingerprint = resolveJanetLanguageServerManifestFingerprint(options);
	const hasConfiguredProfile = hasConfiguredJanetTrust(options);

	if (!hasConfiguredProfile) {
		if (usesCustomJanetRuntimeUrls(options)) {
			throw new LanguageServerAssetConfigurationError(
				'Janet LSP',
				'a complete runtime profile and receipts for custom runtime URLs'
			);
		}
		return snapshotJanetRuntimePreflightProfile(BUNDLED_JANET_RUNTIME_BUNDLE.profile);
	}

	try {
		return snapshotJanetRuntimePreflightProfile({
			profileId: configured?.profileId?.trim(),
			artifactRevision: configured?.artifactRevision?.trim(),
			janetVersion: configured?.janetVersion?.trim(),
			emscriptenVersion: configured?.emscriptenVersion?.trim(),
			manifestFingerprint,
			manifestReceipt: configured?.manifestReceipt,
			javascriptReceipt: configured?.javascriptReceipt,
			wasmReceipt: configured?.wasmReceipt
		});
	} catch {
		throw new LanguageServerAssetConfigurationError(
			'Janet LSP',
			'a complete valid runtime preflight profile and receipts'
		);
	}
}

export function resolveJanetLanguageServerAssetConfig(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const profile = resolveJanetLanguageServerPreflightProfile(options);
	const workerReceipt = resolveJanetLanguageServerWorkerReceipt(options);
	return Object.freeze({
		baseUrl: resolveJanetLanguageServerBaseUrl(options, currentUrl),
		workerUrl: resolveJanetLanguageServerWorkerUrl(options, currentUrl),
		manifestUrl: resolveJanetLanguageServerManifestUrl(options, currentUrl),
		manifestFingerprint: profile.manifestFingerprint,
		profile,
		workerReceipt
	});
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
	return resolveApplicationAssetUrl('/wasm-lisp/index.js', currentUrl);
}

export function resolveLispLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options.lisp?.manifestUrl) {
		return resolveFileUrl(options.lisp.manifestUrl, currentUrl);
	}
	const moduleUrl = resolveLispLanguageServerModuleUrl(options, currentUrl);
	try {
		const module = new URL(moduleUrl, currentUrl || undefined);
		const manifest = new URL('runtime-manifest.v2.json', module);
		manifest.search = module.search;
		return manifest.href;
	} catch {
		return moduleUrl.replace(/index\.js(?:\?.*)?$/u, 'runtime-manifest.v2.json');
	}
}

const usesCustomLispRuntimeUrls = (options: EditorLanguageServerOptions | undefined) =>
	typeof options === 'object' && Boolean(options.lisp?.moduleUrl || options.lisp?.manifestUrl);

export function resolveLispLanguageServerManifestFingerprint(
	options: EditorLanguageServerOptions | undefined
) {
	const configured =
		typeof options === 'object' ? options.lisp?.manifestFingerprint?.trim() || '' : '';
	if (/^[a-f0-9]{64}$/u.test(configured)) return configured;
	if (!configured && !usesCustomLispRuntimeUrls(options)) {
		return BUNDLED_LISP_MANIFEST_FINGERPRINT;
	}
	throw new LanguageServerAssetConfigurationError(
		'Scheme LSP',
		'an explicit 64-character lisp.manifestFingerprint for custom runtime URLs'
	);
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
	return resolveApplicationAssetUrl('/wasm-octave/runtime/', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-octave/runner-worker.js', currentUrl);
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
	return resolveApplicationAssetUrl(path, currentUrl);
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
	return resolveApplicationAssetUrl(path, currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-haskell/dyld.mjs', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-haskell/rootfs.tar.zst', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-haskell/bsdtar.wasm', currentUrl);
}

export function resolveSqliteLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	return resolveStaticRuntimeModuleUrl(
		options,
		typeof options === 'object' ? options.sql?.moduleUrl : undefined,
		'/wasm-sqlite/runtime.mjs',
		currentUrl
	);
}

export function resolveDuckDbLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	return resolveStaticRuntimeModuleUrl(
		options,
		typeof options === 'object' ? options.sql?.moduleUrl : undefined,
		'/wasm-duckdb/runtime.mjs',
		currentUrl
	);
}

export function resolveFortranLanguageServerAnalyzerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-fortran/analyzer.js`,
			currentUrl
		);
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
	return resolveApplicationAssetUrl('/wasm-fortran/analyzer.js', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-prolog/', currentUrl);
}

export function resolvePrologLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-prolog/runner-worker.js?v=${BUNDLED_PROLOG_RUNNER_RECEIPT.sha256}`,
			currentUrl
		);
	}
	if (options?.prolog?.workerUrl) {
		return resolveFileUrl(options.prolog.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-prolog/runner-worker.js?v=${BUNDLED_PROLOG_RUNNER_RECEIPT.sha256}`,
			currentUrl
		);
	}
	return resolveApplicationAssetUrl(
		`/wasm-prolog/runner-worker.js?v=${BUNDLED_PROLOG_RUNNER_RECEIPT.sha256}`,
		currentUrl
	);
}

export function resolvePrologLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options.prolog?.manifestUrl) {
		return resolveFileUrl(options.prolog.manifestUrl, currentUrl);
	}
	const manifestFingerprint = resolvePrologLanguageServerManifestFingerprint(options);
	return resolveFileUrl(
		`${resolvePrologLanguageServerBaseUrl(options, currentUrl)}runtime-manifest.v2.json?v=${manifestFingerprint}`,
		currentUrl
	);
}

export function resolvePrologLanguageServerManifestFingerprint(
	options: EditorLanguageServerOptions | undefined
) {
	const configured =
		typeof options === 'object' ? options.prolog?.manifestFingerprint?.trim() || '' : '';
	if (!configured) return BUNDLED_PROLOG_MANIFEST_FINGERPRINT;
	if (/^[a-f0-9]{64}$/u.test(configured)) return configured;
	throw new LanguageServerAssetConfigurationError(
		'Prolog LSP',
		'a 64-character prolog.manifestFingerprint'
	);
}

export function resolvePrologLanguageServerWorkerReceipt(
	options: EditorLanguageServerOptions | undefined
) {
	const configured = typeof options === 'object' ? options.prolog?.workerReceipt : undefined;
	return configured || BUNDLED_PROLOG_RUNNER_RECEIPT;
}

export function resolvePrologLanguageServerPreflightProfile(
	options: EditorLanguageServerOptions | undefined
): PrologRuntimePreflightProfile {
	const configured = typeof options === 'object' ? options.prolog : undefined;
	const manifestFingerprint = resolvePrologLanguageServerManifestFingerprint(options);
	const hasConfiguredProfile =
		!!configured &&
		[
			configured.profileId,
			configured.packageRevision,
			configured.swiplRevision,
			configured.manifestReceipt,
			configured.javascriptReceipt,
			configured.wasmReceipt,
			configured.dataReceipt
		].some((value) => value !== undefined);

	if (!hasConfiguredProfile) {
		if (manifestFingerprint !== BUNDLED_PROLOG_MANIFEST_FINGERPRINT) {
			throw new LanguageServerAssetConfigurationError(
				'Prolog LSP',
				'a complete runtime profile and receipts for a custom manifest fingerprint'
			);
		}
		return snapshotPrologRuntimePreflightProfile(BUNDLED_PROLOG_RUNTIME_PROFILE);
	}

	try {
		return snapshotPrologRuntimePreflightProfile({
			profileId: configured?.profileId?.trim(),
			packageRevision: configured?.packageRevision?.trim(),
			swiplRevision: configured?.swiplRevision?.trim(),
			manifestFingerprint,
			manifestReceipt: configured?.manifestReceipt,
			javascriptReceipt: configured?.javascriptReceipt,
			wasmReceipt: configured?.wasmReceipt,
			dataReceipt: configured?.dataReceipt
		});
	} catch {
		throw new LanguageServerAssetConfigurationError(
			'Prolog LSP',
			'a complete valid runtime preflight profile and receipts'
		);
	}
}

type RubyLanguageServerRuntimeConfig = NonNullable<EditorLanguageServerRuntimeOptions['ruby']>;

const RUBY_LANGUAGE_SERVER_CONFIG_KEYS = [
	'baseUrl',
	'manifestUrl',
	'moduleUrl',
	'wasmUrl',
	'profileId',
	'artifactRevision',
	'rubyVersion',
	'rubyRevision',
	'rubyWasmVersion',
	'rubyWasmRevision',
	'wasiSdkVersion',
	'manifestFingerprint',
	'manifestReceipt',
	'moduleJavaScriptReceipt',
	'wasmReceipt'
] as const satisfies readonly (keyof RubyLanguageServerRuntimeConfig)[];

function snapshotRubyLanguageServerOptions(
	options: EditorLanguageServerOptions | undefined
): EditorLanguageServerOptions | undefined {
	if (!options || typeof options !== 'object') return options;
	const source = options.ruby;
	const rootUrl = options.rootUrl;
	if (!source) return Object.freeze({ rootUrl });
	const ruby: Record<string, unknown> = {};
	for (const key of RUBY_LANGUAGE_SERVER_CONFIG_KEYS) ruby[key] = source[key];
	return Object.freeze({
		rootUrl,
		ruby: Object.freeze(ruby) as Readonly<RubyLanguageServerRuntimeConfig>
	});
}

const usesCustomRubyRuntimeUrls = (
	configured: Readonly<RubyLanguageServerRuntimeConfig> | undefined
) =>
	Boolean(
		configured?.baseUrl ||
		configured?.manifestUrl ||
		configured?.moduleUrl ||
		configured?.wasmUrl
	);

function hasConfiguredRubyTrust(
	configured: Readonly<RubyLanguageServerRuntimeConfig> | undefined
): boolean {
	return (
		!!configured &&
		[
			configured.profileId,
			configured.artifactRevision,
			configured.rubyVersion,
			configured.rubyRevision,
			configured.rubyWasmVersion,
			configured.rubyWasmRevision,
			configured.wasiSdkVersion,
			configured.manifestFingerprint,
			configured.manifestReceipt,
			configured.moduleJavaScriptReceipt,
			configured.wasmReceipt
		].some((value) => value !== undefined)
	);
}

function resolveRubyLanguageServerPreflightProfileFromSnapshot(
	options: EditorLanguageServerOptions | undefined
): RubyRuntimePreflightProfile {
	const configured = typeof options === 'object' ? options.ruby : undefined;
	const hasConfiguredProfile = hasConfiguredRubyTrust(configured);

	if (!hasConfiguredProfile) {
		if (usesCustomRubyRuntimeUrls(configured)) {
			throw new LanguageServerAssetConfigurationError(
				'Ruby LSP',
				'a complete runtime profile and receipts for custom runtime URLs'
			);
		}
		return snapshotRubyRuntimePreflightProfile(RUBY_RUNTIME_PROFILE);
	}

	try {
		return snapshotRubyRuntimePreflightProfile({
			profileId: configured?.profileId?.trim(),
			artifactRevision: configured?.artifactRevision?.trim(),
			rubyVersion: configured?.rubyVersion?.trim(),
			rubyRevision: configured?.rubyRevision?.trim(),
			rubyWasmVersion: configured?.rubyWasmVersion?.trim(),
			rubyWasmRevision: configured?.rubyWasmRevision?.trim(),
			wasiSdkVersion: configured?.wasiSdkVersion?.trim(),
			manifestFingerprint: configured?.manifestFingerprint?.trim(),
			manifestReceipt: configured?.manifestReceipt,
			moduleJavaScriptReceipt: configured?.moduleJavaScriptReceipt,
			wasmReceipt: configured?.wasmReceipt
		});
	} catch {
		throw new LanguageServerAssetConfigurationError(
			'Ruby LSP',
			'a complete valid runtime preflight profile and receipts'
		);
	}
}

function resolveRubyLanguageServerBaseUrlFromSnapshot(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-ruby/`, currentUrl);
	}
	if (options?.ruby?.baseUrl) {
		resolveRubyLanguageServerPreflightProfileFromSnapshot(options);
		return normalizeBaseUrl(options.ruby.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-ruby/`, currentUrl);
	}
	return resolveApplicationAssetUrl('/wasm-ruby/', currentUrl);
}

export function resolveRubyLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	return resolveRubyLanguageServerBaseUrlFromSnapshot(
		snapshotRubyLanguageServerOptions(options),
		currentUrl
	);
}

export function resolveRubyLanguageServerPreflightProfile(
	options: EditorLanguageServerOptions | undefined
): RubyRuntimePreflightProfile {
	return resolveRubyLanguageServerPreflightProfileFromSnapshot(
		snapshotRubyLanguageServerOptions(options)
	);
}

function resolveRubyLanguageServerPinnedAssetUrl(
	baseUrl: string,
	currentUrl: string,
	configuredUrl: string | undefined,
	path: string,
	pin: string
) {
	const sentinelOrigin = 'https://wasm-idle.invalid';
	const candidate = resolveFileUrl(configuredUrl || `${baseUrl}${path}`, currentUrl);
	let url: URL;
	let expected: URL;
	try {
		url = new URL(candidate, currentUrl || sentinelOrigin);
		expected = new URL(path, new URL(baseUrl, currentUrl || sentinelOrigin));
	} catch {
		throw new LanguageServerAssetConfigurationError(
			'Ruby LSP',
			`${path} to use its canonical query-pinned path under ruby.baseUrl`
		);
	}
	if (
		(url.protocol !== 'http:' && url.protocol !== 'https:') ||
		url.username ||
		url.password ||
		url.hash ||
		url.origin !== expected.origin ||
		url.pathname !== expected.pathname ||
		(url.search && url.search !== `?v=${pin}`)
	) {
		throw new LanguageServerAssetConfigurationError(
			'Ruby LSP',
			`${path} to use its canonical query-pinned path under ruby.baseUrl`
		);
	}
	if (!url.search) url.searchParams.set('v', pin);
	return currentUrl || candidate.startsWith('http://') || candidate.startsWith('https://')
		? url.href
		: `${url.pathname}${url.search}`;
}

export function resolveRubyLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const snapshot = snapshotRubyLanguageServerOptions(options);
	const configured = typeof snapshot === 'object' ? snapshot.ruby : undefined;
	const profile = resolveRubyLanguageServerPreflightProfileFromSnapshot(snapshot);
	return resolveRubyLanguageServerPinnedAssetUrl(
		resolveRubyLanguageServerBaseUrlFromSnapshot(snapshot, currentUrl),
		currentUrl,
		configured?.manifestUrl,
		RUBY_RUNTIME_MANIFEST_PATH,
		profile.manifestFingerprint
	);
}

export function resolveRubyLanguageServerModuleUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const snapshot = snapshotRubyLanguageServerOptions(options);
	const configured = typeof snapshot === 'object' ? snapshot.ruby : undefined;
	const profile = resolveRubyLanguageServerPreflightProfileFromSnapshot(snapshot);
	return resolveRubyLanguageServerPinnedAssetUrl(
		resolveRubyLanguageServerBaseUrlFromSnapshot(snapshot, currentUrl),
		currentUrl,
		configured?.moduleUrl,
		RUBY_RUNTIME_MODULE_STORAGE_PATH,
		profile.moduleJavaScriptReceipt.sha256
	);
}

export function resolveRubyLanguageServerWasmUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const snapshot = snapshotRubyLanguageServerOptions(options);
	const configured = typeof snapshot === 'object' ? snapshot.ruby : undefined;
	const profile = resolveRubyLanguageServerPreflightProfileFromSnapshot(snapshot);
	return resolveRubyLanguageServerPinnedAssetUrl(
		resolveRubyLanguageServerBaseUrlFromSnapshot(snapshot, currentUrl),
		currentUrl,
		configured?.wasmUrl,
		RUBY_RUNTIME_WASM_STORAGE_PATH,
		profile.wasmReceipt.sha256
	);
}

export function resolveRubyLanguageServerAssetConfig(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const snapshot = snapshotRubyLanguageServerOptions(options);
	const configured = typeof snapshot === 'object' ? snapshot.ruby : undefined;
	const profile = resolveRubyLanguageServerPreflightProfileFromSnapshot(snapshot);
	const baseUrl = resolveRubyLanguageServerBaseUrlFromSnapshot(snapshot, currentUrl);
	return Object.freeze({
		baseUrl,
		manifestUrl: resolveRubyLanguageServerPinnedAssetUrl(
			baseUrl,
			currentUrl,
			configured?.manifestUrl,
			RUBY_RUNTIME_MANIFEST_PATH,
			profile.manifestFingerprint
		),
		moduleUrl: resolveRubyLanguageServerPinnedAssetUrl(
			baseUrl,
			currentUrl,
			configured?.moduleUrl,
			RUBY_RUNTIME_MODULE_STORAGE_PATH,
			profile.moduleJavaScriptReceipt.sha256
		),
		wasmUrl: resolveRubyLanguageServerPinnedAssetUrl(
			baseUrl,
			currentUrl,
			configured?.wasmUrl,
			RUBY_RUNTIME_WASM_STORAGE_PATH,
			profile.wasmReceipt.sha256
		),
		profile
	});
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
	return resolveApplicationAssetUrl('/webr/', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-awk/', currentUrl);
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
	return resolveApplicationAssetUrl('/wasm-awk/runner-worker.js', currentUrl);
}

export function resolvePerlLanguageServerBaseUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'string') {
		return resolveFileUrl(`${normalizeRootUrl(options) || ''}/wasm-perl/`, currentUrl);
	}
	if (options?.perl?.baseUrl) {
		return normalizeBaseUrl(options.perl.baseUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(`${normalizeRootUrl(options.rootUrl) || ''}/wasm-perl/`, currentUrl);
	}
	return resolveApplicationAssetUrl('/wasm-perl/', currentUrl);
}

export function resolvePerlLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const workerVersion = resolvePerlLanguageServerWorkerReceipt(options).sha256;
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-perl/runner-worker.js?v=${workerVersion}`,
			currentUrl
		);
	}
	if (options?.perl?.workerUrl) {
		return resolveFileUrl(options.perl.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-perl/runner-worker.js?v=${workerVersion}`,
			currentUrl
		);
	}
	return resolveApplicationAssetUrl(`/wasm-perl/runner-worker.js?v=${workerVersion}`, currentUrl);
}

export function resolvePerlLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options.perl?.manifestUrl) {
		return resolveFileUrl(options.perl.manifestUrl, currentUrl);
	}
	return resolveFileUrl(
		`${resolvePerlLanguageServerBaseUrl(options, currentUrl)}runtime-manifest.v2.json?v=${resolvePerlLanguageServerManifestFingerprint(options)}`,
		currentUrl
	);
}

export function resolvePerlLanguageServerManifestFingerprint(
	options: EditorLanguageServerOptions | undefined
) {
	const configured =
		typeof options === 'object' ? options.perl?.manifestFingerprint?.trim() || '' : '';
	if (!configured) return BUNDLED_PERL_MANIFEST_FINGERPRINT;
	if (/^[a-f0-9]{64}$/u.test(configured)) return configured;
	throw new LanguageServerAssetConfigurationError(
		'Perl LSP',
		'a 64-character perl.manifestFingerprint'
	);
}

function hasConfiguredPerlTrust(options: EditorLanguageServerOptions | undefined): boolean {
	const configured = typeof options === 'object' ? options.perl : undefined;
	return (
		!!configured &&
		[
			configured.manifestFingerprint,
			configured.profileId,
			configured.artifactRevision,
			configured.webperlRevision,
			configured.perlRevision,
			configured.emscriptenRevision,
			configured.manifestReceipt,
			configured.javascriptReceipt,
			configured.wasmReceipt,
			configured.dataReceipt,
			configured.workerReceipt
		].some((value) => value !== undefined)
	);
}

export function resolvePerlLanguageServerWorkerReceipt(
	options: EditorLanguageServerOptions | undefined
) {
	const configured = typeof options === 'object' ? options.perl?.workerReceipt : undefined;
	if (configured) return configured;
	if (!hasConfiguredPerlTrust(options)) return BUNDLED_PERL_RUNTIME_BUNDLE.workerReceipt;
	throw new LanguageServerAssetConfigurationError(
		'Perl LSP',
		'a complete runtime profile and runner receipt bundle'
	);
}

export function resolvePerlLanguageServerPreflightProfile(
	options: EditorLanguageServerOptions | undefined
): PerlRuntimePreflightProfile {
	const configured = typeof options === 'object' ? options.perl : undefined;
	const manifestFingerprint = resolvePerlLanguageServerManifestFingerprint(options);
	const hasConfiguredProfile = hasConfiguredPerlTrust(options);

	if (!hasConfiguredProfile) {
		if (manifestFingerprint !== BUNDLED_PERL_MANIFEST_FINGERPRINT) {
			throw new LanguageServerAssetConfigurationError(
				'Perl LSP',
				'a complete runtime profile and receipts for a custom manifest fingerprint'
			);
		}
		return snapshotPerlRuntimePreflightProfile(BUNDLED_PERL_RUNTIME_BUNDLE.profile);
	}

	try {
		return snapshotPerlRuntimePreflightProfile({
			profileId: configured?.profileId?.trim(),
			artifactRevision: configured?.artifactRevision?.trim(),
			webperlRevision: configured?.webperlRevision?.trim(),
			perlRevision: configured?.perlRevision?.trim(),
			emscriptenRevision: configured?.emscriptenRevision?.trim(),
			manifestFingerprint,
			manifestReceipt: configured?.manifestReceipt,
			javascriptReceipt: configured?.javascriptReceipt,
			wasmReceipt: configured?.wasmReceipt,
			dataReceipt: configured?.dataReceipt
		});
	} catch {
		throw new LanguageServerAssetConfigurationError(
			'Perl LSP',
			'a complete valid runtime preflight profile and receipts'
		);
	}
}

export function resolvePerlLanguageServerAssetConfig(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const profile = resolvePerlLanguageServerPreflightProfile(options);
	const workerReceipt = resolvePerlLanguageServerWorkerReceipt(options);
	return Object.freeze({
		baseUrl: resolvePerlLanguageServerBaseUrl(options, currentUrl),
		workerUrl: resolvePerlLanguageServerWorkerUrl(options, currentUrl),
		manifestUrl: resolvePerlLanguageServerManifestUrl(options, currentUrl),
		manifestFingerprint: profile.manifestFingerprint,
		profile,
		workerReceipt
	});
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
	return resolveApplicationAssetUrl('/wasm-tcl/', currentUrl);
}

export function resolveTclLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const workerReceipt = resolveTclLanguageServerWorkerReceipt(options);
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-tcl/runner-worker.js?v=${workerReceipt.sha256}`,
			currentUrl
		);
	}
	if (options?.tcl?.workerUrl) {
		return resolveFileUrl(options.tcl.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-tcl/runner-worker.js?v=${workerReceipt.sha256}`,
			currentUrl
		);
	}
	return resolveApplicationAssetUrl(
		`/wasm-tcl/runner-worker.js?v=${workerReceipt.sha256}`,
		currentUrl
	);
}

export function resolveTclLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options.tcl?.manifestUrl) {
		return resolveFileUrl(options.tcl.manifestUrl, currentUrl);
	}
	const manifestFingerprint = resolveTclLanguageServerManifestFingerprint(options);
	return resolveFileUrl(
		`${resolveTclLanguageServerBaseUrl(options, currentUrl)}runtime-manifest.v2.json?v=${manifestFingerprint}`,
		currentUrl
	);
}

export function resolveTclLanguageServerManifestFingerprint(
	options: EditorLanguageServerOptions | undefined
) {
	const configured =
		typeof options === 'object' ? options.tcl?.manifestFingerprint?.trim() || '' : '';
	if (!configured) return BUNDLED_TCL_MANIFEST_FINGERPRINT;
	if (/^[a-f0-9]{64}$/u.test(configured)) return configured;
	throw new LanguageServerAssetConfigurationError(
		'Tcl LSP',
		'a 64-character tcl.manifestFingerprint'
	);
}

function hasConfiguredTclTrust(options: EditorLanguageServerOptions | undefined): boolean {
	const configured = typeof options === 'object' ? options.tcl : undefined;
	return (
		!!configured &&
		[
			configured.manifestFingerprint,
			configured.profileId,
			configured.artifactRevision,
			configured.waclRevision,
			configured.tclRevision,
			configured.requireJsRevision,
			configured.emscriptenRevision,
			configured.manifestReceipt,
			configured.requireJsReceipt,
			configured.customDataReceipt,
			configured.libraryDataReceipt,
			configured.glueReceipt,
			configured.wasmReceipt,
			configured.workerReceipt
		].some((value) => value !== undefined)
	);
}

export function resolveTclLanguageServerWorkerReceipt(
	options: EditorLanguageServerOptions | undefined
) {
	const configured = typeof options === 'object' ? options.tcl?.workerReceipt : undefined;
	if (configured) return configured;
	if (!hasConfiguredTclTrust(options)) return BUNDLED_TCL_RUNTIME_BUNDLE.workerReceipt;
	throw new LanguageServerAssetConfigurationError(
		'Tcl LSP',
		'a complete runtime profile and runner receipt bundle'
	);
}

export function resolveTclLanguageServerPreflightProfile(
	options: EditorLanguageServerOptions | undefined
): TclRuntimePreflightProfile {
	const configured = typeof options === 'object' ? options.tcl : undefined;
	const manifestFingerprint = resolveTclLanguageServerManifestFingerprint(options);
	const hasConfiguredProfile = hasConfiguredTclTrust(options);

	if (!hasConfiguredProfile) {
		if (manifestFingerprint !== BUNDLED_TCL_MANIFEST_FINGERPRINT) {
			throw new LanguageServerAssetConfigurationError(
				'Tcl LSP',
				'a complete runtime profile and receipts for a custom manifest fingerprint'
			);
		}
		return snapshotTclRuntimePreflightProfile(BUNDLED_TCL_RUNTIME_BUNDLE.profile);
	}

	try {
		return snapshotTclRuntimePreflightProfile({
			profileId: configured?.profileId?.trim(),
			artifactRevision: configured?.artifactRevision?.trim(),
			waclRevision: configured?.waclRevision?.trim(),
			tclRevision: configured?.tclRevision?.trim(),
			requireJsRevision: configured?.requireJsRevision?.trim(),
			emscriptenRevision: configured?.emscriptenRevision?.trim(),
			manifestFingerprint,
			manifestReceipt: configured?.manifestReceipt,
			requireJsReceipt: configured?.requireJsReceipt,
			customDataReceipt: configured?.customDataReceipt,
			libraryDataReceipt: configured?.libraryDataReceipt,
			glueReceipt: configured?.glueReceipt,
			wasmReceipt: configured?.wasmReceipt
		});
	} catch {
		throw new LanguageServerAssetConfigurationError(
			'Tcl LSP',
			'a complete valid runtime preflight profile and receipts'
		);
	}
}

export function resolveTclLanguageServerAssetConfig(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const profile = resolveTclLanguageServerPreflightProfile(options);
	const workerReceipt = resolveTclLanguageServerWorkerReceipt(options);
	return Object.freeze({
		baseUrl: resolveTclLanguageServerBaseUrl(options, currentUrl),
		workerUrl: resolveTclLanguageServerWorkerUrl(options, currentUrl),
		manifestUrl: resolveTclLanguageServerManifestUrl(options, currentUrl),
		manifestFingerprint: profile.manifestFingerprint,
		profile,
		workerReceipt
	});
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
	return resolveApplicationAssetUrl('/wasm-pascal/', currentUrl);
}

export function resolvePascalLanguageServerWorkerUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const bundledWorkerVersion = resolvePascalLanguageServerWorkerReceipt(options).sha256;
	if (typeof options === 'string') {
		return resolveFileUrl(
			`${normalizeRootUrl(options) || ''}/wasm-pascal/runner-worker.js?v=${bundledWorkerVersion}`,
			currentUrl
		);
	}
	if (options?.pascal?.workerUrl) {
		return resolveFileUrl(options.pascal.workerUrl, currentUrl);
	}
	if (options?.rootUrl) {
		return resolveFileUrl(
			`${normalizeRootUrl(options.rootUrl) || ''}/wasm-pascal/runner-worker.js?v=${bundledWorkerVersion}`,
			currentUrl
		);
	}
	return resolveApplicationAssetUrl(
		`/wasm-pascal/runner-worker.js?v=${bundledWorkerVersion}`,
		currentUrl
	);
}

export function resolvePascalLanguageServerManifestUrl(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	if (typeof options === 'object' && options.pascal?.manifestUrl) {
		return resolveFileUrl(options.pascal.manifestUrl, currentUrl);
	}
	return resolveFileUrl(
		`${resolvePascalLanguageServerBaseUrl(options, currentUrl)}runtime-manifest.v2.json?v=${resolvePascalLanguageServerManifestFingerprint(options)}`,
		currentUrl
	);
}

const usesCustomPascalRuntimeUrls = (options: EditorLanguageServerOptions | undefined) =>
	typeof options === 'object' &&
	Boolean(
		options.pascal?.baseUrl ||
		options.pascal?.workerUrl ||
		options.pascal?.manifestUrl ||
		options.pascal?.compilerJavaScriptUrl ||
		options.pascal?.rtlJavaScriptUrl ||
		options.pascal?.systemPascalUrl
	);

function hasConfiguredPascalTrust(options: EditorLanguageServerOptions | undefined): boolean {
	const configured = typeof options === 'object' ? options.pascal : undefined;
	return (
		!!configured &&
		[
			configured.manifestFingerprint,
			configured.profileId,
			configured.artifactRevision,
			configured.pas2jsVersion,
			configured.pas2jsRevision,
			configured.manifestReceipt,
			configured.compilerJavaScriptReceipt,
			configured.rtlJavaScriptReceipt,
			configured.systemPascalReceipt,
			configured.workerReceipt
		].some((value) => value !== undefined)
	);
}

export function resolvePascalLanguageServerManifestFingerprint(
	options: EditorLanguageServerOptions | undefined
) {
	const configured =
		typeof options === 'object' ? options.pascal?.manifestFingerprint?.trim() || '' : '';
	if (/^[a-f0-9]{64}$/u.test(configured)) return configured;
	if (!configured && !usesCustomPascalRuntimeUrls(options)) {
		return BUNDLED_PASCAL_MANIFEST_FINGERPRINT;
	}
	throw new LanguageServerAssetConfigurationError(
		'Pascal LSP',
		'an explicit 64-character pascal.manifestFingerprint for custom runtime URLs'
	);
}

export function resolvePascalLanguageServerWorkerReceipt(
	options: EditorLanguageServerOptions | undefined
) {
	const configured = typeof options === 'object' ? options.pascal?.workerReceipt : undefined;
	if (configured) return configured;
	if (!usesCustomPascalRuntimeUrls(options) && !hasConfiguredPascalTrust(options)) {
		return BUNDLED_PASCAL_RUNTIME_BUNDLE.workerReceipt;
	}
	throw new LanguageServerAssetConfigurationError(
		'Pascal LSP',
		'a complete runtime profile and runner receipt bundle'
	);
}

export function resolvePascalLanguageServerPreflightProfile(
	options: EditorLanguageServerOptions | undefined
): PascalRuntimePreflightProfile {
	const configured = typeof options === 'object' ? options.pascal : undefined;
	const manifestFingerprint = resolvePascalLanguageServerManifestFingerprint(options);
	const hasConfiguredProfile = hasConfiguredPascalTrust(options);

	if (!hasConfiguredProfile) {
		if (usesCustomPascalRuntimeUrls(options)) {
			throw new LanguageServerAssetConfigurationError(
				'Pascal LSP',
				'a complete runtime profile and receipts for custom runtime URLs'
			);
		}
		return snapshotPascalRuntimePreflightProfile(BUNDLED_PASCAL_RUNTIME_BUNDLE.profile);
	}

	try {
		return snapshotPascalRuntimePreflightProfile({
			profileId: configured?.profileId?.trim(),
			artifactRevision: configured?.artifactRevision?.trim(),
			pas2jsVersion: configured?.pas2jsVersion?.trim(),
			pas2jsRevision: configured?.pas2jsRevision?.trim(),
			manifestFingerprint,
			manifestReceipt: configured?.manifestReceipt,
			compilerJavaScriptReceipt: configured?.compilerJavaScriptReceipt,
			rtlJavaScriptReceipt: configured?.rtlJavaScriptReceipt,
			systemPascalReceipt: configured?.systemPascalReceipt
		});
	} catch {
		throw new LanguageServerAssetConfigurationError(
			'Pascal LSP',
			'a complete valid runtime preflight profile and receipts'
		);
	}
}

export function resolvePascalLanguageServerAssetConfig(
	options: EditorLanguageServerOptions | undefined,
	currentUrl = ''
) {
	const configured = typeof options === 'object' ? options.pascal : undefined;
	const profile = resolvePascalLanguageServerPreflightProfile(options);
	const workerReceipt = resolvePascalLanguageServerWorkerReceipt(options);
	return Object.freeze({
		baseUrl: resolvePascalLanguageServerBaseUrl(options, currentUrl),
		workerUrl: resolvePascalLanguageServerWorkerUrl(options, currentUrl),
		manifestUrl: resolvePascalLanguageServerManifestUrl(options, currentUrl),
		...(configured?.compilerJavaScriptUrl
			? {
					compilerJavaScriptUrl: resolveFileUrl(
						configured.compilerJavaScriptUrl,
						currentUrl
					)
				}
			: {}),
		...(configured?.rtlJavaScriptUrl
			? { rtlJavaScriptUrl: resolveFileUrl(configured.rtlJavaScriptUrl, currentUrl) }
			: {}),
		...(configured?.systemPascalUrl
			? { systemPascalUrl: resolveFileUrl(configured.systemPascalUrl, currentUrl) }
			: {}),
		manifestFingerprint: profile.manifestFingerprint,
		profile,
		workerReceipt
	});
}

export type { EditorLanguageServerRuntimeOptions };
