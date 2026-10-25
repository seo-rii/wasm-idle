import { defineConfig } from 'vitest/config';

export default defineConfig({
	// Tests are outside the declaration build's include glob. Keep their transform
	// independent of the application's generated $app/tsconfig in a clean checkout.
	tsconfig: './tsconfig.json',
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts']
	}
});
