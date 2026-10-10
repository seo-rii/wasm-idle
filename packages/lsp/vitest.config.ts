import { defineConfig } from 'vitest/config';

export default defineConfig({
	// Use the standalone package configuration for tests and source modules.
	tsconfig: './tsconfig.json',
	ssr: {
		resolve: { conditions: ['node', 'browser', 'development|production'] }
	},
	test: {
		environment: 'node',
		server: { deps: { inline: ['vscode-jsonrpc'] } },
		include: ['test/**/*.test.ts']
	}
});
