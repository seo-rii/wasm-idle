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
	createBrowserRustCompileRequestIdentity,
	executeBrowserRustArtifact,
	resolveBrowserRustDebugMode,
	type BrowserRustDebugMode,
	type BrowserRustCompilerFactory,
	type BrowserRustCompilerResult,
	type DwarfDebugDescriptor
} from './index.js';

const factory: BrowserRustCompilerFactory = createRustCompiler;
await factory({ dependencies: {} });
await createRustCompiler({ dependencies: {} });
await createNamedCompiler({ dependencies: {} });

const debugMode: BrowserRustDebugMode = resolveBrowserRustDebugMode({
	debugMode: 'lldb'
});
createBrowserRustCompileRequestIdentity({
	code: 'fn main() {}',
	debugMode
});

const debugDescriptor: DwarfDebugDescriptor = {
	kind: 'dwarf',
	sourceRoot: '/workspace',
	moduleSha256: 'module-sha256',
	files: [{
		path: '/workspace/main.rs',
		contentSha256: 'source-sha256'
	}],
	compiler: {
		name: 'rustc',
		version: '1.99.0',
		revision: 'rust-revision',
		llvmVersion: '22.1.8',
		llvmRevision: 'llvm-revision',
		runtimeVersion: 'rust-test-runtime',
		hostTriple: 'wasm32-wasip1-threads'
	}
};

const artifact: NonNullable<BrowserRustCompilerResult['artifact']> = {
	wasm: new Uint8Array([0]),
	targetTriple: 'wasm32-wasip2',
	format: 'component'
};

const compiler = await createRustCompiler();
await compiler.compile({
	code: 'fn main() {}',
	debugMode: 'lldb',
	extendedTimeout: true,
	prepare: true
});

void debugDescriptor;

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
	}, 30_000);
});
