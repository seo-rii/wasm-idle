import { describe, expect, it } from 'vitest';
import {
	createRuntimeAssetsKey,
	isDeferredProgressLanguage,
	normalizeLanguageId,
	supportedLanguageIds
} from '@wasm-idle/core';

describe('core language contract', () => {
	it('exposes Haskell as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('HASKELL');
		expect(normalizeLanguageId('haskell')).toBe('HASKELL');
		expect(normalizeLanguageId('hs')).toBe('HASKELL');
		expect(isDeferredProgressLanguage('haskell')).toBe(true);
	});

	it('includes Haskell module, rootfs, bsdtar, and search path urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			haskell: {
				moduleUrl: '/wasm-haskell/dyld.mjs?v=test',
				rootfsUrl: '/wasm-haskell/rootfs.tar.zst?v=test',
				bsdtarUrl: '/wasm-haskell/bsdtar.wasm?v=test',
				mainSoPath: '/ghc_wasm_jsffi.so',
				searchDirs: ['/lib/wasm32-wasi-ghc-9.13.20250303', '/lib/wasm-ghc']
			}
		});

		expect(key).toContain('"haskellModuleUrl":"/wasm-haskell/dyld.mjs?v=test"');
		expect(key).toContain('"haskellRootfsUrl":"/wasm-haskell/rootfs.tar.zst?v=test"');
		expect(key).toContain('"haskellBsdtarUrl":"/wasm-haskell/bsdtar.wasm?v=test"');
		expect(key).toContain('"haskellMainSoPath":"/ghc_wasm_jsffi.so"');
		expect(JSON.parse(key || '{}').haskellSearchDirs).toBe(
			['/lib/wasm32-wasi-ghc-9.13.20250303', '/lib/wasm-ghc'].join('\0')
		);
	});

	it('includes folder-backed runtime base urls and loader presence in runtime asset cache keys', () => {
		const loader = () => undefined;
		const key = JSON.parse(
			createRuntimeAssetsKey({
				rootUrl: '/repl',
				python: { baseUrl: '/pyodide/test/', loader },
				java: { baseUrl: '/teavm/test/' },
				clang: { baseUrl: '/clang/test/', loader },
				clangd: { baseUrl: '/clangd/test/' }
			}) || '{}'
		);

		expect(key).toMatchObject({
			rootUrl: '/repl',
			pythonBaseUrl: '/pyodide/test/',
			hasPythonLoader: true,
			javaBaseUrl: '/teavm/test/',
			hasJavaLoader: false,
			clangBaseUrl: '/clang/test/',
			hasClangLoader: true,
			clangdBaseUrl: '/clangd/test/',
			hasClangdLoader: false
		});
	});

	it('includes both Rust compiler assets in runtime cache keys', () => {
		const key = JSON.parse(
			createRuntimeAssetsKey({
				rust: {
					compilerUrl: '/wasm-rust/index.js?v=test',
					debugModuleUrl: '/wasm-rust/debug-instrumenter.js?v=test'
				}
			}) || '{}'
		);

		expect(key).toMatchObject({
			rustCompilerUrl: '/wasm-rust/index.js?v=test',
			rustDebugModuleUrl: '/wasm-rust/debug-instrumenter.js?v=test'
		});
	});

	it('exposes Zig as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('ZIG');
		expect(normalizeLanguageId('zig')).toBe('ZIG');
		expect(isDeferredProgressLanguage('zig')).toBe(true);
	});

	it('exposes WAT as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('WAT');
		expect(normalizeLanguageId('wat')).toBe('WAT');
		expect(isDeferredProgressLanguage('wat')).toBe(true);
	});

	it('exposes WASM aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('WASM');
		expect(normalizeLanguageId('wasm')).toBe('WASM');
		expect(normalizeLanguageId('wasm32')).toBe('WASM');
		expect(isDeferredProgressLanguage('wasm32')).toBe(true);
	});

	it('exposes Lua as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('LUA');
		expect(normalizeLanguageId('lua')).toBe('LUA');
		expect(isDeferredProgressLanguage('lua')).toBe(true);
	});

	it('exposes Ruby aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('RUBY');
		expect(normalizeLanguageId('ruby')).toBe('RUBY');
		expect(normalizeLanguageId('rb')).toBe('RUBY');
		expect(isDeferredProgressLanguage('ruby')).toBe(true);
	});

	it('exposes R as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('R');
		expect(normalizeLanguageId('r')).toBe('R');
		expect(isDeferredProgressLanguage('r')).toBe(true);
	});

	it('exposes Octave and MATLAB aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('OCTAVE');
		expect(normalizeLanguageId('octave')).toBe('OCTAVE');
		expect(normalizeLanguageId('matlab')).toBe('OCTAVE');
		expect(isDeferredProgressLanguage('matlab')).toBe(true);
	});

	it('exposes SQLite aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('SQLITE');
		expect(normalizeLanguageId('sqlite')).toBe('SQLITE');
		expect(normalizeLanguageId('sql')).toBe('SQLITE');
		expect(isDeferredProgressLanguage('sql')).toBe(true);
	});

	it('exposes DuckDB as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('DUCKDB');
		expect(normalizeLanguageId('duckdb')).toBe('DUCKDB');
		expect(isDeferredProgressLanguage('duckdb')).toBe(true);
	});

	it('exposes PHP as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('PHP');
		expect(normalizeLanguageId('php')).toBe('PHP');
		expect(isDeferredProgressLanguage('php')).toBe(true);
	});

	it('exposes Erlang aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('ERLANG');
		expect(normalizeLanguageId('erlang')).toBe('ERLANG');
		expect(normalizeLanguageId('erl')).toBe('ERLANG');
		expect(isDeferredProgressLanguage('erl')).toBe(true);
	});

	it('exposes Prolog, Gleam, Perl, Tcl, AWK, Pascal, Forth, J, BQN, Janet, Julia, and Nim as deferred browser runtime languages', () => {
		expect(supportedLanguageIds).toContain('PROLOG');
		expect(supportedLanguageIds).toContain('GLEAM');
		expect(supportedLanguageIds).toContain('PERL');
		expect(supportedLanguageIds).toContain('TCL');
		expect(supportedLanguageIds).toContain('AWK');
		expect(supportedLanguageIds).toContain('PASCAL');
		expect(supportedLanguageIds).toContain('FORTH');
		expect(supportedLanguageIds).toContain('J');
		expect(supportedLanguageIds).toContain('BQN');
		expect(supportedLanguageIds).toContain('JANET');
		expect(supportedLanguageIds).toContain('JULIA');
		expect(supportedLanguageIds).toContain('NIM');
		expect(normalizeLanguageId('swipl')).toBe('PROLOG');
		expect(normalizeLanguageId('swi')).toBe('PROLOG');
		expect(normalizeLanguageId('gleam')).toBe('GLEAM');
		expect(normalizeLanguageId('perl')).toBe('PERL');
		expect(normalizeLanguageId('tclsh')).toBe('TCL');
		expect(normalizeLanguageId('gawk')).toBe('AWK');
		expect(normalizeLanguageId('pas')).toBe('PASCAL');
		expect(normalizeLanguageId('fpc')).toBe('PASCAL');
		expect(normalizeLanguageId('gforth')).toBe('FORTH');
		expect(normalizeLanguageId('jl')).toBe('JULIA');
		expect(normalizeLanguageId('nimrod')).toBe('NIM');
		expect(isDeferredProgressLanguage('swipl')).toBe(true);
		expect(isDeferredProgressLanguage('gleam')).toBe(true);
		expect(isDeferredProgressLanguage('perl')).toBe(true);
		expect(isDeferredProgressLanguage('tclsh')).toBe(true);
		expect(isDeferredProgressLanguage('gawk')).toBe(true);
		expect(isDeferredProgressLanguage('pas')).toBe(true);
		expect(isDeferredProgressLanguage('gforth')).toBe(true);
		expect(isDeferredProgressLanguage('j')).toBe(true);
		expect(isDeferredProgressLanguage('bqn')).toBe(true);
		expect(isDeferredProgressLanguage('janet')).toBe(true);
		expect(isDeferredProgressLanguage('julia')).toBe(true);
		expect(isDeferredProgressLanguage('nim')).toBe(true);
	});

	it('keeps Swift out of the core runtime registry until a verified browser compiler bundle exists', () => {
		expect(supportedLanguageIds).not.toContain('SWIFT');
		expect(isDeferredProgressLanguage('swift')).toBe(false);
	});

	it('exposes Bash aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('BASH');
		expect(normalizeLanguageId('bash')).toBe('BASH');
		expect(normalizeLanguageId('sh')).toBe('BASH');
		expect(normalizeLanguageId('shell')).toBe('BASH');
		expect(isDeferredProgressLanguage('sh')).toBe(true);
	});

	it('exposes Fortran aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('FORTRAN');
		expect(normalizeLanguageId('fortran')).toBe('FORTRAN');
		expect(normalizeLanguageId('f77')).toBe('FORTRAN');
		expect(isDeferredProgressLanguage('f77')).toBe(true);
	});

	it('includes the Bash WEBc url in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({ bash: { webcUrl: '/wasm-bash/bash.webc?v=test' } });
		expect(key).toContain('"bashWebcUrl":"/wasm-bash/bash.webc?v=test"');
	});

	it('exposes ClojureScript aliases and static worker urls', () => {
		expect(supportedLanguageIds).toContain('CLOJURESCRIPT');
		expect(normalizeLanguageId('clojurescript')).toBe('CLOJURESCRIPT');
		expect(normalizeLanguageId('cljs')).toBe('CLOJURESCRIPT');
		expect(isDeferredProgressLanguage('cljs')).toBe(true);
		const key = createRuntimeAssetsKey({
			clojurescript: {
				baseUrl: '/wasm-clojurescript/',
				workerUrl: '/wasm-clojurescript/runner-worker.js?v=test'
			}
		});
		expect(key).toContain('"clojurescriptBaseUrl":"/wasm-clojurescript/"');
		expect(key).toContain(
			'"clojurescriptWorkerUrl":"/wasm-clojurescript/runner-worker.js?v=test"'
		);
	});

	it('exposes COBOL aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('COBOL');
		expect(normalizeLanguageId('cobol')).toBe('COBOL');
		expect(normalizeLanguageId('cob')).toBe('COBOL');
		expect(normalizeLanguageId('cbl')).toBe('COBOL');
		expect(normalizeLanguageId('gnucobol')).toBe('COBOL');
		expect(isDeferredProgressLanguage('gnucobol')).toBe(true);
	});

	it('includes the COBOL runtime base url in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			cobol: { baseUrl: '/wasm-cobol/' }
		});

		expect(key).toContain('"cobolBaseUrl":"/wasm-cobol/"');
	});

	it('includes Swift runtime urls in runtime asset cache keys before registration', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			swift: {
				baseUrl: '/wasm-swift/',
				workerUrl: '/wasm-swift/runner-worker.js?v=test',
				manifestUrl: '/wasm-swift/runtime-manifest.v1.json?v=test'
			}
		});

		expect(key).toContain('"swiftBaseUrl":"/wasm-swift/"');
		expect(key).toContain('"swiftWorkerUrl":"/wasm-swift/runner-worker.js?v=test"');
		expect(key).toContain('"swiftManifestUrl":"/wasm-swift/runtime-manifest.v1.json?v=test"');
	});

	it('exposes VB.NET aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('VBNET');
		expect(normalizeLanguageId('vbnet')).toBe('VBNET');
		expect(normalizeLanguageId('vb')).toBe('VBNET');
		expect(normalizeLanguageId('visualbasic')).toBe('VBNET');
		expect(isDeferredProgressLanguage('vb')).toBe(true);
	});

	it('includes static worker urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			pascal: {
				baseUrl: '/wasm-pascal/',
				workerUrl: '/wasm-pascal/runner-worker.js?v=test'
			},
			forth: {
				baseUrl: '/wasm-forth/',
				workerUrl: '/wasm-forth/runner-worker.js?v=test'
			},
			j: {
				baseUrl: '/wasm-j/',
				workerUrl: '/wasm-j/runner-worker.js?v=test'
			},
			bqn: {
				baseUrl: '/wasm-bqn/',
				workerUrl: '/wasm-bqn/runner-worker.js?v=test'
			},
			janet: {
				baseUrl: '/wasm-janet/',
				workerUrl: '/wasm-janet/runner-worker.js?v=test'
			},
			julia: {
				baseUrl: '/wasm-julia/',
				workerUrl: '/wasm-julia/runner-worker.js?v=test'
			},
			nim: {
				baseUrl: '/wasm-nim/',
				workerUrl: '/wasm-nim/runner-worker.js?v=test'
			}
		});

		expect(key).toContain('"pascalBaseUrl":"/wasm-pascal/"');
		expect(key).toContain('"pascalWorkerUrl":"/wasm-pascal/runner-worker.js?v=test"');
		expect(key).toContain('"forthBaseUrl":"/wasm-forth/"');
		expect(key).toContain('"forthWorkerUrl":"/wasm-forth/runner-worker.js?v=test"');
		expect(key).toContain('"jBaseUrl":"/wasm-j/"');
		expect(key).toContain('"jWorkerUrl":"/wasm-j/runner-worker.js?v=test"');
		expect(key).toContain('"bqnBaseUrl":"/wasm-bqn/"');
		expect(key).toContain('"bqnWorkerUrl":"/wasm-bqn/runner-worker.js?v=test"');
		expect(key).toContain('"janetBaseUrl":"/wasm-janet/"');
		expect(key).toContain('"janetWorkerUrl":"/wasm-janet/runner-worker.js?v=test"');
		expect(key).toContain('"juliaBaseUrl":"/wasm-julia/"');
		expect(key).toContain('"juliaWorkerUrl":"/wasm-julia/runner-worker.js?v=test"');
		expect(key).toContain('"nimBaseUrl":"/wasm-nim/"');
		expect(key).toContain('"nimWorkerUrl":"/wasm-nim/runner-worker.js?v=test"');
	});

	it('exposes D aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('D');
		expect(normalizeLanguageId('d')).toBe('D');
		expect(normalizeLanguageId('dlang')).toBe('D');
		expect(isDeferredProgressLanguage('dlang')).toBe(true);
	});

	it('exposes AssemblyScript aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('ASSEMBLYSCRIPT');
		expect(normalizeLanguageId('assemblyscript')).toBe('ASSEMBLYSCRIPT');
		expect(normalizeLanguageId('as')).toBe('ASSEMBLYSCRIPT');
		expect(isDeferredProgressLanguage('assemblyscript')).toBe(true);
	});

	it('exposes Lisp aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('LISP');
		expect(normalizeLanguageId('lisp')).toBe('LISP');
		expect(normalizeLanguageId('scheme')).toBe('LISP');
		expect(normalizeLanguageId('scm')).toBe('LISP');
		expect(isDeferredProgressLanguage('scheme')).toBe(true);
	});

	it('includes Zig compiler and stdlib urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			zig: {
				compilerUrl: '/wasm-zig/zig_small.wasm?v=test',
				stdlibUrl: '/wasm-zig/std.tar.gz?v=test'
			}
		});

		expect(key).toContain('"zigCompilerUrl":"/wasm-zig/zig_small.wasm?v=test"');
		expect(key).toContain('"zigStdlibUrl":"/wasm-zig/std.tar.gz?v=test"');
	});

	it('includes R base url in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			r: {
				baseUrl: '/webr/test/'
			}
		});

		expect(key).toContain('"rBaseUrl":"/webr/test/"');
	});

	it('includes Octave runtime urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			octave: {
				baseUrl: '/wasm-octave/runtime/',
				workerUrl: '/wasm-octave/runner-worker.js?v=test',
				manifestUrl: '/wasm-octave/runtime/runtime-manifest.v1.json?v=test'
			}
		});

		expect(key).toContain('"octaveBaseUrl":"/wasm-octave/runtime/"');
		expect(key).toContain('"octaveWorkerUrl":"/wasm-octave/runner-worker.js?v=test"');
		expect(key).toContain(
			'"octaveManifestUrl":"/wasm-octave/runtime/runtime-manifest.v1.json?v=test"'
		);
	});

	it('includes static worker runtime urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			prolog: {
				baseUrl: '/wasm-prolog/',
				workerUrl: '/wasm-prolog/runner-worker.js?v=test'
			},
			gleam: {
				baseUrl: '/wasm-gleam/',
				workerUrl: '/wasm-gleam/runner-worker.js?v=test',
				manifestUrl: '/wasm-gleam/source-manifest.v1.json?v=test'
			},
			perl: {
				baseUrl: '/wasm-perl/',
				workerUrl: '/wasm-perl/runner-worker.js?v=test'
			},
			tcl: {
				baseUrl: '/wasm-tcl/',
				workerUrl: '/wasm-tcl/runner-worker.js?v=test'
			},
			awk: {
				baseUrl: '/wasm-awk/',
				workerUrl: '/wasm-awk/runner-worker.js?v=test'
			}
		});

		expect(key).toContain('"prologBaseUrl":"/wasm-prolog/"');
		expect(key).toContain('"prologWorkerUrl":"/wasm-prolog/runner-worker.js?v=test"');
		expect(key).toContain('"gleamBaseUrl":"/wasm-gleam/"');
		expect(key).toContain('"gleamWorkerUrl":"/wasm-gleam/runner-worker.js?v=test"');
		expect(key).toContain('"gleamManifestUrl":"/wasm-gleam/source-manifest.v1.json?v=test"');
		expect(key).toContain('"perlBaseUrl":"/wasm-perl/"');
		expect(key).toContain('"perlWorkerUrl":"/wasm-perl/runner-worker.js?v=test"');
		expect(key).toContain('"tclBaseUrl":"/wasm-tcl/"');
		expect(key).toContain('"tclWorkerUrl":"/wasm-tcl/runner-worker.js?v=test"');
		expect(key).toContain('"awkBaseUrl":"/wasm-awk/"');
		expect(key).toContain('"awkWorkerUrl":"/wasm-awk/runner-worker.js?v=test"');
	});

	it('includes WAT module urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			wat: {
				moduleUrl: '/wasm-wat/index.js?v=test'
			}
		});

		expect(key).toContain('"watModuleUrl":"/wasm-wat/index.js?v=test"');
	});

	it('includes Lua module urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			lua: {
				moduleUrl: '/wasm-lua/index.js?v=test'
			}
		});

		expect(key).toContain('"luaModuleUrl":"/wasm-lua/index.js?v=test"');
	});

	it('includes D module urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			d: {
				moduleUrl: '/wasm-d/index.js?v=test'
			}
		});

		expect(key).toContain('"dModuleUrl":"/wasm-d/index.js?v=test"');
	});

	it('includes Erlang bundle urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			erlang: {
				bundleUrl: '/wasm-elixir/bundle.avm?v=test'
			}
		});

		expect(key).toContain('"erlangBundleUrl":"/wasm-elixir/bundle.avm?v=test"');
	});

	it('includes Lisp module urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			lisp: {
				moduleUrl: '/wasm-lisp/index.js?v=test'
			}
		});

		expect(key).toContain('"lispModuleUrl":"/wasm-lisp/index.js?v=test"');
	});

	it('includes Ruby runtime module and wasm urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			ruby: {
				moduleUrl: '/wasm-ruby/runtime.mjs?v=test',
				wasmUrl: '/ruby/ruby+stdlib.wasm?v=test'
			}
		});

		expect(key).toContain('"rubyModuleUrl":"/wasm-ruby/runtime.mjs?v=test"');
		expect(key).toContain('"rubyWasmUrl":"/ruby/ruby+stdlib.wasm?v=test"');
	});

	it('includes external runtime module urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			assemblyscript: { moduleUrl: '/wasm-assemblyscript/runtime.mjs?v=test' },
			duckdb: { moduleUrl: '/wasm-duckdb/runtime.mjs?v=test' },
			php: { moduleUrl: '/wasm-php/runtime.mjs?v=test' },
			bash: {
				moduleUrl: '/wasm-bash/sdk/index.mjs?v=test',
				webcUrl: '/wasm-bash/bash.webc?v=test',
				workerUrl: '/wasm-bash/sdk/worker.mjs?v=test'
			},
			sqlite: {
				moduleUrl: '/wasm-sqlite/runtime.mjs?v=test',
				wasmUrl: '/sqlite/sql-wasm.wasm?v=test'
			}
		});

		expect(key).toContain(
			'"assemblyScriptModuleUrl":"/wasm-assemblyscript/runtime.mjs?v=test"'
		);
		expect(key).toContain('"duckDbModuleUrl":"/wasm-duckdb/runtime.mjs?v=test"');
		expect(key).toContain('"phpModuleUrl":"/wasm-php/runtime.mjs?v=test"');
		expect(key).toContain('"bashModuleUrl":"/wasm-bash/sdk/index.mjs?v=test"');
		expect(key).toContain('"bashWorkerUrl":"/wasm-bash/sdk/worker.mjs?v=test"');
		expect(key).toContain('"sqliteModuleUrl":"/wasm-sqlite/runtime.mjs?v=test"');
		expect(key).toContain('"sqliteWasmUrl":"/sqlite/sql-wasm.wasm?v=test"');
	});
});
