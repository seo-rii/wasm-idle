// @vitest-environment node

import type { BrowserContext } from 'playwright-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addBrowserTestCookies } from '../../scripts/browser-test-cookies.mjs';

afterEach(() => vi.unstubAllEnvs());

describe('optional browser test credentials', () => {
	it('uses no credentials by default', async () => {
		vi.stubEnv('WASM_IDLE_TEST_BYPASS_COOKIE', '');
		const context = { addCookies: vi.fn() };
		await addBrowserTestCookies(context as unknown as BrowserContext, 'http://localhost:5173');
		expect(context.addCookies).not.toHaveBeenCalled();
	});

	it('scopes configured credentials to the browser origin through the cookie jar', async () => {
		vi.stubEnv('WASM_IDLE_TEST_BYPASS_COOKIE', 'dev_bypass_waf=test-only');
		const context = { addCookies: vi.fn() };
		await addBrowserTestCookies(
			context as unknown as BrowserContext,
			'https://dev.example.test/absproxy/5173/'
		);
		expect(context.addCookies).toHaveBeenCalledExactlyOnceWith([
			{ name: 'dev_bypass_waf', value: 'test-only', url: 'https://dev.example.test' }
		]);
	});

	it.each(['other=value', 'dev_bypass_waf=value; other=value', 'dev_bypass_waf=value\r\n'])(
		'rejects malformed or additional credentials without printing them',
		async (cookie) => {
			vi.stubEnv('WASM_IDLE_TEST_BYPASS_COOKIE', cookie);
			const context = { addCookies: vi.fn() };
			await expect(
				addBrowserTestCookies(
					context as unknown as BrowserContext,
					'https://dev.example.test'
				)
			).rejects.toThrow(
				'WASM_IDLE_TEST_BYPASS_COOKIE must contain one dev_bypass_waf cookie'
			);
			expect(context.addCookies).not.toHaveBeenCalled();
		}
	);
});
