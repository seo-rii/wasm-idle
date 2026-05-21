import { describe, expect, it } from 'vitest';

import { parseRuntimeManifest } from '../src/runtime-manifest.js';

describe('runtime manifest', () => {
	it('parses the packaged runtime manifest shape', () => {
		const manifest = parseRuntimeManifest({
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
		});

		expect(manifest.defaultTarget).toBe('wasm32-wasi');
		expect(manifest.compiler.clang.argv0).toBe('clang');
		expect(manifest.clangd.wasm).toBe('clangd/clangd.wasm.gz');
		expect(manifest.targets['wasm32-wasi'].artifactFormat).toBe('wasi-core-wasm');
	});
});
