import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCrossGccCompiler } from '../src/compiler.js';
import { parseCrossGccManifest } from '../src/manifest.js';

const host = vi.hoisted(() => ({
	calls: [] as { tool: string; argv: string[]; files: Map<string, Uint8Array> }[],
	mode: ''
}));

/** Deliberately synthetic host fixture. It does not compile C/C++ or validate GCC semantics. */
vi.mock('../src/module-loader.js', () => ({
	loadGccModuleFactory: vi.fn(async (source: Uint8Array) => ({
		revoke: vi.fn(),
		factory: async (options: Record<string, unknown>) => {
			const tool = new TextDecoder().decode(source).replace('synthetic-fixture:', '');
			// Real binutils Emscripten loaders retain their pre-package names.
			(options.locateFile as Function)(
				`${tool}${tool === 'as' || tool === 'ld' ? '-new' : ''}.wasm`
			);
			const files = new Map<string, Uint8Array>();
			let instance: WebAssembly.Instance;
			(options.instantiateWasm as Function)({}, (value: WebAssembly.Instance) => {
				instance = value;
			});
			return {
				HEAPU8: new Uint8Array((instance!.exports.memory as WebAssembly.Memory).buffer),
				FS: {
					mkdirTree() {},
					chdir() {},
					writeFile(path: string, bytes: Uint8Array) {
						files.set(path, Uint8Array.from(bytes));
					},
					readFile(path: string) {
						if (!files.has(path)) throw new Error('fixture output missing');
						return files.get(path)!;
					}
				},
				callMain(argv: string[]) {
					host.calls.push({ tool, argv, files });
					(options.print as Function)(`${tool} fixture stdout`);
					if (host.mode === 'diagnostics')
						(options.printErr as Function)('x'.repeat(4 * 1024 * 1024));
					const source = [...files.entries()].find(([path]) =>
						/^\/workspace\/main\./u.test(path)
					)?.[1];
					if (source?.[0] === 33 || host.mode === `fail-${tool}`) {
						(options.printErr as Function)('synthetic failure');
						return 9;
					}
					if (host.mode === 'no-output') return 0;
					const output = argv[argv.indexOf('-o') + 1];
					files.set(
						output,
						tool.startsWith('cc1')
							? new TextEncoder().encode(
									'# Synthetic assembly fixture, not GCC output\n.text\n'
								)
							: elf(
									tool === 'as' ? 1 : 2,
									host.mode === 'wrong-machine' ? 183 : 62,
									host.mode === 'dynamic'
								)
					);
					if (host.mode === 'exit-status') throw { name: 'ExitStatus', status: 0 };
					return 0;
				}
			};
		}
	}))
}));

const encoder = new TextEncoder();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Only exports a memory. Using this proves host-Wasm/ELF separation, not GCC compilation.
const wasm = Uint8Array.from([
	0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0
]);

function elf(type: number, machine = 62, dynamic = false) {
	const bytes = new Uint8Array(type === 1 ? 64 : 120),
		view = new DataView(bytes.buffer);
	bytes.set([0x7f, 69, 76, 70, 2, 1, 1]);
	view.setUint16(16, type, true);
	view.setUint16(18, machine, true);
	view.setUint32(20, 1, true);
	view.setUint16(52, 64, true);
	if (type === 2) {
		view.setBigUint64(32, 64n, true);
		view.setUint16(54, 56, true);
		view.setUint16(56, 1, true);
		view.setUint32(64, dynamic ? 3 : 1, true);
	}
	return bytes;
}

