import { describe, expect, it } from 'vitest';

import {
	resolveCppLanguageServerBaseUrl,
	resolveCppLanguageServerRuntimeAssetConfig,
	resolveElixirLanguageServerBundleUrl,
	resolveElixirLanguageServerWorkerUrl,
	resolveErlangLanguageServerBundleUrl,
	resolveErlangLanguageServerWorkerUrl,
	resolveGoLanguageServerCompilerUrl,
	resolveGleamLanguageServerBaseUrl,
	resolveGleamLanguageServerManifestUrl,
	resolveHaskellLanguageServerBsdtarUrl,
	resolveHaskellLanguageServerModuleUrl,
	resolveHaskellLanguageServerRootfsUrl,
	resolveAwkLanguageServerBaseUrl,
	resolveAwkLanguageServerWorkerUrl,
	resolvePythonLanguageServerBaseUrl,
	resolvePerlLanguageServerBaseUrl,
	resolvePerlLanguageServerWorkerUrl,
	resolveDotnetLanguageServerModuleUrl,
	resolveLuaLanguageServerModuleUrl,
	resolveOcamlLanguageServerManifestUrl,
	resolveOcamlLanguageServerModuleUrl,
	resolvePhpLanguageServerVersion,
	resolveRLanguageServerBaseUrl,
	resolveRustLanguageServerCompilerUrl,
	resolveZigLanguageServerCompilerUrl,
	resolveZigLanguageServerStdlibUrl
} from '../src/index.js';

