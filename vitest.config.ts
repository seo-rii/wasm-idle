import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
		testTimeout:
			process.env.WASM_IDLE_RUN_REAL_BROWSER_DEBUG === '1'
				? Number(process.env.WASM_IDLE_DEBUG_BROWSER_TEST_TIMEOUT_MS || '1200000')
				: 5_000
	}
});
