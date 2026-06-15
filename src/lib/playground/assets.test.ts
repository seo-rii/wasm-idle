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
		PUBLIC_WASM_RUBY_WASM_URL: '',
		PUBLIC_WASM_R_BASE_URL: '',
		PUBLIC_WASM_OCTAVE_BASE_URL: '',
		PUBLIC_WASM_OCTAVE_WORKER_URL: '',
		PUBLIC_WASM_OCTAVE_MANIFEST_URL: '',
		PUBLIC_WASM_SQLITE_WASM_URL: '',
		PUBLIC_WASM_PHP_VERSION: ''
	}
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import { resolveRuntimeAssetConfig } from './assets';

describe('runtime asset config resolution', () => {
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
		publicEnv.PUBLIC_WASM_ERLANG_BUNDLE_URL =
			'https://env.example.com/wasm-elixir/bundle.avm';
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
		publicEnv.PUBLIC_WASM_ZIG_STDLIB_URL = 'https://env.example.com/std.zip';
		const { resolveZigCompilerUrl, resolveZigStdlibUrl } = await import('./assets');

		const config = {
			zig: {
				compilerUrl: '/runtime/wasm-zig/zig_small.wasm',
				stdlibUrl: '/runtime/wasm-zig/std.zip'
			}
		};
		expect(resolveZigCompilerUrl(config, 'https://example.com/app')).toBe(
			'https://example.com/runtime/wasm-zig/zig_small.wasm'
		);
		expect(resolveZigStdlibUrl(config, 'https://example.com/app')).toBe(
			'https://example.com/runtime/wasm-zig/std.zip'
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
			'https://example.com/absproxy/5173/wasm-zig/std.zip'
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

	it('prefers an explicit PHP version over the public env override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_PHP_VERSION = '8.3';
		const { resolvePhpVersion } = await import('./assets');

		expect(
			resolvePhpVersion({
				php: {
					version: '8.5'
				}
			})
		).toBe('8.5');
	});

	it('falls back to PUBLIC_WASM_PHP_VERSION when no PHP runtime config is provided', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_PHP_VERSION = '8.2';
		const { resolvePhpVersion } = await import('./assets');

		expect(resolvePhpVersion('/absproxy/5173')).toBe('8.2');
	});

	it('uses PHP 8.4 when no PHP version is configured', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_PHP_VERSION = '';
		const { resolvePhpVersion } = await import('./assets');

		expect(resolvePhpVersion('/absproxy/5173')).toBe('8.4');
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
});
