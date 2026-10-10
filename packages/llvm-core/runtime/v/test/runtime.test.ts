import { Directory, File } from '@bjorn3/browser_wasi_shim';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emptyWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const calls = vi.hoisted(() => ({
	run: [] as string[][],
	translate: [] as Array<{
		args: string[];
		env: Record<string, string>;
		files: Array<{ path: string; contents: Uint8Array }>;
	}>,
	compile: [] as Array<Record<string, unknown>>,
	runtimeOptions: [] as Array<Record<string, unknown>>,
	translation: { exitCode: 0, stderr: '', cSource: 'int main(void) { return 0; }\n' }
}));

vi.mock('../../core/src/wasm.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../core/src/wasm.js')>()),
	compile: vi.fn(async () => new WebAssembly.Module(emptyWasm)),
	readBuffer: vi.fn(async () => new Uint8Array())
}));

vi.mock('../../core/src/tar.js', () => ({
	default: vi.fn(
		(_archive: Uint8Array, fs: { addFile(path: string, contents: Uint8Array): void }) => {
			fs.addFile('./v/vlib/builtin/builtin.v', new TextEncoder().encode('module builtin\n'));
			fs.addFile('./v/vlib/os/os.v', new TextEncoder().encode('module os\n'));
		}
	)
}));

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
	}
	class MockRuntime {
		ready = Promise.resolve();
		memfs = new MockMemfs();
		stdout = (_chunk: string) => {};
		log = false;
		assetUrls = { lld: 'lld.wasm.gz' };
		compilerConfig = { compilerRuntimeLibDir: 'lib/clang/22/lib/wasi' };
		constructor(options: Record<string, unknown>) {
			calls.runtimeOptions.push(options);
		}
		beginTrace(_debug: boolean) {}
		async getModule() {
			return new WebAssembly.Module(emptyWasm);
		}
		async compile(options: Record<string, unknown>) {
			calls.compile.push(options);
			this.memfs.addFile(String(options.obj), emptyWasm);
		}
		async run(_module: WebAssembly.Module, _out: boolean, ...args: string[]) {
			calls.run.push(args);
			this.memfs.addFile(args[args.indexOf('-o') + 1], emptyWasm);
		}
	}
	return {
		BrowserClangRuntime: MockRuntime,
		executeBrowserClangArtifact: vi.fn(async (_artifact: unknown, options: any) => {
			calls.translate.push({ args: options.args, env: options.env, files: options.files });
			const root = new Directory(new Map());
			if (calls.translation.exitCode === 0) {
				root.contents.set(
					'work',
					new Directory(
						new Map([
							[
								'__wasm_v_main.c',
								new File(new TextEncoder().encode(calls.translation.cSource))
							]
						])
					)
				);
			}
			await options.extraImports({ host: { rootDirectory: root } });
			if (calls.translation.stderr) options.stderr(calls.translation.stderr);
			return { exitCode: calls.translation.exitCode, stdout: '', stderr: '' };
		}),
		loadRuntimeManifest: vi.fn(async () => ({
			manifestVersion: 1,
			version: 'clang-test',
			defaultTarget: 'wasm32-wasi',
			compiler: {
				memfs: { asset: 'memfs.wasm.gz', argv0: 'memfs' },
				clang: { asset: 'clang.wasm.gz', argv0: 'clang' },
				lld: { asset: 'lld.wasm.gz', argv0: 'wasm-ld' },
				sysroot: { asset: 'sysroot.tar.gz' },
				resourceDir: '/lib/clang/22',
				compilerRuntimeLibDir: 'lib/clang/22/lib/wasi'
			},
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
	V_C_FLAGS,
	V_COMPILER_ENV,
	V_LLVM_PROFILE,
	V_TRANSLATE_ARGS,
	createVCompiler,
	parseVRuntimeManifest,
	resolveVRuntimeAssetUrls
} from '../src/index.js';

const manifest = {
	manifestVersion: 1 as const,
	version: 'v-0.5.2-wasi-preview1-v1',
	frontend: { asset: 'v.wasm.gz', argv0: 'v' },
	rootfs: { asset: 'vroot.tar.gz' },
	cSysroot: { asset: 'c-sysroot.tar.gz' },
	profile: V_LLVM_PROFILE
};

const runtimeLocations = {
	runtimeBaseUrl: 'https://cdn.test/v/',
	clangRuntimeBaseUrl: 'https://cdn.test/clang/'
} as const;

describe('V llvm-core runtime', () => {
	beforeEach(() => {
		calls.run.length = 0;
		calls.translate.length = 0;
		calls.compile.length = 0;
		calls.runtimeOptions.length = 0;
		calls.translation = {
			exitCode: 0,
			stderr: '',
			cSource: 'int main(void) { return 0; }\n'
		};
	});

	it('validates the pinned V profile and resolves its delivery assets', () => {
		expect(parseVRuntimeManifest(manifest)).toEqual(manifest);
		expect(resolveVRuntimeAssetUrls('https://cdn.test/v', manifest)).toEqual({
			manifest: 'https://cdn.test/v/runtime-manifest.v1.json',
			frontend: 'https://cdn.test/v/v.wasm.gz',
			rootfs: 'https://cdn.test/v/vroot.tar.gz',
			cSysroot: 'https://cdn.test/v/c-sysroot.tar.gz'
		});
		expect(() =>
			parseVRuntimeManifest({
				...manifest,
				profile: { ...V_LLVM_PROFILE, vCommit: '0'.repeat(40) }
			})
		).toThrow('unsupported root.profile');
	});

	it('replaces only the shared Clang sysroot with the V C sysroot', async () => {
		await createVCompiler({ ...runtimeLocations, manifest });

		expect(calls.runtimeOptions[0]?.manifest).toEqual(
			expect.objectContaining({
				compiler: expect.objectContaining({
					resourceDir: '/lib/clang/22',
					sysroot: { asset: 'https://cdn.test/v/c-sysroot.tar.gz' }
				})
			})
		);
	});

	it('translates with the real V compiler, compiles the C output, and links above 64 KiB', async () => {
		calls.translation.cSource = 'void main__main(void) {}\nint main(void) { return 0; }\n';
		const compiler = await createVCompiler({ ...runtimeLocations, manifest });
		const result = await compiler.compile({
			code: 'fn main() {\n\tprintln(1)\n}\n',
			fileName: 'src/app.v',
			compileArgs: ['-skip-unused'],
			workspaceFiles: [{ path: 'src/util.v', content: 'module main\n' }]
		});

		expect(result.success).toBe(true);
		expect(result.artifact).toEqual(
			expect.objectContaining({ sourceLanguage: 'V', target: 'wasm32-wasi' })
		);
		const translation = calls.translate[0];
		expect(translation.args).toEqual([
			...V_TRANSLATE_ARGS,
			'-skip-unused',
			'-o',
			'/work/__wasm_v_main.c',
			'/work/src/app.v'
		]);
		expect(translation.env).toEqual(V_COMPILER_ENV);
		expect(translation.files.map(({ path }) => path).sort()).toEqual([
			'v/vlib/builtin/builtin.v',
			'v/vlib/os/os.v',
			'work/src/app.v',
			'work/src/util.v'
		]);
		expect(calls.compile[0]).toEqual(
			expect.objectContaining({
				code: calls.translation.cSource,
				language: 'C',
				compileArgs: [...V_C_FLAGS]
			})
		);
		const link = calls.run[0];
		expect(link).toEqual(
			expect.arrayContaining([
				'wasm-ld',
				'--no-stack-first',
				'--global-base=65536',
				'lib/wasm32-wasi/libvwasi.a',
				'-lclang_rt.builtins-wasm32'
			])
		);
	});

	it('returns V diagnostics with workspace-relative paths and skips the C backend', async () => {
		calls.translation.exitCode = 1;
		calls.translation.stderr = '/work/main.v:3:1: error: invalid expression\n';
		const compiler = await createVCompiler({ ...runtimeLocations, manifest });
		const result = await compiler.compile({ code: 'fn main() {\n\tx := 1 +\n}\n' });

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('main.v:3:1: error: invalid expression');
		expect(result.stderr).not.toContain('/work/');
		expect(calls.compile).toEqual([]);
		expect(calls.run).toEqual([]);
	});

	it('rejects empty source without starting the compiler', async () => {
		const compiler = await createVCompiler({ ...runtimeLocations, manifest });
		await expect(compiler.compile({ code: '  ' })).resolves.toEqual({
			success: false,
			stderr: 'wasm-v requires a non-empty source string'
		});
		expect(calls.translate).toEqual([]);
	});
});
