import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtimeOptions = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('../../clang/src/index.js', async () => ({
	...(await import('../../clang/src/runtime-manifest.js')),
	...(await import('../../clang/src/url.js')),
	BrowserClangRuntime: class {
		ready = Promise.resolve();
		memfs = { addDirectory() {}, addFile() {} };
		constructor(options: Record<string, unknown>) {
			runtimeOptions.push(options);
		}
	},
	executeBrowserClangArtifact: vi.fn()
}));

import { createVCompiler, V_LLVM_PROFILE } from '../../v/src/index.js';
import { createCobolCompiler, COBOL_LLVM_PROFILE } from '../../cobol/src/index.js';

const emptyWasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const clangManifest = {
	manifestVersion: 1,
	version: 'fetch-provider-test',
	defaultTarget: 'wasm32-wasi',
	clangd: { js: 'clangd.js', wasm: 'clangd.wasm.gz' },
	compiler: {
		memfs: { asset: 'memfs.wasm.gz', argv0: 'memfs' },
		clang: { asset: 'clang.wasm.gz', argv0: 'clang' },
		lld: { asset: 'lld.wasm.gz', argv0: 'wasm-ld' },
		sysroot: { asset: 'sysroot.tar.gz' }
	},
	targets: {
		'wasm32-wasi': { artifactFormat: 'wasi-core-wasm', execution: { kind: 'wasi-preview1' } }
	}
};

function tarFile(name: string) {
	const header = Buffer.alloc(512);
	header.write(name);
	header.write('0000644\0', 100);
	header.write('0000000\0', 108);
	header.write('0000000\0', 116);
	header.write('00000000001\0', 124);
	header.write('00000000000\0', 136);
	header.fill(32, 148, 156);
	header[156] = 48;
	header.write('ustar\0', 257);
	header.write('00', 263);
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
	return Buffer.concat([header, Buffer.from('x'), Buffer.alloc(511 + 1024)]);
}

afterEach(() => {
	vi.unstubAllGlobals();
	runtimeOptions.length = 0;
});

describe('language compiler fetch providers', () => {
	it.each(['v', 'cobol'] as const)(
		'uses the %s provider for manifests, frontend and rootfs',
		async (language) => {
			const base = `https://provider.test/${language}/`;
			const frontend = language === 'v' ? 'v.wasm.gz' : 'cobc.wasm.gz';
			const rootfs = language === 'v' ? 'vroot.tar.gz' : 'rootfs.tar.gz';
			const manifest = {
				manifestVersion: 1,
				version: 'provider-test',
				frontend: { asset: frontend, argv0: language },
				rootfs: { asset: rootfs },
				cSysroot: { asset: 'c-sysroot.tar.gz' },
				profile: language === 'v' ? V_LLVM_PROFILE : COBOL_LLVM_PROFILE
			};
			const globalFetch = vi.fn(() => {
				throw new Error('custom provider was bypassed');
			});
			vi.stubGlobal('fetch', globalFetch);
			const fetchImpl = vi.fn<typeof fetch>(async (input) => {
				const url = new URL(input.toString());
				if (url.pathname.endsWith('.json')) {
					return new Response(
						JSON.stringify(url.href.startsWith(base) ? manifest : clangManifest)
					);
				}
				if (url.pathname.endsWith(frontend)) return new Response(gzipSync(emptyWasm));
				if (url.pathname.endsWith(rootfs)) {
					return new Response(
						gzipSync(
							tarFile(
								language === 'v'
									? 'v/vlib/builtin/builtin.v'
									: 'share/gnucobol/default.conf'
							)
						)
					);
				}
				throw new Error(`Unexpected fetch: ${url}`);
			});
			const create = language === 'v' ? createVCompiler : createCobolCompiler;
			await create({
				runtimeBaseUrl: base,
				clangRuntimeBaseUrl: 'https://provider.test/clang/',
				fetchImpl
			});
			expect(fetchImpl.mock.calls.map(([input]) => input.toString()).sort()).toEqual(
				[
					`${base}runtime-manifest.v1.json`,
					`${base}${frontend}`,
					`${base}${rootfs}`,
					'https://provider.test/clang/runtime-manifest.v1.json'
				].sort()
			);
			expect(runtimeOptions[0]?.fetchImpl).toBe(fetchImpl);
			expect(globalFetch).not.toHaveBeenCalled();
		}
	);
});
