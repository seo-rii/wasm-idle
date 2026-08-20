import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('published declaration generation', () => {
	it('uses the package-specific TypeScript configuration', async () => {
		const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
			scripts?: Record<string, string>;
		};

		expect(manifest.scripts?.['package:root']).toContain(
			'svelte-package --tsconfig ./tsconfig.package.json'
		);
	});

	it('excludes tests and specs from the generated declarations', async () => {
		const packageTsconfig = JSON.parse(await readFile('tsconfig.package.json', 'utf8')) as {
			exclude?: string[];
		};

		expect(packageTsconfig.exclude).toEqual(
			expect.arrayContaining(['src/**/*.test.*', 'src/**/*.spec.*'])
		);
	});
});
