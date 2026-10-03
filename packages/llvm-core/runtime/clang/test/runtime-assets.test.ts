import { describe, expect, it } from 'vitest';

import { resolveRuntimeAssetUrls } from '../src/runtime-assets.js';
import type { RuntimeManifestV1 } from '../src/types.js';

const manifest: RuntimeManifestV1 = {
	manifestVersion: 1,
	version: 'test',
	defaultTarget: 'wasm32-wasi',
	compiler: {
		memfs: { asset: 'bin/memfs.zip', argv0: 'memfs' },
		clang: { asset: 'bin/clang.zip', argv0: 'clang' },
		lld: { asset: 'bin/lld.zip', argv0: 'wasm-ld' },
		sysroot: { asset: 'bin/sysroot.tar.zip' }
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

describe('runtime asset urls', () => {
	it('defaults to native gzip compiler and sysroot assets', () => {
		const urls = resolveRuntimeAssetUrls('https://cdn.example.com/pkg/runtime');

		expect(urls.memfs).toBe('https://cdn.example.com/pkg/runtime/bin/memfs.wasm.gz');
		expect(urls.clang).toBe('https://cdn.example.com/pkg/runtime/bin/clang.wasm.gz');
		expect(urls.lld).toBe('https://cdn.example.com/pkg/runtime/bin/lld.wasm.gz');
		expect(urls.sysroot).toBe('https://cdn.example.com/pkg/runtime/bin/sysroot.tar.gz');
		expect(urls.cSysroot).toBeUndefined();
		expect(urls.cppAddon).toBeUndefined();
	});

	it('resolves externally hosted asset URLs from the runtime manifest', () => {
		const urls = resolveRuntimeAssetUrls('https://cdn.example.com/pkg/runtime', manifest);

		expect(urls.manifest).toBe('https://cdn.example.com/pkg/runtime/runtime-manifest.v1.json');
		expect(urls.memfs).toBe('https://cdn.example.com/pkg/runtime/bin/memfs.zip');
		expect(urls.clang).toBe('https://cdn.example.com/pkg/runtime/bin/clang.zip');
		expect(urls.lld).toBe('https://cdn.example.com/pkg/runtime/bin/lld.zip');
		expect(urls.sysroot).toBe('https://cdn.example.com/pkg/runtime/bin/sysroot.tar.zip');
		expect(urls.cSysroot).toBeUndefined();
		expect(urls.cppAddon).toBeUndefined();
		expect(urls.clangdJs).toBe('https://cdn.example.com/pkg/runtime/clangd/clangd.js');
		expect(urls.clangdWasm).toBe('https://cdn.example.com/pkg/runtime/clangd/clangd.wasm.gz');
	});

	it('resolves only explicitly provided C and C++ profile assets', () => {
		const profiled: RuntimeManifestV1 = {
			...manifest,
			compiler: {
				...manifest.compiler,
				sysroot: {
					...manifest.compiler.sysroot,
					profiles: {
						c: { asset: 'bin/c-sysroot.tar.gz' },
						cppAddon: { asset: 'bin/cpp-addon.tar.gz' }
					}
				}
			}
		};
		const urls = resolveRuntimeAssetUrls('https://cdn.example.com/pkg/runtime', profiled);
		expect(urls.sysroot).toBe('https://cdn.example.com/pkg/runtime/bin/sysroot.tar.zip');
		expect(urls.cSysroot).toBe('https://cdn.example.com/pkg/runtime/bin/c-sysroot.tar.gz');
		expect(urls.cppAddon).toBe('https://cdn.example.com/pkg/runtime/bin/cpp-addon.tar.gz');
		expect(() =>
			resolveRuntimeAssetUrls('https://cdn.example.com/pkg/runtime', {
				...profiled,
				compiler: {
					...profiled.compiler,
					sysroot: {
						...profiled.compiler.sysroot,
						profiles: { c: { asset: 'bin/c-sysroot.tar.gz' } }
					}
				}
			} as RuntimeManifestV1)
		).toThrow('both C and C++ add-on assets');
	});

	it('rejects omitted and package-local runtime locations', () => {
		expect(() => resolveRuntimeAssetUrls(undefined as never, manifest)).toThrow(
			'wasm-clang runtime base URL is required'
		);
		expect(() => resolveRuntimeAssetUrls(new URL('file:///package/assets/'), manifest)).toThrow(
			'wasm-clang runtime base URL must use HTTP(S)'
		);
	});

	it('resolves an explicitly hosted long double archive without requiring it from older hosts', () => {
		expect(
			resolveRuntimeAssetUrls('https://cdn.example.com/pkg/runtime', manifest)
				.printscanLongDouble
		).toBeUndefined();
		const extended = {
			...manifest,
			compiler: {
				...manifest.compiler,
				sysroot: {
					...manifest.compiler.sysroot,
					printscanLongDouble: { asset: 'libc-printscan-long-double.a.gz' }
				}
			}
		};
		expect(
			resolveRuntimeAssetUrls('https://cdn.example.com/pkg/runtime', extended)
				.printscanLongDouble
		).toBe('https://cdn.example.com/pkg/runtime/libc-printscan-long-double.a.gz');
	});
});
