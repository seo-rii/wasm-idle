const quotedSources = new Set(['none', 'self', 'unsafe-inline', 'wasm-unsafe-eval']);

/** @typedef {NonNullable<NonNullable<import('@sveltejs/kit').Config['kit']>['csp']>} SvelteContentSecurityPolicy */

/** @param {Record<string, string | undefined>} [environment] */
export function isStrictContentSecurityPolicyEnabled(environment = process.env) {
	return environment.WASM_IDLE_STRICT_CSP === '1';
}

export const applicationContentSecurityPolicyDirectives = {
	'default-src': ['self'],
	'base-uri': ['self'],
	'object-src': ['none'],
	'script-src': ['self', 'blob:', 'wasm-unsafe-eval'],
	'worker-src': ['self', 'blob:'],
	'connect-src': ['self', 'https:', 'http:'],
	'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
	'img-src': ['self', 'blob:', 'data:'],
	'manifest-src': ['self'],
	'media-src': ['self', 'blob:', 'data:'],
	'frame-src': ['self', 'blob:'],
	'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
	'form-action': ['self']
};

/** @type {SvelteContentSecurityPolicy} */
export const svelteContentSecurityPolicy = {
	mode: 'hash',
	directives: /** @type {SvelteContentSecurityPolicy['directives']} */ (
		applicationContentSecurityPolicyDirectives
	)
};

/** @param {string} source */
function serializeSource(source) {
	return quotedSources.has(source) ? `'${source}'` : source;
}

/** @param {Record<string, string[]>} directives */
function serializeDirectives(directives) {
	return Object.entries(directives)
		.map(([directive, sources]) => `${directive} ${sources.map(serializeSource).join(' ')}`)
		.join('; ');
}

// The HTTP response policy also reaches module-worker responses. It permits inline bootstrap code
// because the document's independently enforced hash policy restricts inline scripts to the exact
// SvelteKit-generated hashes; workers receive only this response policy and can import verified
// compiler bytes through Blob URLs without enabling general JavaScript eval.
export const releaseResponseContentSecurityPolicy = serializeDirectives({
	...applicationContentSecurityPolicyDirectives,
	'script-src': [...applicationContentSecurityPolicyDirectives['script-src'], 'unsafe-inline']
});

/** @param {boolean} [strictContentSecurityPolicy] */
export function createReleasePreviewSecurityHeaders(
	strictContentSecurityPolicy = isStrictContentSecurityPolicyEnabled()
) {
	return {
		...(strictContentSecurityPolicy
			? { 'Content-Security-Policy': releaseResponseContentSecurityPolicy }
			: {}),
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Cross-Origin-Resource-Policy': 'same-origin'
	};
}
