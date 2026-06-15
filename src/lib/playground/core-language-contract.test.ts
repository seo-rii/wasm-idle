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

	it('exposes VB.NET aliases as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('VBNET');
		expect(normalizeLanguageId('vbnet')).toBe('VBNET');
		expect(normalizeLanguageId('vb')).toBe('VBNET');
		expect(normalizeLanguageId('visualbasic')).toBe('VBNET');
		expect(isDeferredProgressLanguage('vb')).toBe(true);
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
				stdlibUrl: '/wasm-zig/std.zip?v=test'
			}
		});

		expect(key).toContain('"zigCompilerUrl":"/wasm-zig/zig_small.wasm?v=test"');
		expect(key).toContain('"zigStdlibUrl":"/wasm-zig/std.zip?v=test"');
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

	it('includes Ruby wasm urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			ruby: {
				wasmUrl: '/ruby/ruby+stdlib.wasm?v=test'
			}
		});

		expect(key).toContain('"rubyWasmUrl":"/ruby/ruby+stdlib.wasm?v=test"');
	});

	it('includes SQLite wasm urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			sqlite: {
				wasmUrl: '/sqlite/sql-wasm.wasm?v=test'
			}
		});

		expect(key).toContain('"sqliteWasmUrl":"/sqlite/sql-wasm.wasm?v=test"');
	});

	it('includes PHP versions in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			php: {
				version: '8.5'
			}
		});

		expect(key).toContain('"phpVersion":"8.5"');
	});
});
