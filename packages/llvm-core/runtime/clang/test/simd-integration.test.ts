// @vitest-environment node
import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { compileClang } from '../src/compiler.js';
import { executeBrowserClangArtifact } from '../src/browser-execution.js';

const read = promisify(readFile);
const root = new URL('../../../../../', import.meta.url);
const source = readFileSync(new URL('scripts/fixtures/clang-simd.c', root), 'utf8');
const targetSource = readFileSync(new URL('scripts/fixtures/clang-simd-target.c', root), 'utf8');
const fetchAssets: typeof fetch = async (input) => {
	const url = new URL(input instanceof Request ? input.url : input);
	if (url.origin !== 'http://wasm-idle.test' || !url.pathname.startsWith('/clang/')) {
		throw new Error(`Unexpected SIMD test asset: ${url}`);
	}
	const bytes = await read(new URL(`static${url.pathname}`, root));
	return new Response(bytes, { headers: { 'Content-Length': String(bytes.byteLength) } });
};

describe.skipIf(process.env.WASM_IDLE_RUN_REAL_CLANG_SIMD !== '1')(
	'real Wasm SIMD compiler',
	() => {
		it.each(['C', 'CPP'] as const)(
			'compiles and runs %s SSE/AVX2 and Wasm intrinsics without user flags',
			{ timeout: 180_000 },
			async (language) => {
				const result = await compileClang(
					{ code: source, language },
					{
						runtimeBaseUrl: 'http://wasm-idle.test/clang/',
						fetchImpl: fetchAssets
					}
				);
				expect(result.success, result.stderr).toBe(true);
				if (!result.artifact) throw new Error('Missing compiled SIMD artifact');
				// The real compiler must emit SIMD, rather than fold a constant example away.
				const features = WebAssembly.Module.customSections(
					result.artifact.wasm!,
					'target_features'
				);
				expect(
					features.some((bytes) => new TextDecoder().decode(bytes).includes('simd128'))
				).toBe(true);
				for (const n of [17, -13]) {
					let consumed = false;
					const execution = await executeBrowserClangArtifact(result.artifact, {
						stdin: () => {
							if (consumed) return null;
							consumed = true;
							return `${n}\n`;
						}
					});
					expect(execution.exitCode, execution.stderr).toBe(0);
					expect(execution.stdout).toBe(
						`simd=${n} sse=${n + 5} avx2=${(n + 7) * 4} wasm=${n + 3}\n`
					);
					expect(execution.stderr).toBe('');
				}
			}
		);

		it.each(['C', 'CPP'] as const)(
			'provides WASI aligned allocation through the %s intrinsic headers',
			{ timeout: 180_000 },
			async (language) => {
				const code = `#include <xmmintrin.h>
#include <immintrin.h>
int main(void) {
    for (size_t size = 1; size <= 33; size += 16) {
        for (size_t alignment = 1; alignment <= 64; alignment *= 2) {
            unsigned char *memory = (unsigned char *)_mm_malloc(size, alignment);
            if (!memory || ((size_t)memory % alignment)) return 1;
            memory[0] = 42;
            memory[size - 1] = 73;
            if (memory[size - 1] != 73) return 2;
            _mm_free(memory);
        }
    }
    _mm_free((void *)0);
    if (_mm_malloc(17, 3) != (void *)0) return 3;
    if (_mm_malloc(17, 6) != (void *)0) return 4;
    return 0;
}`;
				const result = await compileClang(
					{ code, language },
					{ runtimeBaseUrl: 'http://wasm-idle.test/clang/', fetchImpl: fetchAssets }
				);
				expect(result.success, result.stderr).toBe(true);
				if (!result.artifact) throw new Error('Missing aligned allocation artifact');
				const execution = await executeBrowserClangArtifact(result.artifact);
				expect(execution.exitCode, execution.stderr).toBe(0);
				expect(execution.stderr).toBe('');
			}
		);

		it.each(['C', 'CPP'] as const)(
			'uses the final %s target features and preserves explicit macro overrides',
			{ timeout: 180_000 },
			async (language) => {
				const cases = [
					{ name: 'default', compileArgs: [], path: 'simd' },
					{
						name: 'disabled',
						compileArgs: ['-target-feature', '-simd128'],
						path: 'scalar'
					},
					{
						name: 'enabled then disabled',
						compileArgs: ['-target-feature', '+simd128', '-target-feature', '-simd128'],
						path: 'scalar'
					},
					{
						name: 'disabled then enabled',
						compileArgs: ['-target-feature', '-simd128', '-target-feature', '+simd128'],
						path: 'simd'
					},
					{ name: 'user macro override', compileArgs: ['-U__SSE2__'], path: 'scalar' },
					{ name: 'response file', compileArgs: ['@scalar.rsp'], path: 'scalar' }
				];
				for (const testCase of cases) {
					const result = await compileClang(
						{
							code: targetSource,
							language,
							compileArgs: testCase.compileArgs,
							workspaceFiles: [
								{ path: 'scalar.rsp', content: '-target-feature -simd128' }
							]
						},
						{ runtimeBaseUrl: 'http://wasm-idle.test/clang/', fetchImpl: fetchAssets }
					);
					expect(result.success, `${testCase.name}: ${result.stderr}`).toBe(true);
					if (!result.artifact) throw new Error(`Missing ${testCase.name} artifact`);
					let consumed = false;
					const execution = await executeBrowserClangArtifact(result.artifact, {
						stdin: () => {
							if (consumed) return null;
							consumed = true;
							return '17\n';
						}
					});
					expect(execution.exitCode, `${testCase.name}: ${execution.stderr}`).toBe(0);
					expect(execution.stdout, testCase.name).toBe(
						`path=${testCase.path} value=22\n`
					);
					expect(execution.stderr, testCase.name).toBe('');
				}
			}
		);
	}
);