describe('lsp runtime asset resolution', () => {
	it('resolves root-based cpp and python asset URLs', () => {
		expect(
			resolveCppLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/clangd/');
		expect(
			resolvePythonLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/pyodide/');
		expect(
			resolveRustLanguageServerCompilerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-rust/index.js');
		expect(
			resolveGoLanguageServerCompilerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-go/index.js');
		expect(
			resolveDotnetLanguageServerModuleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-dotnet/index.js');
		expect(
			resolveZigLanguageServerCompilerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-zig/zig_small.wasm');
		expect(
			resolveZigLanguageServerStdlibUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-zig/std.zip');
		expect(
			resolveLuaLanguageServerModuleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-lua/index.js');
		expect(
			resolveOcamlLanguageServerModuleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe(
			'https://static.example.com/repl_20240807/wasm-of-js-of-ocaml/browser-native/src/index.js'
		);
		expect(
			resolveOcamlLanguageServerManifestUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe(
			'https://static.example.com/repl_20240807/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
		);
		expect(
			resolveHaskellLanguageServerModuleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-haskell/dyld.mjs');
		expect(
			resolveHaskellLanguageServerRootfsUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-haskell/rootfs.tar.zst');
		expect(
			resolveHaskellLanguageServerBsdtarUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-haskell/bsdtar.wasm');
		expect(
			resolveGleamLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-gleam/');
		expect(
			resolveGleamLanguageServerManifestUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-gleam/source-manifest.v1.json');
		expect(
			resolveElixirLanguageServerBundleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-elixir/bundle.avm');
		expect(
			resolveErlangLanguageServerBundleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-elixir/bundle.avm');
		expect(
			resolveAwkLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-awk/');
		expect(
			resolveAwkLanguageServerWorkerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-awk/runner-worker.js');
		expect(
			resolvePerlLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-perl/');
		expect(
			resolvePerlLanguageServerWorkerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-perl/runner-worker.js');
		expect(
			resolveRLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/webr/');
	});

	it('prefers explicit per-language overrides', () => {
		const options = {
			rootUrl: 'https://static.example.com/repl_20240807',
			cpp: {
				baseUrl: 'https://cpp.example.com/assets'
			},
			python: {
				baseUrl: 'https://python.example.com/assets/'
			},
			rust: {
				compilerUrl: 'https://rust.example.com/wasm-rust/index.js?v=20240807'
			},
			go: {
				compilerUrl: 'https://go.example.com/wasm-go/index.js?v=20240807'
			},
			dotnet: {
				moduleUrl: 'https://dotnet.example.com/wasm-dotnet/index.js?v=20240807'
			},
			zig: {
				compilerUrl: 'https://zig.example.com/zig_small.wasm?v=20240807',
				stdlibUrl: 'https://zig.example.com/std.zip?v=20240807'
			},
			lua: {
				moduleUrl: 'https://lua.example.com/wasm-lua/index.js?v=20240807'
			},
			ocaml: {
				moduleUrl: 'https://ocaml.example.com/index.js?v=20240807',
				manifestUrl: 'https://ocaml.example.com/manifest.json?v=20240807'
			},
			haskell: {
				moduleUrl: 'https://haskell.example.com/dyld.mjs?v=20240807',
				rootfsUrl: 'https://haskell.example.com/rootfs.tar.zst?v=20240807',
				bsdtarUrl: 'https://haskell.example.com/bsdtar.wasm?v=20240807'
			},
			php: {
				version: '8.5'
			},
			gleam: {
				baseUrl: 'https://gleam.example.com/wasm-gleam/',
				manifestUrl: 'https://gleam.example.com/manifest.json'
			},
			elixir: {
				bundleUrl: 'https://beam.example.com/bundle.avm?v=20240807',
				workerUrl: 'https://app.example.com/assets/elixir-worker.js'
			},
			erlang: {
				bundleUrl: 'https://erlang.example.com/bundle.avm?v=20240807',
				workerUrl: 'https://app.example.com/assets/erlang-worker.js'
			},
			awk: {
				baseUrl: 'https://awk.example.com/wasm-awk/',
				workerUrl: 'https://awk.example.com/runner-worker.js?v=20240807'
			},
			perl: {
				baseUrl: 'https://perl.example.com/wasm-perl/',
				workerUrl: 'https://perl.example.com/runner-worker.js?v=20240807'
			},
			r: {
				baseUrl: 'https://r.example.com/webr/0.6.0/'
			}
		};

		expect(resolveCppLanguageServerBaseUrl(options)).toBe('https://cpp.example.com/assets/');
		expect(resolvePythonLanguageServerBaseUrl(options)).toBe(
			'https://python.example.com/assets/'
		);
		expect(resolveRustLanguageServerCompilerUrl(options)).toBe(
			'https://rust.example.com/wasm-rust/index.js?v=20240807'
		);
		expect(resolveGoLanguageServerCompilerUrl(options)).toBe(
			'https://go.example.com/wasm-go/index.js?v=20240807'
		);
		expect(resolveDotnetLanguageServerModuleUrl(options)).toBe(
			'https://dotnet.example.com/wasm-dotnet/index.js?v=20240807'
		);
		expect(resolveZigLanguageServerCompilerUrl(options)).toBe(
			'https://zig.example.com/zig_small.wasm?v=20240807'
		);
		expect(resolveZigLanguageServerStdlibUrl(options)).toBe(
			'https://zig.example.com/std.zip?v=20240807'
		);
		expect(resolveLuaLanguageServerModuleUrl(options)).toBe(
			'https://lua.example.com/wasm-lua/index.js?v=20240807'
		);
		expect(resolveOcamlLanguageServerModuleUrl(options)).toBe(
			'https://ocaml.example.com/index.js?v=20240807'
		);
		expect(resolveOcamlLanguageServerManifestUrl(options)).toBe(
			'https://ocaml.example.com/manifest.json?v=20240807'
		);
		expect(resolveHaskellLanguageServerModuleUrl(options)).toBe(
			'https://haskell.example.com/dyld.mjs?v=20240807'
		);
		expect(resolveHaskellLanguageServerRootfsUrl(options)).toBe(
			'https://haskell.example.com/rootfs.tar.zst?v=20240807'
		);
		expect(resolveHaskellLanguageServerBsdtarUrl(options)).toBe(
			'https://haskell.example.com/bsdtar.wasm?v=20240807'
		);
		expect(resolvePhpLanguageServerVersion(options)).toBe('8.5');
		expect(resolveGleamLanguageServerBaseUrl(options)).toBe(
			'https://gleam.example.com/wasm-gleam/'
		);
		expect(resolveGleamLanguageServerManifestUrl(options)).toBe(
			'https://gleam.example.com/manifest.json'
		);
		expect(resolveElixirLanguageServerBundleUrl(options)).toBe(
			'https://beam.example.com/bundle.avm?v=20240807'
		);
		expect(resolveElixirLanguageServerWorkerUrl(options)).toBe(
			'https://app.example.com/assets/elixir-worker.js'
		);
		expect(resolveErlangLanguageServerBundleUrl(options)).toBe(
			'https://erlang.example.com/bundle.avm?v=20240807'
		);
		expect(resolveErlangLanguageServerWorkerUrl(options)).toBe(
			'https://app.example.com/assets/erlang-worker.js'
		);
		expect(resolveAwkLanguageServerBaseUrl(options)).toBe('https://awk.example.com/wasm-awk/');
		expect(resolveAwkLanguageServerWorkerUrl(options)).toBe(
			'https://awk.example.com/runner-worker.js?v=20240807'
		);
		expect(resolvePerlLanguageServerBaseUrl(options)).toBe(
			'https://perl.example.com/wasm-perl/'
		);
		expect(resolvePerlLanguageServerWorkerUrl(options)).toBe(
			'https://perl.example.com/runner-worker.js?v=20240807'
		);
		expect(resolveRLanguageServerBaseUrl(options)).toBe('https://r.example.com/webr/0.6.0/');
	});

	it('preserves cpp loader configuration for clangd worker assets', () => {
		const loader = async () => null;

		expect(
			resolveCppLanguageServerRuntimeAssetConfig({
				cpp: {
					baseUrl: 'https://cpp.example.com/assets',
					loader
				}
			})
		).toEqual({
			baseUrl: 'https://cpp.example.com/assets/',
			loader
		});
	});

	it('falls back to same-origin defaults when no runtime root is provided', () => {
		expect(resolveCppLanguageServerBaseUrl(undefined, 'https://app.example.com/editor')).toBe(
			'https://app.example.com/clangd/'
		);
		expect(
			resolvePythonLanguageServerBaseUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/pyodide/');
		expect(
			resolveRustLanguageServerCompilerUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-rust/index.js');
		expect(
			resolveGoLanguageServerCompilerUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-go/index.js');
		expect(
			resolveDotnetLanguageServerModuleUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-dotnet/index.js');
		expect(
			resolveZigLanguageServerCompilerUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-zig/zig_small.wasm');
		expect(resolveZigLanguageServerStdlibUrl(undefined, 'https://app.example.com/editor')).toBe(
			'https://app.example.com/wasm-zig/std.zip'
		);
		expect(resolveLuaLanguageServerModuleUrl(undefined, 'https://app.example.com/editor')).toBe(
			'https://app.example.com/wasm-lua/index.js'
		);
		expect(
			resolveOcamlLanguageServerModuleUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-of-js-of-ocaml/browser-native/src/index.js');
		expect(
			resolveOcamlLanguageServerManifestUrl(undefined, 'https://app.example.com/editor')
		).toBe(
			'https://app.example.com/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
		);
		expect(
			resolveHaskellLanguageServerModuleUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-haskell/dyld.mjs');
		expect(
			resolveHaskellLanguageServerRootfsUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-haskell/rootfs.tar.zst');
		expect(
			resolveHaskellLanguageServerBsdtarUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-haskell/bsdtar.wasm');
		expect(resolvePhpLanguageServerVersion(undefined)).toBe('8.4');
		expect(resolveGleamLanguageServerBaseUrl(undefined, 'https://app.example.com/editor')).toBe(
			'https://app.example.com/wasm-gleam/'
		);
		expect(
			resolveGleamLanguageServerManifestUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-gleam/source-manifest.v1.json');
		expect(
			resolveElixirLanguageServerBundleUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-elixir/bundle.avm');
		expect(
			resolveErlangLanguageServerBundleUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-elixir/bundle.avm');
		expect(
			resolveElixirLanguageServerWorkerUrl(undefined, 'https://app.example.com/editor')
		).toBe('');
		expect(
			resolveErlangLanguageServerWorkerUrl(undefined, 'https://app.example.com/editor')
		).toBe('');
		expect(resolveAwkLanguageServerBaseUrl(undefined, 'https://app.example.com/editor')).toBe(
			'https://app.example.com/wasm-awk/'
		);
		expect(resolveAwkLanguageServerWorkerUrl(undefined, 'https://app.example.com/editor')).toBe(
			'https://app.example.com/wasm-awk/runner-worker.js'
		);
		expect(resolvePerlLanguageServerBaseUrl(undefined, 'https://app.example.com/editor')).toBe(
			'https://app.example.com/wasm-perl/'
		);
		expect(
			resolvePerlLanguageServerWorkerUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-perl/runner-worker.js');
		expect(resolveRLanguageServerBaseUrl(undefined, 'https://app.example.com/editor')).toBe(
			'https://app.example.com/webr/'
		);
	});
});
