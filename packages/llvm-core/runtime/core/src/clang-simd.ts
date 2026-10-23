import { CLANG_SIMD_DEFINES, CLANG_SIMD_HEADERS } from './clang-simd-headers.generated.js';

export const CLANG_SIMD_INCLUDE_PATH = 'include/wasm-idle/simd';

const simdTargetHeaderName = '__wasm_idle_simd_target.h';
// Read the compiler's final target, including options expanded from response files.
// Keep explicit user -U overrides when SIMD is enabled.
const simdTargetHeader = `#ifndef __wasm_idle_simd_target_h__
#define __wasm_idle_simd_target_h__
#ifndef __wasm_simd128__
#undef __SSE__
#undef __SSE2__
#undef __SSE3__
#undef __SSSE3__
#undef __SSE4_1__
#undef __SSE4_2__
#undef __AVX__
#undef __AVX2__
#endif
#endif
`;

interface SimdHeaderFileSystem {
	mkdirTree(path: string): void;
	writeFile(path: string, contents: Uint8Array): void;
}

function simdIncludeDirectory(root: string) {
	return `${root.replace(/\/+$/, '')}/${CLANG_SIMD_INCLUDE_PATH}`;
}

/** Driver flags for the pinned SSE through AVX2 compatibility headers. */
export function clangSimdDriverArgs(root = '') {
	const directory = simdIncludeDirectory(root);
	return [
		'-msimd128',
		...CLANG_SIMD_DEFINES,
		'-include',
		`${directory}/${simdTargetHeaderName}`,
		'-isystem',
		directory
	];
}

/** Clang's -cc1 entry point accepts target features instead of driver -m flags. */
export function clangSimdFrontendArgs(root = '') {
	const directory = simdIncludeDirectory(root);
	return [
		'-target-feature',
		'+simd128',
		...CLANG_SIMD_DEFINES,
		'-include',
		`${directory}/${simdTargetHeaderName}`,
		'-internal-isystem',
		directory
	];
}

/** Keep the SDK's native x86 headers intact beneath its original resource directory. */
export function installClangSimdHeaders(fs: SimdHeaderFileSystem, root = '') {
	const directory = simdIncludeDirectory(root);
	// MemFS creates one directory at a time; other hosts accept an entire tree.
	const parts = directory.split('/').filter(Boolean);
	for (let count = 1; count <= parts.length; count++) {
		fs.mkdirTree(`${directory.startsWith('/') ? '/' : ''}${parts.slice(0, count).join('/')}`);
	}
	const encoder = new TextEncoder();
	fs.mkdirTree(`${directory}/emscripten`);
	for (const [name, contents] of Object.entries(CLANG_SIMD_HEADERS)) {
		const installedName = name === 'xmmintrin.h' ? `emscripten/${name}` : name;
		fs.writeFile(`${directory}/${installedName}`, encoder.encode(contents));
	}
	// Preserve upstream SIMD sources while replacing Emscripten's memalign macros
	// with Clang's portable allocator, which uses WASI's posix_memalign.
	fs.writeFile(
		`${directory}/xmmintrin.h`,
		encoder.encode(`#ifndef __wasm_idle_xmmintrin_h__
#define __wasm_idle_xmmintrin_h__
#include "emscripten/xmmintrin.h"
#undef _mm_malloc
#undef _mm_free
#include <mm_malloc.h>
#endif
`)
	);
	fs.writeFile(`${directory}/${simdTargetHeaderName}`, encoder.encode(simdTargetHeader));
}
