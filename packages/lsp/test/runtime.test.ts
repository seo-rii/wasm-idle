import { describe, expect, it } from 'vitest';

import { BUNDLED_CLANGD_ASSET_INTEGRITY } from '../src/bundledClangdAssetIntegrity.js';
import { BUNDLED_ELIXIR_ASSET_VERSION } from '../src/bundledElixirRuntimeIntegrity.js';
import { BUNDLED_GLEAM_MANIFEST_FINGERPRINT } from '../src/bundledGleamRuntime.js';
import {
	BUNDLED_JANET_MANIFEST_FINGERPRINT,
	BUNDLED_JANET_RUNNER_RECEIPT
} from '../src/bundledJanetRuntime.js';
import { BUNDLED_LISP_MANIFEST_FINGERPRINT } from '../src/bundledLispRuntime.js';
import {
	BUNDLED_PROLOG_MANIFEST_FINGERPRINT,
	BUNDLED_PROLOG_RUNTIME_PROFILE,
	BUNDLED_PROLOG_RUNNER_RECEIPT
} from '../src/bundledPrologRuntime.js';
import {
	BUNDLED_PERL_MANIFEST_FINGERPRINT,
	BUNDLED_PERL_RUNNER_RECEIPT
} from '../src/bundledPerlRuntime.js';
import {
	BUNDLED_TCL_MANIFEST_FINGERPRINT,
	BUNDLED_TCL_RUNNER_RECEIPT
} from '../src/bundledTclRuntime.js';
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
	resolveJanetLanguageServerManifestFingerprint,
	resolveJanetLanguageServerManifestUrl,
	resolveJanetLanguageServerWorkerReceipt,
	resolveJanetLanguageServerWorkerUrl,
	resolveLispLanguageServerManifestFingerprint,
	resolveLispLanguageServerManifestUrl,
	resolveLispLanguageServerModuleUrl,
	resolveAwkLanguageServerBaseUrl,
	resolveAwkLanguageServerWorkerUrl,
	resolvePythonLanguageServerBaseUrl,
	resolvePerlLanguageServerBaseUrl,
	resolvePerlLanguageServerManifestFingerprint,
	resolvePerlLanguageServerManifestUrl,
	resolvePerlLanguageServerWorkerReceipt,
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
	resolvePrologLanguageServerManifestFingerprint,
	resolvePrologLanguageServerManifestUrl,
	resolvePrologLanguageServerWorkerReceipt,
	resolvePrologLanguageServerWorkerUrl,
	resolveRustLanguageServerCompilerUrl,
	resolveTclLanguageServerBaseUrl,
	resolveTclLanguageServerManifestFingerprint,
	resolveTclLanguageServerManifestUrl,
	resolveTclLanguageServerWorkerReceipt,
	resolveTclLanguageServerWorkerUrl,
	resolveZigLanguageServerCompilerUrl,
	resolveZigLanguageServerStdlibUrl
} from '../src/index.js';
import {
	resolveAssemblyScriptLanguageServerModuleUrl,
	resolveDuckDbLanguageServerModuleUrl,
	resolvePrologLanguageServerPreflightProfile,
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

	it('pins bundled Janet manifests and diagnostic workers and fails closed for mirrors', () => {
		const currentUrl = 'https://app.example.com/editor';
		const bundledOptions = { rootUrl: '/wasm-idle' };

		expect(resolveJanetLanguageServerManifestFingerprint(bundledOptions)).toBe(
			BUNDLED_JANET_MANIFEST_FINGERPRINT
		);
		expect(resolveJanetLanguageServerWorkerReceipt(bundledOptions)).toBe(
			BUNDLED_JANET_RUNNER_RECEIPT
		);
		expect(resolveJanetLanguageServerWorkerUrl(bundledOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-janet/runner-worker.js?v=${BUNDLED_JANET_RUNNER_RECEIPT.sha256}`
		);
		expect(resolveJanetLanguageServerManifestUrl(bundledOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-janet/runtime-manifest.v2.json?v=${BUNDLED_JANET_MANIFEST_FINGERPRINT}`
		);

		const customReceipt = { bytes: 543, sha256: 'b'.repeat(64) };
		const customOptions = {
			janet: {
				baseUrl: 'https://mirror.example.com/janet',
				workerUrl: 'https://mirror.example.com/janet/runner.js?v=custom',
				manifestUrl: 'https://mirror.example.com/janet/manifest.json?v=custom',
				manifestFingerprint: ` ${'a'.repeat(64)} `,
				workerReceipt: customReceipt
			}
		};

		expect(resolveJanetLanguageServerBaseUrl(customOptions)).toBe(
			'https://mirror.example.com/janet/'
		);
		expect(resolveJanetLanguageServerWorkerUrl(customOptions)).toBe(
			'https://mirror.example.com/janet/runner.js?v=custom'
		);
		expect(resolveJanetLanguageServerManifestUrl(customOptions)).toBe(
			'https://mirror.example.com/janet/manifest.json?v=custom'
		);
		expect(resolveJanetLanguageServerManifestFingerprint(customOptions)).toBe('a'.repeat(64));
		expect(resolveJanetLanguageServerWorkerReceipt(customOptions)).toBe(customReceipt);
		expect(() =>
			resolveJanetLanguageServerManifestFingerprint({
				janet: { baseUrl: 'https://mirror.example.com/janet/' }
			})
		).toThrow(LanguageServerAssetConfigurationError);
		expect(() =>
			resolveJanetLanguageServerWorkerReceipt({
				janet: {
					baseUrl: 'https://mirror.example.com/janet/',
					manifestFingerprint: 'c'.repeat(64)
				}
			})
		).toThrow(LanguageServerAssetConfigurationError);
	});

	it('pins bundled Scheme manifests and fails closed for custom module URLs', () => {
		expect(resolveLispLanguageServerManifestFingerprint({ rootUrl: '/wasm-idle' })).toBe(
			BUNDLED_LISP_MANIFEST_FINGERPRINT
		);
		expect(() =>
			resolveLispLanguageServerManifestFingerprint({
				lisp: { moduleUrl: 'https://lisp.example.com/index.js' }
			})
		).toThrow(LanguageServerAssetConfigurationError);
		expect(
			resolveLispLanguageServerManifestFingerprint({
				lisp: {
					moduleUrl: 'https://lisp.example.com/index.js',
					manifestFingerprint: 'f'.repeat(64)
				}
			})
		).toBe('f'.repeat(64));
	});

	it('pins bundled Prolog manifests and diagnostic workers while allowing explicit mirrors', () => {
		const currentUrl = 'https://app.example.com/editor';
		const bundledOptions = { rootUrl: '/wasm-idle' };

		expect(resolvePrologLanguageServerManifestFingerprint(bundledOptions)).toBe(
			BUNDLED_PROLOG_MANIFEST_FINGERPRINT
		);
		expect(resolvePrologLanguageServerWorkerReceipt(bundledOptions)).toBe(
			BUNDLED_PROLOG_RUNNER_RECEIPT
		);
		expect(resolvePrologLanguageServerWorkerUrl(bundledOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-prolog/runner-worker.js?v=${BUNDLED_PROLOG_RUNNER_RECEIPT.sha256}`
		);
		expect(resolvePrologLanguageServerManifestUrl(bundledOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-prolog/runtime-manifest.v2.json?v=${BUNDLED_PROLOG_MANIFEST_FINGERPRINT}`
		);

		const customReceipt = { bytes: 321, sha256: 'b'.repeat(64) };
		const customOptions = {
			prolog: {
				baseUrl: 'https://mirror.example.com/prolog/',
				workerUrl: 'https://mirror.example.com/prolog/runner.js?v=custom',
				manifestUrl: 'https://mirror.example.com/prolog/manifest.json?v=custom',
				manifestFingerprint: ` ${'a'.repeat(64)} `,
				workerReceipt: customReceipt
			}
		};

		expect(resolvePrologLanguageServerWorkerUrl(customOptions)).toBe(
			'https://mirror.example.com/prolog/runner.js?v=custom'
		);
		expect(resolvePrologLanguageServerManifestUrl(customOptions)).toBe(
			'https://mirror.example.com/prolog/manifest.json?v=custom'
		);
		expect(resolvePrologLanguageServerManifestFingerprint(customOptions)).toBe('a'.repeat(64));
		expect(resolvePrologLanguageServerWorkerReceipt(customOptions)).toBe(customReceipt);
		expect(() =>
			resolvePrologLanguageServerManifestFingerprint({
				prolog: { manifestFingerprint: 'not-a-digest' }
			})
		).toThrow(LanguageServerAssetConfigurationError);
	});

	it('resolves one complete Prolog preflight profile and rejects partial custom trust roots', () => {
		expect(resolvePrologLanguageServerPreflightProfile({ rootUrl: '/wasm-idle' })).toEqual(
			BUNDLED_PROLOG_RUNTIME_PROFILE
		);
		expect(
			resolvePrologLanguageServerPreflightProfile({
				prolog: {
					baseUrl: 'https://mirror.example.com/prolog/',
					manifestUrl: `https://mirror.example.com/prolog/runtime-manifest.v2.json?v=${BUNDLED_PROLOG_MANIFEST_FINGERPRINT}`
				}
			})
		).toEqual(BUNDLED_PROLOG_RUNTIME_PROFILE);
		expect(() =>
			resolvePrologLanguageServerPreflightProfile({
				prolog: { manifestFingerprint: 'a'.repeat(64) }
			})
		).toThrow('complete runtime profile and receipts');

		const customProfile = {
			profileId: 'swipl-wasm-custom',
			packageRevision: '1'.repeat(40),
			swiplRevision: '2'.repeat(40),
			manifestFingerprint: '3'.repeat(64),
			manifestReceipt: { bytes: 10, sha256: '4'.repeat(64) },
			javascriptReceipt: { bytes: 20, sha256: '5'.repeat(64) },
			wasmReceipt: {
				bytes: 30,
				sha256: '6'.repeat(64),
				uncompressedBytes: 40,
				uncompressedSha256: '7'.repeat(64)
			},
			dataReceipt: {
				bytes: 50,
				sha256: '8'.repeat(64),
				uncompressedBytes: 60,
				uncompressedSha256: '9'.repeat(64)
			}
		};
		expect(resolvePrologLanguageServerPreflightProfile({ prolog: customProfile })).toEqual(
			customProfile
		);
		expect(() =>
			resolvePrologLanguageServerPreflightProfile({
				prolog: { ...customProfile, dataReceipt: undefined }
			})
		).toThrow('complete valid runtime preflight profile and receipts');
	});

	it('pins bundled Perl manifests and diagnostic workers and fails closed for custom mirrors', () => {
		const currentUrl = 'https://app.example.com/editor';
		const bundledOptions = { rootUrl: '/wasm-idle' };

		expect(resolvePerlLanguageServerManifestFingerprint(bundledOptions)).toBe(
			BUNDLED_PERL_MANIFEST_FINGERPRINT
		);
		expect(resolvePerlLanguageServerWorkerReceipt(bundledOptions)).toBe(
			BUNDLED_PERL_RUNNER_RECEIPT
		);
		expect(resolvePerlLanguageServerWorkerUrl(bundledOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-perl/runner-worker.js?v=${BUNDLED_PERL_RUNNER_RECEIPT.sha256}`
		);
		expect(resolvePerlLanguageServerManifestUrl(bundledOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-perl/runtime-manifest.v2.json?v=${BUNDLED_PERL_MANIFEST_FINGERPRINT}`
		);

		const customReceipt = { bytes: 987, sha256: 'd'.repeat(64) };
		const customOptions = {
			perl: {
				baseUrl: 'https://mirror.example.com/perl/',
				workerUrl: 'https://mirror.example.com/perl/runner.js?v=custom',
				manifestUrl: 'https://mirror.example.com/perl/manifest.json?v=custom',
				manifestFingerprint: ` ${'c'.repeat(64)} `,
				workerReceipt: customReceipt
			}
		};

		expect(resolvePerlLanguageServerWorkerUrl(customOptions)).toBe(
			'https://mirror.example.com/perl/runner.js?v=custom'
		);
		expect(resolvePerlLanguageServerManifestUrl(customOptions)).toBe(
			'https://mirror.example.com/perl/manifest.json?v=custom'
		);
		expect(resolvePerlLanguageServerManifestFingerprint(customOptions)).toBe('c'.repeat(64));
		expect(resolvePerlLanguageServerWorkerReceipt(customOptions)).toBe(customReceipt);
		expect(() =>
			resolvePerlLanguageServerManifestFingerprint({
				perl: { baseUrl: 'https://mirror.example.com/perl/' }
			})
		).toThrow(LanguageServerAssetConfigurationError);
		expect(() =>
			resolvePerlLanguageServerWorkerReceipt({
				perl: {
					baseUrl: 'https://mirror.example.com/perl/',
					manifestFingerprint: 'e'.repeat(64)
				}
			})
		).toThrow(LanguageServerAssetConfigurationError);

		const noTrailingSlashOptions = {
			perl: {
				baseUrl: 'https://mirror.example.com/perl',
				manifestFingerprint: 'e'.repeat(64),
				workerReceipt: { bytes: 765, sha256: 'f'.repeat(64) }
			}
		};
		expect(resolvePerlLanguageServerBaseUrl(noTrailingSlashOptions)).toBe(
			'https://mirror.example.com/perl/'
		);
		expect(resolvePerlLanguageServerManifestUrl(noTrailingSlashOptions)).toBe(
			`https://mirror.example.com/perl/runtime-manifest.v2.json?v=${'e'.repeat(64)}`
		);

		const pinOnlyOptions = {
			rootUrl: '/wasm-idle',
			perl: {
				manifestFingerprint: 'e'.repeat(64),
				workerReceipt: { bytes: 765, sha256: 'f'.repeat(64) }
			}
		};
		expect(resolvePerlLanguageServerWorkerUrl(pinOnlyOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-perl/runner-worker.js?v=${'f'.repeat(64)}`
		);
		expect(resolvePerlLanguageServerManifestUrl(pinOnlyOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-perl/runtime-manifest.v2.json?v=${'e'.repeat(64)}`
		);
	});

	it('pins bundled Tcl manifests and diagnostic workers while allowing explicit mirrors', () => {
		const currentUrl = 'https://app.example.com/editor';
		const bundledOptions = { rootUrl: '/wasm-idle' };

		expect(resolveTclLanguageServerManifestFingerprint(bundledOptions)).toBe(
			BUNDLED_TCL_MANIFEST_FINGERPRINT
		);
		expect(resolveTclLanguageServerWorkerReceipt(bundledOptions)).toBe(
			BUNDLED_TCL_RUNNER_RECEIPT
		);
		expect(resolveTclLanguageServerWorkerUrl(bundledOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-tcl/runner-worker.js?v=${BUNDLED_TCL_RUNNER_RECEIPT.sha256}`
		);
		expect(resolveTclLanguageServerManifestUrl(bundledOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-tcl/runtime-manifest.v2.json?v=${BUNDLED_TCL_MANIFEST_FINGERPRINT}`
		);

		const customReceipt = { bytes: 654, sha256: 'd'.repeat(64) };
		const customOptions = {
			tcl: {
				baseUrl: 'https://mirror.example.com/tcl/',
				workerUrl: 'https://mirror.example.com/tcl/runner.js?v=custom',
				manifestUrl: 'https://mirror.example.com/tcl/manifest.json?v=custom',
				manifestFingerprint: ` ${'c'.repeat(64)} `,
				workerReceipt: customReceipt
			}
		};

		expect(resolveTclLanguageServerWorkerUrl(customOptions)).toBe(
			'https://mirror.example.com/tcl/runner.js?v=custom'
		);
		expect(resolveTclLanguageServerManifestUrl(customOptions)).toBe(
			'https://mirror.example.com/tcl/manifest.json?v=custom'
		);
		expect(resolveTclLanguageServerManifestFingerprint(customOptions)).toBe('c'.repeat(64));
		expect(resolveTclLanguageServerWorkerReceipt(customOptions)).toBe(customReceipt);
		expect(() =>
			resolveTclLanguageServerManifestFingerprint({
				tcl: { manifestFingerprint: 'not-a-digest' }
			})
		).toThrow(LanguageServerAssetConfigurationError);

		const pinOnlyOptions = {
			rootUrl: '/wasm-idle',
			tcl: {
				manifestFingerprint: 'e'.repeat(64),
				workerReceipt: { bytes: 777, sha256: 'f'.repeat(64) }
			}
		};
		expect(resolveTclLanguageServerWorkerUrl(pinOnlyOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-tcl/runner-worker.js?v=${'f'.repeat(64)}`
		);
		expect(resolveTclLanguageServerManifestUrl(pinOnlyOptions, currentUrl)).toBe(
			`https://app.example.com/wasm-idle/wasm-tcl/runtime-manifest.v2.json?v=${'e'.repeat(64)}`
		);
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
			[
				resolveElixirLanguageServerBundleUrl,
				`wasm-elixir/bundle.avm?v=${BUNDLED_ELIXIR_ASSET_VERSION}`
			],
			[
				resolveErlangLanguageServerBundleUrl,
				`wasm-elixir/bundle.avm?v=${BUNDLED_ELIXIR_ASSET_VERSION}`
			],
			[resolveZigLanguageServerCompilerUrl, 'wasm-zig/zig_small.wasm'],
			[resolveZigLanguageServerStdlibUrl, 'wasm-zig/std.tar.gz'],
			[resolveLuaLanguageServerModuleUrl, 'wasm-lua/index.js'],
			[resolveJanetLanguageServerBaseUrl, 'wasm-janet/'],
			[
				resolveJanetLanguageServerWorkerUrl,
				`wasm-janet/runner-worker.js?v=${BUNDLED_JANET_RUNNER_RECEIPT.sha256}`
			],
			[
				resolveJanetLanguageServerManifestUrl,
				`wasm-janet/runtime-manifest.v2.json?v=${BUNDLED_JANET_MANIFEST_FINGERPRINT}`
			],
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
			[
				resolvePrologLanguageServerWorkerUrl,
				`wasm-prolog/runner-worker.js?v=${BUNDLED_PROLOG_RUNNER_RECEIPT.sha256}`
			],
			[
				resolvePrologLanguageServerManifestUrl,
				`wasm-prolog/runtime-manifest.v2.json?v=${BUNDLED_PROLOG_MANIFEST_FINGERPRINT}`
			],
			[resolveRubyLanguageServerModuleUrl, 'wasm-ruby/runtime.mjs'],
			[resolveRLanguageServerBaseUrl, 'webr/'],
			[resolveAwkLanguageServerBaseUrl, 'wasm-awk/'],
			[resolveAwkLanguageServerWorkerUrl, 'wasm-awk/runner-worker.js'],
			[resolvePerlLanguageServerBaseUrl, 'wasm-perl/'],
			[
				resolvePerlLanguageServerWorkerUrl,
				`wasm-perl/runner-worker.js?v=${BUNDLED_PERL_RUNNER_RECEIPT.sha256}`
			],
			[
				resolvePerlLanguageServerManifestUrl,
				`wasm-perl/runtime-manifest.v2.json?v=${BUNDLED_PERL_MANIFEST_FINGERPRINT}`
			],
			[resolveTclLanguageServerBaseUrl, 'wasm-tcl/'],
			[
				resolveTclLanguageServerWorkerUrl,
				`wasm-tcl/runner-worker.js?v=${BUNDLED_TCL_RUNNER_RECEIPT.sha256}`
			],
			[
				resolveTclLanguageServerManifestUrl,
				`wasm-tcl/runtime-manifest.v2.json?v=${BUNDLED_TCL_MANIFEST_FINGERPRINT}`
			],
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
		).toBe(
			`https://static.example.com/repl_20240807/wasm-tcl/runner-worker.js?v=${BUNDLED_TCL_RUNNER_RECEIPT.sha256}`
		);
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
		).toBe(
			`https://static.example.com/repl_20240807/wasm-janet/runner-worker.js?v=${BUNDLED_JANET_RUNNER_RECEIPT.sha256}`
		);
		expect(
			resolveLispLanguageServerModuleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-lisp/index.js');
		expect(
			resolveLispLanguageServerManifestUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-lisp/runtime-manifest.v2.json');
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
		).toBe(
			`https://static.example.com/repl_20240807/wasm-elixir/bundle.avm?v=${BUNDLED_ELIXIR_ASSET_VERSION}`
		);
		expect(
			resolveErlangLanguageServerBundleUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe(
			`https://static.example.com/repl_20240807/wasm-elixir/bundle.avm?v=${BUNDLED_ELIXIR_ASSET_VERSION}`
		);
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
		).toBe(
			`https://static.example.com/repl_20240807/wasm-perl/runner-worker.js?v=${BUNDLED_PERL_RUNNER_RECEIPT.sha256}`
		);
		expect(
			resolvePerlLanguageServerManifestUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe(
			`https://static.example.com/repl_20240807/wasm-perl/runtime-manifest.v2.json?v=${BUNDLED_PERL_MANIFEST_FINGERPRINT}`
		);
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
				workerUrl: 'https://janet.example.com/runner-worker.js?v=20240807',
				manifestUrl: 'https://janet.example.com/manifest.json?v=20240807',
				manifestFingerprint: 'd'.repeat(64),
				workerReceipt: { bytes: 2345, sha256: 'e'.repeat(64) }
			},
			lisp: {
				moduleUrl: 'https://lisp.example.com/wasm-lisp/index.js?v=20240807',
				manifestUrl: 'https://lisp.example.com/wasm-lisp/manifest.json?v=20240807',
				manifestFingerprint: 'f'.repeat(64)
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
				workerUrl: 'https://perl.example.com/runner-worker.js?v=20240807',
				manifestUrl: 'https://perl.example.com/manifest.json?v=20240807',
				manifestFingerprint: 'b'.repeat(64),
				workerReceipt: { bytes: 1234, sha256: 'c'.repeat(64) }
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
		expect(resolveJanetLanguageServerManifestUrl(options)).toBe(
			'https://janet.example.com/manifest.json?v=20240807'
		);
		expect(resolveJanetLanguageServerManifestFingerprint(options)).toBe('d'.repeat(64));
		expect(resolveJanetLanguageServerWorkerReceipt(options)).toEqual({
			bytes: 2345,
			sha256: 'e'.repeat(64)
		});
		expect(resolveLispLanguageServerModuleUrl(options)).toBe(
			'https://lisp.example.com/wasm-lisp/index.js?v=20240807'
		);
		expect(resolveLispLanguageServerManifestUrl(options)).toBe(
			'https://lisp.example.com/wasm-lisp/manifest.json?v=20240807'
		);
		expect(resolveLispLanguageServerManifestFingerprint(options)).toBe('f'.repeat(64));
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
		expect(resolvePerlLanguageServerManifestUrl(options)).toBe(
			'https://perl.example.com/manifest.json?v=20240807'
		);
		expect(resolvePerlLanguageServerManifestFingerprint(options)).toBe('b'.repeat(64));
		expect(resolvePerlLanguageServerWorkerReceipt(options)).toEqual({
			bytes: 1234,
			sha256: 'c'.repeat(64)
		});
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
