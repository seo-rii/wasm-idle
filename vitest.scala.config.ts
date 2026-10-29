import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { createCoreSourceAliases } from './scripts/core-source-aliases.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));

// This runtime qualification imports source modules directly and does not build the app.
export default defineConfig({
	resolve: {
		alias: [{ find: '$lib', replacement: `${root}src/lib` }, ...createCoreSourceAliases(root)]
	},
	test: {
		environment: 'node',
		include: ['src/lib/playground/scala*.test.ts'],
		testTimeout: 10_000
	}
});
