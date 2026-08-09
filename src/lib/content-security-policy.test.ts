import { describe, expect, it } from 'vitest';

import svelteConfig from '../../svelte.config.js';
import {
	applicationContentSecurityPolicyDirectives,
	createReleasePreviewSecurityHeaders,
	isStrictContentSecurityPolicyEnabled,
	releaseResponseContentSecurityPolicy,
	svelteContentSecurityPolicy
} from '../../scripts/content-security-policy.mjs';
import viteConfig, { releasePreviewSecurityHeaders } from '../../vite.config';

describe('release content security policy', () => {
	it('uses SvelteKit hashes for document scripts and permits only verified Blob/Wasm execution', () => {
		expect(svelteContentSecurityPolicy).toEqual({
			mode: 'hash',
			directives: applicationContentSecurityPolicyDirectives
		});
		expect(applicationContentSecurityPolicyDirectives['script-src']).toEqual([
			'self',
			'blob:',
			'wasm-unsafe-eval'
		]);
		expect(applicationContentSecurityPolicyDirectives['script-src']).not.toContain(
			'unsafe-eval'
		);
		expect(applicationContentSecurityPolicyDirectives['script-src']).not.toContain(
			'unsafe-inline'
		);
		expect(applicationContentSecurityPolicyDirectives['worker-src']).toEqual(['self', 'blob:']);
		expect(applicationContentSecurityPolicyDirectives['style-src']).toEqual([
			'self',
			'unsafe-inline',
			'https://fonts.googleapis.com'
		]);
		expect(applicationContentSecurityPolicyDirectives['font-src']).toEqual([
			'self',
			'data:',
			'https://fonts.gstatic.com'
		]);
		expect(isStrictContentSecurityPolicyEnabled({})).toBe(false);
		expect(isStrictContentSecurityPolicyEnabled({ WASM_IDLE_STRICT_CSP: '1' })).toBe(true);
		expect((svelteConfig.kit as { csp?: unknown }).csp).toBe(
			isStrictContentSecurityPolicyEnabled() ? svelteContentSecurityPolicy : undefined
		);
	});

	it('applies the worker-capable response policy to release preview responses', () => {
		expect(releaseResponseContentSecurityPolicy).toContain(
			"script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-inline'"
		);
		expect(releaseResponseContentSecurityPolicy).toContain("worker-src 'self' blob:");
		expect(releaseResponseContentSecurityPolicy).not.toContain("'unsafe-eval'");
		const strictHeaders = createReleasePreviewSecurityHeaders(true);
		const defaultHeaders = createReleasePreviewSecurityHeaders(false);
		expect(strictHeaders['Content-Security-Policy']).toBe(releaseResponseContentSecurityPolicy);
		expect(defaultHeaders).not.toHaveProperty('Content-Security-Policy');
		expect(releasePreviewSecurityHeaders).toEqual(
			createReleasePreviewSecurityHeaders(isStrictContentSecurityPolicyEnabled())
		);

		const previewHeaders = (
			viteConfig as {
				preview?: { headers?: Record<string, string> };
			}
		).preview?.headers;
		expect(previewHeaders).toEqual(releasePreviewSecurityHeaders);
	});
});
