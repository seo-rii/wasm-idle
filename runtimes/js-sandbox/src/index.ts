export const QUICKJS_EMSCRIPTEN_PACKAGE = 'quickjs-emscripten';

export const QUICKJS_PACKAGE_ASSETS = [
	'dist/index.mjs',
	'dist/index.global.js',
	'dist/variants.mjs'
] as const;

export type QuickJsPackageAsset = (typeof QUICKJS_PACKAGE_ASSETS)[number];

export interface QuickJsAssetResolverOptions {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
}

export interface QuickJsHandleLike {
	dispose?: () => void;
}

export interface QuickJsEvalResultLike {
	value?: QuickJsHandleLike;
	error?: QuickJsHandleLike;
}

export interface QuickJsModuleLike {
	evalCode: (code: string, options?: unknown) => QuickJsEvalResultLike;
	dump: (handle: QuickJsHandleLike) => unknown;
}

export interface QuickJsPackageLike {
	getQuickJS?: () => Promise<QuickJsModuleLike>;
	shouldInterruptAfterDeadline?: (deadline: number) => unknown;
	[key: string]: unknown;
}

export interface QuickJsSandboxOptions {
	quickJs?: QuickJsModuleLike;
	moduleName?: string;
	memoryLimitBytes?: number;
	timeoutMs?: number;
	shouldInterrupt?: unknown;
}

export interface QuickJsEvaluation {
	value: unknown;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

export function normalizeQuickJsBaseUrl(
	baseUrl: string | URL = '/quickjs/',
	currentUrl?: string | URL
) {
	const normalized = ensureTrailingSlash(stringifyUrl(baseUrl));
	if (currentUrl) return new URL(normalized, stringifyUrl(currentUrl)).href;
	return normalized;
}

export function resolveQuickJsAssetUrl(
	asset: QuickJsPackageAsset | string,
	options: QuickJsAssetResolverOptions = {}
) {
	if (ABSOLUTE_URL_PATTERN.test(asset)) return asset;
	const baseUrl = normalizeQuickJsBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(asset, baseUrl).href;
	return `${baseUrl}${asset.replace(/^\/+/, '')}`;
}

export function createQuickJsAssetManifest(options: QuickJsAssetResolverOptions = {}) {
	return Object.fromEntries(
		QUICKJS_PACKAGE_ASSETS.map((asset) => [asset, resolveQuickJsAssetUrl(asset, options)])
	) as Record<QuickJsPackageAsset, string>;
}

export async function importQuickJsPackage<T = QuickJsPackageLike>(
	moduleName = QUICKJS_EMSCRIPTEN_PACKAGE
): Promise<T> {
	return (await import(/* @vite-ignore */ moduleName)) as T;
}

export function createDeadlineInterrupt(deadlineMs: number, now = () => Date.now()) {
	return () => now() >= deadlineMs;
}

export async function loadQuickJs(options: QuickJsSandboxOptions = {}) {
	if (options.quickJs) return options.quickJs;
	const quickJsPackage = await importQuickJsPackage<QuickJsPackageLike>(options.moduleName);
	if (!quickJsPackage.getQuickJS) {
		throw new Error('quickjs-emscripten getQuickJS export was not found.');
	}
	return quickJsPackage.getQuickJS();
}

export async function evaluateQuickJs(
	code: string,
	options: QuickJsSandboxOptions = {}
): Promise<QuickJsEvaluation> {
	const quickJs = await loadQuickJs(options);
	const evalOptions = {
		memoryLimitBytes: options.memoryLimitBytes,
		shouldInterrupt:
			options.shouldInterrupt ??
			(options.timeoutMs
				? createDeadlineInterrupt(Date.now() + options.timeoutMs)
				: undefined)
	};
	const result = quickJs.evalCode(code, evalOptions);
	try {
		if (result.error) {
			throw new Error(String(quickJs.dump(result.error)));
		}
		return { value: result.value ? quickJs.dump(result.value) : undefined };
	} finally {
		result.value?.dispose?.();
		result.error?.dispose?.();
	}
}
