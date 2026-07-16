import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface PackageJson {
	dependencies?: Record<string, string>;
	name?: string;
	private?: boolean;
	scripts?: Record<string, string>;
}

async function readRootPackage() {
	return JSON.parse(await readFile('package.json', 'utf8')) as PackageJson;
}

async function readPackageVerifier() {
	return await readFile('scripts/verify-package.mjs', 'utf8');
}

describe('LLVM runtime package scripts', () => {
	it('consumes the local code-only LLVM runtime without depending on the producer repo', async () => {
		const pkg = await readRootPackage();

		expect(pkg.dependencies?.['@seo-rii/wasm-llvm']).toBeUndefined();
		expect(pkg.dependencies?.['@wasm-idle/llvm-core']).toBe('workspace:*');
		expect(pkg.dependencies?.['wasm-clang']).toBeUndefined();
		expect(pkg.dependencies?.['@wasm-idle/clang-common']).toBeUndefined();
	});

	it('does not publish language-specific AssemblyScript or PHP wrapper packages', async () => {
		const pkg = await readRootPackage();
		const verifier = await readPackageVerifier();

		expect(pkg.dependencies?.['@wasm-idle/runtime-assemblyscript']).toBeUndefined();
		expect(pkg.dependencies?.['@wasm-idle/runtime-php']).toBeUndefined();
		expect(verifier).not.toContain('runtimes/assemblyscript');
		expect(verifier).not.toContain('runtimes/php');
		expect(verifier).not.toContain('@wasm-idle/runtime-assemblyscript');
		expect(verifier).not.toContain('@wasm-idle/runtime-php');
	});

	it('keeps every language runtime workspace private', async () => {
		const runtimeEntries = await readdir('runtimes', { withFileTypes: true });

		for (const entry of runtimeEntries) {
			if (!entry.isDirectory()) continue;
			let manifestSource: string;
			try {
				manifestSource = await readFile(`runtimes/${entry.name}/package.json`, 'utf8');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
				throw error;
			}
			const manifest = JSON.parse(manifestSource) as PackageJson;
			expect(manifest.private, manifest.name || entry.name).toBe(true);
		}
	});

	it('keeps normal development and builds independent of runtime asset syncs', async () => {
		const pkg = await readRootPackage();

		expect(pkg.scripts?.['prepare:app']).toBe('pnpm run build:publish-deps');
		expect(pkg.scripts?.['prepare:clang-assets']).toBeUndefined();
		expect(pkg.scripts?.['prepare:cobol-assets']).toBeUndefined();
		for (const scriptName of ['dev', 'build:preview', 'build', 'prepare:app']) {
			expect(pkg.scripts?.[scriptName]).not.toContain('sync:wasm-');
		}

		expect(pkg.scripts?.['sync:wasm-clang']).toBe('node scripts/sync-wasm-clang.mjs');
		expect(pkg.scripts?.['sync:wasm-cobol']).toBe('node scripts/sync-runtime.mjs wasm-cobol');
		expect(pkg.scripts?.['sync:wasm-swift']).toBe('node scripts/sync-runtime.mjs wasm-swift');

		for (const command of Object.values(pkg.scripts || {})) {
			expect(command).not.toContain('runtimes/wasm-clang');
			expect(command).not.toContain('runtimes/wasm-swift');
			expect(command).not.toContain('runtimes/wasm-objectivec');
		}
	});

	it('checks every public workspace package tarball for static assets', async () => {
		const verifier = await readPackageVerifier();

		for (const packagePath of [
			'packages/core',
			'packages/llvm-core',
			'packages/lsp',
			'packages/node',
			'packages/react',
			'packages/svelte',
			'packages/vue'
		]) {
			expect(verifier).toContain(`'${packagePath}'`);
		}
		expect(verifier).toContain("['wasm-idle', '.']");
	});
});
