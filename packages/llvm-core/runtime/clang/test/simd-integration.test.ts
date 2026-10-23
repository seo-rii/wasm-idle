// @vitest-environment node
import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { compileClang } from '../src/compiler.js';
import { executeBrowserClangArtifact } from '../src/browser-execution.js';

const read = promisify(readFile);
const root = new URL('../../../../../', import.meta.url);
const source = readFileSync(new URL('scripts/fixtures/clang-simd.c', root), 'utf8');
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
	}
);
