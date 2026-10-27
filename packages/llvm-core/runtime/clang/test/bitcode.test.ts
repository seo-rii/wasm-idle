import { describe, expect, it, vi } from 'vitest';
import Runtime from '../src/runtime.js';

const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const bc = new Uint8Array([0x42, 0x43, 0xc0, 0xde]);
function harness() {
	const files = new Map<string, Uint8Array>();
	const runtime = Object.assign(Object.create(Runtime.prototype), {
		ready: Promise.resolve(),
		log: false,
		assetUrls: { clang: 'clang', lld: 'lld' },
		compilerConfig: { compilerRuntimeLibDir: 'lib/clang/22/lib/wasi' },
		memfs: {
			addDirectory: vi.fn(),
			addFile: vi.fn((path: string, bytes: Uint8Array) => files.set(path, bytes)),
			getFileContents: (path: string) => files.get(path) || new Uint8Array()
		},
		getModule: vi.fn(async (name: string) => name),
		run: vi.fn(async (_module: unknown, _log: boolean, command: string, ...args: string[]) => {
			files.set(args[args.indexOf('-o') + 1], command === 'clang' ? bc : wasm);
		})
	}) as unknown as Runtime;
	return { runtime, files };
}

describe('frontend-owned LLVM bitcode entry points', () => {
	it('lowers all frontend/runtime modules and links WASI libraries without a duplicate C entry point', async () => {
		const { runtime } = harness();
		const result = await runtime.compileBitcodeArtifact([bc, bc]);
		expect(result).toEqual(wasm);
		expect(result).not.toBe(wasm);
		const calls = vi.mocked(runtime.run).mock.calls;
		expect(calls).toHaveLength(3);
		for (const call of calls.slice(0, 2)) {
			expect(call.slice(2)).toEqual(
				expect.arrayContaining([
					'clang',
					'-cc1',
					'-triple',
					'wasm32-unknown-wasip1',
					'-emit-obj',
					'-x',
					'ir',
					'-O0'
				])
			);
		}
		const linker = calls[2].slice(2);
		expect(
			linker.filter((argument) => typeof argument === 'string' && argument.endsWith('.o'))
		).toEqual(['__wasm_idle_build/bitcode/0.o', '__wasm_idle_build/bitcode/1.o']);
		expect(linker).toEqual(
			expect.arrayContaining([
				'stack-size=1048576',
				'-lc',
				'-lm',
				'-Llib/clang/22/lib/wasi',
				'-lclang_rt.builtins-wasm32'
			])
		);
		expect(linker.join(' ')).not.toMatch(/crt1|allow-undefined|strip|libc\+\+/u);
	});

	it('preserves a frontend-owned 16 MiB stack while retaining the Wasm memory limit', async () => {
		const { runtime } = harness();
		await runtime.compileBitcodeArtifact(bc, {
			stackSizeBytes: 16 * 1024 * 1024,
			maxWasmMemoryBytes: 128 * 1024 * 1024
		});
		expect(vi.mocked(runtime.run).mock.calls.at(-1)).toEqual(
			expect.arrayContaining(['stack-size=16777216', '--max-memory=134217728'])
		);
	});

	it.each([0, -16, 1, 17, 1.5, NaN, Infinity, 2 ** 32, Number.MAX_SAFE_INTEGER])(
		'rejects an invalid wasm32 stack size before invoking tools: %s',
		async (stackSizeBytes) => {
			const { runtime } = harness();
			await expect(runtime.compileBitcodeArtifact(bc, { stackSizeBytes })).rejects.toThrow(
				'stack size'
			);
			expect(runtime.getModule).not.toHaveBeenCalled();
			expect(runtime.run).not.toHaveBeenCalled();
		}
	);

	it('checks the stack against the page-rounded memory limit and releases the compilation guard', async () => {
		const { runtime } = harness();
		await expect(
			runtime.compileBitcodeArtifact(bc, {
				stackSizeBytes: 1024 * 1024 + 16,
				maxWasmMemoryBytes: 1024 * 1024 + 1
			})
		).rejects.toThrow('stack size exceeds the Wasm memory limit');
		expect(runtime.run).not.toHaveBeenCalled();
		await expect(
			runtime.compileBitcodeArtifact(bc, {
				stackSizeBytes: 1024 * 1024,
				maxWasmMemoryBytes: 1024 * 1024
			})
		).resolves.toEqual(wasm);
	});

	it('clears stale object and Wasm outputs before reusing the runtime', async () => {
		const { runtime, files } = harness();
		await runtime.compileBitcodeArtifact(bc);
		vi.mocked(runtime.run).mockImplementation(async () => undefined);
		await expect(runtime.compileBitcodeArtifact(bc)).rejects.toThrow('did not emit an object');
		expect(files.get('__wasm_idle_build/bitcode/0.o')).toHaveLength(0);
	});

	it('does not return an earlier Wasm module when the linker fails to write output', async () => {
		const { runtime } = harness();
		await runtime.compileBitcodeArtifact(bc);
		const run = vi.mocked(runtime.run).getMockImplementation()!;
		vi.mocked(runtime.run).mockImplementation(async (...args) => {
			if (args[2] === 'clang') return run(...args);
		});
		await expect(runtime.compileBitcodeArtifact(bc)).rejects.toThrow('LLD did not emit');
	});

	it('rejects overlapping calls on the mutable runtime and releases the guard on completion', async () => {
		const { runtime } = harness();
		let resolve!: () => void;
		runtime.ready = new Promise<void>((done) => {
			resolve = done;
		});
		const first = runtime.compileBitcodeArtifact(bc);
		await expect(runtime.compileBitcodeArtifact(bc)).rejects.toThrow('Concurrent LLVM bitcode');
		resolve();
		await first;
		await expect(runtime.compileBitcodeArtifact(bc)).resolves.toEqual(wasm);
	});

	it('adds a validated Wasm memory limit to the no-CRT link', async () => {
		const { runtime } = harness();
		await runtime.compileBitcodeArtifact(bc, { maxWasmMemoryBytes: 128 * 1024 * 1024 });
		expect(vi.mocked(runtime.run).mock.calls.at(-1)).toContain('--max-memory=134217728');
		await expect(runtime.compileBitcodeArtifact(bc, { maxWasmMemoryBytes: 1 })).rejects.toThrow(
			'64 KiB'
		);
	});

	it.each([{ inputs: [] }, { inputs: [new Uint8Array()] }])(
		'rejects absent frontend IR: $inputs',
		async ({ inputs }) => {
			const { runtime } = harness();
			await expect(runtime.compileBitcodeArtifact(inputs)).rejects.toThrow(
				'nonempty LLVM bitcode'
			);
			expect(runtime.run).not.toHaveBeenCalled();
		}
	);
});
