export interface RuntimeModuleAssetSpecifierRewriteRequest {
	bytes: Uint8Array;
	assetPath: string;
	assetUrl: string;
	label?: string;
}

const FATAL_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const requireRelativeAssetPath = (value: string, label: string) => {
	if (
		!value ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.includes('?') ||
		value.includes('#') ||
		/%2f|%5c/iu.test(value) ||
		value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
	) {
		throw new TypeError(`${label} asset path must be a canonical relative path`);
	}
	return value;
};

const requireRuntimeAssetUrl = (value: string, label: string) => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError(`${label} replacement URL must be absolute`);
	}
	if (
		(url.protocol !== 'http:' && url.protocol !== 'https:') ||
		url.username ||
		url.password ||
		url.hash ||
		/%2f|%5c/iu.test(url.pathname)
	) {
		throw new TypeError(`${label} replacement URL is unsafe`);
	}
	return url.href;
};

export function rewriteRuntimeModuleAssetSpecifier({
	bytes,
	assetPath,
	assetUrl,
	label = 'Runtime module'
}: RuntimeModuleAssetSpecifierRewriteRequest) {
	if (
		!ArrayBuffer.isView(bytes) ||
		Object.prototype.toString.call(bytes) !== '[object Uint8Array]'
	) {
		throw new TypeError(`${label} bytes must be a Uint8Array`);
	}
	const path = requireRelativeAssetPath(assetPath, label);
	const url = requireRuntimeAssetUrl(assetUrl, label);
	let source: string;
	try {
		source = FATAL_UTF8_DECODER.decode(bytes);
	} catch {
		throw new TypeError(`${label} is not valid UTF-8 JavaScript`);
	}

	const quotedPath = JSON.stringify(path);
	const pattern = new RegExp(
		`new\\s+URL\\(\\s*${escapeRegExp(quotedPath)}\\s*,\\s*import\\.meta\\.url\\s*\\)`,
		'gu'
	);
	const matches = [...source.matchAll(pattern)];
	if (matches.length !== 1) {
		throw new TypeError(`${label} must contain exactly one matching asset URL expression`);
	}
	const match = matches[0];
	const expression = match[0];
	const rewrittenExpression = expression.replace(quotedPath, JSON.stringify(url));
	return `${source.slice(0, match.index)}${rewrittenExpression}${source.slice(
		(match.index ?? 0) + expression.length
	)}`;
}
