import { describe, expect, it, vi } from 'vitest';

const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_RUST_COMPILER_URL: '',
		PUBLIC_WASM_GO_COMPILER_URL: '',
		PUBLIC_WASM_D_MODULE_URL: '',
		PUBLIC_WASM_DOTNET_MODULE_URL: '',
		PUBLIC_WASM_ELIXIR_BUNDLE_URL: '',
		PUBLIC_WASM_ERLANG_BUNDLE_URL: '',
		PUBLIC_WASM_OCAML_MODULE_URL: '',
		PUBLIC_WASM_OCAML_MANIFEST_URL: '',
		PUBLIC_WASM_TINYGO_APP_URL: '',
		PUBLIC_WASM_TINYGO_MODULE_URL: '',
		PUBLIC_WASM_TYPESCRIPT_MODULE_URL: '',
		PUBLIC_WASM_WAT_MODULE_URL: '',
		PUBLIC_WASM_LUA_MODULE_URL: '',
		PUBLIC_WASM_ZIG_COMPILER_URL: '',
		PUBLIC_WASM_ZIG_STDLIB_URL: '',
		PUBLIC_WASM_LISP_MODULE_URL: '',
		PUBLIC_WASM_HASKELL_MODULE_URL: '',
		PUBLIC_WASM_HASKELL_ROOTFS_URL: '',
		PUBLIC_WASM_HASKELL_BSDTAR_URL: '',
		PUBLIC_WASM_FORTRAN_BASE_URL: '',
		PUBLIC_WASM_FORTRAN_F2C_WASM_URL: '',
		PUBLIC_WASM_FORTRAN_LIBF2C_URL: '',
		PUBLIC_WASM_FORTRAN_F2C_HEADER_URL: '',
		PUBLIC_WASM_FORTRAN_ANALYZER_URL: '',
		PUBLIC_WASM_COBOL_BASE_URL: '',
		PUBLIC_WASM_OBJECTIVEC_BASE_URL: '',
		PUBLIC_WASM_OBJECTIVEC_LIBOBJC_URL: '',
		PUBLIC_WASM_OBJECTIVEC_HEADERS_URL: '',
		PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_URL: '',
		PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_OBJECT_URL: '',
		PUBLIC_WASM_OBJECTIVEC_FOUNDATION_HEADERS_URL: '',
		PUBLIC_WASM_OBJECTIVEC_LIBFFI_URL: '',
		PUBLIC_WASM_RUBY_WASM_URL: '',
		PUBLIC_WASM_RUBY_MODULE_URL: '',
		PUBLIC_WASM_R_BASE_URL: '',
		PUBLIC_WASM_OCTAVE_BASE_URL: '',
		PUBLIC_WASM_OCTAVE_WORKER_URL: '',
		PUBLIC_WASM_OCTAVE_MANIFEST_URL: '',
		PUBLIC_WASM_PROLOG_BASE_URL: '',
		PUBLIC_WASM_PROLOG_WORKER_URL: '',
		PUBLIC_WASM_GLEAM_BASE_URL: '',
		PUBLIC_WASM_GLEAM_WORKER_URL: '',
		PUBLIC_WASM_GLEAM_MANIFEST_URL: '',
		PUBLIC_WASM_PERL_BASE_URL: '',
		PUBLIC_WASM_PERL_WORKER_URL: '',
		PUBLIC_WASM_TCL_BASE_URL: '',
		PUBLIC_WASM_TCL_WORKER_URL: '',
		PUBLIC_WASM_AWK_BASE_URL: '',
		PUBLIC_WASM_AWK_WORKER_URL: '',
		PUBLIC_WASM_PASCAL_BASE_URL: '',
		PUBLIC_WASM_PASCAL_WORKER_URL: '',
		PUBLIC_WASM_FORTH_BASE_URL: '',
		PUBLIC_WASM_FORTH_WORKER_URL: '',
		PUBLIC_WASM_J_BASE_URL: '',
		PUBLIC_WASM_J_WORKER_URL: '',
		PUBLIC_WASM_BQN_BASE_URL: '',
		PUBLIC_WASM_BQN_WORKER_URL: '',
		PUBLIC_WASM_JANET_BASE_URL: '',
		PUBLIC_WASM_JANET_WORKER_URL: '',
		PUBLIC_WASM_JULIA_BASE_URL: '',
		PUBLIC_WASM_JULIA_WORKER_URL: '',
		PUBLIC_WASM_NIM_BASE_URL: '',
		PUBLIC_WASM_NIM_WORKER_URL: '',
		PUBLIC_WASM_SWIFT_BASE_URL: '',
		PUBLIC_WASM_SWIFT_WORKER_URL: '',
		PUBLIC_WASM_SWIFT_MANIFEST_URL: '',
		PUBLIC_WASM_SQLITE_WASM_URL: '',
		PUBLIC_WASM_SQLITE_MODULE_URL: '',
		PUBLIC_WASM_ASSEMBLYSCRIPT_MODULE_URL: '',
		PUBLIC_WASM_DUCKDB_MODULE_URL: '',
		PUBLIC_WASM_PHP_MODULE_URL: ''
	}
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import {
	RUNTIME_LOAD_ASSETS,
	resolveCobolBaseUrl,
	resolveFortranRuntimeAssetConfig,
	resolveObjectiveCRuntimeAssetConfig,
	resolveRuntimeAssetConfig
} from './assets';