function tar(path = 'usr/include/stdio.h') {
	const bytes = new Uint8Array(2048);
	bytes.set(encoder.encode(path));
	for (const offset of [100, 108, 116]) bytes.set(encoder.encode('0000000\0'), offset);
	bytes.set(encoder.encode('00000000000\0'), 136);
	bytes.set(encoder.encode('00000000001\0'), 124);
	bytes[156] = 48;
	bytes.set(encoder.encode('ustar\0'), 257);
	bytes[512] = 10;
	bytes.fill(32, 148, 156);
	const checksum = bytes.subarray(0, 512).reduce((sum, value) => sum + value, 0);
	bytes.set(encoder.encode(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
	return bytes;
}

function bundle(archivePath?: string) {
	const files = new Map<string, Uint8Array>([['sysroot.tar', tar(archivePath)]]);
	for (const tool of ['cc1', 'cc1plus', 'as', 'ld']) {
		files.set(`${tool}.mjs`, encoder.encode(`synthetic-fixture:${tool}`));
		files.set(`${tool}.wasm`, Uint8Array.from(wasm));
	}
	const assets = Object.fromEntries(
		[...files].map(([path, bytes]) => [
			path === 'sysroot.tar'
				? 'sysroot'
				: path.replace('.mjs', 'Js').replace('.wasm', 'Wasm'),
			{ path, sha256: hash(bytes), bytes: bytes.length }
		])
	);
	const manifest = {
		schemaVersion: 1,
		kind: 'gcc-x86_64-linux-gnu',
		host: 'wasm32-emscripten',
		target: 'x86_64-linux-gnu',
		compiler: { family: 'gcc', version: '13.3.0' },
		cpuProfiles: ['x86-64', 'avx2-fma'],
		linkMode: 'static',
		sysrootPath: '/sysroot',
		gccInstallation: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/13',
		resourceDir: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/13/include',
		assets,
		gnu: { gccVersion: '13', glibcVersion: '2.39', distribution: 'Synthetic test fixture' },
		qualification: { status: 'unverified' }
	};
	const manifestBytes = encoder.encode(JSON.stringify(manifest));
	files.set('gcc-toolchain.v1.json', manifestBytes);
	const fetchImpl = vi.fn(async (url: string | URL | Request) => {
		const bytes = files.get(new URL(String(url)).pathname.split('/').at(-1)!);
		return bytes ? new Response(Uint8Array.from(bytes)) : new Response(null, { status: 404 });
	}) as unknown as typeof fetch;
	return {
		manifest,
		files,
		options: {
			manifestUrl: 'https://example.test/gcc/gcc-toolchain.v1.json',
			manifestSha256: hash(manifestBytes),
			fetchImpl
		}
	};
}

beforeEach(() => {
	host.calls.length = 0;
	host.mode = '';
});
afterEach(() => vi.restoreAllMocks());

describe('synthetic GCC host contract (not real compiler qualification)', () => {
	it('runs separate front end, assembler and static linker with real GNU paths and untouched source', async () => {
		const fixture = bundle(),
			compileWasm = vi.spyOn(WebAssembly, 'compile');
		const compiler = await createCrossGccCompiler(fixture.options);
		const preparedCalls = compileWasm.mock.calls.length;
		try {
			const code =
				'#pragma GCC push_options\n#pragma GCC target("avx2,fma")\n#pragma GCC optimize("O3")\nint main() {}\n#pragma GCC pop_options\n';
			const result = await compiler.compile({
				code,
				cpu: 'x86-64',
				optimization: '0',
				files: [{ path: 'include/local.h', contents: '#define LOCAL 1' }]
			});
			expect(result.exitCode).toBe(0);
			expect(result.artifact).toMatchObject({
				compiler: 'gcc',
				compilerHost: 'wasm32-emscripten',
				target: 'x86_64-linux-gnu',
				format: 'elf-executable',
				fileName: 'program.elf',
				cpu: 'x86-64',
				bytes: elf(2)
			});
			expect(result.stages.map((stage) => stage.tool)).toEqual(['cc1plus', 'as', 'ld']);
			expect(result.stages.every((stage) => stage.peakMemoryBytes === 65536)).toBe(true);
			expect(new TextDecoder().decode(host.calls[0].files.get('/workspace/main.cpp'))).toBe(
				code
			);
			expect(host.calls.every((call) => call.files.has('/sysroot/usr/include/stdio.h'))).toBe(
				true
			);
			expect(host.calls[0].argv).toEqual(
				expect.arrayContaining([
					'-O0',
					'-march=x86-64',
					'-nostdinc',
					'-fexceptions',
					'/sysroot/usr/include/c++/13'
				])
			);
			expect(host.calls[0].argv).not.toContain('-mavx2');
			expect(host.calls[2].argv).toEqual(
				expect.arrayContaining([
					'-static',
					'-lstdc++',
					'-lgcc_eh',
					'-lc',
					'/sysroot/usr/lib/gcc/x86_64-linux-gnu/13/crtbeginT.o'
				])
			);
			expect(compiler.identity.sysrootSha256).toBe(fixture.manifest.assets.sysroot.sha256);
			expect(preparedCalls).toBeGreaterThanOrEqual(4);
			expect(compileWasm).toHaveBeenCalledTimes(preparedCalls);
			for (const [bytes] of compileWasm.mock.calls)
				expect(new Uint8Array(bytes as Uint8Array).slice(0, 4)).toEqual(
					Uint8Array.from([0, 97, 115, 109])
				);
		} finally {
			compiler.dispose();
		}
		await expect(compiler.compile({ code: '' })).rejects.toThrow('disposed');
	});

	it('supports C, preprocessed .ii, AVX2/FMA and each requested output without adding later stages', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		try {
			const assembly = await compiler.compile({
				code: 'int f(int a) { return a + 1; }',
				language: 'c',
				emit: 'assembly',
				cpu: 'avx2-fma'
			});
			expect(assembly.stages.map((stage) => stage.tool)).toEqual(['cc1']);
			expect(assembly.stages[0].argv).toEqual(
				expect.arrayContaining(['-march=x86-64', '-mavx2', '-mfma', '-std=gnu17'])
			);
			const object = await compiler.compile({
				code: 'int f(int a) { return a + 1; }',
				emit: 'object',
				preprocessed: true
			});
			expect(object.artifact?.format).toBe('elf-object');
			expect(object.stages.map((stage) => stage.tool)).toEqual(['cc1plus', 'as']);
			expect(object.stages[0].argv).toContain('-fpreprocessed');
			expect(object.stages[0].argv).toContain('/workspace/main.ii');
			expect(object.stages[0].argv).not.toContain('-nostdinc');
		} finally {
			compiler.dispose();
		}
	});

	it('never returns stale output after front end, assembler or linker failures and can compile again', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		try {
			expect((await compiler.compile({ code: '' })).artifact).toBeDefined();
			for (const tool of ['cc1plus', 'as', 'ld']) {
				host.mode = `fail-${tool}`;
				const result = await compiler.compile({ code: '' });
				expect(result.exitCode).toBe(9);
				expect(result.artifact).toBeUndefined();
				expect(result.stages.at(-1)?.tool).toBe(tool);
			}
			host.mode = 'exit-status';
			expect((await compiler.compile({ code: '' })).artifact).toBeDefined();
		} finally {
			compiler.dispose();
		}
	});

	it('rejects missing output, another ELF architecture, dynamic linkage, and oversized diagnostics', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		try {
			for (const mode of ['no-output', 'wrong-machine', 'dynamic', 'diagnostics']) {
				host.mode = mode;
				await expect(compiler.compile({ code: '' })).rejects.toThrow();
			}
		} finally {
			compiler.dispose();
		}
	});

	it('rejects arbitrary driver flags, unsafe paths, collisions and unsupported options before executing', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		try {
			for (const request of [
				{ code: '', cpu: 'native' },
				{ code: '', flags: ['-flto'] },
				{ code: '', standard: 'gnu++20 -fplugin=bad' },
				{ code: '', preprocessed: 1 },
				...[
					'../outside',
					'/outside',
					'a\\b',
					'a//b',
					'a/./b',
					'program.o',
					'program.elf/x',
					'main.cpp'
				].map((path) => ({ code: '', files: [{ path, contents: '' }] })),
				{
					code: '',
					files: [
						{ path: 'a', contents: '' },
						{ path: 'a/b', contents: '' }
					]
				},
				{
					code: '',
					files: [
						{ path: 'a', contents: '' },
						{ path: 'a', contents: '' }
					]
				},
				{ code: 'a'.repeat(16 * 1024 * 1024 + 1) }
			])
				await expect(compiler.compile(request as never)).rejects.toThrow();
			expect(host.calls).toHaveLength(0);
		} finally {
			compiler.dispose();
		}
	});

	it('verifies manifest and every asset before executing any imported loader', async () => {
		const loader = (await import('../src/module-loader.js')).loadGccModuleFactory;
		vi.mocked(loader).mockClear();
		const compileWasm = vi.spyOn(WebAssembly, 'compile'),
			fixture = bundle();
		await expect(
			createCrossGccCompiler({ ...fixture.options, manifestSha256: '0'.repeat(64) })
		).rejects.toThrow();
		expect(fixture.options.fetchImpl).toHaveBeenCalledTimes(1);
		for (const path of ['cc1plus.mjs', 'as.wasm', 'sysroot.tar']) {
			const corrupt = bundle();
			corrupt.files.get(path)![9] ^= 1;
			await expect(createCrossGccCompiler(corrupt.options)).rejects.toThrow();
		}
		expect(loader).not.toHaveBeenCalled();
		expect(compileWasm).not.toHaveBeenCalled();
	});

	it('rejects asset/extraction limits and path traversal, and freezes a manifest snapshot', async () => {
		await expect(
			createCrossGccCompiler({ ...bundle().options, maxAssetBytes: 1024 })
		).rejects.toThrow('byte limit');
		for (const path of ['../file', '/outside', 'usr/../../outside'])
			await expect(createCrossGccCompiler(bundle(path).options)).rejects.toThrow(
				'relative path'
			);
		const { manifest } = bundle(),
			parsed = parseCrossGccManifest(manifest);
		manifest.assets.cc1Js.sha256 = '0'.repeat(64);
		expect(parsed.assets.cc1Js.sha256).not.toBe(manifest.assets.cc1Js.sha256);
		expect(Object.isFrozen(parsed.assets.cc1Js)).toBe(true);
		for (const change of [
			{ host: 'x86_64-linux-gnu' },
			{ target: 'wasm32-wasi' },
			{ compiler: { family: 'clang', version: '13.3.0' } },
			{ cpuProfiles: ['native'] },
			{ resourceDir: '/tmp/include' },
			{
				assets: {
					...manifest.assets,
					cc1Js: { ...manifest.assets.cc1Js, path: 'https://evil.test/gcc.mjs' }
				}
			}
		])
			expect(() => parseCrossGccManifest({ ...manifest, ...change })).toThrow();
	});
});
