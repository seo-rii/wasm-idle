import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeManifestV1 } from '../src/types.js';

const wasmFixture = vi.hoisted(() => ({
	bytes: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
}));

const runtimeState = vi.hoisted(() => ({
	instances: [] as Array<Record<string, unknown>>,
	nextCompilerOutput: '',
	shouldFail: false
}));

const wasiState = vi.hoisted(() => ({
	lastArgs: [] as string[],
	start: vi.fn((..._args: unknown[]) => 0)
}));

vi.mock('../src/runtime.js', () => ({
	default: class MockRuntime {
		readonly ready = Promise.resolve();
		readonly memfs = {
			getFileContents: vi.fn(() => wasmFixture.bytes)
		};
		readonly debugVariableMetadata = {
			1: [{ slot: 1, name: 'value', kind: 'number', fromLine: 1, toLine: 1 }]
		};
		readonly debugGlobalMetadata = [] as never[];
		readonly debugFunctionMetadata = { 1: 'main' };
		readonly wasm = new WebAssembly.Module(wasmFixture.bytes);
		readonly options: Record<string, unknown>;
		lastArtifactPath = 'main.wasm';
		compileLinkCall?: { code: string; options: Record<string, unknown> };

		constructor(options: Record<string, unknown>) {
			this.options = options;
			runtimeState.instances.push(this as unknown as Record<string, unknown>);
		}

		async compileLink(code: string, options: Record<string, unknown>) {
			this.compileLinkCall = { code, options };
			const fileName = String(options.fileName || 'main.cc');
			this.lastArtifactPath = `${fileName.replace(/\.[^.]+$/, '')}.wasm`;
			if (runtimeState.nextCompilerOutput) {
				(this.options.stdout as ((chunk: string) => void) | undefined)?.(
					runtimeState.nextCompilerOutput
				);
			}
			if (runtimeState.shouldFail) {
				throw new Error('compile failed');
			}
			return this.wasm;
		}
	}
}));

vi.mock('@bjorn3/browser_wasi_shim', () => {
	class MockFd {}
	class MockDirectory {
		contents: Map<string, unknown>;
		constructor(contents: Map<string, unknown>) {
			this.contents = contents;
		}
	}
	class MockFile {
		bytes: Uint8Array;
		constructor(bytes: Uint8Array) {
			this.bytes = bytes;
		}
	}
	class MockPreopenDirectory extends MockFd {
		path: string;
		contents: Map<string, unknown>;
		constructor(path: string, contents: Map<string, unknown>) {
			super();
			this.path = path;
			this.contents = contents;
		}
	}
	class MockWASI {
		readonly wasiImport = {};
		constructor(args: string[]) {
			wasiState.lastArgs = args;
		}
		start(instance: unknown) {
			return wasiState.start(instance);
		}
	}

	return {
		Directory: MockDirectory,
		Fd: MockFd,
		File: MockFile,
		Inode: { issue_ino: () => 1 },
		PreopenDirectory: MockPreopenDirectory,
		WASI: MockWASI,
		wasi: {
			ERRNO_SUCCESS: 0,
			FILETYPE_CHARACTER_DEVICE: 0,
			RIGHTS_FD_WRITE: 1,
			RIGHTS_FD_READ: 2,
			Filestat: class {
				constructor(..._args: unknown[]) {}
			},
			Fdstat: class {
				fs_rights_base = 0n;
				constructor(..._args: unknown[]) {}
			}
		}
	};
});

import {
	compileClang,
	createClangCompiler,
	executeBrowserClangArtifact,
	normalizeDwarfWorkspacePath,
	preloadBrowserClangRuntime,
	resolveDebugMode
} from '../src/index.js';

const manifest: RuntimeManifestV1 = {
	manifestVersion: 1,
	version: 'test-manifest',
	defaultTarget: 'wasm32-wasi',
	compiler: {
		memfs: { asset: 'bin/memfs.zip', argv0: 'memfs' },
		clang: { asset: 'bin/clang.zip', argv0: 'clang' },
		lld: { asset: 'bin/lld.zip', argv0: 'wasm-ld' },
		sysroot: { asset: 'bin/sysroot.tar.zip' },
		provenance: {
			name: 'clang',
			version: '22.1.8',
			revision: 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1'
		}
	},
	targets: {
		'wasm32-wasi': {
			artifactFormat: 'wasi-core-wasm',
			execution: { kind: 'wasi-preview1' }
		}
	},
	clangd: {
		js: 'clangd/clangd.js',
		wasm: 'clangd/clangd.wasm.gz'
	}
};

