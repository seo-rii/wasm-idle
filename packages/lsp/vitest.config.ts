import { defineConfig } from 'vitest/config';

export default defineConfig({
	ssr: {
		resolve: { conditions: ['node', 'browser', 'development|production'] }
	},
	test: {
		environment: 'node',
		server: { deps: { inline: ['vscode-jsonrpc'] } },
		include: ['test/**/*.test.ts']
	}
});
