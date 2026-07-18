import { beforeEach, describe, expect, it, vi } from 'vitest';

const emptyWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const calls = vi.hoisted(() => ({
	run: [] as string[][],
	runWithOptions: [] as Array<{
		args: string[];
		env: Record<string, string>;
		source: string;
	}>,
	compile: [] as Array<Record<string, unknown>>,
	runtimeOptions: [] as Array<Record<string, unknown>>
}));

vi.mock('../../core/src/wasm.js', () => ({
	compile: vi.fn(async () => new WebAssembly.Module(emptyWasm)),
	readBuffer: vi.fn(async () => new Uint8Array())
}));

vi.mock('../../core/src/tar.js', () => ({ default: vi.fn() }));

vi.mock('../../clang/src/index.js', () => {
	class MockMemfs {
		files = new Map<string, Uint8Array>();
		stdout = (_chunk: string) => {};
		addDirectory(_path: string) {}
		addFile(path: string, contents: string | Uint8Array) {
			this.files.set(
				path,
				typeof contents === 'string' ? new TextEncoder().encode(contents) : contents
			);
		}
		getFileContents(path: string) {
			const contents = this.files.get(path);
			if (!contents) throw new Error(`missing ${path}`);
			return contents;
		}
		hasFile(path: string) {
			return this.files.has(path);
		}
	}
	class MockRuntime {
		ready = Promise.resolve();
		memfs = new MockMemfs();
		stdout = (_chunk: string) => {};
		log = false;
		assetUrls = { lld: 'lld.zip' };
		compilerConfig = { compilerRuntimeLibDir: 'lib/clang/22/lib/wasi' };
		constructor(options: Record<string, unknown>) {
			calls.runtimeOptions.push(options);
		}
		beginTrace(_debug: boolean) {}
		async getModule() {
			return new WebAssembly.Module(emptyWasm);
		}
		async runWithOptions(
			_module: WebAssembly.Module,
			_out: boolean,
			args: string[],
			env: Record<string, string>
		) {
			const input = args.at(-1) || '';
			calls.runWithOptions.push({
				args,
				env,
				source: new TextDecoder().decode(this.memfs.getFileContents(input))
			});
			const output = args[args.indexOf('-o') + 1];
			this.memfs.addFile(
				output,
				'#include "main.c.h"\n#include "main.c.l.h"\nint main(void) { return 0; }\n'
			);
			this.memfs.addFile(output + '.h', '/* data */\n');
			this.memfs.addFile(output + '.l.h', '/* locals */\n');
		}
		async compile(options: Record<string, unknown>) {
			calls.compile.push(options);
			this.memfs.addFile(String(options.obj), new Uint8Array([1]));
		}
		async run(_module: WebAssembly.Module, _out: boolean, ...args: string[]) {
			calls.run.push(args);
			const output = args[args.indexOf('-o') + 1];
			this.memfs.addFile(output, emptyWasm);
		}
	}
	return {
		BrowserClangRuntime: MockRuntime,
		executeBrowserClangArtifact: vi.fn(),
		loadRuntimeManifest: vi.fn(async () => ({
			manifestVersion: 1,
			version: 'clang-test',
			defaultTarget: 'wasm32-wasi',
			compiler: {
				memfs: { asset: 'memfs.zip', argv0: 'memfs' },
				clang: { asset: 'clang.zip', argv0: 'clang' },
				lld: { asset: 'lld.zip', argv0: 'wasm-ld' },
				sysroot: { asset: 'sysroot.tar.zip' },
				resourceDir: '/lib/clang/22',
				compilerRuntimeLibDir: 'lib/clang/22/lib/wasi'
			},
			clangd: { js: 'clangd.js', wasm: 'clangd.wasm.gz' },
			targets: {
				'wasm32-wasi': {
					artifactFormat: 'wasi-core-wasm',
					execution: { kind: 'wasi-preview1' }
				}
			}
		})),
		resolveRuntimeBaseUrl: vi.fn((value: string | URL) => {
			const url = new URL(value);
			if (!url.pathname.endsWith('/')) url.pathname += '/';
			return url.toString();
		}),
		resolveRuntimeBaseUrlFromManifestUrl: vi.fn((value: string | URL) =>
			new URL('./', value).toString()
		),
		resolveRuntimeManifestUrl: vi.fn((value: string | URL) =>
			new URL('runtime-manifest.v1.json', value).toString()
		)
	};
});

import {
	COBOL_LLVM_PROFILE,
	createCobolCompiler,
	parseCobolRuntimeManifest,
	resolveCobolRuntimeAssetUrls
} from '../src/index.js';

const manifest = {
	manifestVersion: 1 as const,
	version: 'test',
	frontend: { asset: 'cobc.wasm.gz', argv0: 'cobc' },
	rootfs: { asset: 'rootfs.tar.gz' },
	cSysroot: { asset: 'c-sysroot.tar.gz' },
	profile: COBOL_LLVM_PROFILE
};

const runtimeLocations = {
	runtimeBaseUrl: 'https://cdn.test/cobol/',
	clangRuntimeBaseUrl: 'https://cdn.test/clang/'
} as const;

