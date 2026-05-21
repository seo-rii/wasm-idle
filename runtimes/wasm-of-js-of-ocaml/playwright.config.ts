import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests',
	testMatch: ['browser-native.spec.ts'],
	timeout: 180_000,
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: 'http://127.0.0.1:4174',
		browserName: 'chromium',
		headless: true
	},
	webServer: {
		command: 'npm run serve:browser-harness',
		url: 'http://127.0.0.1:4174',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
