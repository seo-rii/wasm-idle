import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface PackageJson {
	dependencies?: Record<string, string>;
	scripts?: Record<string, string>;
}

async function readRootPackage() {
	return JSON.parse(await readFile('package.json', 'utf8')) as PackageJson;
}

describe('LLVM runtime package scripts', () => {
	it('consumes the pinned wasm-llvm package instead of local compiler workspaces', async () => {
		const pkg = await readRootPackage();

		expect(pkg.dependencies?.['@seo-rii/wasm-llvm']).toBe(
			'github:seo-rii/wasm-llvm#3ead733'
		);
		expect(pkg.dependencies?.['wasm-clang']).toBeUndefined();
		expect(pkg.dependencies?.['@wasm-idle/clang-common']).toBeUndefined();
	});

	it('prepares browser assets through consumer sync scripts only', async () => {
		const pkg = await readRootPackage();
		expect(pkg.scripts?.['prepare:clang-assets']).toBe('pnpm run sync:wasm-clang');
		expect(pkg.scripts?.['sync:wasm-swift']).toBe('node scripts/sync-runtime.mjs wasm-swift');

		for (const command of Object.values(pkg.scripts || {})) {
			expect(command).not.toContain('runtimes/wasm-clang');
			expect(command).not.toContain('runtimes/wasm-swift');
			expect(command).not.toContain('runtimes/wasm-objectivec');
		}
	});
});
