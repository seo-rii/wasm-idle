import { describe, expect, it } from 'vitest';

import { BUNDLED_CLANGD_ASSET_INTEGRITY } from '../src/bundledClangdAssetIntegrity.js';
import { BUNDLED_GLEAM_MANIFEST_FINGERPRINT } from '../src/bundledGleamRuntime.js';
import {
	LanguageServerAssetConfigurationError,
	resolveCppLanguageServerBaseUrl,
	resolveCppLanguageServerRuntimeAssetConfig,
	resolveDLanguageServerModuleUrl,
	resolveElixirLanguageServerBundleUrl,
	resolveElixirLanguageServerWorkerUrl,
	resolveErlangLanguageServerBundleUrl,
	resolveErlangLanguageServerWorkerUrl,
	resolveFortranLanguageServerAnalyzerUrl,
	resolveGoLanguageServerCompilerUrl,
	resolveGleamLanguageServerBaseUrl,
	resolveGleamLanguageServerManifestFingerprint,
	resolveGleamLanguageServerManifestUrl,
	resolveHaskellLanguageServerBsdtarUrl,
	resolveHaskellLanguageServerModuleUrl,
	resolveHaskellLanguageServerRootfsUrl,
	resolveJanetLanguageServerBaseUrl,
	resolveJanetLanguageServerWorkerUrl,
	resolveLispLanguageServerModuleUrl,
	resolveAwkLanguageServerBaseUrl,
	resolveAwkLanguageServerWorkerUrl,
	resolvePythonLanguageServerBaseUrl,
	resolvePerlLanguageServerBaseUrl,
	resolvePerlLanguageServerWorkerUrl,
	resolvePascalLanguageServerBaseUrl,
	resolvePascalLanguageServerWorkerUrl,
	resolveDotnetLanguageServerModuleUrl,
	resolveLuaLanguageServerModuleUrl,
	resolveOctaveLanguageServerBaseUrl,
	resolveOctaveLanguageServerManifestUrl,
	resolveOctaveLanguageServerWorkerUrl,
	resolveOcamlLanguageServerManifestUrl,
	resolveOcamlLanguageServerModuleUrl,
	resolveRLanguageServerBaseUrl,
	resolvePrologLanguageServerBaseUrl,
	resolvePrologLanguageServerWorkerUrl,
	resolveRustLanguageServerCompilerUrl,
	resolveTclLanguageServerBaseUrl,
	resolveTclLanguageServerWorkerUrl,
	resolveZigLanguageServerCompilerUrl,
	resolveZigLanguageServerStdlibUrl
} from '../src/index.js';
import {
	resolveAssemblyScriptLanguageServerModuleUrl,
	resolveDuckDbLanguageServerModuleUrl,
	resolveRubyLanguageServerModuleUrl,
	resolveSqliteLanguageServerModuleUrl
} from '../src/runtime.js';

