export const GHC_WASM_COMPILER = 'wasm32-wasi-ghc';
export const GHC_WASM_RUNNER = 'wasm32-wasi-ghci';

export const HASKELL_WASM_ARTIFACTS = ['main.wasm', 'main.mjs', 'main.js'] as const;

export type HaskellWasmArtifact = (typeof HASKELL_WASM_ARTIFACTS)[number];

export interface HaskellAssetResolverOptions {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
}

export interface GhcWasmCompileCommandOptions {
	compiler?: string;
	source?: string;
	output?: string;
	optimization?: '-O0' | '-O1' | '-O2';
	moduleName?: string;
	extraArgs?: string[];
}

export interface GhcWasmPostLinkCommandOptions {
	nodeExecutable?: string;
	postLinkScript?: string;
	input?: string;
	output?: string;
	extraArgs?: string[];
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

export function normalizeHaskellBaseUrl(
	baseUrl: string | URL = '/haskell/',
	currentUrl?: string | URL
) {
	const normalized = ensureTrailingSlash(stringifyUrl(baseUrl));
	if (currentUrl) return new URL(normalized, stringifyUrl(currentUrl)).href;
	return normalized;
}

export function resolveHaskellAssetUrl(
	asset: HaskellWasmArtifact | string,
	options: HaskellAssetResolverOptions = {}
) {
	if (ABSOLUTE_URL_PATTERN.test(asset)) return asset;
	const baseUrl = normalizeHaskellBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(asset, baseUrl).href;
	return `${baseUrl}${asset.replace(/^\/+/, '')}`;
}

export function createHaskellAssetManifest(
	artifacts: readonly string[] = HASKELL_WASM_ARTIFACTS,
	options: HaskellAssetResolverOptions = {}
) {
	return Object.fromEntries(
		artifacts.map((asset) => [asset, resolveHaskellAssetUrl(asset, options)])
	) as Record<string, string>;
}

export function createGhcWasmCompileCommand(options: GhcWasmCompileCommandOptions = {}) {
	const {
		compiler = GHC_WASM_COMPILER,
		source = 'Main.hs',
		output = 'main.wasm',
		optimization = '-O1',
		moduleName,
		extraArgs = []
	} = options;
	const args = [compiler, source, '-o', output, optimization];
	if (moduleName) args.push('-main-is', moduleName);
	args.push(...extraArgs);
	return args;
}

export function createGhcWasmPostLinkCommand(options: GhcWasmPostLinkCommandOptions = {}) {
	const {
		nodeExecutable = 'node',
		postLinkScript = 'post-link.mjs',
		input = 'main.wasm',
		output = 'main.mjs',
		extraArgs = []
	} = options;
	return [nodeExecutable, postLinkScript, input, output, ...extraArgs];
}

export function hasWebAssemblyRuntime() {
	return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}
