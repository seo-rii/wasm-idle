import { describe, expect, expectTypeOf, it, vi } from 'vitest';

const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_DEBUG_RUNTIME_URL: '',
		PUBLIC_WASM_RUST_COMPILER_URL: '',
		PUBLIC_WASM_GO_COMPILER_URL: '',
		PUBLIC_WASM_D_MODULE_URL: '',
		PUBLIC_WASM_D_MANIFEST_URL: '',
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
		PUBLIC_WASM_LISP_MANIFEST_URL: '',
		PUBLIC_WASM_LISP_MANIFEST_FINGERPRINT: '',
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
		PUBLIC_WASM_GLEAM_MANIFEST_FINGERPRINT: '',
		PUBLIC_WASM_GLEAM_WORKER_SHA256: '',
		PUBLIC_WASM_GLEAM_WORKER_BYTES: '',
		PUBLIC_WASM_PERL_BASE_URL: '',
		PUBLIC_WASM_PERL_WORKER_URL: '',
		PUBLIC_WASM_PERL_MANIFEST_URL: '',
		PUBLIC_WASM_PERL_MANIFEST_FINGERPRINT: '',
		PUBLIC_WASM_PERL_WORKER_SHA256: '',
		PUBLIC_WASM_PERL_WORKER_BYTES: '',
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
		PUBLIC_WASM_JANET_MANIFEST_URL: '',
		PUBLIC_WASM_JANET_MANIFEST_FINGERPRINT: '',
		PUBLIC_WASM_JANET_WORKER_SHA256: '',
		PUBLIC_WASM_JANET_WORKER_BYTES: '',
		PUBLIC_WASM_JULIA_BASE_URL: '',
		PUBLIC_WASM_JULIA_WORKER_URL: '',
		PUBLIC_WASM_JULIA_MANIFEST_URL: '',
		PUBLIC_WASM_JULIA_MANIFEST_FINGERPRINT: '',
		PUBLIC_WASM_JULIA_WORKER_SHA256: '',
		PUBLIC_WASM_JULIA_WORKER_BYTES: '',
		PUBLIC_WASM_NIM_BASE_URL: '',
		PUBLIC_WASM_NIM_WORKER_URL: '',
		PUBLIC_WASM_NIM_MANIFEST_URL: '',
		PUBLIC_WASM_NIM_MANIFEST_FINGERPRINT: '',
		PUBLIC_WASM_NIM_WORKER_SHA256: '',
		PUBLIC_WASM_NIM_WORKER_BYTES: '',
		PUBLIC_WASM_CLOJURESCRIPT_BASE_URL: '',
		PUBLIC_WASM_CLOJURESCRIPT_WORKER_URL: '',
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
	resolveDebugRuntimeUrls,
	resolveFortranRuntimeAssetConfig,
	resolveObjectiveCRuntimeAssetConfig,
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from './assets';
import { BUNDLED_CLANG_ASSET_INTEGRITY } from './clangAssetIntegrity';
import { TEAVM_RUNTIME_ASSET_RECEIPTS, type RuntimeAssetKeySource } from '@wasm-idle/core';
import { WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS } from './wasmFortranExecutionAssets';
import {
	WASM_FORTH_ASSET_VERSION,
	WASM_FORTH_RUNTIME_PROFILE,
	WASM_FORTH_RUNNER_RECEIPT
} from './wasmForthVersion';
import {
	WASM_BQN_ASSET_VERSION,
	WASM_BQN_RUNNER_RECEIPT,
	WASM_BQN_RUNTIME_PROFILE
} from './wasmBqnVersion';
import {
	WASM_CLOJURESCRIPT_ASSET_VERSION,
	WASM_CLOJURESCRIPT_RUNNER_RECEIPT,
	WASM_CLOJURESCRIPT_RUNTIME_PROFILE
} from './wasmClojureScriptVersion';
import {
	WASM_J_ASSET_VERSION,
	WASM_J_RUNNER_RECEIPT,
	WASM_J_RUNTIME_PROFILE
} from './wasmJVersion';
import {
	WASM_JANET_ASSET_VERSION,
	WASM_JANET_RUNNER_RECEIPT,
	WASM_JANET_RUNTIME_PROFILE
} from './wasmJanetVersion';
import {
	WASM_JULIA_ASSET_VERSION,
	WASM_JULIA_RUNNER_RECEIPT,
	WASM_JULIA_RUNTIME_PROFILE
} from './wasmJuliaVersion';
import {
	WASM_NIM_ASSET_VERSION,
	WASM_NIM_RUNNER_RECEIPT,
	WASM_NIM_RUNTIME_PROFILE
} from './wasmNimVersion';
import { WASM_BASH_RUNTIME_PROFILE } from './wasmBashVersion';
import { WASM_GLEAM_ASSET_VERSION, WASM_GLEAM_RUNNER_RECEIPT } from './wasmGleamVersion';
import { WASM_OBJECTIVEC_ASSET_RECEIPTS } from './wasmObjectiveCVersion';
import {
	WASM_PERL_ASSET_VERSION,
	WASM_PERL_RUNNER_RECEIPT,
	WASM_PERL_RUNTIME_PROFILE
} from './wasmPerlVersion';
import {
	WASM_PROLOG_ASSET_VERSION,
	WASM_PROLOG_RUNNER_RECEIPT,
	WASM_PROLOG_RUNTIME_PROFILE
} from './wasmPrologVersion';
import {
	WASM_TCL_ASSET_VERSION,
	WASM_TCL_RUNNER_RECEIPT,
	WASM_TCL_RUNTIME_PROFILE
} from './wasmTclVersion';

