import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
	CLANG_SIMD_DEFINES,
	CLANG_SIMD_HEADER_PROVENANCE,
	CLANG_SIMD_HEADERS,
	CLANG_SIMD_WASM_HEADER_PROVENANCE
} from '../src/clang-simd-headers.generated.js';
import { CLANG_RESOURCE_HEADER_PROVENANCE } from '../src/clang-resource-headers.js';
import {
	CLANG_SIMD_INCLUDE_PATH,
	clangSimdDriverArgs,
	clangSimdFrontendArgs,
	installClangSimdHeaders
} from '../src/clang-simd.js';

const root = new URL('../../../../../', import.meta.url);
const lock = JSON.parse(
	readFileSync(new URL('scripts/clang-simd-headers.lock.json', root), 'utf8')
);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const expectedDefines = [
	'-D__SSE__=1',
	'-D__SSE2__=1',
	'-D__SSE3__=1',
	'-D__SSSE3__=1',
	'-D__SSE4_1__=1',
	'-D__SSE4_2__=1',
	'-D__AVX__=1',
	'-D__AVX2__=1'
];
const expectedHeaders = [
	'immintrin.h',
	'xmmintrin.h',
	'emmintrin.h',
	'pmmintrin.h',
	'tmmintrin.h',
	'smmintrin.h',
	'nmmintrin.h',
	'avxintrin.h',
	'avx2intrin.h',
	'wasm_simd128.h',
	'mm_malloc.h'
];

describe('pinned WebAssembly SIMD compatibility headers', () => {
	it('keeps the selected headers and license byte-exact to immutable Emscripten source receipts', () => {
		expect(lock.format).toBe('wasm-idle-clang-simd-headers-v1');
		expect(CLANG_SIMD_HEADER_PROVENANCE).toEqual({
			name: 'emscripten',
			version: lock.version,
			revision: lock.revision
		});
		expect(lock.baseUrl).toBe(
			`https://raw.githubusercontent.com/emscripten-core/emscripten/${lock.revision}/`
		);
		expect(lock.revision).toMatch(/^[0-9a-f]{40}$/);
		expect(Object.keys(CLANG_SIMD_HEADERS)).toEqual(expectedHeaders);
		expect(lock.headers.map((entry: { path: string }) => entry.path)).toEqual(
			expectedHeaders.slice(0, -2)
		);
		for (const entry of lock.headers) {
			const bytes = Buffer.from(CLANG_SIMD_HEADERS[entry.path]);
			expect(entry.source).toBe(`system/include/compat/${entry.path}`);
			expect(bytes.byteLength, entry.path).toBe(entry.bytes);
			expect(sha256(bytes), entry.path).toBe(entry.sha256);
		}
		const dependency = lock.llvmDependency;
		expect(CLANG_SIMD_WASM_HEADER_PROVENANCE).toEqual(CLANG_RESOURCE_HEADER_PROVENANCE);
		expect(CLANG_SIMD_WASM_HEADER_PROVENANCE).toEqual({
			name: dependency.name,
			version: dependency.version,
			revision: dependency.revision
		});
		expect(dependency.baseUrl).toBe(
			`https://raw.githubusercontent.com/llvm/llvm-project/${dependency.revision}/`
		);
		expect(dependency.headers.map((entry: { path: string }) => entry.path)).toEqual(
			expectedHeaders.slice(-2)
		);
		for (const entry of dependency.headers) {
			expect(entry.source).toBe(`clang/lib/Headers/${entry.path}`);
			const bytes = Buffer.from(CLANG_SIMD_HEADERS[entry.path]);
			expect(bytes.byteLength, entry.path).toBe(entry.bytes);
			expect(sha256(bytes), entry.path).toBe(entry.sha256);
		}
		const license = readFileSync(new URL('packages/llvm-core/LICENSE.emscripten.txt', root));
		expect(license.byteLength).toBe(lock.license.bytes);
		expect(sha256(license)).toBe(lock.license.sha256);
	});

	it('limits transitive header dependencies to the selected pack and standard WASI headers', () => {
		const available = new Set([
			...expectedHeaders,
			'stdbool.h',
			'stdint.h',
			'limits.h',
			'math.h',
			'string.h',
			'stdlib.h'
		]);
		for (const [name, contents] of Object.entries(CLANG_SIMD_HEADERS)) {
			for (const match of contents.matchAll(/^#\s*include\s+[<"]([^>"]+)[>"]/gm)) {
				if (name === 'mm_malloc.h' && match[1] === 'malloc.h') {
					// This dependency belongs only to the allocator's Windows branch.
					expect(contents).toContain('#ifdef _WIN32\n#include <malloc.h>\n#else');
					continue;
				}
				expect(available.has(match[1]), `${name} requires ${match[1]}`).toBe(true);
			}
		}
	});

	it('uses the Emscripten SSE through AVX2 feature tower with actual WebAssembly SIMD enabled', () => {
		expect(lock.compilerFlags.source).toBe('tools/compile.py');
		expect(lock.defines).toEqual(expectedDefines);
		expect(CLANG_SIMD_DEFINES).toEqual(expectedDefines);
		expect(clangSimdDriverArgs()).toEqual([
			'-msimd128',
			...expectedDefines,
			'-isystem',
			`/${CLANG_SIMD_INCLUDE_PATH}`
		]);
		expect(clangSimdFrontendArgs()).toEqual([
			'-target-feature',
			'+simd128',
			...expectedDefines,
			'-internal-isystem',
			`/${CLANG_SIMD_INCLUDE_PATH}`
		]);
	});

	it.each(['', '/', '/sysroot', '/sysroot/'])(
		'installs sources in the same dedicated directory used by both compiler entry points: %j',
		(mountRoot) => {
			const nativePath = '/lib/clang/22/include/immintrin.h';
			const nativeHeader = Buffer.from('original SDK header');
			const files = new Map<string, Uint8Array>([[nativePath, nativeHeader]]);
			const directories = new Set(['']);
			const fs = {
				mkdirTree: vi.fn((path: string) => {
					expect(directories.has(path.slice(0, path.lastIndexOf('/')))).toBe(true);
					directories.add(path);
				}),
				writeFile: vi.fn((path: string, contents: Uint8Array) => {
					expect(directories.has(path.slice(0, path.lastIndexOf('/')))).toBe(true);
					files.set(path, contents);
				})
			};
			installClangSimdHeaders(fs, mountRoot);
			const directory = `${mountRoot.replace(/\/+$/, '')}/${CLANG_SIMD_INCLUDE_PATH}`;
			expect(fs.mkdirTree).toHaveBeenCalledWith(directory);
			expect(clangSimdDriverArgs(mountRoot).at(-1)).toBe(directory);
			expect(clangSimdFrontendArgs(mountRoot).at(-1)).toBe(directory);
			expect(fs.writeFile).toHaveBeenCalledTimes(expectedHeaders.length + 1);
			for (const name of expectedHeaders) {
				const installedName = name === 'xmmintrin.h' ? `emscripten/${name}` : name;
				expect(files.get(`${directory}/${installedName}`)).toEqual(
					new TextEncoder().encode(CLANG_SIMD_HEADERS[name])
				);
			}
			const publicHeader = new TextDecoder().decode(files.get(`${directory}/xmmintrin.h`));
			expect(publicHeader).toMatch(
				/#include "emscripten\/xmmintrin.h"\s+#undef _mm_malloc\s+#undef _mm_free\s+#include <mm_malloc.h>/
			);
			expect(files.get(nativePath)).toBe(nativeHeader);
		}
	);
});
