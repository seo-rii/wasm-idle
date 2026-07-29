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
		compilerRuntimeLibDir: 'lib/clang/22.1.8/lib/wasi',
		provenance: {
			name: 'clang',
			version: '22.1.8',
			revision: 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1'
		}
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
		expect(manifest.compiler.provenance).toEqual({
			name: 'clang',
			version: '22.1.8',
			revision: 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1'
		});
		expect(manifest.clangd.wasm).toBe('clangd/clangd.wasm.gz');
		expect(manifest.targets['wasm32-wasi'].artifactFormat).toBe('wasi-core-wasm');
	});

	it('keeps compiler provenance additive for older version 1 manifests', () => {
		const legacyValue = structuredClone(manifestValue);
		delete (legacyValue.compiler as { provenance?: unknown }).provenance;

		expect(parseRuntimeManifest(legacyValue).compiler.provenance).toBeUndefined();
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
		expect(fetchImpl).toHaveBeenCalledWith('https://cdn.example.com/clang/v1/manifest.json', {
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
		await expect(loadRuntimeManifest(undefined as never, fetchImpl)).rejects.toThrow(
			'wasm-clang runtime manifest URL is required'
		);
		await expect(
			loadRuntimeManifest('file:///package/runtime-manifest.json', fetchImpl)
		).rejects.toThrow('wasm-clang runtime manifest URL must use HTTP(S)');
	});

	it('rejects an oversized manifest before parsing its body', async () => {
		let cancelled = false;
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						pull() {
							throw new Error('body should not be read');
						},
						cancel() {
							cancelled = true;
						}
					}),
					{ headers: { 'Content-Length': String(4 * 1024 * 1024 + 1) } }
				)
		);

		await expect(
			loadRuntimeManifest('https://cdn.example.com/clang/v1/manifest.json', fetchImpl)
		).rejects.toThrow(/size exceeds the 4194304 byte limit/u);
		expect(cancelled).toBe(true);
	});
});
