import { afterEach, describe, expect, it, vi } from 'vitest';
import ArtifactRuntime from '../src/artifact-runtime.js';
import Runtime from '../src/runtime.js';
import {
	executeBrowserClangArtifact,
	type BrowserExecutionImportContext
} from '../src/browser-execution.js';
import { assertWasmMemoryLimit, resolveWasmMemoryLimit } from '../src/memory-limit.js';

const page = 65536;
afterEach(() => vi.restoreAllMocks());

// A real core module whose _start grows its exported memory by one page.
function moduleBytes(maximum?: number) {
	const memory = maximum === undefined ? [1, 0, 1] : [1, 1, 1, maximum];
	return Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		1,
		4,
		1,
		96,
		0,
		0,
		3,
		2,
		1,
		0,
		5,
		memory.length,
		...memory,
		7,
		19,
		2,
		6,
		109,
		101,
		109,
		111,
		114,
		121,
		2,
		0,
		6,
		95,
		115,
		116,
		97,
		114,
		116,
		0,
		0,
		10,
		9,
		1,
		7,
		0,
		65,
		1,
		64,
		0,
		26,
		11
	]);
}

describe('native guest Wasm memory ceilings', () => {
	it('passes a page-aligned ceiling to the real linker invocation and invalidates its build cache', async () => {
		const invoke = vi.spyOn(Runtime.prototype, 'run').mockResolvedValue(null);
		const bytes = moduleBytes(2);
		const runtime = Object.assign(Object.create(ArtifactRuntime.prototype), {
			ready: Promise.resolve(),
			stdout: vi.fn(),
			log: false,
			lastBuildKey: '',
			assetUrls: { clang: 'clang', lld: 'lld' },
			memfs: {
				addDirectory: vi.fn(),
				addFile: vi.fn(),
				hasFile: vi.fn(() => false),
				getFileContents: () => bytes
			},
			getModule: vi.fn(async () => WebAssembly.compile(bytes)),
			compile: vi.fn(async () => null),
			prepareLongDoubleLinkArgs: vi.fn(async () => []),
			hostLogAsync: async (_label: string, operation: Promise<unknown>) => operation
		}) as ArtifactRuntime;
		await runtime.compileArtifact('int main(void) { return 0; }', {
			language: 'C',
			maxWasmMemoryBytes: page * 2 + 100
		});
		expect(invoke.mock.calls[0]).toContain(`--max-memory=${page * 2}`);
		await runtime.compileArtifact('int main(void) { return 0; }', {
			language: 'C',
			maxWasmMemoryBytes: page * 3
		});
		expect(invoke).toHaveBeenCalledTimes(2);
		expect(invoke.mock.calls[1]).toContain(`--max-memory=${page * 3}`);
	});

	it('rounds down to complete pages and rejects sub-page or invalid ceilings', () => {
		expect(resolveWasmMemoryLimit(page * 2 + 100)).toBe(page * 2);
		expect(resolveWasmMemoryLimit(undefined)).toBeUndefined();
		for (const bytes of [1, page - 1, NaN, Infinity, -page, 1.5]) {
			expect(() => resolveWasmMemoryLimit(bytes)).toThrow(/at least one/);
		}
	});

	it('rejects an unbounded or larger memory declaration before instantiation', async () => {
		for (const bytes of [moduleBytes(), moduleBytes(3)]) {
			await expect(
				executeBrowserClangArtifact(
					{
						bytes,
						target: 'wasm32-wasi',
						format: 'wasi-core-wasm'
					},
					{ maxWasmMemoryBytes: page * 2 }
				)
			).rejects.toMatchObject({ code: 'runtime-configuration' });
		}
		expect(() => assertWasmMemoryLimit(moduleBytes(2).slice(0, 23), page * 2)).toThrow();
	});

	it('runs real Wasm and prevents growth beyond the ceiling even with a mismatched cached Module', async () => {
		let ref: BrowserExecutionImportContext['instance'] | undefined;
		const bytes = moduleBytes(2);
		const unbounded = await WebAssembly.compile(moduleBytes());
		const result = await executeBrowserClangArtifact(
			{
				bytes,
				wasm: unbounded,
				target: 'wasm32-wasi',
				format: 'wasi-core-wasm'
			},
			{
				maxWasmMemoryBytes: page * 2,
				extraImports: ({ instance }) => {
					ref = instance;
					return {};
				}
			}
		);
		expect(result.exitCode).toBe(0);
		const memory = ref!.current!.exports.memory as WebAssembly.Memory;
		expect(memory.buffer.byteLength).toBe(page * 2);
		expect(() => memory.grow(1)).toThrow(RangeError);
	});
});
