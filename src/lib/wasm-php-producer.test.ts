import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'vite';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true })
		)
	);
});

describe('the standalone wasm-php producer', () => {
	it('does not depend on the generated root SvelteKit tsconfig', async () => {
		const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-php-producer-'));
		temporaryDirectories.push(fixtureRoot);
		const producerRoot = path.join(fixtureRoot, 'producers', 'wasm-php');
		const entryPath = path.join(producerRoot, 'src', 'entry.ts');
		await mkdir(path.dirname(entryPath), { recursive: true });
		await writeFile(
			path.join(fixtureRoot, 'tsconfig.json'),
			`${JSON.stringify({ extends: './.svelte-kit/tsconfig.json' })}\n`,
			'utf8'
		);
		await writeFile(
			path.join(producerRoot, 'tsconfig.json'),
			await readFile(path.join(REPO_ROOT, 'producers/wasm-php/tsconfig.json'), 'utf8'),
			'utf8'
		);
		await writeFile(entryPath, 'export const runtimeVersion: string = "8.4";\n', 'utf8');

		await expect(
			build({
				root: producerRoot,
				configFile: false,
				logLevel: 'silent',
				build: {
					outDir: path.join(producerRoot, 'dist'),
					rollupOptions: { input: entryPath }
				}
			})
		).resolves.toBeDefined();
	});
});
