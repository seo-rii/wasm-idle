import { describe, expect, it } from 'vitest';
import {
	RUBY_RUNTIME_PROFILE,
	createRuntimeAssetsKey,
	isDeferredProgressLanguage,
	normalizeLanguageId,
	supportedLanguageIds
} from '@wasm-idle/core';

describe('core language contract', () => {
	it('exposes TinyGo as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('TINYGO');
		expect(normalizeLanguageId('tinygo')).toBe('TINYGO');
		expect(isDeferredProgressLanguage('tinygo')).toBe(true);
	});

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

	it('distinguishes custom loader identities in runtime asset cache keys', () => {
		const firstLoader = () => undefined;
		const secondLoader = () => undefined;
		const firstKey = createRuntimeAssetsKey({ python: { loader: firstLoader } });
		const secondKey = createRuntimeAssetsKey({ python: { loader: secondLoader } });

		expect(firstKey).toBe(createRuntimeAssetsKey({ python: { loader: firstLoader } }));
		expect(firstKey).not.toBe(secondKey);
		expect(
			createRuntimeAssetsKey({
				python: { loader: firstLoader, loaderKey: 'pyodide-cache-v1' }
			})
		).toBe(
			createRuntimeAssetsKey({
				python: { loader: secondLoader, loaderKey: 'pyodide-cache-v1' }
			})
		);
	});

	it('includes runtime integrity metadata in asset cache keys', () => {
		const firstKey = createRuntimeAssetsKey({
			clang: {
				integrity: {
					'bin/clang.wasm.gz': {
						sha256: 'a'.repeat(64),
						bytes: 123,
						uncompressedSha256: 'c'.repeat(64),
						uncompressedBytes: 456
					}
				}
			}
		});
		const secondKey = createRuntimeAssetsKey({
			clang: {
				integrity: {
					'bin/clang.wasm.gz': {
						sha256: 'a'.repeat(64),
						bytes: 123,
						uncompressedSha256: 'd'.repeat(64),
						uncompressedBytes: 456
					}
				}
			}
		});

		expect(firstKey).not.toBe(secondKey);
	});

	it('rejects malformed runtime integrity metadata before key generation', () => {
		expect(() =>
			createRuntimeAssetsKey({
				clang: { integrity: { '../clang.wasm': 'a'.repeat(64) } }
			})
		).toThrow('asset key must be normalized and relative');
		expect(() =>
			createRuntimeAssetsKey({
				clang: { integrity: { 'clang.wasm': 'not-a-digest' } }
			})
		).toThrow('invalid SHA-256');
		expect(() =>
			createRuntimeAssetsKey({
				clang: {
					integrity: {
						'clang.wasm': { sha256: 'a'.repeat(64), bytes: -1 }
					}
				}
			})
		).toThrow('invalid byte size');
		expect(() =>
			createRuntimeAssetsKey({
				clang: {
					integrity: {
						'clang.wasm': {
							sha256: 'a'.repeat(64),
							uncompressedSha256: 'b'.repeat(64)
						}
					}
				}
			})
		).toThrow('requires both uncompressed digest and size');
	});

	it('includes allowed runtime asset bases in cache keys', () => {
		const firstKey = createRuntimeAssetsKey({
			clang: { allowedBaseUrls: ['https://one.example.com/clang/'] }
		});
		const secondKey = createRuntimeAssetsKey({
			clang: { allowedBaseUrls: ['https://two.example.com/clang/'] }
		});

		expect(firstKey).not.toBe(secondKey);
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
		const key = createRuntimeAssetsKey({
			bash: {
				webcUrl: '/wasm-bash/bash.webc?v=test',
				webcReceipt: { bytes: 4, sha256: 'a'.repeat(64) }
			}
		});
		expect(key).toContain('"bashWebcUrl":"/wasm-bash/bash.webc?v=test"');
		expect(key).toContain('"bashWebcReceipt":');
		expect(key).not.toBe(
			createRuntimeAssetsKey({
				bash: {
					webcUrl: '/wasm-bash/bash.webc?v=test',
					webcReceipt: { bytes: 4, sha256: 'b'.repeat(64) }
				}
			})
		);
	});

	it('exposes ClojureScript aliases and static worker urls', () => {
		expect(supportedLanguageIds).toContain('CLOJURESCRIPT');
		expect(normalizeLanguageId('clojurescript')).toBe('CLOJURESCRIPT');
		expect(normalizeLanguageId('cljs')).toBe('CLOJURESCRIPT');
		expect(isDeferredProgressLanguage('cljs')).toBe(true);
		const key = createRuntimeAssetsKey({
			clojurescript: {
				baseUrl: '/wasm-clojurescript/',
				workerUrl: '/wasm-clojurescript/runner-worker.js?v=test',
				manifestUrl: '/wasm-clojurescript/runtime-manifest.v2.json?v=test',
				manifestFingerprint: 'a'.repeat(64),
				profileId: 'clojurescript-1.12.134-test',
				sourceRevision: 'r1.12.134',
				integrationRevision: 'c'.repeat(40),
				manifestReceipt: { bytes: 2345, sha256: 'd'.repeat(64) },
				compilerReceipt: {
					bytes: 3456,
					sha256: 'e'.repeat(64),
					uncompressedBytes: 4567,
					uncompressedSha256: 'f'.repeat(64)
				},
				workerReceipt: { bytes: 1234, sha256: 'b'.repeat(64) }
			}
		});
		expect(key).toContain('"clojurescriptBaseUrl":"/wasm-clojurescript/"');
		expect(key).toContain(
			'"clojurescriptWorkerUrl":"/wasm-clojurescript/runner-worker.js?v=test"'
		);
		expect(key).toContain(
			'"clojurescriptManifestUrl":"/wasm-clojurescript/runtime-manifest.v2.json?v=test"'
		);
		expect(key).toContain('"clojurescriptManifestFingerprint":');
		expect(key).toContain('"clojurescriptProfileId":"clojurescript-1.12.134-test"');
		expect(key).toContain('"clojurescriptSourceRevision":"r1.12.134"');
		expect(key).toContain('"clojurescriptIntegrationRevision":');
		expect(key).toContain('"clojurescriptManifestReceipt":');
		expect(key).toContain('"clojurescriptCompilerReceipt":');
		expect(key).toContain('"clojurescriptWorkerReceipt":');
		expect(key).not.toBe(
			createRuntimeAssetsKey({
				clojurescript: {
					manifestFingerprint: 'a'.repeat(64),
					profileId: 'clojurescript-1.12.134-test',
					sourceRevision: 'r1.12.134',
					integrationRevision: 'c'.repeat(40),
					manifestReceipt: { bytes: 2345, sha256: 'd'.repeat(64) },
					compilerReceipt: {
						bytes: 3456,
						sha256: '0'.repeat(64),
						uncompressedBytes: 4567,
						uncompressedSha256: 'f'.repeat(64)
					},
					workerReceipt: { bytes: 1234, sha256: 'b'.repeat(64) }
				}
			})
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
				workerUrl: '/wasm-forth/runner-worker.js?v=test',
				manifestUrl: '/wasm-forth/runtime-manifest.v2.json?v=test',
				manifestFingerprint: 'c'.repeat(64),
				workerReceipt: { bytes: 5678, sha256: 'd'.repeat(64) }
			},
			j: {
				baseUrl: '/wasm-j/',
				workerUrl: '/wasm-j/runner-worker.js?v=test',
				manifestUrl: '/wasm-j/runtime-manifest.v2.json?v=test',
				manifestFingerprint: 'e'.repeat(64),
				profileId: 'jsoftware-j-playground-test',
				sourceRevision: 'test',
				manifestReceipt: { bytes: 111, sha256: '7'.repeat(64) },
				moduleReceipt: { bytes: 222, sha256: '8'.repeat(64) },
				wasmReceipt: {
					bytes: 333,
					sha256: '9'.repeat(64),
					uncompressedBytes: 444,
					uncompressedSha256: 'a'.repeat(64)
				},
				workerReceipt: { bytes: 6789, sha256: 'f'.repeat(64) }
			},
			bqn: {
				baseUrl: '/wasm-bqn/',
				workerUrl: '/wasm-bqn/runner-worker.js?v=test',
				manifestUrl: '/wasm-bqn/runtime-manifest.v2.json?v=test',
				manifestFingerprint: '1'.repeat(64),
				profileId: 'dzaima-cbqn-test',
				sourceRevision: 'test',
				manifestReceipt: { bytes: 555, sha256: 'b'.repeat(64) },
				moduleReceipt: { bytes: 666, sha256: 'c'.repeat(64) },
				wasmReceipt: {
					bytes: 777,
					sha256: 'd'.repeat(64),
					uncompressedBytes: 888,
					uncompressedSha256: 'e'.repeat(64)
				},
				workerReceipt: { bytes: 7890, sha256: '2'.repeat(64) }
			},
			janet: {
				baseUrl: '/wasm-janet/',
				workerUrl: '/wasm-janet/runner-worker.js?v=test',
				manifestUrl: '/wasm-janet/runtime-manifest.v2.json?v=test',
				manifestFingerprint: '3'.repeat(64),
				workerReceipt: { bytes: 3456, sha256: '4'.repeat(64) }
			},
			julia: {
				baseUrl: '/wasm-julia/',
				workerUrl: '/wasm-julia/runner-worker.js?v=test',
				manifestUrl: '/wasm-julia/runtime-manifest.v2.json?v=test',
				manifestFingerprint: '5'.repeat(64),
				workerReceipt: { bytes: 4567, sha256: '6'.repeat(64) }
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
		expect(key).toContain('"forthManifestUrl":"/wasm-forth/runtime-manifest.v2.json?v=test"');
		expect(key).toContain(`"forthManifestFingerprint":"${'c'.repeat(64)}"`);
		expect(key).toContain('"forthWorkerReceipt":');
		expect(key).toContain('"jBaseUrl":"/wasm-j/"');
		expect(key).toContain('"jWorkerUrl":"/wasm-j/runner-worker.js?v=test"');
		expect(key).toContain('"jManifestUrl":"/wasm-j/runtime-manifest.v2.json?v=test"');
		expect(key).toContain(`"jManifestFingerprint":"${'e'.repeat(64)}"`);
		expect(key).toContain('"jProfileId":"jsoftware-j-playground-test"');
		expect(key).toContain('"jSourceRevision":"test"');
		expect(key).toContain('"jManifestReceipt":');
		expect(key).toContain('"jModuleReceipt":');
		expect(key).toContain('"jWasmReceipt":');
		expect(key).toContain('"jWorkerReceipt":');
		expect(key).toContain('"bqnBaseUrl":"/wasm-bqn/"');
		expect(key).toContain('"bqnWorkerUrl":"/wasm-bqn/runner-worker.js?v=test"');
		expect(key).toContain('"bqnManifestUrl":"/wasm-bqn/runtime-manifest.v2.json?v=test"');
		expect(key).toContain(`"bqnManifestFingerprint":"${'1'.repeat(64)}"`);
		expect(key).toContain('"bqnProfileId":"dzaima-cbqn-test"');
		expect(key).toContain('"bqnSourceRevision":"test"');
		expect(key).toContain('"bqnManifestReceipt":');
		expect(key).toContain('"bqnModuleReceipt":');
		expect(key).toContain('"bqnWasmReceipt":');
		expect(key).toContain('"bqnWorkerReceipt":');
		expect(key).toContain('"janetBaseUrl":"/wasm-janet/"');
		expect(key).toContain('"janetWorkerUrl":"/wasm-janet/runner-worker.js?v=test"');
		expect(key).toContain('"janetManifestUrl":"/wasm-janet/runtime-manifest.v2.json?v=test"');
		expect(key).toContain(`"janetManifestFingerprint":"${'3'.repeat(64)}"`);
		expect(key).toContain('"janetWorkerReceipt":');
		expect(key).toContain('"juliaBaseUrl":"/wasm-julia/"');
		expect(key).toContain('"juliaWorkerUrl":"/wasm-julia/runner-worker.js?v=test"');
		expect(key).toContain('"juliaManifestUrl":"/wasm-julia/runtime-manifest.v2.json?v=test"');
		expect(key).toContain(`"juliaManifestFingerprint":"${'5'.repeat(64)}"`);
		expect(key).toContain('"juliaWorkerReceipt":');
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

	it('includes Zig compiler, stdlib, and receipt identity in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			zig: {
				compilerUrl: '/wasm-zig/zig_small.wasm?v=test',
				stdlibUrl: '/wasm-zig/std.tar.gz?v=test',
				integrity: {
					'zig_small.wasm': { bytes: 4, sha256: 'a'.repeat(64) },
					'std.tar.gz': {
						bytes: 5,
						sha256: 'b'.repeat(64),
						uncompressedBytes: 10,
						uncompressedSha256: 'c'.repeat(64)
					}
				}
			}
		});

		expect(key).toContain('"zigCompilerUrl":"/wasm-zig/zig_small.wasm?v=test"');
		expect(key).toContain('"zigStdlibUrl":"/wasm-zig/std.tar.gz?v=test"');
		const parsedKey = JSON.parse(key || '{}') as { zigIntegrity?: string };
		expect(JSON.parse(parsedKey.zigIntegrity || '[]')).toContainEqual([
			'std.tar.gz',
			expect.objectContaining({
				uncompressedSha256: 'c'.repeat(64),
				uncompressedBytes: 10
			})
		]);
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
				workerUrl: '/wasm-prolog/runner-worker.js?v=test',
				manifestUrl: '/wasm-prolog/runtime-manifest.v2.json?v=test',
				manifestFingerprint: '3'.repeat(64),
				workerReceipt: { bytes: 3456, sha256: '4'.repeat(64) }
			},
			gleam: {
				baseUrl: '/wasm-gleam/',
				workerUrl: '/wasm-gleam/runner-worker.js?v=test',
				manifestUrl: '/wasm-gleam/source-manifest.v2.json?v=test',
				manifestFingerprint: 'a'.repeat(64),
				workerReceipt: { bytes: 1234, sha256: 'b'.repeat(64) }
			},
			perl: {
				baseUrl: '/wasm-perl/',
				workerUrl: '/wasm-perl/runner-worker.js?v=test',
				manifestUrl: '/wasm-perl/runtime-manifest.v2.json?v=test',
				manifestFingerprint: '7'.repeat(64),
				workerReceipt: { bytes: 5678, sha256: '8'.repeat(64) }
			},
			tcl: {
				baseUrl: '/wasm-tcl/',
				workerUrl: '/wasm-tcl/runner-worker.js?v=test',
				manifestUrl: '/wasm-tcl/runtime-manifest.v2.json?v=test',
				manifestFingerprint: '5'.repeat(64),
				workerReceipt: { bytes: 4567, sha256: '6'.repeat(64) }
			},
			awk: {
				baseUrl: '/wasm-awk/',
				workerUrl: '/wasm-awk/runner-worker.js?v=test'
			}
		});

		expect(key).toContain('"prologBaseUrl":"/wasm-prolog/"');
		expect(key).toContain('"prologWorkerUrl":"/wasm-prolog/runner-worker.js?v=test"');
		expect(key).toContain('"prologManifestUrl":"/wasm-prolog/runtime-manifest.v2.json?v=test"');
		expect(key).toContain(`"prologManifestFingerprint":"${'3'.repeat(64)}"`);
		expect(key).toContain(`"prologWorkerReceipt":"[[\\"worker\\",`);
		expect(key).toContain('"gleamBaseUrl":"/wasm-gleam/"');
		expect(key).toContain('"gleamWorkerUrl":"/wasm-gleam/runner-worker.js?v=test"');
		expect(key).toContain('"gleamManifestUrl":"/wasm-gleam/source-manifest.v2.json?v=test"');
		expect(key).toContain(`"gleamManifestFingerprint":"${'a'.repeat(64)}"`);
		expect(key).toContain(`"gleamWorkerReceipt":"[[\\"worker\\",`);
		expect(key).toContain('"perlBaseUrl":"/wasm-perl/"');
		expect(key).toContain('"perlWorkerUrl":"/wasm-perl/runner-worker.js?v=test"');
		expect(key).toContain('"perlManifestUrl":"/wasm-perl/runtime-manifest.v2.json?v=test"');
		expect(key).toContain(`"perlManifestFingerprint":"${'7'.repeat(64)}"`);
		expect(key).toContain(`"perlWorkerReceipt":"[[\\"worker\\",`);
		expect(key).toContain('"tclBaseUrl":"/wasm-tcl/"');
		expect(key).toContain('"tclWorkerUrl":"/wasm-tcl/runner-worker.js?v=test"');
		expect(key).toContain('"tclManifestUrl":"/wasm-tcl/runtime-manifest.v2.json?v=test"');
		expect(key).toContain(`"tclManifestFingerprint":"${'5'.repeat(64)}"`);
		expect(key).toContain(`"tclWorkerReceipt":"[[\\"worker\\",`);
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
				moduleUrl: '/wasm-lisp/index.js?v=test',
				manifestUrl: '/wasm-lisp/runtime-manifest.v2.json?v=test',
				manifestFingerprint: 'a'.repeat(64)
			}
		});

		expect(key).toContain('"lispModuleUrl":"/wasm-lisp/index.js?v=test"');
		expect(key).toContain('"lispManifestUrl":"/wasm-lisp/runtime-manifest.v2.json?v=test"');
		expect(key).toContain(`"lispManifestFingerprint":"${'a'.repeat(64)}"`);
	});

	it('includes the complete Ruby preflight identity and receipts in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			ruby: {
				baseUrl: '/wasm-ruby/',
				manifestUrl: '/wasm-ruby/runtime-manifest.v2.json?v=test',
				moduleUrl: '/wasm-ruby/runtime.mjs.bin?v=test',
				wasmUrl: '/wasm-ruby/assets/ruby_stdlib-C40Yu-vu.wasm.gz.bin?v=test',
				...RUBY_RUNTIME_PROFILE
			}
		});

		const serialized = JSON.parse(key || '{}') as Record<string, string>;
		expect(serialized).toMatchObject({
			rubyBaseUrl: '/wasm-ruby/',
			rubyManifestUrl: '/wasm-ruby/runtime-manifest.v2.json?v=test',
			rubyModuleUrl: '/wasm-ruby/runtime.mjs.bin?v=test',
			rubyWasmUrl: '/wasm-ruby/assets/ruby_stdlib-C40Yu-vu.wasm.gz.bin?v=test',
			rubyProfileId: RUBY_RUNTIME_PROFILE.profileId,
			rubyArtifactRevision: RUBY_RUNTIME_PROFILE.artifactRevision,
			rubyVersion: RUBY_RUNTIME_PROFILE.rubyVersion,
			rubyRevision: RUBY_RUNTIME_PROFILE.rubyRevision,
			rubyWasmVersion: RUBY_RUNTIME_PROFILE.rubyWasmVersion,
			rubyWasmRevision: RUBY_RUNTIME_PROFILE.rubyWasmRevision,
			rubyWasiSdkVersion: RUBY_RUNTIME_PROFILE.wasiSdkVersion,
			rubyManifestFingerprint: RUBY_RUNTIME_PROFILE.manifestFingerprint
		});
		expect(serialized.rubyManifestReceipt).toContain(
			RUBY_RUNTIME_PROFILE.manifestReceipt.sha256
		);
		expect(serialized.rubyModuleJavaScriptReceipt).toContain(
			RUBY_RUNTIME_PROFILE.moduleJavaScriptReceipt.sha256
		);
		expect(serialized.rubyWasmReceipt).toContain(RUBY_RUNTIME_PROFILE.wasmReceipt.sha256);
		expect(serialized.rubyWasmReceipt).toContain(
			RUBY_RUNTIME_PROFILE.wasmReceipt.uncompressedSha256 || ''
		);
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
