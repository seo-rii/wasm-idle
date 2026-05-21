import { describe, expect, it, vi } from 'vitest';

const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_RUST_COMPILER_URL: '',
		PUBLIC_WASM_GO_COMPILER_URL: '',
		PUBLIC_WASM_DOTNET_MODULE_URL: '',
		PUBLIC_WASM_ELIXIR_BUNDLE_URL: '',
		PUBLIC_WASM_OCAML_MODULE_URL: '',
		PUBLIC_WASM_OCAML_MANIFEST_URL: '',
		PUBLIC_WASM_TINYGO_APP_URL: '',
		PUBLIC_WASM_TINYGO_MODULE_URL: '',
		PUBLIC_WASM_TYPESCRIPT_MODULE_URL: '',
		PUBLIC_WASM_ZIG_COMPILER_URL: '',
		PUBLIC_WASM_ZIG_STDLIB_URL: ''
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
});
