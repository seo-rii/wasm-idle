import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error The build script intentionally has no declaration file.
import { cleanModuleOutput } from '../scripts/clean-module-output.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true })
		)
	);
});

describe('cleanModuleOutput', () => {
	it('preserves static runtime assets while removing stale module output', async () => {
		const outputDir = await mkdtemp(join(tmpdir(), 'wasm-dotnet-dist-'));
		temporaryDirectories.push(outputDir);
		await mkdir(join(outputDir, 'runtime'), { recursive: true });
		await writeFile(join(outputDir, 'runtime', 'dotnet.js'), 'runtime', 'utf8');
		await writeFile(join(outputDir, 'index.js'), 'stale', 'utf8');
		await writeFile(join(outputDir, 'index.d.ts'), 'stale', 'utf8');

		await cleanModuleOutput({ outputDir });

		await expect(readFile(join(outputDir, 'runtime', 'dotnet.js'), 'utf8')).resolves.toBe(
			'runtime'
		);
		await expect(readFile(join(outputDir, 'index.js'), 'utf8')).rejects.toThrow();
		await expect(readFile(join(outputDir, 'index.d.ts'), 'utf8')).rejects.toThrow();
	});
});
