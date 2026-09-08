import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import RequiredBrowserReporter from './scripts/required-browser-reporter.mjs';

export default defineConfig({
	define: {
		__WASM_IDLE_BUILD__: JSON.stringify({ commit: 'test', builtAt: '', runtimeAssets: {} })
	},
	plugins: [sveltekit()],
	test: {
		reporters:
			process.env.WASM_IDLE_REQUIRE_BROWSER_TESTS === '1'
				? ['default', new RequiredBrowserReporter()]
				: ['default'],
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
		testTimeout:
			process.env.WASM_IDLE_RUN_REAL_BROWSER_DEBUG === '1'
				? Number(process.env.WASM_IDLE_DEBUG_BROWSER_TEST_TIMEOUT_MS || '1200000')
				: 5_000
	}
});
