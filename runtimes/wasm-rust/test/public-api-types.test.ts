import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempFiles = new Set<string>();

afterEach(async () => {
	await Promise.all(
		[...tempFiles].map(async (tempFile) => {
			tempFiles.delete(tempFile);
			await fs.rm(tempFile, { recursive: true, force: true });
		})
	);
});

describe('public api type contracts', () => {
	it('allows factory options and execute helper overloads for TypeScript consumers', async () => {
		const tempFile = path.join(
			repoRoot,
			'src',
			`tmp-public-api-types-${process.pid}-${Date.now()}.ts`
		);
		tempFiles.add(tempFile);
		await fs.writeFile(
			tempFile,
			`import createRustCompiler, {
	createRustCompiler as createNamedCompiler,
	executeBrowserRustArtifact,
	type BrowserRustCompilerFactory,
	type BrowserRustCompilerResult
} from './index.js';

const factory: BrowserRustCompilerFactory = createRustCompiler;
await factory({ dependencies: {} });
await createRustCompiler({ dependencies: {} });
await createNamedCompiler({ dependencies: {} });

const artifact: NonNullable<BrowserRustCompilerResult['artifact']> = {
	wasm: new Uint8Array([0]),
	targetTriple: 'wasm32-wasip2',
	format: 'component'
};

const compiler = await createRustCompiler();
await compiler.compile({
	code: 'fn main() {}',
	extendedTimeout: true,
	prepare: true
});

await executeBrowserRustArtifact(artifact, {
	stdin: () => null
});
await executeBrowserRustArtifact(artifact, 'https://example.com/runtime/', {
	stdin: () => null
});
`
		);

		await expect(
			execFileAsync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'], {
				cwd: repoRoot
			})
		).resolves.toMatchObject({
			stderr: ''
		});
	}, 15_000);
});