describe('runtime asset config resolution', () => {
	it('keeps application runtime asset keys aligned with the Core contract', () => {
		expectTypeOf<PlaygroundRuntimeAssets>().toMatchTypeOf<RuntimeAssetKeySource>();
		expectTypeOf<Exclude<keyof PlaygroundRuntimeAssets, 'debug'>>().toEqualTypeOf<
			keyof RuntimeAssetKeySource
		>();
	});

	it.each([
		['https://example.com/', 'https://example.com/'],
		['https://example.com/wasm-idle/', 'https://example.com/wasm-idle/'],
		['https://example.com/foo/bar/', 'https://example.com/foo/bar/']
	])('keeps bundled folder runtimes under the application base %s', (currentUrl, baseUrl) => {
		for (const [runtime, folder] of [
			['python', 'pyodide'],
			['java', 'teavm'],
			['clang', 'clang'],
			['clangd', 'clangd']
		] as const) {
			expect(resolveRuntimeAssetConfig(runtime, undefined, currentUrl).baseUrl).toBe(
				`${baseUrl}${folder}/`
			);
		}
	});

	it('indexes folder-backed runtime load assets by runtime id', () => {
		expect(Object.keys(RUNTIME_LOAD_ASSETS).sort()).toEqual([
			'clang',
			'clangd',
			'java',
			'python'
		]);
		expect(RUNTIME_LOAD_ASSETS.clang).toContain('runtime-manifest.v1.json');
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

	it('resolves lazy LLDB/WAMR assets from a dedicated runtime manifest', () => {
		expect(
			resolveDebugRuntimeUrls(
				{
					rootUrl: '/absproxy/5173',
					debug: { baseUrl: '/debug-runtime/' }
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/debug-runtime/',
			manifestUrl: 'https://example.com/debug-runtime/runtime-manifest.v2.json'
		});
		expect(resolveDebugRuntimeUrls('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-debug/',
			manifestUrl: 'https://example.com/absproxy/5173/wasm-debug/runtime-manifest.v2.json'
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
			loader: undefined,
			integrity: TEAVM_RUNTIME_ASSET_RECEIPTS,
			allowedBaseUrls: undefined,
			useAssetBridge: true
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
			integrity: TEAVM_RUNTIME_ASSET_RECEIPTS,
			allowedBaseUrls: undefined,
			useAssetBridge: true
		});
	});

	it('keeps an explicit TeaVM mirror on the bundled receipt generation', () => {
		expect(
			resolveRuntimeAssetConfig(
				'java',
				{ java: { baseUrl: 'https://cdn.example.com/teavm/' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://cdn.example.com/teavm/',
			loader: undefined,
			integrity: TEAVM_RUNTIME_ASSET_RECEIPTS,
			allowedBaseUrls: undefined,
			useAssetBridge: true
		});
	});

	it('snapshots a complete replacement TeaVM receipt generation', () => {
		const integrity = structuredClone(TEAVM_RUNTIME_ASSET_RECEIPTS) as Record<
			string,
			{ bytes: number; sha256: string }
		>;
		const resolved = resolveRuntimeAssetConfig('java', { java: { integrity } });
		integrity['compiler.wasm'].bytes = 1;

		expect(resolved.integrity).toEqual(TEAVM_RUNTIME_ASSET_RECEIPTS);
		expect(resolved.integrity).not.toBe(integrity);
		expect(Object.isFrozen(resolved.integrity)).toBe(true);
		expect(Object.isFrozen(resolved.integrity?.['compiler.wasm'])).toBe(true);
		expect(resolved.useAssetBridge).toBe(true);
	});

	it('rejects incomplete or widened TeaVM receipt generations', () => {
		expect(() =>
			resolveRuntimeAssetConfig('java', {
				java: {
					integrity: { 'compiler.wasm': TEAVM_RUNTIME_ASSET_RECEIPTS['compiler.wasm'] }
				}
			})
		).toThrow('exactly four assets');
		expect(() =>
			resolveRuntimeAssetConfig('java', {
				java: {
					integrity: {
						...TEAVM_RUNTIME_ASSET_RECEIPTS,
						unexpected: { bytes: 1, sha256: 'a'.repeat(64) }
					}
				}
			})
		).toThrow('exactly four assets');
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
			integrity: BUNDLED_CLANG_ASSET_INTEGRITY,
			useAssetBridge: true
		});
	});

	it('pins bundled clang assets when resolving the legacy root path', () => {
		expect(
			resolveRuntimeAssetConfig('clang', '/absproxy/5173', 'https://example.com/app')
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/clang/',
			integrity: BUNDLED_CLANG_ASSET_INTEGRITY,
			useAssetBridge: true
		});
	});

	it('does not apply bundled clang hashes to a custom asset source', () => {
		expect(
			resolveRuntimeAssetConfig(
				'clang',
				{ clang: { baseUrl: 'https://cdn.example.com/custom-clang/' } },
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://cdn.example.com/custom-clang/',
			loader: undefined,
			integrity: undefined,
			allowedBaseUrls: undefined,
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

	it('routes integrity-protected assets through the browser bridge', () => {
		const integrity = {
			'bin/clang.wasm.gz': {
				sha256: 'a'.repeat(64),
				bytes: 123
			}
		};

		expect(
			resolveRuntimeAssetConfig('clang', {
				rootUrl: '/absproxy/5173',
				clang: { integrity }
			})
		).toEqual({
			baseUrl: '/absproxy/5173/clang/',
			integrity,
			useAssetBridge: true
		});
	});

	it('resolves additional allowed asset bases against the application URL', () => {
		expect(
			resolveRuntimeAssetConfig(
				'clang',
				{
					clang: {
						baseUrl: '/runtime/clang/',
						allowedBaseUrls: ['/mirror/clang/']
					}
				},
				'https://app.example.com/wasm-idle/'
			)
		).toEqual({
			baseUrl: 'https://app.example.com/runtime/clang/',
			allowedBaseUrls: ['https://app.example.com/mirror/clang/'],
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

	it('resolves one pinned D module and manifest snapshot with version propagation', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_D_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_D_MANIFEST_URL = '';
		const { resolveDRuntimeAssetConfig } = await import('./assets');
		const { WASM_D_OUTER_ASSET_RECEIPTS } = await import('./wasmDIntegrity');

		const resolved = resolveDRuntimeAssetConfig(
			{
				d: {
					moduleUrl: '/runtime/d/index.js?v=pinned'
				}
			},
			'https://example.com/app'
		);

		expect(resolved).toEqual({
			moduleUrl: 'https://example.com/runtime/d/index.js?v=pinned',
			manifestUrl: 'https://example.com/runtime/d/runtime/runtime-manifest.v1.json?v=pinned',
			integrity: WASM_D_OUTER_ASSET_RECEIPTS
		});
		expect(Object.isFrozen(resolved)).toBe(true);
		expect(Object.isFrozen(resolved.integrity)).toBe(true);
	});

	it('rejects incomplete replacement D outer receipts before worker startup', async () => {
		vi.resetModules();
		const { resolveDRuntimeAssetConfig } = await import('./assets');

		expect(() =>
			resolveDRuntimeAssetConfig(
				{
					d: {
						moduleUrl: 'https://runtime.example/d/index.js',
						integrity: {
							'index.js': {
								bytes: 1,
								sha256: 'a'.repeat(64),
								uncompressedBytes: 1,
								uncompressedSha256: 'a'.repeat(64)
							}
						} as never
					}
				},
				'https://example.com/app'
			)
		).toThrow('D outer runtime receipt must describe exactly two assets');
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
			'https://example.com/absproxy/5173/wasm-tinygo/upstream.js'
		);
	});

	it('derives the TinyGo runtime module url from the legacy app url override', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_APP_URL =
			'https://env.example.com/wasm-tinygo/index.html?v=42';
		const { resolveTinyGoModuleUrl } = await import('./assets');

		expect(resolveTinyGoModuleUrl(undefined, 'https://example.com/app')).toBe(
			'https://env.example.com/wasm-tinygo/upstream.js?v=42'
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

	it('snapshots Zig receipt overrides with the resolved asset URLs', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_ZIG_COMPILER_URL = '';
		publicEnv.PUBLIC_WASM_ZIG_STDLIB_URL = '';
		const { resolveZigRuntimeAssetConfig } = await import('./assets');
		const integrity = {
			'zig_small.wasm': { bytes: 4, sha256: 'a'.repeat(64) },
			'std.tar.gz': {
				bytes: 5,
				sha256: 'b'.repeat(64),
				uncompressedBytes: 10,
				uncompressedSha256: 'c'.repeat(64)
			}
		};

		const resolved = resolveZigRuntimeAssetConfig(
			{
				rootUrl: '/runtime',
				zig: { integrity }
			},
			'https://example.com/app'
		);
		integrity['zig_small.wasm'].sha256 = 'd'.repeat(64);

		expect(resolved.compilerUrl).toBe('https://example.com/runtime/wasm-zig/zig_small.wasm');
		expect(resolved.stdlibUrl).toBe('https://example.com/runtime/wasm-zig/std.tar.gz');
		expect(resolved.integrity['zig_small.wasm'].sha256).toBe('a'.repeat(64));
		expect(Object.isFrozen(resolved.integrity)).toBe(true);
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

	it('pins bundled Lisp module and manifest URLs to one fingerprint', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_LISP_MODULE_URL = '';
		const [{ resolveLispRuntimeAssetConfig }, { WASM_LISP_ASSET_VERSION }] = await Promise.all([
			import('./assets'),
			import('./wasmLispVersion')
		]);

		expect(resolveLispRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			moduleUrl: 'https://example.com/absproxy/5173/wasm-lisp/index.js',
			manifestUrl: 'https://example.com/absproxy/5173/wasm-lisp/runtime-manifest.v2.json',
			manifestFingerprint: WASM_LISP_ASSET_VERSION
		});
	});

	it('does not trust a custom Lisp module without an explicit fingerprint', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_LISP_MODULE_URL = '';
		const { resolveLispRuntimeAssetConfig } = await import('./assets');

		expect(
			resolveLispRuntimeAssetConfig(
				{ lisp: { moduleUrl: '/custom/index.js?v=profile' } },
				'https://example.com/app'
			)
		).toEqual({
			moduleUrl: 'https://example.com/custom/index.js?v=profile',
			manifestUrl: 'https://example.com/custom/runtime-manifest.v2.json?v=profile',
			manifestFingerprint: ''
		});
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

		expect(resolveRubyWasmUrl('/absproxy/5173', 'https://example.com/app')).toBe(
			'https://example.com/absproxy/5173/wasm-ruby/assets/ruby_stdlib-C40Yu-vu.wasm'
		);
	});

	it('preserves the verified module query when deriving the Ruby wasm sibling', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_RUBY_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_RUBY_WASM_URL = '';
		const { resolveRubyWasmUrl } = await import('./assets');

		expect(
			resolveRubyWasmUrl(
				{ ruby: { moduleUrl: '/runtime/runtime.mjs?v=verified-profile' } },
				'https://example.com/app'
			)
		).toBe('https://example.com/runtime/assets/ruby_stdlib-C40Yu-vu.wasm?v=verified-profile');
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
			resolveClojureScriptRuntimeAssetConfig,
			resolvePascalRuntimeAssetConfig,
			resolvePerlRuntimeAssetConfig,
			resolvePrologRuntimeAssetConfig,
			resolveTclRuntimeAssetConfig
		} = await import('./assets');

		expect(
			resolvePrologRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-prolog/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-prolog/runner-worker.js',
			manifestUrl: 'https://example.com/absproxy/5173/wasm-prolog/runtime-manifest.v2.json',
			manifestFingerprint: WASM_PROLOG_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_PROLOG_RUNTIME_PROFILE),
			preflightProfile: WASM_PROLOG_RUNTIME_PROFILE,
			workerReceipt: WASM_PROLOG_RUNNER_RECEIPT
		});
		expect(resolveGleamRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://example.com/absproxy/5173/wasm-gleam/',
				workerUrl: 'https://example.com/absproxy/5173/wasm-gleam/runner-worker.js',
				manifestUrl: 'https://example.com/absproxy/5173/wasm-gleam/source-manifest.v2.json',
				manifestFingerprint: WASM_GLEAM_ASSET_VERSION,
				workerReceipt: WASM_GLEAM_RUNNER_RECEIPT
			}
		);
		expect(resolvePerlRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-perl/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-perl/runner-worker.js',
			manifestUrl: 'https://example.com/absproxy/5173/wasm-perl/runtime-manifest.v2.json',
			manifestFingerprint: WASM_PERL_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_PERL_RUNTIME_PROFILE),
			preflightProfile: WASM_PERL_RUNTIME_PROFILE,
			workerReceipt: WASM_PERL_RUNNER_RECEIPT
		});
		expect(resolveTclRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-tcl/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-tcl/runner-worker.js',
			manifestUrl: 'https://example.com/absproxy/5173/wasm-tcl/runtime-manifest.v2.json',
			manifestFingerprint: WASM_TCL_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_TCL_RUNTIME_PROFILE),
			preflightProfile: WASM_TCL_RUNTIME_PROFILE,
			workerReceipt: WASM_TCL_RUNNER_RECEIPT
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
				workerUrl: 'https://example.com/absproxy/5173/wasm-forth/runner-worker.js',
				manifestUrl:
					'https://example.com/absproxy/5173/wasm-forth/runtime-manifest.v2.json',
				manifestFingerprint: WASM_FORTH_ASSET_VERSION,
				preflightKey: JSON.stringify(WASM_FORTH_RUNTIME_PROFILE),
				preflightProfile: WASM_FORTH_RUNTIME_PROFILE,
				workerReceipt: WASM_FORTH_RUNNER_RECEIPT
			}
		);
		expect(resolveJRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-j/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-j/runner-worker.js',
			manifestUrl: 'https://example.com/absproxy/5173/wasm-j/runtime-manifest.v2.json',
			manifestFingerprint: WASM_J_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_J_RUNTIME_PROFILE),
			preflightProfile: WASM_J_RUNTIME_PROFILE,
			workerReceipt: WASM_J_RUNNER_RECEIPT
		});
		expect(resolveBqnRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-bqn/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-bqn/runner-worker.js',
			manifestUrl: 'https://example.com/absproxy/5173/wasm-bqn/runtime-manifest.v2.json',
			manifestFingerprint: WASM_BQN_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_BQN_RUNTIME_PROFILE),
			preflightProfile: WASM_BQN_RUNTIME_PROFILE,
			workerReceipt: WASM_BQN_RUNNER_RECEIPT
		});
		expect(
			resolveClojureScriptRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')
		).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-clojurescript/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-clojurescript/runner-worker.js',
			manifestUrl:
				'https://example.com/absproxy/5173/wasm-clojurescript/runtime-manifest.v2.json',
			manifestFingerprint: WASM_CLOJURESCRIPT_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_CLOJURESCRIPT_RUNTIME_PROFILE),
			preflightProfile: WASM_CLOJURESCRIPT_RUNTIME_PROFILE,
			workerReceipt: WASM_CLOJURESCRIPT_RUNNER_RECEIPT
		});
		expect(resolveJanetRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://example.com/absproxy/5173/wasm-janet/',
				workerUrl: 'https://example.com/absproxy/5173/wasm-janet/runner-worker.js',
				manifestUrl:
					'https://example.com/absproxy/5173/wasm-janet/runtime-manifest.v2.json',
				manifestFingerprint: WASM_JANET_ASSET_VERSION,
				preflightKey: JSON.stringify(WASM_JANET_RUNTIME_PROFILE),
				preflightProfile: WASM_JANET_RUNTIME_PROFILE,
				workerReceipt: WASM_JANET_RUNNER_RECEIPT
			}
		);
		expect(resolveJuliaRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://example.com/absproxy/5173/wasm-julia/',
				workerUrl: 'https://example.com/absproxy/5173/wasm-julia/runner-worker.js',
				manifestUrl:
					'https://example.com/absproxy/5173/wasm-julia/runtime-manifest.v2.json',
				manifestFingerprint: WASM_JULIA_ASSET_VERSION,
				preflightKey: JSON.stringify(WASM_JULIA_RUNTIME_PROFILE),
				preflightProfile: WASM_JULIA_RUNTIME_PROFILE,
				workerReceipt: WASM_JULIA_RUNNER_RECEIPT
			}
		);
		expect(resolveNimRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl: 'https://example.com/absproxy/5173/wasm-nim/',
			workerUrl: 'https://example.com/absproxy/5173/wasm-nim/runner-worker.js',
			manifestUrl: `https://example.com/absproxy/5173/wasm-nim/runtime-manifest.v2.json?v=${WASM_NIM_ASSET_VERSION}`,
			manifestFingerprint: WASM_NIM_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_NIM_RUNTIME_PROFILE),
			preflightProfile: WASM_NIM_RUNTIME_PROFILE,
			workerReceipt: WASM_NIM_RUNNER_RECEIPT
		});
		expect(resolveSwiftRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual(
			{
				baseUrl: 'https://example.com/absproxy/5173/wasm-swift/',
				workerUrl: 'https://example.com/absproxy/5173/wasm-swift/runner-worker.js',
				manifestUrl: 'https://example.com/absproxy/5173/wasm-swift/runtime-manifest.v1.json'
			}
		);
	});

	it('resolves one complete query-pinned Bash preflight bundle and rejects partial overrides', async () => {
		vi.resetModules();
		const { resolveBashRuntimeAssetConfig } = await import('./assets');
		const baseUrl = 'https://example.com/absproxy/5173/wasm-bash/';
		const manifestUrl = `${baseUrl}runtime-manifest.v2.json?v=${WASM_BASH_RUNTIME_PROFILE.manifestFingerprint}`;
		const moduleUrl = `${baseUrl}sdk/index.mjs.bin?v=${WASM_BASH_RUNTIME_PROFILE.sdkJavaScriptReceipt.sha256}`;
		const wasmerWasmUrl = `${baseUrl}sdk/wasmer_js_bg.wasm.gz.bin?v=${WASM_BASH_RUNTIME_PROFILE.wasmerWasmReceipt.sha256}`;
		const webcUrl = `${baseUrl}bash.webc.gz.bin?v=${WASM_BASH_RUNTIME_PROFILE.webcReceipt.sha256}`;
		const expectedIdentity = {
			baseUrl,
			manifestUrl,
			moduleUrl,
			wasmerWasmUrl,
			webcUrl,
			profile: WASM_BASH_RUNTIME_PROFILE
		};

		expect(resolveBashRuntimeAssetConfig('/absproxy/5173', 'https://example.com/app')).toEqual({
			baseUrl,
			manifestUrl,
			moduleUrl,
			wasmerWasmUrl,
			webcUrl,
			manifestFingerprint: WASM_BASH_RUNTIME_PROFILE.manifestFingerprint,
			preflightKey: JSON.stringify(expectedIdentity),
			preflightProfile: WASM_BASH_RUNTIME_PROFILE
		});
		expect(() =>
			resolveBashRuntimeAssetConfig(
				{ bash: { moduleUrl: 'https://runtime.example.test/wasm-bash/sdk/index.mjs.bin' } },
				'https://example.com/app'
			)
		).toThrow(/complete profile/iu);
		expect(() =>
			resolveBashRuntimeAssetConfig(
				{ bash: { workerUrl: 'https://runtime.example.test/arbitrary-worker.js' } },
				'https://example.com/app'
			)
		).toThrow(/workerUrl.*no longer supported/iu);
	});

	it('preserves relative default Prolog urls and pins when no current url is available', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_PROLOG_BASE_URL = '';
		publicEnv.PUBLIC_WASM_PROLOG_WORKER_URL = '';
		const { resolvePrologRuntimeAssetConfig } = await import('./assets');

		expect(resolvePrologRuntimeAssetConfig(undefined)).toEqual({
			baseUrl: '/wasm-prolog/',
			workerUrl: '/wasm-prolog/runner-worker.js',
			manifestUrl: '/wasm-prolog/runtime-manifest.v2.json',
			manifestFingerprint: WASM_PROLOG_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_PROLOG_RUNTIME_PROFILE),
			preflightProfile: WASM_PROLOG_RUNTIME_PROFILE,
			workerReceipt: WASM_PROLOG_RUNNER_RECEIPT
		});
	});

	it('rejects a custom Prolog fingerprint without a complete matching profile', async () => {
		vi.resetModules();
		const { resolvePrologRuntimeAssetConfig } = await import('./assets');

		expect(() =>
			resolvePrologRuntimeAssetConfig({
				prolog: {
					manifestFingerprint: 'a'.repeat(64),
					manifestReceipt: { bytes: 1, sha256: 'b'.repeat(64) }
				}
			})
		).toThrow('Prolog runtime preflight identity is invalid');
	});

	it('preserves relative default Tcl urls and pins when no current url is available', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_TCL_BASE_URL = '';
		publicEnv.PUBLIC_WASM_TCL_WORKER_URL = '';
		const { resolveTclRuntimeAssetConfig } = await import('./assets');

		expect(resolveTclRuntimeAssetConfig(undefined)).toEqual({
			baseUrl: '/wasm-tcl/',
			workerUrl: '/wasm-tcl/runner-worker.js',
			manifestUrl: '/wasm-tcl/runtime-manifest.v2.json',
			manifestFingerprint: WASM_TCL_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_TCL_RUNTIME_PROFILE),
			preflightProfile: WASM_TCL_RUNTIME_PROFILE,
			workerReceipt: WASM_TCL_RUNNER_RECEIPT
		});
	});

	it('rejects a custom Tcl fingerprint without a complete matching profile', async () => {
		vi.resetModules();
		const { resolveTclRuntimeAssetConfig } = await import('./assets');

		expect(() =>
			resolveTclRuntimeAssetConfig({
				tcl: {
					manifestFingerprint: 'a'.repeat(64),
					manifestReceipt: { bytes: 1, sha256: 'b'.repeat(64) }
				}
			})
		).toThrow('Tcl runtime preflight identity is invalid');

		expect(() =>
			resolveTclRuntimeAssetConfig({
				tcl: {
					...WASM_TCL_RUNTIME_PROFILE,
					manifestFingerprint: 'a'.repeat(64)
				}
			})
		).toThrow('complete profile and runner receipt bundle');
	});

	it('preserves relative default Forth urls when no current url is available', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_FORTH_BASE_URL = '';
		publicEnv.PUBLIC_WASM_FORTH_WORKER_URL = '';
		const { resolveForthRuntimeAssetConfig } = await import('./assets');

		expect(resolveForthRuntimeAssetConfig(undefined)).toEqual({
			baseUrl: '/wasm-forth/',
			workerUrl: '/wasm-forth/runner-worker.js',
			manifestUrl: '/wasm-forth/runtime-manifest.v2.json',
			manifestFingerprint: WASM_FORTH_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_FORTH_RUNTIME_PROFILE),
			preflightProfile: WASM_FORTH_RUNTIME_PROFILE,
			workerReceipt: WASM_FORTH_RUNNER_RECEIPT
		});
	});

	it('preserves relative default J urls and pins when no current url is available', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_J_BASE_URL = '';
		publicEnv.PUBLIC_WASM_J_WORKER_URL = '';
		const { resolveJRuntimeAssetConfig } = await import('./assets');

		expect(resolveJRuntimeAssetConfig(undefined)).toEqual({
			baseUrl: '/wasm-j/',
			workerUrl: '/wasm-j/runner-worker.js',
			manifestUrl: '/wasm-j/runtime-manifest.v2.json',
			manifestFingerprint: WASM_J_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_J_RUNTIME_PROFILE),
			preflightProfile: WASM_J_RUNTIME_PROFILE,
			workerReceipt: WASM_J_RUNNER_RECEIPT
		});
	});

	it('preserves relative default ClojureScript urls and pins when no current url is available', async () => {
		vi.resetModules();
		publicEnv.PUBLIC_WASM_CLOJURESCRIPT_BASE_URL = '';
		publicEnv.PUBLIC_WASM_CLOJURESCRIPT_WORKER_URL = '';
		const { resolveClojureScriptRuntimeAssetConfig } = await import('./assets');

		expect(resolveClojureScriptRuntimeAssetConfig(undefined)).toEqual({
			baseUrl: '/wasm-clojurescript/',
			workerUrl: '/wasm-clojurescript/runner-worker.js',
			manifestUrl: '/wasm-clojurescript/runtime-manifest.v2.json',
			manifestFingerprint: WASM_CLOJURESCRIPT_ASSET_VERSION,
			preflightKey: JSON.stringify(WASM_CLOJURESCRIPT_RUNTIME_PROFILE),
			preflightProfile: WASM_CLOJURESCRIPT_RUNTIME_PROFILE,
			workerReceipt: WASM_CLOJURESCRIPT_RUNNER_RECEIPT
		});
	});

	it('prefers explicit static worker runtime urls over public env overrides', async () => {
		const customFingerprint = 'a'.repeat(64);
		const customWorkerReceipt = { bytes: 1234, sha256: 'b'.repeat(64) };
		const customManifestReceipt = { bytes: 2345, sha256: 'c'.repeat(64) };
		const customRuntimeReceipt = { bytes: 3456, sha256: 'd'.repeat(64) };
		const customModuleReceipt = { bytes: 4567, sha256: 'e'.repeat(64) };
		const customWasmReceipt = {
			bytes: 5678,
			sha256: 'f'.repeat(64),
			uncompressedBytes: 6789,
			uncompressedSha256: '1'.repeat(64)
		};
		const customPrologProfile = {
			profileId: 'swipl-wasm-custom',
			packageRevision: '2'.repeat(40),
			swiplRevision: '3'.repeat(40),
			manifestFingerprint: customFingerprint,
			manifestReceipt: customManifestReceipt,
			javascriptReceipt: customRuntimeReceipt,
			wasmReceipt: customWasmReceipt,
			dataReceipt: {
				bytes: 7890,
				sha256: '4'.repeat(64),
				uncompressedBytes: 8901,
				uncompressedSha256: '5'.repeat(64)
			}
		};
		const customTclProfile = {
			...WASM_TCL_RUNTIME_PROFILE,
			manifestFingerprint: customFingerprint
		};
		const customPerlProfile = {
			...WASM_PERL_RUNTIME_PROFILE,
			manifestFingerprint: customFingerprint
		};
		const customJanetProfile = {
			profileId: 'janet-custom-emscripten-custom-wasm-idle-22222222',
			artifactRevision: '2'.repeat(40),
			janetVersion: 'custom',
			emscriptenVersion: 'custom',
			manifestFingerprint: customFingerprint,
			manifestReceipt: customManifestReceipt,
			javascriptReceipt: customModuleReceipt,
			wasmReceipt: customWasmReceipt
		};
		const customJuliaProfile = {
			...WASM_JULIA_RUNTIME_PROFILE,
			manifestFingerprint: customFingerprint
		};
		const customNimProfile = {
			...WASM_NIM_RUNTIME_PROFILE,
			manifestFingerprint: customFingerprint
		};
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
		publicEnv.PUBLIC_WASM_CLOJURESCRIPT_BASE_URL = 'https://env.example.com/clojurescript/';
		publicEnv.PUBLIC_WASM_SWIFT_BASE_URL = 'https://env.example.com/swift/';
		const {
			resolveAwkRuntimeAssetConfig,
			resolveBqnRuntimeAssetConfig,
			resolveClojureScriptRuntimeAssetConfig,
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
				{
					prolog: {
						baseUrl: '/runtime/prolog',
						workerUrl: '/runtime/prolog/worker.js',
						manifestUrl: '/runtime/prolog/manifest.json',
						...customPrologProfile,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/prolog/',
			workerUrl: 'https://example.com/runtime/prolog/worker.js',
			manifestUrl: 'https://example.com/runtime/prolog/manifest.json',
			manifestFingerprint: customFingerprint,
			preflightKey: JSON.stringify(customPrologProfile),
			preflightProfile: customPrologProfile,
			workerReceipt: customWorkerReceipt
		});
		expect(
			resolveGleamRuntimeAssetConfig(
				{
					gleam: {
						baseUrl: '/runtime/gleam',
						workerUrl: '/runtime/gleam/worker.js',
						manifestUrl: '/runtime/gleam/manifest.json',
						manifestFingerprint: customFingerprint,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/gleam/',
			workerUrl: 'https://example.com/runtime/gleam/worker.js',
			manifestUrl: 'https://example.com/runtime/gleam/manifest.json',
			manifestFingerprint: customFingerprint,
			workerReceipt: customWorkerReceipt
		});
		expect(
			resolvePerlRuntimeAssetConfig(
				{
					perl: {
						baseUrl: '/runtime/perl',
						workerUrl: '/runtime/perl/worker.js',
						manifestUrl: '/runtime/perl/manifest.json',
						...customPerlProfile,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/perl/',
			workerUrl: 'https://example.com/runtime/perl/worker.js',
			manifestUrl: 'https://example.com/runtime/perl/manifest.json',
			manifestFingerprint: customFingerprint,
			preflightKey: JSON.stringify(customPerlProfile),
			preflightProfile: customPerlProfile,
			workerReceipt: customWorkerReceipt
		});
		expect(
			resolveTclRuntimeAssetConfig(
				{
					tcl: {
						baseUrl: '/runtime/tcl',
						workerUrl: '/runtime/tcl/worker.js',
						manifestUrl: '/runtime/tcl/manifest.json',
						...customTclProfile,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/tcl/',
			workerUrl: 'https://example.com/runtime/tcl/worker.js',
			manifestUrl: 'https://example.com/runtime/tcl/manifest.json',
			manifestFingerprint: customFingerprint,
			preflightKey: JSON.stringify(customTclProfile),
			preflightProfile: customTclProfile,
			workerReceipt: customWorkerReceipt
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
				{
					forth: {
						baseUrl: '/runtime/forth',
						workerUrl: '/runtime/forth/worker.js',
						manifestUrl: '/runtime/forth/manifest.json',
						manifestFingerprint: customFingerprint,
						profileId: 'waforth-custom',
						implementationVersion: 'custom',
						manifestReceipt: customManifestReceipt,
						runtimeReceipt: customRuntimeReceipt,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/forth/',
			workerUrl: 'https://example.com/runtime/forth/worker.js',
			manifestUrl: 'https://example.com/runtime/forth/manifest.json',
			manifestFingerprint: customFingerprint,
			preflightKey: JSON.stringify({
				profileId: 'waforth-custom',
				implementationVersion: 'custom',
				manifestFingerprint: customFingerprint,
				manifestReceipt: customManifestReceipt,
				runtimeReceipt: customRuntimeReceipt
			}),
			preflightProfile: {
				profileId: 'waforth-custom',
				implementationVersion: 'custom',
				manifestFingerprint: customFingerprint,
				manifestReceipt: customManifestReceipt,
				runtimeReceipt: customRuntimeReceipt
			},
			workerReceipt: customWorkerReceipt
		});
		expect(
			resolveJRuntimeAssetConfig(
				{
					j: {
						baseUrl: '/runtime/j',
						workerUrl: '/runtime/j/worker.js',
						manifestUrl: '/runtime/j/manifest.json',
						manifestFingerprint: customFingerprint,
						profileId: 'jsoftware-j-playground-custom',
						sourceRevision: 'custom',
						manifestReceipt: customManifestReceipt,
						moduleReceipt: customModuleReceipt,
						wasmReceipt: customWasmReceipt,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/j/',
			workerUrl: 'https://example.com/runtime/j/worker.js',
			manifestUrl: 'https://example.com/runtime/j/manifest.json',
			manifestFingerprint: customFingerprint,
			preflightKey: JSON.stringify({
				profileId: 'jsoftware-j-playground-custom',
				sourceRevision: 'custom',
				manifestFingerprint: customFingerprint,
				manifestReceipt: customManifestReceipt,
				moduleReceipt: customModuleReceipt,
				wasmReceipt: customWasmReceipt
			}),
			preflightProfile: {
				profileId: 'jsoftware-j-playground-custom',
				sourceRevision: 'custom',
				manifestFingerprint: customFingerprint,
				manifestReceipt: customManifestReceipt,
				moduleReceipt: customModuleReceipt,
				wasmReceipt: customWasmReceipt
			},
			workerReceipt: customWorkerReceipt
		});
		expect(
			resolveBqnRuntimeAssetConfig(
				{
					bqn: {
						baseUrl: '/runtime/bqn',
						workerUrl: '/runtime/bqn/worker.js',
						manifestUrl: '/runtime/bqn/manifest.json',
						manifestFingerprint: customFingerprint,
						profileId: 'dzaima-cbqn-custom',
						sourceRevision: 'custom',
						manifestReceipt: customManifestReceipt,
						moduleReceipt: customModuleReceipt,
						wasmReceipt: customWasmReceipt,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/bqn/',
			workerUrl: 'https://example.com/runtime/bqn/worker.js',
			manifestUrl: 'https://example.com/runtime/bqn/manifest.json',
			manifestFingerprint: customFingerprint,
			preflightKey: JSON.stringify({
				profileId: 'dzaima-cbqn-custom',
				sourceRevision: 'custom',
				manifestFingerprint: customFingerprint,
				manifestReceipt: customManifestReceipt,
				moduleReceipt: customModuleReceipt,
				wasmReceipt: customWasmReceipt
			}),
			preflightProfile: {
				profileId: 'dzaima-cbqn-custom',
				sourceRevision: 'custom',
				manifestFingerprint: customFingerprint,
				manifestReceipt: customManifestReceipt,
				moduleReceipt: customModuleReceipt,
				wasmReceipt: customWasmReceipt
			},
			workerReceipt: customWorkerReceipt
		});
		expect(
			resolveClojureScriptRuntimeAssetConfig(
				{
					clojurescript: {
						baseUrl: '/runtime/clojurescript',
						workerUrl: '/runtime/clojurescript/worker.js',
						manifestUrl: '/runtime/clojurescript/manifest.json',
						manifestFingerprint: customFingerprint,
						profileId: 'clojurescript-1.12.134-custom',
						sourceRevision: 'r1.12.134',
						integrationRevision: '2'.repeat(40),
						manifestReceipt: customManifestReceipt,
						compilerReceipt: customWasmReceipt,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/clojurescript/',
			workerUrl: 'https://example.com/runtime/clojurescript/worker.js',
			manifestUrl: 'https://example.com/runtime/clojurescript/manifest.json',
			manifestFingerprint: customFingerprint,
			preflightKey: JSON.stringify({
				profileId: 'clojurescript-1.12.134-custom',
				sourceRevision: 'r1.12.134',
				integrationRevision: '2'.repeat(40),
				manifestFingerprint: customFingerprint,
				manifestReceipt: customManifestReceipt,
				compilerReceipt: customWasmReceipt
			}),
			preflightProfile: {
				profileId: 'clojurescript-1.12.134-custom',
				sourceRevision: 'r1.12.134',
				integrationRevision: '2'.repeat(40),
				manifestFingerprint: customFingerprint,
				manifestReceipt: customManifestReceipt,
				compilerReceipt: customWasmReceipt
			},
			workerReceipt: customWorkerReceipt
		});
		expect(
			resolveJanetRuntimeAssetConfig(
				{
					janet: {
						baseUrl: '/runtime/janet',
						workerUrl: '/runtime/janet/worker.js',
						manifestUrl: '/runtime/janet/manifest.json',
						...customJanetProfile,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/janet/',
			workerUrl: 'https://example.com/runtime/janet/worker.js',
			manifestUrl: 'https://example.com/runtime/janet/manifest.json',
			manifestFingerprint: customFingerprint,
			preflightKey: JSON.stringify(customJanetProfile),
			preflightProfile: customJanetProfile,
			workerReceipt: customWorkerReceipt
		});
		expect(
			resolveJuliaRuntimeAssetConfig(
				{
					julia: {
						baseUrl: '/runtime/julia',
						workerUrl: '/runtime/julia/worker.js',
						manifestUrl: '/runtime/julia/manifest.json',
						...customJuliaProfile,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/julia/',
			workerUrl: 'https://example.com/runtime/julia/worker.js',
			manifestUrl: 'https://example.com/runtime/julia/manifest.json',
			manifestFingerprint: customFingerprint,
			preflightKey: JSON.stringify(customJuliaProfile),
			preflightProfile: customJuliaProfile,
			workerReceipt: customWorkerReceipt
		});
		expect(
			resolveNimRuntimeAssetConfig(
				{
					nim: {
						baseUrl: '/runtime/nim',
						workerUrl: '/runtime/nim/worker.js',
						manifestUrl: `/runtime/nim/runtime-manifest.v2.json?v=${customFingerprint}`,
						...customNimProfile,
						workerReceipt: customWorkerReceipt
					}
				},
				'https://example.com/app'
			)
		).toEqual({
			baseUrl: 'https://example.com/runtime/nim/',
			workerUrl: 'https://example.com/runtime/nim/worker.js',
			manifestUrl: `https://example.com/runtime/nim/runtime-manifest.v2.json?v=${customFingerprint}`,
			manifestFingerprint: customFingerprint,
			preflightKey: JSON.stringify(customNimProfile),
			preflightProfile: customNimProfile,
			workerReceipt: customWorkerReceipt
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

	it('accepts custom Gleam URL environment overrides only with complete integrity pins', async () => {
		const manifestFingerprint = 'c'.repeat(64);
		const workerSha256 = 'd'.repeat(64);
		publicEnv.PUBLIC_WASM_GLEAM_BASE_URL = 'https://runtime.example.com/gleam/';
		publicEnv.PUBLIC_WASM_GLEAM_WORKER_URL = 'https://runtime.example.com/gleam/runner.js';
		publicEnv.PUBLIC_WASM_GLEAM_MANIFEST_URL =
			'https://runtime.example.com/gleam/manifest.json';
		publicEnv.PUBLIC_WASM_GLEAM_MANIFEST_FINGERPRINT = manifestFingerprint;
		publicEnv.PUBLIC_WASM_GLEAM_WORKER_SHA256 = workerSha256;
		publicEnv.PUBLIC_WASM_GLEAM_WORKER_BYTES = '4321';
		vi.resetModules();
		try {
			const { resolveGleamRuntimeAssetConfig } = await import('./assets');
			expect(resolveGleamRuntimeAssetConfig(undefined, 'https://example.com/app')).toEqual({
				baseUrl: 'https://runtime.example.com/gleam/',
				workerUrl: 'https://runtime.example.com/gleam/runner.js',
				manifestUrl: 'https://runtime.example.com/gleam/manifest.json',
				manifestFingerprint,
				workerReceipt: { bytes: 4321, sha256: workerSha256 }
			});
		} finally {
			publicEnv.PUBLIC_WASM_GLEAM_BASE_URL = '';
			publicEnv.PUBLIC_WASM_GLEAM_WORKER_URL = '';
			publicEnv.PUBLIC_WASM_GLEAM_MANIFEST_URL = '';
			publicEnv.PUBLIC_WASM_GLEAM_MANIFEST_FINGERPRINT = '';
			publicEnv.PUBLIC_WASM_GLEAM_WORKER_SHA256 = '';
			publicEnv.PUBLIC_WASM_GLEAM_WORKER_BYTES = '';
		}
	});

	it('rejects custom Perl URL environment overrides without a complete profile bundle', async () => {
		const manifestFingerprint = 'e'.repeat(64);
		const workerSha256 = 'f'.repeat(64);
		publicEnv.PUBLIC_WASM_PERL_BASE_URL = 'https://runtime.example.com/perl/';
		publicEnv.PUBLIC_WASM_PERL_WORKER_URL = 'https://runtime.example.com/perl/runner.js';
		publicEnv.PUBLIC_WASM_PERL_MANIFEST_URL = 'https://runtime.example.com/perl/manifest.json';
		publicEnv.PUBLIC_WASM_PERL_MANIFEST_FINGERPRINT = manifestFingerprint;
		publicEnv.PUBLIC_WASM_PERL_WORKER_SHA256 = workerSha256;
		publicEnv.PUBLIC_WASM_PERL_WORKER_BYTES = '5432';
		vi.resetModules();
		try {
			const { resolvePerlRuntimeAssetConfig } = await import('./assets');
			expect(() =>
				resolvePerlRuntimeAssetConfig(undefined, 'https://example.com/app')
			).toThrow('WebPerl runtime preflight identity is invalid');
		} finally {
			publicEnv.PUBLIC_WASM_PERL_BASE_URL = '';
			publicEnv.PUBLIC_WASM_PERL_WORKER_URL = '';
			publicEnv.PUBLIC_WASM_PERL_MANIFEST_URL = '';
			publicEnv.PUBLIC_WASM_PERL_MANIFEST_FINGERPRINT = '';
			publicEnv.PUBLIC_WASM_PERL_WORKER_SHA256 = '';
			publicEnv.PUBLIC_WASM_PERL_WORKER_BYTES = '';
		}
	});

	it('rejects custom Janet URL environment overrides without a complete profile bundle', async () => {
		publicEnv.PUBLIC_WASM_JANET_BASE_URL = 'https://runtime.example.com/janet/';
		publicEnv.PUBLIC_WASM_JANET_WORKER_URL = 'https://runtime.example.com/janet/runner.js';
		publicEnv.PUBLIC_WASM_JANET_MANIFEST_URL =
			'https://runtime.example.com/janet/manifest.json';
		publicEnv.PUBLIC_WASM_JANET_MANIFEST_FINGERPRINT = 'e'.repeat(64);
		publicEnv.PUBLIC_WASM_JANET_WORKER_SHA256 = 'f'.repeat(64);
		publicEnv.PUBLIC_WASM_JANET_WORKER_BYTES = '5432';
		vi.resetModules();
		try {
			const { resolveJanetRuntimeAssetConfig } = await import('./assets');
			expect(() =>
				resolveJanetRuntimeAssetConfig(undefined, 'https://example.com/app')
			).toThrow('Janet runtime preflight identity is invalid');
		} finally {
			publicEnv.PUBLIC_WASM_JANET_BASE_URL = '';
			publicEnv.PUBLIC_WASM_JANET_WORKER_URL = '';
			publicEnv.PUBLIC_WASM_JANET_MANIFEST_URL = '';
			publicEnv.PUBLIC_WASM_JANET_MANIFEST_FINGERPRINT = '';
			publicEnv.PUBLIC_WASM_JANET_WORKER_SHA256 = '';
			publicEnv.PUBLIC_WASM_JANET_WORKER_BYTES = '';
		}
	});

	it('rejects custom Julia URL environment overrides without a complete profile bundle', async () => {
		const manifestFingerprint = '7'.repeat(64);
		const workerSha256 = '8'.repeat(64);
		publicEnv.PUBLIC_WASM_JULIA_BASE_URL = 'https://runtime.example.com/julia/';
		publicEnv.PUBLIC_WASM_JULIA_WORKER_URL = 'https://runtime.example.com/julia/runner.js';
		publicEnv.PUBLIC_WASM_JULIA_MANIFEST_URL =
			'https://runtime.example.com/julia/manifest.json';
		publicEnv.PUBLIC_WASM_JULIA_MANIFEST_FINGERPRINT = manifestFingerprint;
		publicEnv.PUBLIC_WASM_JULIA_WORKER_SHA256 = workerSha256;
		publicEnv.PUBLIC_WASM_JULIA_WORKER_BYTES = '6543';
		vi.resetModules();
		try {
			const { resolveJuliaRuntimeAssetConfig } = await import('./assets');
			expect(() =>
				resolveJuliaRuntimeAssetConfig(undefined, 'https://example.com/app')
			).toThrow('Julia runtime preflight identity is invalid');
		} finally {
			publicEnv.PUBLIC_WASM_JULIA_BASE_URL = '';
			publicEnv.PUBLIC_WASM_JULIA_WORKER_URL = '';
			publicEnv.PUBLIC_WASM_JULIA_MANIFEST_URL = '';
			publicEnv.PUBLIC_WASM_JULIA_MANIFEST_FINGERPRINT = '';
			publicEnv.PUBLIC_WASM_JULIA_WORKER_SHA256 = '';
			publicEnv.PUBLIC_WASM_JULIA_WORKER_BYTES = '';
		}
	});

	it('rejects custom Nim URL environment overrides without a complete profile bundle', async () => {
		const manifestFingerprint = '9'.repeat(64);
		const workerSha256 = 'a'.repeat(64);
		publicEnv.PUBLIC_WASM_NIM_BASE_URL = 'https://runtime.example.com/nim/';
		publicEnv.PUBLIC_WASM_NIM_WORKER_URL = 'https://runtime.example.com/nim/runner.js';
		publicEnv.PUBLIC_WASM_NIM_MANIFEST_URL = 'https://runtime.example.com/nim/manifest.json';
		publicEnv.PUBLIC_WASM_NIM_MANIFEST_FINGERPRINT = manifestFingerprint;
		publicEnv.PUBLIC_WASM_NIM_WORKER_SHA256 = workerSha256;
		publicEnv.PUBLIC_WASM_NIM_WORKER_BYTES = '7654';
		vi.resetModules();
		try {
			const { resolveNimRuntimeAssetConfig } = await import('./assets');
			expect(() =>
				resolveNimRuntimeAssetConfig(undefined, 'https://example.com/app')
			).toThrow('Nim runtime profile ID');
		} finally {
			publicEnv.PUBLIC_WASM_NIM_BASE_URL = '';
			publicEnv.PUBLIC_WASM_NIM_WORKER_URL = '';
			publicEnv.PUBLIC_WASM_NIM_MANIFEST_URL = '';
			publicEnv.PUBLIC_WASM_NIM_MANIFEST_FINGERPRINT = '';
			publicEnv.PUBLIC_WASM_NIM_WORKER_SHA256 = '';
			publicEnv.PUBLIC_WASM_NIM_WORKER_BYTES = '';
		}
	});

	it('rejects a complete custom Nim profile paired with a noncanonical manifest URL', async () => {
		vi.resetModules();
		const { resolveNimRuntimeAssetConfig } = await import('./assets');

		expect(() =>
			resolveNimRuntimeAssetConfig(
				{
					nim: {
						baseUrl: 'https://runtime.example.com/nim/',
						workerUrl: 'https://runtime.example.com/nim/runner-worker.js',
						manifestUrl: 'https://runtime.example.com/nim/manifest.json',
						...WASM_NIM_RUNTIME_PROFILE,
						workerReceipt: WASM_NIM_RUNNER_RECEIPT
					}
				},
				'https://example.com/app'
			)
		).toThrow('canonical query-pinned v2 manifest');
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
			analyzerUrl: 'https://example.com/absproxy/5173/wasm-fortran/analyzer.js',
			integrity: WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS
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
			analyzerUrl: 'https://example.com/runtime/fortran/analyzer.js?v=test',
			integrity: WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS
		});
	});

	it('snapshots a custom Fortran execution trust root', () => {
		const integrity = structuredClone(WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS);
		const resolved = resolveFortranRuntimeAssetConfig(
			{ fortran: { integrity } },
			'https://example.com/app'
		);
		(integrity['f2c.wasm'] as { bytes: number }).bytes = 1;

		expect(resolved.integrity['f2c.wasm'].bytes).toBe(
			WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS['f2c.wasm'].bytes
		);
		expect(resolved.integrity).not.toBe(integrity);
		expect(Object.isFrozen(resolved.integrity)).toBe(true);
		expect(Object.isFrozen(resolved.integrity['f2c.h'])).toBe(true);
	});

	it('rejects an explicitly malformed Fortran trust root instead of using bundled receipts', () => {
		expect(() =>
			resolveFortranRuntimeAssetConfig(
				{ fortran: { integrity: null as never } },
				'https://example.com/app'
			)
		).toThrow('exactly three asset receipts');
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
			analyzerUrl: 'https://env.example.com/fortran/analyzer.js',
			integrity: WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS
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
			libffiUrl: 'https://example.com/absproxy/5173/wasm-objectivec/libffi.a',
			integrity: WASM_OBJECTIVEC_ASSET_RECEIPTS
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
		const customIntegrity = {
			...WASM_OBJECTIVEC_ASSET_RECEIPTS,
			'libobjc.a': { bytes: 73, sha256: 'a'.repeat(64) }
		};

		const resolved = resolveObjectiveCRuntimeAssetConfig(
			{
				objectivec: {
					baseUrl: '/runtime/objectivec/',
					libobjcUrl: '/runtime/objectivec/libobjc.a?v=test',
					headersUrl: '/runtime/objectivec/headers.json?v=test',
					libgnustepBaseUrl: '/runtime/objectivec/libgnustep-base.a?v=test',
					libgnustepBaseObjectUrl: '/runtime/objectivec/libgnustep-base.o?v=test',
					foundationHeadersUrl: '/runtime/objectivec/foundation-headers.json?v=test',
					libffiUrl: '/runtime/objectivec/libffi.a?v=test',
					integrity: customIntegrity
				}
			},
			'https://example.com/app'
		);
		expect(resolved).toEqual({
			baseUrl: 'https://example.com/runtime/objectivec/',
			libobjcUrl: 'https://example.com/runtime/objectivec/libobjc.a?v=test',
			headersUrl: 'https://example.com/runtime/objectivec/headers.json?v=test',
			libgnustepBaseUrl: 'https://example.com/runtime/objectivec/libgnustep-base.a?v=test',
			libgnustepBaseObjectUrl:
				'https://example.com/runtime/objectivec/libgnustep-base.o?v=test',
			foundationHeadersUrl:
				'https://example.com/runtime/objectivec/foundation-headers.json?v=test',
			libffiUrl: 'https://example.com/runtime/objectivec/libffi.a?v=test',
			integrity: customIntegrity
		});
		expect(resolved.integrity).not.toBe(customIntegrity);
		expect(resolved.integrity['libobjc.a']).not.toBe(customIntegrity['libobjc.a']);
		expect(Object.isFrozen(resolved.integrity)).toBe(true);
		expect(Object.isFrozen(resolved.integrity['libobjc.a'])).toBe(true);

		customIntegrity['libobjc.a'].bytes = 74;
		customIntegrity['libobjc.a'].sha256 = 'b'.repeat(64);
		expect(resolved.integrity['libobjc.a']).toEqual({
			bytes: 73,
			sha256: 'a'.repeat(64)
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
			libffiUrl: 'https://env.example.com/objectivec/libffi.a',
			integrity: WASM_OBJECTIVEC_ASSET_RECEIPTS
		});
	});
});