describe('GnuCOBOL llvm-core runtime', () => {
	beforeEach(() => {
		calls.run.length = 0;
		calls.runWithOptions.length = 0;
		calls.compile.length = 0;
		calls.runtimeOptions.length = 0;
	});

	it('loads clang metadata and replaces only its sysroot with the COBOL C bundle', async () => {
		await createCobolCompiler({ ...runtimeLocations, manifest });

		expect(calls.runtimeOptions[0]?.manifest).toEqual(
			expect.objectContaining({
				compiler: expect.objectContaining({
					resourceDir: '/lib/clang/22',
					sysroot: { asset: expect.stringMatching(/c-sysroot\.tar\.gz$/) }
				})
			})
		);
	});

	it('validates and resolves versioned runtime assets', () => {
		expect(parseCobolRuntimeManifest(manifest)).toEqual(manifest);
		expect(resolveCobolRuntimeAssetUrls('https://cdn.test/cobol', manifest)).toEqual({
			manifest: 'https://cdn.test/cobol/runtime-manifest.v1.json',
			frontend: 'https://cdn.test/cobol/cobc.wasm.gz',
			rootfs: 'https://cdn.test/cobol/rootfs.tar.gz',
			cSysroot: 'https://cdn.test/cobol/c-sysroot.tar.gz'
		});
		expect(
			resolveCobolRuntimeAssetUrls('https://cdn.test/cobol', {
				...manifest,
				frontend: { asset: 'cobc.zip', argv0: 'cobc' },
				rootfs: { asset: 'rootfs.tar.zip' },
				cSysroot: { asset: 'c-sysroot.tar.zip' }
			})
		).toEqual(
			expect.objectContaining({
				frontend: 'https://cdn.test/cobol/cobc.zip',
				rootfs: 'https://cdn.test/cobol/rootfs.tar.zip',
				cSysroot: 'https://cdn.test/cobol/c-sysroot.tar.zip'
			})
		);
		expect(() => parseCobolRuntimeManifest({ ...manifest, manifestVersion: 2 })).toThrow(
			'manifestVersion'
		);
	});

	it('translates real COBOL output files, compiles C, and links libcob with GMP', async () => {
		const compiler = await createCobolCompiler({
			...runtimeLocations,
			manifest,
			clangManifest: { compiler: { sysroot: { asset: 'sysroot.tar.zip' } } } as never
		});
		const result = await compiler.compile({
			code: 'identification division. program-id. hello. procedure division. stop run.',
			fileName: 'main.cob',
			workspaceFiles: [{ path: 'names.cpy', content: '01 NAME PIC X(20).' }]
		});

		expect(result.success).toBe(true);
		expect(result.artifact).toEqual(
			expect.objectContaining({ sourceLanguage: 'COBOL', format: 'wasi-core-wasm' })
		);
		expect(calls.runWithOptions[0]?.args).toEqual(
			expect.arrayContaining(['cobc', '-x', '-C', '-free'])
		);
		expect(calls.runWithOptions[0]?.args.at(-1)).toMatch(/main\.cob$/);
		expect(calls.runWithOptions[0]?.env.COB_CONFIG_DIR).toBe('share/gnucobol/config');
		expect(calls.compile[0]?.workspaceFiles).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: expect.stringMatching(/main\.c\.h$/) }),
				expect.objectContaining({ path: expect.stringMatching(/main\.c\.l\.h$/) })
			])
		);
		expect(calls.run.at(-1)).toEqual(
			expect.arrayContaining(['lib/libcob.a', 'lib/libgmp.a', 'lib/libsetjmp.a'])
		);
	});

	it('avoids the GnuCOBOL C symbol collision for a top-level PROGRAM-ID named main', async () => {
		const compiler = await createCobolCompiler({
			...runtimeLocations,
			manifest,
			clangManifest: {
				compiler: { sysroot: { asset: 'sysroot.tar.zip' } }
			} as never
		});

		const result = await compiler.compile({
			code: 'identification division. program-id. main. procedure division. stop run. end program main.'
		});

		expect(result.success).toBe(true);
		expect(calls.runWithOptions[0]?.source).toContain('program-id. WASM-IDLE-MAIN.');
		expect(calls.runWithOptions[0]?.source).toContain('end program WASM-IDLE-MAIN.');
	});

	it('derives both runtime bases from explicit manifest URLs', async () => {
		await createCobolCompiler({
			manifestUrl: 'https://cdn.test/cobol/v2/custom.json',
			clangManifestUrl: 'https://cdn.test/clang/v3/custom.json',
			manifest,
			clangManifest: {
				compiler: { sysroot: { asset: 'sysroot.tar.zip' } }
			} as never
		});

		expect(calls.runtimeOptions[0]?.runtimeBaseUrl).toBe('https://cdn.test/clang/v3/');
	});

	it('rejects omitted and package-local runtime locations', async () => {
		await expect(createCobolCompiler({} as never)).rejects.toThrow(
			'wasm-cobol runtime manifest URL is required'
		);
		expect(() =>
			resolveCobolRuntimeAssetUrls(new URL('file:///package/cobol/assets/'), manifest)
		).toThrow('wasm-cobol runtime base URL must use HTTP(S)');
	});
});
