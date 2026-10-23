// @vitest-environment node

import { describe, expect, it } from 'vitest';

import svelteConfig from '../../sveltekit.config.mjs';
import {
	applicationContentSecurityPolicyDirectives,
	createReleasePreviewSecurityHeaders,
	isStrictContentSecurityPolicyEnabled,
	javaLanguageServerHostContentSecurityPolicy,
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
		expect(applicationContentSecurityPolicyDirectives['connect-src']).toEqual([
			'self',
			'blob:',
			'https:',
			'http:'
		]);
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
		expect((svelteConfig as { csp?: unknown }).csp).toBe(
			isStrictContentSecurityPolicyEnabled() ? svelteContentSecurityPolicy : undefined
		);
	});

	it('applies the worker-capable response policy to release preview responses', () => {
		expect(releaseResponseContentSecurityPolicy).toContain(
			"script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-inline'"
		);
		expect(releaseResponseContentSecurityPolicy).toContain("worker-src 'self' blob:");
		expect(releaseResponseContentSecurityPolicy).toContain(
			"connect-src 'self' blob: https: http:"
		);
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
		expect(previewHeaders).toEqual(createReleasePreviewSecurityHeaders(false));
	});

	it('scopes the Java vendor bootstrap policy to the standalone JVM document', () => {
		for (const path of [
			'/java-lsp/host.html',
			'/wasm-idle/java-lsp/host.html?cache=1',
			'/apps/editor/java-lsp/host.html'
		]) {
			const headers = createReleasePreviewSecurityHeaders(true, path);
			expect(headers['Content-Security-Policy']).toBe(
				javaLanguageServerHostContentSecurityPolicy
			);
			expect(headers['Cross-Origin-Embedder-Policy']).toBe('require-corp');
		}
		for (const path of [
			'/wasm-idle/',
			'/java-lsp/host.mjs',
			'/java-lsp/host.html/other',
			'/java-lsp/host.html/../other',
			'/_app/immutable/workers/java.js'
		]) {
			expect(createReleasePreviewSecurityHeaders(true, path)['Content-Security-Policy']).toBe(
				releaseResponseContentSecurityPolicy
			);
		}
		expect(javaLanguageServerHostContentSecurityPolicy).toContain(
			'https://cjrtnc.leaningtech.com'
		);
		expect(javaLanguageServerHostContentSecurityPolicy).toContain("'unsafe-eval'");
		expect(releaseResponseContentSecurityPolicy).not.toContain('leaningtech');
	});
});
