import { defineConfig } from 'vitest/config';

export default defineConfig({
	tsconfig: './tsconfig.json',
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts']
	}
});