describe('lsp runtime asset resolution', () => {
	it('pins bundled clangd assets in the default runtime config', () => {
		expect(
			resolveCppLanguageServerRuntimeAssetConfig(
				{ rootUrl: '/wasm-idle' },
				'https://app.example.com/editor'
			)
		).toEqual({
			baseUrl: 'https://app.example.com/wasm-idle/clangd/',
			loader: undefined,
			allowedBaseUrls: undefined,
			integrity: BUNDLED_CLANGD_ASSET_INTEGRITY
		});

		expect(
			resolveCppLanguageServerRuntimeAssetConfig(
				'/wasm-idle',
				'https://app.example.com/editor'
			)
		).toEqual({
			baseUrl: 'https://app.example.com/wasm-idle/clangd/',
			integrity: BUNDLED_CLANGD_ASSET_INTEGRITY
		});
	});

	it('requires the host to declare clangd and Python asset roots', () => {
		const applicationUrl = 'https://app.example.com/wasm-idle/';

		expect(() => resolveCppLanguageServerBaseUrl(undefined, applicationUrl)).toThrow(
			LanguageServerAssetConfigurationError
		);
		expect(() => resolvePythonLanguageServerBaseUrl(undefined, applicationUrl)).toThrow(
			LanguageServerAssetConfigurationError
		);
		expect(resolveCppLanguageServerBaseUrl({ rootUrl: '/wasm-idle' }, applicationUrl)).toBe(
			'https://app.example.com/wasm-idle/clangd/'
		);
		expect(resolvePythonLanguageServerBaseUrl({ rootUrl: '/wasm-idle' }, applicationUrl)).toBe(
			'https://app.example.com/wasm-idle/pyodide/'
		);
	});

	it('keeps an absent optional Erlang worker override empty', () => {
		expect(
			resolveErlangLanguageServerWorkerUrl(
				{ rootUrl: '/wasm-idle' },
				'https://app.example.com/wasm-idle/'
			)
		).toBe('');
	});

	it('pins bundled Gleam roots and requires a fingerprint for custom assets', () => {
		expect(resolveGleamLanguageServerManifestFingerprint({ rootUrl: '/wasm-idle' })).toBe(
			BUNDLED_GLEAM_MANIFEST_FINGERPRINT
		);
		expect(() =>
			resolveGleamLanguageServerManifestFingerprint({
				gleam: { baseUrl: 'https://gleam.example.com/' }
			})
		).toThrow(LanguageServerAssetConfigurationError);
		expect(() =>
			resolveGleamLanguageServerManifestFingerprint({
				gleam: { manifestFingerprint: 'not-a-digest' }
			})
		).toThrow(LanguageServerAssetConfigurationError);
		expect(
			resolveGleamLanguageServerManifestFingerprint({
				gleam: { manifestFingerprint: 'a'.repeat(64) }
			})
		).toBe('a'.repeat(64));
	});

	it('requires host context for document-relative asset overrides', () => {
		const options = { rust: { compilerUrl: './assets/rustc.js' } };

		expect(() => resolveRustLanguageServerCompilerUrl(options)).toThrow(
			LanguageServerAssetConfigurationError
		);
		expect(
			resolveRustLanguageServerCompilerUrl(
				options,
				'https://app.example.com/wasm-idle/editor/'
			)
		).toBe('https://app.example.com/wasm-idle/editor/assets/rustc.js');
		expect(
			resolveRustLanguageServerCompilerUrl({
				rust: { compilerUrl: '/wasm-idle/wasm-rust/index.js' }
			})
		).toBe('/wasm-idle/wasm-rust/index.js');
	});

	it('resolves declared runtime roots and rejects document-relative fallbacks', () => {
		const applicationUrl = 'https://app.example.com/wasm-idle/';
		const cases: [(options: string | undefined, currentUrl: string) => string, string][] = [
			[resolveAssemblyScriptLanguageServerModuleUrl, 'wasm-assemblyscript/runtime.mjs'],
			[resolveRustLanguageServerCompilerUrl, 'wasm-rust/index.js'],
			[resolveGoLanguageServerCompilerUrl, 'wasm-go/index.js'],
			[resolveDLanguageServerModuleUrl, 'wasm-d/index.js'],
			[resolveGleamLanguageServerBaseUrl, 'wasm-gleam/'],
			[resolveGleamLanguageServerManifestUrl, 'wasm-gleam/source-manifest.v2.json'],
			[resolveElixirLanguageServerBundleUrl, 'wasm-elixir/bundle.avm'],
			[resolveErlangLanguageServerBundleUrl, 'wasm-elixir/bundle.avm'],
			[resolveZigLanguageServerCompilerUrl, 'wasm-zig/zig_small.wasm'],
			[resolveZigLanguageServerStdlibUrl, 'wasm-zig/std.tar.gz'],
			[resolveLuaLanguageServerModuleUrl, 'wasm-lua/index.js'],
			[resolveJanetLanguageServerBaseUrl, 'wasm-janet/'],
			[resolveJanetLanguageServerWorkerUrl, 'wasm-janet/runner-worker.js'],
			[resolveLispLanguageServerModuleUrl, 'wasm-lisp/index.js'],
			[resolveOctaveLanguageServerBaseUrl, 'wasm-octave/runtime/'],
			[resolveOctaveLanguageServerWorkerUrl, 'wasm-octave/runner-worker.js'],
			[
				resolveOctaveLanguageServerManifestUrl,
				'wasm-octave/runtime/runtime-manifest.v1.json'
			],
			[
				resolveOcamlLanguageServerModuleUrl,
				'wasm-of-js-of-ocaml/browser-native/src/index.js'
			],
			[
				resolveOcamlLanguageServerManifestUrl,
				'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json'
			],
			[resolveHaskellLanguageServerModuleUrl, 'wasm-haskell/dyld.mjs'],
			[resolveHaskellLanguageServerRootfsUrl, 'wasm-haskell/rootfs.tar.zst'],
			[resolveHaskellLanguageServerBsdtarUrl, 'wasm-haskell/bsdtar.wasm'],
			[resolveSqliteLanguageServerModuleUrl, 'wasm-sqlite/runtime.mjs'],
			[resolveDuckDbLanguageServerModuleUrl, 'wasm-duckdb/runtime.mjs'],
			[resolveFortranLanguageServerAnalyzerUrl, 'wasm-fortran/analyzer.js'],
			[resolvePrologLanguageServerBaseUrl, 'wasm-prolog/'],
			[resolvePrologLanguageServerWorkerUrl, 'wasm-prolog/runner-worker.js'],
			[resolveRubyLanguageServerModuleUrl, 'wasm-ruby/runtime.mjs'],
			[resolveRLanguageServerBaseUrl, 'webr/'],
			[resolveAwkLanguageServerBaseUrl, 'wasm-awk/'],
			[resolveAwkLanguageServerWorkerUrl, 'wasm-awk/runner-worker.js'],
			[resolvePerlLanguageServerBaseUrl, 'wasm-perl/'],
			[resolvePerlLanguageServerWorkerUrl, 'wasm-perl/runner-worker.js'],
			[resolveTclLanguageServerBaseUrl, 'wasm-tcl/'],
			[resolveTclLanguageServerWorkerUrl, 'wasm-tcl/runner-worker.js'],
			[resolvePascalLanguageServerBaseUrl, 'wasm-pascal/'],
			[resolvePascalLanguageServerWorkerUrl, 'wasm-pascal/runner-worker.js']
		];

		for (const [resolve, path] of cases) {
			expect(resolve('/wasm-idle', applicationUrl), path).toBe(`${applicationUrl}${path}`);
			expect(() => resolve(undefined, applicationUrl), path).toThrow(
				LanguageServerAssetConfigurationError
			);
		}
	});

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
			resolveDLanguageServerModuleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-d/index.js');
		expect(
			resolveTclLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-tcl/');
		expect(
			resolveTclLanguageServerWorkerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-tcl/runner-worker.js');
		expect(
			resolvePascalLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-pascal/');
		expect(
			resolvePascalLanguageServerWorkerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-pascal/runner-worker.js');
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
		).toBe('https://static.example.com/repl_20240807/wasm-zig/std.tar.gz');
		expect(
			resolveLuaLanguageServerModuleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-lua/index.js');
		expect(
			resolveJanetLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-janet/');
		expect(
			resolveJanetLanguageServerWorkerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-janet/runner-worker.js');
		expect(
			resolveLispLanguageServerModuleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-lisp/index.js');
		expect(
			resolveOctaveLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-octave/runtime/');
		expect(
			resolveOctaveLanguageServerWorkerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-octave/runner-worker.js');
		expect(
			resolveOctaveLanguageServerManifestUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe(
			'https://static.example.com/repl_20240807/wasm-octave/runtime/runtime-manifest.v1.json'
		);
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
		).toBe('https://static.example.com/repl_20240807/wasm-gleam/source-manifest.v2.json');
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
			d: {
				moduleUrl: 'https://d.example.com/wasm-d/index.js?v=20240807',
				compileArgs: ['-preview=dip1000']
			},
			tcl: {
				baseUrl: 'https://tcl.example.com/wasm-tcl/',
				workerUrl: 'https://tcl.example.com/runner-worker.js?v=20240807'
			},
			pascal: {
				baseUrl: 'https://pascal.example.com/wasm-pascal/',
				workerUrl: 'https://pascal.example.com/runner-worker.js?v=20240807'
			},
			zig: {
				compilerUrl: 'https://zig.example.com/zig_small.wasm?v=20240807',
				stdlibUrl: 'https://zig.example.com/std.tar.gz?v=20240807'
			},
			lua: {
				moduleUrl: 'https://lua.example.com/wasm-lua/index.js?v=20240807'
			},
			janet: {
				baseUrl: 'https://janet.example.com/wasm-janet/',
				workerUrl: 'https://janet.example.com/runner-worker.js?v=20240807'
			},
			lisp: {
				moduleUrl: 'https://lisp.example.com/wasm-lisp/index.js?v=20240807'
			},
			octave: {
				baseUrl: 'https://octave.example.com/runtime/',
				workerUrl: 'https://octave.example.com/runner-worker.js?v=20240807',
				manifestUrl: 'https://octave.example.com/runtime/manifest.json?v=20240807'
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
			gleam: {
				baseUrl: 'https://gleam.example.com/wasm-gleam/',
				manifestUrl: 'https://gleam.example.com/manifest.json',
				manifestFingerprint: 'a'.repeat(64)
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
		expect(resolveDLanguageServerModuleUrl(options)).toBe(
			'https://d.example.com/wasm-d/index.js?v=20240807'
		);
		expect(resolveTclLanguageServerBaseUrl(options)).toBe('https://tcl.example.com/wasm-tcl/');
		expect(resolveTclLanguageServerWorkerUrl(options)).toBe(
			'https://tcl.example.com/runner-worker.js?v=20240807'
		);
		expect(resolvePascalLanguageServerBaseUrl(options)).toBe(
			'https://pascal.example.com/wasm-pascal/'
		);
		expect(resolvePascalLanguageServerWorkerUrl(options)).toBe(
			'https://pascal.example.com/runner-worker.js?v=20240807'
		);
		expect(resolveZigLanguageServerCompilerUrl(options)).toBe(
			'https://zig.example.com/zig_small.wasm?v=20240807'
		);
		expect(resolveZigLanguageServerStdlibUrl(options)).toBe(
			'https://zig.example.com/std.tar.gz?v=20240807'
		);
		expect(resolveLuaLanguageServerModuleUrl(options)).toBe(
			'https://lua.example.com/wasm-lua/index.js?v=20240807'
		);
		expect(resolveJanetLanguageServerBaseUrl(options)).toBe(
			'https://janet.example.com/wasm-janet/'
		);
		expect(resolveJanetLanguageServerWorkerUrl(options)).toBe(
			'https://janet.example.com/runner-worker.js?v=20240807'
		);
		expect(resolveLispLanguageServerModuleUrl(options)).toBe(
			'https://lisp.example.com/wasm-lisp/index.js?v=20240807'
		);
		expect(resolveOctaveLanguageServerBaseUrl(options)).toBe(
			'https://octave.example.com/runtime/'
		);
		expect(resolveOctaveLanguageServerWorkerUrl(options)).toBe(
			'https://octave.example.com/runner-worker.js?v=20240807'
		);
		expect(resolveOctaveLanguageServerManifestUrl(options)).toBe(
			'https://octave.example.com/runtime/manifest.json?v=20240807'
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
		expect(resolveGleamLanguageServerBaseUrl(options)).toBe(
			'https://gleam.example.com/wasm-gleam/'
		);
		expect(resolveGleamLanguageServerManifestUrl(options)).toBe(
			'https://gleam.example.com/manifest.json'
		);
		expect(resolveGleamLanguageServerManifestFingerprint(options)).toBe('a'.repeat(64));
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
			resolveCppLanguageServerRuntimeAssetConfig(
				{
					cpp: {
						baseUrl: 'https://cpp.example.com/assets',
						loader,
						allowedBaseUrls: ['./mirror/']
					}
				},
				'https://app.example.com/wasm-idle/'
			)
		).toEqual({
			baseUrl: 'https://cpp.example.com/assets/',
			loader,
			allowedBaseUrls: ['https://app.example.com/wasm-idle/mirror/']
		});
	});
});