async function sha256Hex(value: string | Uint8Array) {
	const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
		''
	);
}

describe('public wasm-clang API contract', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		runtimeState.instances.length = 0;
		runtimeState.nextCompilerOutput = '';
		runtimeState.shouldFail = false;
		wasiState.lastArgs = [];
		wasiState.start.mockReset();
		wasiState.start.mockReturnValue(0);
	});

	it('exports the canonical DWARF workspace path mapping used by debug hosts', () => {
		expect(normalizeDwarfWorkspacePath('src\\nested\\main.cpp')).toBe('src/nested/main.cpp');
		expect(normalizeDwarfWorkspacePath('/workspace/src/../main.cpp')).toBe('src/main.cpp');
	});

	it('resolves explicit debug modes before the deprecated trace boolean', () => {
		expect(resolveDebugMode({})).toBe('none');
		expect(resolveDebugMode({ debug: true })).toBe('trace');
		expect(resolveDebugMode({ debug: false })).toBe('none');
		expect(resolveDebugMode({ debug: true, debugMode: 'lldb' })).toBe('lldb');
		expect(resolveDebugMode({ debug: true, debugMode: 'none' })).toBe('none');
	});

	it('forwards public compile options and returns artifact metadata', async () => {
		const compiler = await createClangCompiler({
			runtimeBaseUrl: 'https://cdn.example.com/pkg/runtime/',
			manifest,
			log: true,
			showTiming: true
		});

		const result = await compiler.compile({
			language: 'C',
			fileName: 'hello.c',
			code: 'int main(void) { return 0; }',
			compileArgs: ['-DTEST=1'],
			debug: true,
			breakpoints: [7],
			pauseOnEntry: true,
			log: true
		});

		expect(result.success, result.stderr).toBe(true);
		const runtime = runtimeState.instances[0] as {
			debugVariableMetadata: unknown;
			debugGlobalMetadata: unknown;
			debugFunctionMetadata: unknown;
			wasm: WebAssembly.Module;
			compileLinkCall: unknown;
		};
		expect(result.artifact).toEqual(
			expect.objectContaining({
				fileName: 'hello.wasm',
				language: 'C',
				target: 'wasm32-wasi',
				format: 'wasi-core-wasm',
				debugMetadata: {
					variableMetadata: runtime.debugVariableMetadata,
					globalVariableMetadata: runtime.debugGlobalMetadata,
					functionMetadata: runtime.debugFunctionMetadata
				},
				wasm: runtime.wasm
			})
		);
		expect(result.artifact?.debug).toBeUndefined();
		expect(runtime.compileLinkCall).toEqual({
			code: 'int main(void) { return 0; }',
			options: {
				language: 'C',
				fileName: 'hello.c',
				activePath: undefined,
				workspaceFiles: [],
				compileArgs: ['-DTEST=1'],
				debugMode: 'trace',
				breakpoints: [7],
				pauseOnEntry: true,
				cppVersion: undefined,
				cVersion: undefined
			}
		});
		expect(result.logs).toEqual([
			'[wasm-clang] runtime manifest loaded',
			'[wasm-clang] runtime ready'
		]);
	});

	it('returns a deterministic DWARF descriptor and forwards workspace sources', async () => {
		const result = await compileClang(
			{
				language: 'CPP',
				fileName: 'ignored.cpp',
				activePath: '/workspace/src/main.cpp',
				code: '#include "../include/value.hpp"\nint main() { return value; }\n',
				workspaceFiles: [
					{ path: '/workspace/src/main.cpp', content: 'stale active source' },
					{ path: '/workspace/include/value.hpp', content: 'constexpr int value = 0;\n' }
				],
				debugMode: 'lldb'
			},
			{
				runtimeBaseUrl: 'https://cdn.example.com/pkg/runtime/',
				manifest
			}
		);

		expect(result.success, result.stderr).toBe(true);
		expect(result.artifact?.debugMetadata).toBeUndefined();
		expect(result.artifact?.debug).toEqual({
			kind: 'dwarf',
			sourceRoot: '/workspace',
			moduleSha256: await sha256Hex(wasmFixture.bytes),
			files: [
				{
					path: '/workspace/include/value.hpp',
					contentSha256: await sha256Hex('constexpr int value = 0;\n')
				},
				{
					path: '/workspace/src/main.cpp',
					contentSha256: await sha256Hex(
						'#include "../include/value.hpp"\nint main() { return value; }\n'
					)
				}
			],
			compiler: manifest.compiler.provenance
		});
		expect(runtimeState.instances[0]?.compileLinkCall).toEqual({
			code: '#include "../include/value.hpp"\nint main() { return value; }\n',
			options: {
				language: 'CPP',
				fileName: 'ignored.cpp',
				activePath: '/workspace/src/main.cpp',
				workspaceFiles: [
					{ path: '/workspace/src/main.cpp', content: 'stale active source' },
					{ path: '/workspace/include/value.hpp', content: 'constexpr int value = 0;\n' }
				],
				compileArgs: [],
				debugMode: 'lldb',
				breakpoints: undefined,
				pauseOnEntry: undefined,
				cppVersion: undefined,
				cVersion: undefined
			}
		});
	});

	it('reports missing compiler provenance only when LLDB metadata is requested', async () => {
		const legacyManifest = structuredClone(manifest);
		delete legacyManifest.compiler.provenance;

		const result = await compileClang(
			{
				code: 'int main() { return 0; }',
				debugMode: 'lldb'
			},
			{
				runtimeBaseUrl: 'https://cdn.example.com/pkg/runtime/',
				manifest: legacyManifest
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('requires compiler provenance');
	});

	it('preloads the runtime with the provided manifest and base url', async () => {
		await preloadBrowserClangRuntime({
			runtimeBaseUrl: 'https://cdn.example.com/pkg/runtime/',
			manifest
		});

		expect(runtimeState.instances).toHaveLength(1);
		expect(runtimeState.instances[0]?.options).toEqual(
			expect.objectContaining({
				runtimeBaseUrl: 'https://cdn.example.com/pkg/runtime/',
				manifest,
				log: false
			})
		);
	});

	it('derives the runtime base URL from an explicit manifest URL', async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify(manifest), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
		);

		await preloadBrowserClangRuntime({
			manifestUrl: 'https://cdn.example.com/clang/v2/custom-manifest.json',
			fetchImpl
		});

		expect(fetchImpl).toHaveBeenCalledWith(
			'https://cdn.example.com/clang/v2/custom-manifest.json'
		);
		expect(runtimeState.instances[0]?.options).toEqual(
			expect.objectContaining({
				runtimeBaseUrl: 'https://cdn.example.com/clang/v2/'
			})
		);
	});

	it('rejects an omitted runtime location', async () => {
		await expect(preloadBrowserClangRuntime({} as never)).rejects.toThrow(
			'wasm-clang runtime manifest URL is required'
		);
	});

	it('returns parsed diagnostics from compile output when compilation fails', async () => {
		runtimeState.nextCompilerOutput = 'hello.c:7:3: error: expected ; after expression\n';
		runtimeState.shouldFail = true;

		const result = await compileClang(
			{
				language: 'C',
				fileName: 'hello.c',
				code: 'int main(void) { return }\n'
			},
			{
				runtimeBaseUrl: 'https://cdn.example.com/pkg/runtime/',
				manifest
			}
		);

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('hello.c:7:3: error: expected ; after expression');
		expect(result.diagnostics).toEqual([
			{
				fileName: 'hello.c',
				lineNumber: 7,
				columnNumber: 3,
				severity: 'error',
				message: 'expected ; after expression'
			}
		]);
	});

	it('reuses the provided compiled module and artifact file name during execution', async () => {
		const compileSpy = vi.spyOn(WebAssembly, 'compile');
		const instantiateSpy = vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
			exports: {
				memory: new WebAssembly.Memory({ initial: 1 }),
				_start() {}
			}
		} as unknown as WebAssembly.Instance);
		const module = new WebAssembly.Module(wasmFixture.bytes);

		const result = await executeBrowserClangArtifact({
			bytes: wasmFixture.bytes,
			wasm: module,
			fileName: 'hello.wasm',
			target: 'wasm32-wasi',
			format: 'wasi-core-wasm'
		});

		expect(compileSpy).not.toHaveBeenCalled();
		expect(instantiateSpy).toHaveBeenCalledWith(
			module,
			expect.objectContaining({
				wasi_unstable: expect.any(Object),
				wasi_snapshot_preview1: expect.any(Object)
			})
		);
		expect(wasiState.lastArgs[0]).toBe('hello.wasm');
		expect(result.exitCode).toBe(0);
	});
});
