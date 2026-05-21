export const KOTLIN_WEB_HELPERS_PACKAGE = 'kotlin-web-helpers';

export const KOTLIN_WASM_TARGETS = ['wasmJs', 'wasmWasi'] as const;

export const KOTLIN_WASM_BROWSER_TASKS = [
	'wasmJsBrowserDevelopmentExecutableDistribution',
	'wasmJsBrowserProductionWebpack',
	'wasmJsBrowserDistribution'
] as const;

export type KotlinWasmTarget = (typeof KOTLIN_WASM_TARGETS)[number];
export type KotlinWasmBrowserTask = (typeof KOTLIN_WASM_BROWSER_TASKS)[number];

export interface KotlinAssetResolverOptions {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
}

export interface KotlinWasmArtifactsOptions {
	moduleName?: string;
	includeSourceMap?: boolean;
}

export interface KotlinGradleCommandOptions {
	gradleExecutable?: string;
	projectPath?: string;
	task?: KotlinWasmBrowserTask | string;
	extraArgs?: string[];
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

export function normalizeKotlinBaseUrl(
	baseUrl: string | URL = '/kotlin/',
	currentUrl?: string | URL
) {
	const normalized = ensureTrailingSlash(stringifyUrl(baseUrl));
	if (currentUrl) return new URL(normalized, stringifyUrl(currentUrl)).href;
	return normalized;
}

export function createKotlinWasmArtifacts(options: KotlinWasmArtifactsOptions = {}) {
	const { moduleName = 'app', includeSourceMap = true } = options;
	const artifacts = [
		`${moduleName}.mjs`,
		`${moduleName}.wasm`,
		`${moduleName}.uninstantiated.mjs`
	];
	if (includeSourceMap) artifacts.push(`${moduleName}.mjs.map`);
	return artifacts;
}

export function resolveKotlinAssetUrl(asset: string, options: KotlinAssetResolverOptions = {}) {
	if (ABSOLUTE_URL_PATTERN.test(asset)) return asset;
	const baseUrl = normalizeKotlinBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(asset, baseUrl).href;
	return `${baseUrl}${asset.replace(/^\/+/, '')}`;
}

export function createKotlinAssetManifest(
	artifacts = createKotlinWasmArtifacts(),
	options: KotlinAssetResolverOptions = {}
) {
	return Object.fromEntries(
		artifacts.map((asset) => [asset, resolveKotlinAssetUrl(asset, options)])
	) as Record<string, string>;
}

export function createKotlinGradleCommand(options: KotlinGradleCommandOptions = {}) {
	const {
		gradleExecutable = './gradlew',
		projectPath = '',
		task = 'wasmJsBrowserDevelopmentExecutableDistribution',
		extraArgs = []
	} = options;
	const qualifiedTask = projectPath ? `${projectPath}:${task}` : task;
	return [gradleExecutable, qualifiedTask, ...extraArgs];
}

export function hasWebAssemblyRuntime() {
	return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

export async function importKotlinWebHelpers<T = unknown>(
	moduleName = KOTLIN_WEB_HELPERS_PACKAGE
): Promise<T> {
	return (await import(/* @vite-ignore */ moduleName)) as T;
}