describe('runtime asset config resolution', () => {
	it('indexes folder-backed runtime load assets by runtime id', () => {
		expect(Object.keys(RUNTIME_LOAD_ASSETS).sort()).toEqual([
			'clang',
			'clangd',
			'java',
			'python'
		]);
		expect(RUNTIME_LOAD_ASSETS.clang).toContain('bin/clang.wasm.gz');
		expect(RUNTIME_LOAD_ASSETS.clangd).toContain('clangd.wasm.gz');
	});

	it('derives the default python asset base url from the legacy root path', () => {
		expect(
			resolveRuntimeAssetConfig('python', '/absproxy/5173', 'https://example.com/app')
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/pyodide/',
			useAssetBridge: false
		});
	});

	it('derives the default TeaVM asset base url from the shared root path', () => {
		expect(
			resolveRuntimeAssetConfig(
				'java',
				{ rootUrl: '/absproxy/5173' },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/teavm/',
			useAssetBridge: false
		});
	});

	it('uses a virtual base url when only a python custom loader is provided', () => {
		const loader = vi.fn();
		expect(resolveRuntimeAssetConfig('python', { python: { loader } })).toEqual({
			baseUrl: 'https://wasm-idle.invalid/python/',
			loader,
			useAssetBridge: true
		});
	});

	it('prefers an explicit java base url over the shared root path', () => {
		const loader = vi.fn();
		expect(
			resolveRuntimeAssetConfig(
				'java',
				{
					rootUrl: '/ignored',
					java: {
						baseUrl: 'https://cdn.example.com/teavm',
						loader
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://cdn.example.com/teavm/',
			loader,
			useAssetBridge: true
		});
	});

	it('derives the default clang asset base url from the shared root path', () => {
		expect(
			resolveRuntimeAssetConfig(
				'clang',
				{ rootUrl: '/absproxy/5173' },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/clang/',
			useAssetBridge: false
		});
	});

	it('uses a virtual base url when only a clang custom loader is provided', () => {
		const loader = vi.fn();
		expect(resolveRuntimeAssetConfig('clang', { clang: { loader } })).toEqual({
			baseUrl: 'https://wasm-idle.invalid/clang/',
			loader,
			useAssetBridge: true
		});
	});

	it('derives the default clangd asset base url from the shared root path', () => {
		expect(
			resolveRuntimeAssetConfig(
				'clangd',
				{ rootUrl: '/absproxy/5173' },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/clangd/',
			useAssetBridge: false
		});
	});

	it('prefers an explicit clangd base url over the shared root path', () => {
		const loader = vi.fn();
		expect(
			resolveRuntimeAssetConfig(
				'clangd',
				{
					rootUrl: '/ignored',
					clangd: {
						baseUrl: 'https://cdn.example.com/clangd',
						loader
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://cdn.example.com/clangd/',
			loader,
			useAssetBridge: true
		});
	});

	it('prefers an explicit rust compiler url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_RUST_COMPILER_URL = 'https://env.example.com/compiler.js';
		const { resolveRustCompilerUrl } = await import('./assets');

		expect(
			resolveRustCompilerUrl(
				{
					rust: {
						compilerUrl: '/runtime/rust/index.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/rust/index.js');
	});

	it('falls back to PUBLIC_WASM_RUST_COMPILER_URL when no rust runtime config is provided', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_RUST_COMPILER_URL = '/wasm-rust/index.js';
		const { resolveRustCompilerUrl } = await import('./assets');

		expect(resolveRustCompilerUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/wasm-rust/index.js'
		);
	});

	it('derives the Rust debug instrumenter beside the compiler and preserves its version', async () => {
		vi.resetModules();
		const { resolveRustDebugModuleUrl } = await import('./assets');

		expect(
			resolveRustDebugModuleUrl(
				{
					rust: {
						compilerUrl: '/wasm-rust/index.js?v=asset-version'
					}
				},
				'https://example.com/app/'
			)
		).toBe('https://example.com/wasm-rust/debug-instrumenter.js?v=asset-version');
	});

	it('prefers an explicit Rust debug instrumenter url', async () => {
		vi.resetModules();
		const { resolveRustDebugModuleUrl } = await import('./assets');

		expect(
			resolveRustDebugModuleUrl(
				{
					rust: {
						compilerUrl: '/wasm-rust/index.js',
						debugModuleUrl: '/debug-assets/rust.js'
					}
				},
				'https://example.com/app/'
			)
		).toBe('https://example.com/debug-assets/rust.js');
	});

	it('prefers an explicit go compiler url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_GO_COMPILER_URL = 'https://env.example.com/wasm-go/index.js';
		const { resolveGoCompilerUrl } = await import('./assets');

		expect(
			resolveGoCompilerUrl(
				{
					go: {
						compilerUrl: '/runtime/go/index.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/go/index.js');
	});

	it('falls back to PUBLIC_WASM_GO_COMPILER_URL when no go runtime config is provided', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_GO_COMPILER_URL = '/wasm-go/index.js';
		const { resolveGoCompilerUrl } = await import('./assets');

		expect(resolveGoCompilerUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/wasm-go/index.js'
		);
	});

	it('prefers an explicit D module url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_D_MODULE_URL = 'https://env.example.com/wasm-d/index.js';
		const { resolveDModuleUrl } = await import('./assets');

		expect(
			resolveDModuleUrl(
				{
					d: {
						moduleUrl: '/runtime/d/index.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/d/index.js');
	});

	it('derives the default D module url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_D_MODULE_URL = '';
		const { resolveDModuleUrl } = await import('./assets');

		expect(resolveDModuleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-d/index.js'
		);
	});

	it('prefers an explicit Dotnet module url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_DOTNET_MODULE_URL = 'https://env.example.com/wasm-dotnet/index.js';
		const { resolveDotnetModuleUrl } = await import('./assets');

		const config = {
			dotnet: {
				moduleUrl: '/runtime/dotnet/index.js'
			}
		};
		expect(resolveDotnetModuleUrl(config, 'https://example.com/app')).toBe(
			'https://example.com/runtime/dotnet/index.js'
		);
	});

	it('derives the default Dotnet module url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_DOTNET_MODULE_URL = '';
		const { resolveDotnetModuleUrl } = await import('./assets');

		expect(resolveDotnetModuleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-dotnet/index.js'
		);
	});

	it('prefers an explicit Elixir bundle url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_ELIXIR_BUNDLE_URL = 'https://env.example.com/wasm-elixir/bundle.avm';
		const { resolveElixirBundleUrl } = await import('./assets');

		expect(
			resolveElixirBundleUrl(
				{
					elixir: {
						bundleUrl: '/runtime/elixir/bundle.avm'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/elixir/bundle.avm');
	});

	it('derives the default Elixir bundle url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_ELIXIR_BUNDLE_URL = '';
		const { resolveElixirBundleUrl } = await import('./assets');

		expect(resolveElixirBundleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-elixir/bundle.avm'
		);
	});

	it('prefers an explicit Erlang bundle url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_ERLANG_BUNDLE_URL = 'https://env.example.com/wasm-elixir/bundle.avm';
		const { resolveErlangBundleUrl } = await import('./assets');

		expect(
			resolveErlangBundleUrl(
				{
					erlang: {
						bundleUrl: '/runtime/erlang/bundle.avm'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/erlang/bundle.avm');
	});

	it('falls back to the Elixir bundle config for Erlang', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_ERLANG_BUNDLE_URL = '';
		publicEnv.PUBLIC_WASM_ELIXIR_BUNDLE_URL = '';
		const { resolveErlangBundleUrl } = await import('./assets');

		expect(
			resolveErlangBundleUrl(
				{
					elixir: {
						bundleUrl: '/runtime/elixir/bundle.avm'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/elixir/bundle.avm');
		expect(resolveErlangBundleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-elixir/bundle.avm'
		);
	});

	it('prefers an explicit OCaml browser module url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_OCAML_MODULE_URL = 'https://env.example.com/ocaml/index.js';
		const { resolveOcamlModuleUrl } = await import('./assets');

		expect(
			resolveOcamlModuleUrl(
				{
					ocaml: {
						moduleUrl: '/runtime/ocaml/browser-native/src/index.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/ocaml/browser-native/src/index.js');
	});

	it('derives the default OCaml browser module url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_OCAML_MODULE_URL = '';
		const { resolveOcamlModuleUrl } = await import('./assets');

		expect(resolveOcamlModuleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-of-js-of-ocaml/browser-native/src/index.js'
		);
	});

	it('prefers an explicit OCaml manifest url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_OCAML_MANIFEST_URL =
			'https://env.example.com/ocaml/browser-native-manifest.v1.json';
		const { resolveOcamlManifestUrl } = await import('./assets');

		expect(
			resolveOcamlManifestUrl(
				{
					ocaml: {
						manifestUrl: '/runtime/ocaml/browser-native-manifest.v1.json'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/ocaml/browser-native-manifest.v1.json');
	});

	it('derives the default OCaml manifest url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_OCAML_MANIFEST_URL = '';
		const { resolveOcamlManifestUrl } = await import('./assets');

		expect(resolveOcamlManifestUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
		);
	});

	it('prefers an explicit TinyGo runtime module url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_TINYGO_APP_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL = 'https://env.example.com/wasm-tinygo/runtime.js';
		const { resolveTinyGoModuleUrl } = await import('./assets');

		expect(
			resolveTinyGoModuleUrl(
				{
					tinygo: {
						moduleUrl: '/runtime/tinygo/runtime.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/tinygo/runtime.js');
	});

	it('derives the default TinyGo runtime module url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_APP_URL = '';
		const { resolveTinyGoModuleUrl } = await import('./assets');

		expect(resolveTinyGoModuleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-tinygo/runtime.js'
		);
	});

	it('derives the TinyGo runtime module url from the legacy app url override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_APP_URL =
			'https://env.example.com/wasm-tinygo/index.html?v=42';
		const { resolveTinyGoModuleUrl } = await import('./assets');

		expect(resolveTinyGoModuleUrl(undefined, 'https://example.com/app')).toBe(
			'https://env.example.com/wasm-tinygo/runtime.js?v=42'
		);
	});

	it('prefers an explicit TypeScript module url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_TYPESCRIPT_MODULE_URL =
			'https://env.example.com/wasm-typescript/index.js';
		const { resolveTypeScriptModuleUrl } = await import('./assets');

		expect(
			resolveTypeScriptModuleUrl(
				{
					typescript: {
						moduleUrl: '/runtime/wasm-typescript/index.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/wasm-typescript/index.js');
	});

	it('derives the default TypeScript module url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_TYPESCRIPT_MODULE_URL = '';
		const { resolveTypeScriptModuleUrl } = await import('./assets');

		expect(resolveTypeScriptModuleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-typescript/index.js'
		);
	});

	it('prefers an explicit WAT module url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_WAT_MODULE_URL = 'https://env.example.com/wasm-wat/index.js';
		const { resolveWatModuleUrl } = await import('./assets');

		expect(
			resolveWatModuleUrl(
				{
					wat: {
						moduleUrl: '/runtime/wasm-wat/index.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/wasm-wat/index.js');
	});

	it('derives the default WAT module url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_WAT_MODULE_URL = '';
		const { resolveWatModuleUrl } = await import('./assets');

		expect(resolveWatModuleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-wat/index.js'
		);
	});

	it('prefers an explicit Lua module url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_LUA_MODULE_URL = 'https://env.example.com/wasm-lua/index.js';
		const { resolveLuaModuleUrl } = await import('./assets');

		expect(
			resolveLuaModuleUrl(
				{
					lua: {
						moduleUrl: '/runtime/wasm-lua/index.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/wasm-lua/index.js');
	});

	it('derives the default Lua module url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_LUA_MODULE_URL = '';
		const { resolveLuaModuleUrl } = await import('./assets');

		expect(resolveLuaModuleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-lua/index.js'
		);
	});

	it('prefers explicit Zig compiler and stdlib urls over public env overrides', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_ZIG_COMPILER_URL = 'https://env.example.com/zig_small.wasm';
		publicEnv.PUBLIC_WASM_ZIG_STDLIB_URL = 'https://env.example.com/std.tar.gz';
		const { resolveZigCompilerUrl, resolveZigStdlibUrl } = await import('./assets');

		const config = {
			zig: {
				compilerUrl: '/runtime/wasm-zig/zig_small.wasm',
				stdlibUrl: '/runtime/wasm-zig/std.tar.gz'
			}
		};
		expect(resolveZigCompilerUrl(config, 'https://example.com/app')).toBe(
			'https://example.com/runtime/wasm-zig/zig_small.wasm'
		);
		expect(resolveZigStdlibUrl(config, 'https://example.com/app')).toBe(
			'https://example.com/runtime/wasm-zig/std.tar.gz'
		);
	});

	it('derives default Zig asset urls from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_ZIG_COMPILER_URL = '';
		publicEnv.PUBLIC_WASM_ZIG_STDLIB_URL = '';
		const { resolveZigCompilerUrl, resolveZigStdlibUrl } = await import('./assets');

		expect(resolveZigCompilerUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-zig/zig_small.wasm'
		);
		expect(resolveZigStdlibUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-zig/std.tar.gz'
		);
	});

	it('prefers an explicit Lisp module url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_LISP_MODULE_URL = 'https://env.example.com/wasm-lisp/index.js';
		const { resolveLispModuleUrl } = await import('./assets');

		expect(
			resolveLispModuleUrl(
				{
					lisp: {
						moduleUrl: '/runtime/wasm-lisp/index.js'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/wasm-lisp/index.js');
	});

	it('derives the default Lisp module url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_LISP_MODULE_URL = '';
		const { resolveLispModuleUrl } = await import('./assets');

		expect(resolveLispModuleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-lisp/index.js'
		);
	});

	it('prefers an explicit Ruby wasm url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_RUBY_WASM_URL = 'https://env.example.com/ruby+stdlib.wasm';
		const { resolveRubyWasmUrl } = await import('./assets');

		expect(
			resolveRubyWasmUrl(
				{
					ruby: {
						wasmUrl: '/runtime/ruby+stdlib.wasm'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/ruby+stdlib.wasm');
	});

	it('falls back to PUBLIC_WASM_RUBY_WASM_URL when no Ruby runtime config is provided', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_RUBY_WASM_URL = '/ruby/ruby+stdlib.wasm';
		const { resolveRubyWasmUrl } = await import('./assets');

		expect(resolveRubyWasmUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/ruby/ruby+stdlib.wasm'
		);
	});

	it('uses the bundled Ruby wasm asset when no Ruby asset url is configured', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_RUBY_WASM_URL = '';
		const { resolveRubyWasmUrl } = await import('./assets');

		expect(resolveRubyWasmUrl('/absproxy/5173', 'https://example.com/app')).toBe('');
	});

	it('prefers an explicit R base url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_R_BASE_URL = 'https://env.example.com/webr/';
		const { resolveRBaseUrl } = await import('./assets');

		expect(
			resolveRBaseUrl(
				{
					r: {
						baseUrl: '/runtime/webr/test'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/webr/test/');
	});

	it('falls back to PUBLIC_WASM_R_BASE_URL when no R runtime config is provided', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_R_BASE_URL = '/webr/test';
		const { resolveRBaseUrl } = await import('./assets');

		expect(resolveRBaseUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/webr/test/'
		);
	});

	it('derives the default R base url from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_R_BASE_URL = '';
		const { resolveRBaseUrl } = await import('./assets');

		expect(resolveRBaseUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/webr/'
		);
	});

	it('prefers explicit Octave runtime urls over public env overrides', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_OCTAVE_BASE_URL = 'https://env.example.com/octave/runtime/';
		publicEnv.PUBLIC_WASM_OCTAVE_WORKER_URL = 'https://env.example.com/octave/worker.js';
		publicEnv.PUBLIC_WASM_OCTAVE_MANIFEST_URL = 'https://env.example.com/octave/manifest.json';
		const { resolveOctaveRuntimeAssetConfig } = await import('./assets');

		expect(
			resolveOctaveRuntimeAssetConfig(
				{
					octave: {
						baseUrl: '/runtime/wasm-octave/runtime',
						workerUrl: '/runtime/wasm-octave/runner-worker.js',
						manifestUrl: '/runtime/wasm-octave/runtime/runtime-manifest.v1.json'
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/wasm-octave/runtime/',
			workerUrl: 'https://example.com/runtime/wasm-octave/runner-worker.js',
			manifestUrl: 'https://example.com/runtime/wasm-octave/runtime/runtime-manifest.v1.json'
		});
	});

	it('derives default Octave runtime urls from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_OCTAVE_BASE_URL = '';
		publicEnv.PUBLIC_WASM_OCTAVE_WORKER_URL = '';
		publicEnv.PUBLIC_WASM_OCTAVE_MANIFEST_URL = '';
		const { resolveOctaveRuntimeAssetConfig } = await import('./assets');

		expect(
			resolveOctaveRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-octave/runtime/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-octave/runner-worker.js',
			manifestUrl:
				'https://example.com/absproxy/5173/wasm-octave/runtime/runtime-manifest.v1.json'
		});
	});

	it('derives default static worker runtime urls from the shared root path', async () => {
		vi.resetModules();
		const {
			resolveAwkRuntimeAssetConfig,
			resolveForthRuntimeAssetConfig,
			resolveGleamRuntimeAssetConfig,
			resolveJRuntimeAssetConfig,
			resolveJanetRuntimeAssetConfig,
			resolveJuliaRuntimeAssetConfig,
			resolveNimRuntimeAssetConfig,
			resolveSwiftRuntimeAssetConfig,
			resolveBqnRuntimeAssetConfig,
			resolvePascalRuntimeAssetConfig,
			resolvePerlRuntimeAssetConfig,
			resolvePrologRuntimeAssetConfig,
			resolveTclRuntimeAssetConfig
		} = await import('./assets');

		expect(
			resolvePrologRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-prolog/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-prolog/runner-worker.js'
		});
		expect(resolveGleamRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://example.com/absproxy/5173/wasm-gleam/',
				workerUrl: 'https://example.com/absproxy/5173/wasm-gleam/runner-worker.js',
				manifestUrl: 'https://example.com/absproxy/5173/wasm-gleam/source-manifest.v1.json'
			}
		);
		expect(resolvePerlRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-perl/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-perl/runner-worker.js'
		});
		expect(resolveTclRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-tcl/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-tcl/runner-worker.js'
		});
		expect(resolveAwkRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-awk/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-awk/runner-worker.js'
		});
		expect(
			resolvePascalRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-pascal/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-pascal/runner-worker.js'
		});
		expect(resolveForthRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://example.com/absproxy/5173/wasm-forth/',
				workerUrl: 'https://example.com/absproxy/5173/wasm-forth/runner-worker.js'
			}
		);
		expect(resolveJRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-j/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-j/runner-worker.js'
		});
		expect(resolveBqnRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-bqn/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-bqn/runner-worker.js'
		});
		expect(resolveJanetRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://example.com/absproxy/5173/wasm-janet/',
				workerUrl: 'https://example.com/absproxy/5173/wasm-janet/runner-worker.js'
			}
		);
		expect(resolveJuliaRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://example.com/absproxy/5173/wasm-julia/',
				workerUrl: 'https://example.com/absproxy/5173/wasm-julia/runner-worker.js'
			}
		);
		expect(resolveNimRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-nim/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-nim/runner-worker.js'
		});
		expect(resolveSwiftRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://example.com/absproxy/5173/wasm-swift/',
				workerUrl: 'https://example.com/absproxy/5173/wasm-swift/runner-worker.js',
				manifestUrl: 'https://example.com/absproxy/5173/wasm-swift/runtime-manifest.v1.json'
			}
		);
	});

	it('prefers explicit static worker runtime urls over public env overrides', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_PROLOG_BASE_URL = 'https://env.example.com/prolog/';
		publicEnv.PUBLIC_WASM_GLEAM_BASE_URL = 'https://env.example.com/gleam/';
		publicEnv.PUBLIC_WASM_PERL_BASE_URL = 'https://env.example.com/perl/';
		publicEnv.PUBLIC_WASM_TCL_BASE_URL = 'https://env.example.com/tcl/';
		publicEnv.PUBLIC_WASM_AWK_BASE_URL = 'https://env.example.com/awk/';
		publicEnv.PUBLIC_WASM_PASCAL_BASE_URL = 'https://env.example.com/pascal/';
		publicEnv.PUBLIC_WASM_FORTH_BASE_URL = 'https://env.example.com/forth/';
		publicEnv.PUBLIC_WASM_J_BASE_URL = 'https://env.example.com/j/';
		publicEnv.PUBLIC_WASM_BQN_BASE_URL = 'https://env.example.com/bqn/';
		publicEnv.PUBLIC_WASM_JANET_BASE_URL = 'https://env.example.com/janet/';
		publicEnv.PUBLIC_WASM_JULIA_BASE_URL = 'https://env.example.com/julia/';
		publicEnv.PUBLIC_WASM_NIM_BASE_URL = 'https://env.example.com/nim/';
		publicEnv.PUBLIC_WASM_SWIFT_BASE_URL = 'https://env.example.com/swift/';
		const {
			resolveAwkRuntimeAssetConfig,
			resolveBqnRuntimeAssetConfig,
			resolveForthRuntimeAssetConfig,
			resolveGleamRuntimeAssetConfig,
			resolveJRuntimeAssetConfig,
			resolveJanetRuntimeAssetConfig,
			resolveJuliaRuntimeAssetConfig,
			resolveNimRuntimeAssetConfig,
			resolveSwiftRuntimeAssetConfig,
			resolvePascalRuntimeAssetConfig,
			resolvePerlRuntimeAssetConfig,
			resolvePrologRuntimeAssetConfig,
			resolveTclRuntimeAssetConfig
		} = await import('./assets');

		expect(
			resolvePrologRuntimeAssetConfig(
				{ prolog: { baseUrl: '/runtime/prolog', workerUrl: '/runtime/prolog/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/prolog/',
			workerUrl: 'https://example.com/runtime/prolog/worker.js'
		});
		expect(
			resolveGleamRuntimeAssetConfig(
				{
					gleam: {
						baseUrl: '/runtime/gleam',
						workerUrl: '/runtime/gleam/worker.js',
						manifestUrl: '/runtime/gleam/manifest.json'
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/gleam/',
			workerUrl: 'https://example.com/runtime/gleam/worker.js',
			manifestUrl: 'https://example.com/runtime/gleam/manifest.json'
		});
		expect(
			resolvePerlRuntimeAssetConfig(
				{ perl: { baseUrl: '/runtime/perl', workerUrl: '/runtime/perl/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/perl/',
			workerUrl: 'https://example.com/runtime/perl/worker.js'
		});
		expect(
			resolveTclRuntimeAssetConfig(
				{ tcl: { baseUrl: '/runtime/tcl', workerUrl: '/runtime/tcl/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/tcl/',
			workerUrl: 'https://example.com/runtime/tcl/worker.js'
		});
		expect(
			resolveAwkRuntimeAssetConfig(
				{ awk: { baseUrl: '/runtime/awk', workerUrl: '/runtime/awk/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/awk/',
			workerUrl: 'https://example.com/runtime/awk/worker.js'
		});
		expect(
			resolvePascalRuntimeAssetConfig(
				{ pascal: { baseUrl: '/runtime/pascal', workerUrl: '/runtime/pascal/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/pascal/',
			workerUrl: 'https://example.com/runtime/pascal/worker.js'
		});
		expect(
			resolveForthRuntimeAssetConfig(
				{ forth: { baseUrl: '/runtime/forth', workerUrl: '/runtime/forth/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/forth/',
			workerUrl: 'https://example.com/runtime/forth/worker.js'
		});
		expect(
			resolveJRuntimeAssetConfig(
				{ j: { baseUrl: '/runtime/j', workerUrl: '/runtime/j/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/j/',
			workerUrl: 'https://example.com/runtime/j/worker.js'
		});
		expect(
			resolveBqnRuntimeAssetConfig(
				{ bqn: { baseUrl: '/runtime/bqn', workerUrl: '/runtime/bqn/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/bqn/',
			workerUrl: 'https://example.com/runtime/bqn/worker.js'
		});
		expect(
			resolveJanetRuntimeAssetConfig(
				{ janet: { baseUrl: '/runtime/janet', workerUrl: '/runtime/janet/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/janet/',
			workerUrl: 'https://example.com/runtime/janet/worker.js'
		});
		expect(
			resolveJuliaRuntimeAssetConfig(
				{ julia: { baseUrl: '/runtime/julia', workerUrl: '/runtime/julia/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/julia/',
			workerUrl: 'https://example.com/runtime/julia/worker.js'
		});
		expect(
			resolveNimRuntimeAssetConfig(
				{ nim: { baseUrl: '/runtime/nim', workerUrl: '/runtime/nim/worker.js' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/nim/',
			workerUrl: 'https://example.com/runtime/nim/worker.js'
		});
		expect(
			resolveSwiftRuntimeAssetConfig(
				{
					swift: {
						baseUrl: '/runtime/swift',
						workerUrl: '/runtime/swift/worker.js',
						manifestUrl: '/runtime/swift/manifest.json'
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/swift/',
			workerUrl: 'https://example.com/runtime/swift/worker.js',
			manifestUrl: 'https://example.com/runtime/swift/manifest.json'
		});
	});

	it('derives Swift worker and manifest urls from an explicit Swift base url', async () => {
		const { resolveSwiftRuntimeAssetConfig } = await import('./assets');

		expect(
			resolveSwiftRuntimeAssetConfig(
				{
					rootUrl: '/ignored',
					swift: {
						baseUrl: 'https://cdn.example.com/swift-runtime/releases/abc123'
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://cdn.example.com/swift-runtime/releases/abc123/',
			workerUrl: 'https://cdn.example.com/swift-runtime/releases/abc123/runner-worker.js',
			manifestUrl:
				'https://cdn.example.com/swift-runtime/releases/abc123/runtime-manifest.v1.json'
		});
	});

	it('falls back to PUBLIC_WASM_SWIFT urls when no Swift runtime config is provided', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_SWIFT_BASE_URL = 'https://cdn.example.com/swift-runtime';
		publicEnv.PUBLIC_WASM_SWIFT_WORKER_URL = 'https://cdn.example.com/swift-worker.js?v=abc';
		publicEnv.PUBLIC_WASM_SWIFT_MANIFEST_URL =
			'https://cdn.example.com/swift-runtime/runtime-manifest.v1.json?v=abc';
		const { resolveSwiftRuntimeAssetConfig } = await import('./assets');

		expect(resolveSwiftRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://cdn.example.com/swift-runtime/',
				workerUrl: 'https://cdn.example.com/swift-worker.js?v=abc',
				manifestUrl: 'https://cdn.example.com/swift-runtime/runtime-manifest.v1.json?v=abc'
			}
		);
	});

	it('derives Swift worker and manifest urls from PUBLIC_WASM_SWIFT_BASE_URL', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_SWIFT_BASE_URL = 'https://cdn.example.com/swift-runtime';
		publicEnv.PUBLIC_WASM_SWIFT_WORKER_URL = '';
		publicEnv.PUBLIC_WASM_SWIFT_MANIFEST_URL = '';
		const { resolveSwiftRuntimeAssetConfig } = await import('./assets');

		expect(resolveSwiftRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://cdn.example.com/swift-runtime/',
				workerUrl: 'https://cdn.example.com/swift-runtime/runner-worker.js',
				manifestUrl: 'https://cdn.example.com/swift-runtime/runtime-manifest.v1.json'
			}
		);
	});

	it('derives static runtime module urls from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_ASSEMBLYSCRIPT_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_DUCKDB_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_PHP_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_RUBY_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_SQLITE_MODULE_URL = '';
		const {
			resolveAssemblyScriptRuntimeModuleUrl,
			resolveDuckDbRuntimeModuleUrl,
			resolvePhpRuntimeModuleUrl,
			resolveRubyRuntimeModuleUrl,
			resolveSqliteRuntimeModuleUrl
		} = await import('./assets');

		expect(resolveAssemblyScriptRuntimeModuleUrl('/app', 'https://example.com/')).toBe(
			'https://example.com/app/wasm-assemblyscript/runtime.mjs'
		);
		expect(resolveDuckDbRuntimeModuleUrl('/app', 'https://example.com/')).toBe(
			'https://example.com/app/wasm-duckdb/runtime.mjs'
		);
		expect(resolvePhpRuntimeModuleUrl('/app', 'https://example.com/')).toBe(
			'https://example.com/app/wasm-php/runtime.mjs'
		);
		expect(resolveRubyRuntimeModuleUrl('/app', 'https://example.com/')).toBe(
			'https://example.com/app/wasm-ruby/runtime.mjs'
		);
		expect(resolveSqliteRuntimeModuleUrl('/app', 'https://example.com/')).toBe(
			'https://example.com/app/wasm-sqlite/runtime.mjs'
		);
	});

	it('prefers an explicit SQLite wasm url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_SQLITE_WASM_URL = 'https://env.example.com/sql-wasm.wasm';
		const { resolveSqliteWasmUrl } = await import('./assets');

		expect(
			resolveSqliteWasmUrl(
				{
					sqlite: {
						wasmUrl: '/runtime/sql-wasm.wasm'
					}
				},
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/sql-wasm.wasm');
	});

	it('falls back to PUBLIC_WASM_SQLITE_WASM_URL when no SQLite runtime config is provided', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_SQLITE_WASM_URL = '/sqlite/sql-wasm.wasm';
		const { resolveSqliteWasmUrl } = await import('./assets');

		expect(resolveSqliteWasmUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/sqlite/sql-wasm.wasm'
		);
	});

	it('uses the bundled SQLite wasm asset when no SQLite asset url is configured', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_SQLITE_WASM_URL = '';
		const { resolveSqliteWasmUrl } = await import('./assets');

		expect(resolveSqliteWasmUrl('/absproxy/5173', 'https://example.com/app')).toBe('');
	});

	it('prefers explicit Haskell asset urls over public env overrides', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_HASKELL_MODULE_URL = 'https://env.example.com/dyld.mjs';
		publicEnv.PUBLIC_WASM_HASKELL_ROOTFS_URL = 'https://env.example.com/rootfs.tar.zst';
		publicEnv.PUBLIC_WASM_HASKELL_BSDTAR_URL = 'https://env.example.com/bsdtar.wasm';
		const { resolveHaskellModuleUrl, resolveHaskellRootfsUrl, resolveHaskellBsdtarUrl } =
			await import('./assets');

		const config = {
			haskell: {
				moduleUrl: '/runtime/wasm-haskell/dyld.mjs',
				rootfsUrl: '/runtime/wasm-haskell/rootfs.tar.zst',
				bsdtarUrl: '/runtime/wasm-haskell/bsdtar.wasm'
			}
		};
		expect(resolveHaskellModuleUrl(config, 'https://example.com/app')).toBe(
			'https://example.com/runtime/wasm-haskell/dyld.mjs'
		);
		expect(resolveHaskellRootfsUrl(config, 'https://example.com/app')).toBe(
			'https://example.com/runtime/wasm-haskell/rootfs.tar.zst'
		);
		expect(resolveHaskellBsdtarUrl(config, 'https://example.com/app')).toBe(
			'https://example.com/runtime/wasm-haskell/bsdtar.wasm'
		);
	});

	it('derives default Haskell asset urls from the shared root path', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_HASKELL_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_HASKELL_ROOTFS_URL = '';
		publicEnv.PUBLIC_WASM_HASKELL_BSDTAR_URL = '';
		const { resolveHaskellModuleUrl, resolveHaskellRootfsUrl, resolveHaskellBsdtarUrl } =
			await import('./assets');

		expect(resolveHaskellModuleUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-haskell/dyld.mjs'
		);
		expect(resolveHaskellRootfsUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-haskell/rootfs.tar.zst'
		);
		expect(resolveHaskellBsdtarUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-haskell/bsdtar.wasm'
		);
	});

	it('derives default Fortran asset urls from the shared root path', () => {
		expect(
			resolveFortranRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-fortran/',
			f2cWasmUrl: 'https://example.com/absproxy/5173/wasm-fortran/f2c.wasm',
			libf2cUrl: 'https://example.com/absproxy/5173/wasm-fortran/libf2c.a',
			f2cHeaderUrl: 'https://example.com/absproxy/5173/wasm-fortran/f2c.h',
			analyzerUrl: 'https://example.com/absproxy/5173/wasm-fortran/analyzer.js'
		});
	});

	it('derives the COBOL runtime base url from the shared root path', () => {
		expect(resolveCobolBaseUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-cobol/'
		);
	});

	it('prefers an explicit COBOL runtime base url over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_COBOL_BASE_URL = 'https://env.example.com/cobol/';
		const { resolveCobolBaseUrl } = await import('./assets');

		expect(
			resolveCobolBaseUrl(
				{ cobol: { baseUrl: '/runtime/cobol/' } },
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/cobol/');
	});

	it('prefers explicit Fortran asset urls over public env overrides', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_FORTRAN_BASE_URL = 'https://env.example.com/fortran/';
		publicEnv.PUBLIC_WASM_FORTRAN_F2C_WASM_URL = 'https://env.example.com/f2c.wasm';
		publicEnv.PUBLIC_WASM_FORTRAN_LIBF2C_URL = 'https://env.example.com/libf2c.a';
		publicEnv.PUBLIC_WASM_FORTRAN_F2C_HEADER_URL = 'https://env.example.com/f2c.h';
		publicEnv.PUBLIC_WASM_FORTRAN_ANALYZER_URL = 'https://env.example.com/analyzer.js';
		const { resolveFortranRuntimeAssetConfig } = await import('./assets');

		expect(
			resolveFortranRuntimeAssetConfig(
				{
					fortran: {
						baseUrl: '/runtime/fortran/',
						f2cWasmUrl: '/runtime/fortran/f2c.wasm?v=test',
						libf2cUrl: '/runtime/fortran/libf2c.a?v=test',
						f2cHeaderUrl: '/runtime/fortran/f2c.h?v=test',
						analyzerUrl: '/runtime/fortran/analyzer.js?v=test'
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/fortran/',
			f2cWasmUrl: 'https://example.com/runtime/fortran/f2c.wasm?v=test',
			libf2cUrl: 'https://example.com/runtime/fortran/libf2c.a?v=test',
			f2cHeaderUrl: 'https://example.com/runtime/fortran/f2c.h?v=test',
			analyzerUrl: 'https://example.com/runtime/fortran/analyzer.js?v=test'
		});
	});

	it('falls back to PUBLIC_WASM_FORTRAN_BASE_URL for unconfigured Fortran asset urls', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_FORTRAN_BASE_URL = 'https://env.example.com/fortran';
		publicEnv.PUBLIC_WASM_FORTRAN_F2C_WASM_URL = '';
		publicEnv.PUBLIC_WASM_FORTRAN_LIBF2C_URL = '';
		publicEnv.PUBLIC_WASM_FORTRAN_F2C_HEADER_URL = '';
		publicEnv.PUBLIC_WASM_FORTRAN_ANALYZER_URL = '';
		const { resolveFortranRuntimeAssetConfig } = await import('./assets');

		expect(resolveFortranRuntimeAssetConfig(undefined, 'https://example.com/app')).toEqual({
			baseUrl: 'https://env.example.com/fortran/',
			f2cWasmUrl: 'https://env.example.com/fortran/f2c.wasm',
			libf2cUrl: 'https://env.example.com/fortran/libf2c.a',
			f2cHeaderUrl: 'https://env.example.com/fortran/f2c.h',
			analyzerUrl: 'https://env.example.com/fortran/analyzer.js'
		});
	});

	it('derives default Objective-C asset urls from the shared root path', () => {
		expect(
			resolveObjectiveCRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-objectivec/',
			libobjcUrl: 'https://example.com/absproxy/5173/wasm-objectivec/libobjc.a',
			headersUrl: 'https://example.com/absproxy/5173/wasm-objectivec/headers.json',
			libgnustepBaseUrl:
				'https://example.com/absproxy/5173/wasm-objectivec/libgnustep-base.a',
			libgnustepBaseObjectUrl:
				'https://example.com/absproxy/5173/wasm-objectivec/libgnustep-base.o',
			foundationHeadersUrl:
				'https://example.com/absproxy/5173/wasm-objectivec/foundation-headers.json',
			libffiUrl: 'https://example.com/absproxy/5173/wasm-objectivec/libffi.a'
		});
	});

	it('prefers explicit Objective-C asset urls over public env overrides', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_OBJECTIVEC_BASE_URL = 'https://env.example.com/objectivec/';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_LIBOBJC_URL = 'https://env.example.com/libobjc.a';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_HEADERS_URL = 'https://env.example.com/headers.json';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_URL =
			'https://env.example.com/libgnustep-base.a';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_OBJECT_URL =
			'https://env.example.com/libgnustep-base.o';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_FOUNDATION_HEADERS_URL =
			'https://env.example.com/foundation-headers.json';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_LIBFFI_URL = 'https://env.example.com/libffi.a';
		const { resolveObjectiveCRuntimeAssetConfig } = await import('./assets');

		expect(
			resolveObjectiveCRuntimeAssetConfig(
				{
					objectivec: {
						baseUrl: '/runtime/objectivec/',
						libobjcUrl: '/runtime/objectivec/libobjc.a?v=test',
						headersUrl: '/runtime/objectivec/headers.json?v=test',
						libgnustepBaseUrl: '/runtime/objectivec/libgnustep-base.a?v=test',
						libgnustepBaseObjectUrl: '/runtime/objectivec/libgnustep-base.o?v=test',
						foundationHeadersUrl: '/runtime/objectivec/foundation-headers.json?v=test',
						libffiUrl: '/runtime/objectivec/libffi.a?v=test'
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/objectivec/',
			libobjcUrl: 'https://example.com/runtime/objectivec/libobjc.a?v=test',
			headersUrl: 'https://example.com/runtime/objectivec/headers.json?v=test',
			libgnustepBaseUrl: 'https://example.com/runtime/objectivec/libgnustep-base.a?v=test',
			libgnustepBaseObjectUrl:
				'https://example.com/runtime/objectivec/libgnustep-base.o?v=test',
			foundationHeadersUrl:
				'https://example.com/runtime/objectivec/foundation-headers.json?v=test',
			libffiUrl: 'https://example.com/runtime/objectivec/libffi.a?v=test'
		});
	});

	it('falls back to PUBLIC_WASM_OBJECTIVEC_BASE_URL for unconfigured Objective-C asset urls', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_OBJECTIVEC_BASE_URL = 'https://env.example.com/objectivec';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_LIBOBJC_URL = '';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_HEADERS_URL = '';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_URL = '';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_OBJECT_URL = '';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_FOUNDATION_HEADERS_URL = '';
		publicEnv.PUBLIC_WASM_OBJECTIVEC_LIBFFI_URL = '';
		const { resolveObjectiveCRuntimeAssetConfig } = await import('./assets');

		expect(resolveObjectiveCRuntimeAssetConfig(undefined, 'https://example.com/app')).toEqual({
			baseUrl: 'https://env.example.com/objectivec/',
			libobjcUrl: 'https://env.example.com/objectivec/libobjc.a',
			headersUrl: 'https://env.example.com/objectivec/headers.json',
			libgnustepBaseUrl: 'https://env.example.com/objectivec/libgnustep-base.a',
			libgnustepBaseObjectUrl: 'https://env.example.com/objectivec/libgnustep-base.o',
			foundationHeadersUrl: 'https://env.example.com/objectivec/foundation-headers.json',
			libffiUrl: 'https://env.example.com/objectivec/libffi.a'
		});
	});
});
