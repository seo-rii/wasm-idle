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
	it('resolves packaged asset URLs from the runtime manifest', () => {
		const urls = resolveRuntimeAssetUrls('https://cdn.example.com/pkg/runtime', manifest);

		expect(urls.manifest).toBe('https://cdn.example.com/pkg/runtime/runtime-manifest.v1.json');
		expect(urls.memfs).toBe('https://cdn.example.com/pkg/runtime/bin/memfs.zip');
		expect(urls.clang).toBe('https://cdn.example.com/pkg/runtime/bin/clang.zip');
		expect(urls.lld).toBe('https://cdn.example.com/pkg/runtime/bin/lld.zip');
		expect(urls.sysroot).toBe('https://cdn.example.com/pkg/runtime/bin/sysroot.tar.zip');
		expect(urls.clangdJs).toBe('https://cdn.example.com/pkg/runtime/clangd/clangd.js');
		expect(urls.clangdWasm).toBe('https://cdn.example.com/pkg/runtime/clangd/clangd.wasm.gz');
	});
});
