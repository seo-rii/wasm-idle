import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('LLVM producer boundary', () => {
	it('keeps wasm-idle independent from the wasm-llvm npm package', async () => {
		for (const manifestPath of [
			'package.json',
			'packages/lsp/package.json',
			'runtimes/wasm-tinygo/package.json'
		]) {
			const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
			expect(manifest.dependencies?.['@seo-rii/wasm-llvm'], manifestPath).toBeUndefined();
		}

		const pending = ['src', 'packages/lsp/src', 'runtimes/wasm-tinygo/scripts', 'scripts'];
		const forbiddenImports: string[] = [];
		while (pending.length > 0) {
			const directory = pending.pop();
			if (!directory) continue;
			for (const entry of await readdir(directory, { withFileTypes: true })) {
				const entryPath = path.join(directory, entry.name);
				if (entry.isDirectory()) {
					if (!['dist', 'node_modules'].includes(entry.name)) pending.push(entryPath);
					continue;
				}
				if (!/\.(?:cjs|js|mjs|mts|svelte|ts)$/u.test(entry.name)) continue;
				const source = await readFile(entryPath, 'utf8');
				if (
					/(?:from\s*|import\s*\()\s*['"]@seo-rii\/wasm-llvm(?:\/[^'"]*)?['"]/u.test(
						source
					)
				) {
					forbiddenImports.push(entryPath);
				}
			}
		}

		expect(forbiddenImports).toEqual([]);
	});
});
