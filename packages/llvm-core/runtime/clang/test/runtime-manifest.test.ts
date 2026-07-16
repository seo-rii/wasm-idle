import { describe, expect, it, vi } from 'vitest';

import { loadRuntimeManifest, parseRuntimeManifest } from '../src/runtime-manifest.js';

const manifestValue = {
	manifestVersion: 1,
	version: 'test',
	defaultTarget: 'wasm32-wasi',
	compiler: {
		memfs: { asset: 'bin/memfs.zip', argv0: 'memfs' },
		clang: { asset: 'bin/clang.zip', argv0: 'clang' },
		lld: { asset: 'bin/lld.zip', argv0: 'wasm-ld' },
		sysroot: { asset: 'bin/sysroot.tar.zip' },
		resourceDir: '/lib/clang/22.1.8',
		compilerRuntimeLibDir: 'lib/clang/22.1.8/lib/wasi'
	},
	clangd: {
		js: 'clangd/clangd.js',
		wasm: 'clangd/clangd.wasm.gz'
	},
	targets: {
		'wasm32-wasi': {
			artifactFormat: 'wasi-core-wasm',
			execution: { kind: 'wasi-preview1' }
		}
	}
};

describe('runtime manifest', () => {
	it('parses the runtime manifest shape', () => {
		const manifest = parseRuntimeManifest(manifestValue);

		expect(manifest.defaultTarget).toBe('wasm32-wasi');
		expect(manifest.compiler.clang.argv0).toBe('clang');
		expect(manifest.compiler.resourceDir).toBe('/lib/clang/22.1.8');
		expect(manifest.compiler.compilerRuntimeLibDir).toBe('lib/clang/22.1.8/lib/wasi');
		expect(manifest.clangd.wasm).toBe('clangd/clangd.wasm.gz');
		expect(manifest.targets['wasm32-wasi'].artifactFormat).toBe('wasi-core-wasm');
	});

	it('loads only an explicitly hosted manifest URL', async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify(manifestValue), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);

		await expect(
			loadRuntimeManifest('https://cdn.example.com/clang/v1/manifest.json', fetchImpl)
		).resolves.toEqual(parseRuntimeManifest(manifestValue));
		expect(fetchImpl).toHaveBeenCalledWith('https://cdn.example.com/clang/v1/manifest.json');
		await expect(loadRuntimeManifest(undefined as never, fetchImpl)).rejects.toThrow(
			'wasm-clang runtime manifest URL is required'
		);
		await expect(
			loadRuntimeManifest('file:///package/runtime-manifest.json', fetchImpl)
		).rejects.toThrow('wasm-clang runtime manifest URL must use HTTP(S)');
	});
});
