import type { PlaygroundRuntimeAssets } from './assets';
import { STATIC_RUNTIME_MODULE_VERSION } from './staticRuntimeModuleVersion';
import { WASM_AWK_ASSET_VERSION } from './wasmAwkVersion';
import { WASM_BASH_ASSET_VERSION, WASM_BASH_WEBC_RECEIPT } from './wasmBashVersion';
import { WASM_BQN_ASSET_VERSION, WASM_BQN_RUNNER_RECEIPT } from './wasmBqnVersion';
import {
	WASM_CLOJURESCRIPT_ASSET_VERSION,
	WASM_CLOJURESCRIPT_RUNNER_RECEIPT
} from './wasmClojureScriptVersion';
import { WASM_D_INTEGRITY_VERSION, WASM_D_OUTER_ASSET_RECEIPTS } from './wasmDIntegrity';
import { WASM_DOTNET_ASSET_VERSION } from './wasmDotnetVersion';
import { WASM_ELIXIR_ASSET_RECEIPTS, WASM_ELIXIR_ASSET_VERSION } from './wasmElixirVersion';
import { WASM_FORTH_ASSET_VERSION, WASM_FORTH_RUNNER_RECEIPT } from './wasmForthVersion';
import {
	WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS,
	WASM_FORTRAN_EXECUTION_ASSET_VERSION
} from './wasmFortranExecutionAssets';
import { WASM_FORTRAN_ASSET_VERSION } from './wasmFortranVersion';
import { WASM_GLEAM_ASSET_VERSION, WASM_GLEAM_RUNNER_RECEIPT } from './wasmGleamVersion';
import { WASM_GO_ASSET_VERSION } from './wasmGoVersion';
import { WASM_HASKELL_ASSET_VERSION } from './wasmHaskellVersion';
import { WASM_J_ASSET_VERSION, WASM_J_RUNNER_RECEIPT } from './wasmJVersion';
import { WASM_JANET_ASSET_VERSION } from './wasmJanetVersion';
import { WASM_JULIA_ASSET_VERSION } from './wasmJuliaVersion';
import { WASM_LISP_ASSET_VERSION } from './wasmLispVersion';
import { WASM_LUA_ASSET_VERSION } from './wasmLuaVersion';
import { WASM_NIM_ASSET_VERSION } from './wasmNimVersion';
import {
	WASM_OBJECTIVEC_ASSET_RECEIPTS,
	WASM_OBJECTIVEC_ASSET_VERSION
} from './wasmObjectiveCVersion';
import { WASM_OCAML_ASSET_VERSION } from './wasmOcamlVersion';
import { WASM_OCTAVE_ASSET_VERSION } from './wasmOctaveVersion';
import { WASM_PASCAL_ASSET_VERSION } from './wasmPascalVersion';
import { WASM_PERL_ASSET_VERSION } from './wasmPerlVersion';
import { WASM_PROLOG_ASSET_VERSION, WASM_PROLOG_RUNNER_RECEIPT } from './wasmPrologVersion';
import { WASM_R_ASSET_VERSION } from './wasmRVersion';
import {
	RUBY_RUNTIME_ASSET_PATH,
	RUBY_RUNTIME_ASSET_RECEIPTS,
	RUBY_RUNTIME_ASSET_VERSION
} from '@wasm-idle/core';
import { WASM_RUST_ASSET_VERSION } from './wasmRustVersion';
import { WASM_SWIFT_ASSET_VERSION } from './wasmSwiftVersion';
import { WASM_TCL_ASSET_VERSION } from './wasmTclVersion';
import { WASM_TINYGO_ASSET_VERSION } from './wasmTinyGoVersion';
import { WASM_TYPESCRIPT_ASSET_VERSION } from './wasmTypeScriptVersion';
import { WASM_WAT_ASSET_VERSION } from './wasmWatVersion';
import { WASM_ZIG_ASSET_RECEIPTS, WASM_ZIG_ASSET_VERSION } from './wasmZigVersion';

export function normalizeApplicationAssetRootUrl(rootUrl: string): string {
	const normalized = rootUrl.trim();
	if (!normalized || normalized === '/') return '';
	return normalized.replace(/\/+$/u, '');
}

export function createApplicationAssetResolver(
	rootUrl: string
): (assetPath: string, version?: string) => string {
	const normalizedRootUrl = normalizeApplicationAssetRootUrl(rootUrl);
	return (assetPath, version) => {
		const normalizedAssetPath = assetPath.replace(/^\/+/u, '');
		if (!normalizedAssetPath) {
			throw new TypeError('Application asset path must not be empty');
		}
		const url = `${normalizedRootUrl}/${normalizedAssetPath}`;
		return version === undefined ? url : `${url}?v=${encodeURIComponent(version)}`;
	};
}

export function createApplicationRuntimeAssets(rootUrl: string): PlaygroundRuntimeAssets {
	const normalizedRootUrl = normalizeApplicationAssetRootUrl(rootUrl);
	const asset = createApplicationAssetResolver(normalizedRootUrl);
	return {
		rootUrl: normalizedRootUrl,
		assemblyscript: {
			moduleUrl: asset('wasm-assemblyscript/runtime.mjs', STATIC_RUNTIME_MODULE_VERSION)
		},
		duckdb: {
			moduleUrl: asset('wasm-duckdb/runtime.mjs', STATIC_RUNTIME_MODULE_VERSION)
		},
		php: {
			moduleUrl: asset('wasm-php/runtime.mjs', STATIC_RUNTIME_MODULE_VERSION)
		},
		rust: {
			compilerUrl: asset('wasm-rust/index.js', WASM_RUST_ASSET_VERSION),
			manifestUrl: asset(
				'wasm-rust/runtime/runtime-manifest.v3.json',
				WASM_RUST_ASSET_VERSION
			)
		},
		go: {
			compilerUrl: asset('wasm-go/index.js', WASM_GO_ASSET_VERSION),
			manifestUrl: asset('wasm-go/runtime/runtime-manifest.v1.json', WASM_GO_ASSET_VERSION)
		},
		d: {
			moduleUrl: asset('wasm-d/index.js', WASM_D_INTEGRITY_VERSION),
			manifestUrl: asset('wasm-d/runtime/runtime-manifest.v1.json', WASM_D_INTEGRITY_VERSION),
			integrity: WASM_D_OUTER_ASSET_RECEIPTS
		},
		dotnet: {
			moduleUrl: asset('wasm-dotnet/index.js', WASM_DOTNET_ASSET_VERSION)
		},
		elixir: {
			bundleUrl: asset('wasm-elixir/bundle.avm', WASM_ELIXIR_ASSET_VERSION),
			integrity: WASM_ELIXIR_ASSET_RECEIPTS
		},
		erlang: {
			bundleUrl: asset('wasm-elixir/bundle.avm', WASM_ELIXIR_ASSET_VERSION),
			integrity: WASM_ELIXIR_ASSET_RECEIPTS
		},
		prolog: {
			baseUrl: asset('wasm-prolog/'),
			workerUrl: asset('wasm-prolog/runner-worker.js', WASM_PROLOG_RUNNER_RECEIPT.sha256),
			manifestUrl: asset('wasm-prolog/runtime-manifest.v2.json', WASM_PROLOG_ASSET_VERSION),
			manifestFingerprint: WASM_PROLOG_ASSET_VERSION,
			workerReceipt: WASM_PROLOG_RUNNER_RECEIPT
		},
		gleam: {
			baseUrl: asset('wasm-gleam/'),
			workerUrl: asset('wasm-gleam/runner-worker.js', WASM_GLEAM_RUNNER_RECEIPT.sha256),
			manifestUrl: asset('wasm-gleam/source-manifest.v2.json', WASM_GLEAM_ASSET_VERSION),
			manifestFingerprint: WASM_GLEAM_ASSET_VERSION,
			workerReceipt: WASM_GLEAM_RUNNER_RECEIPT
		},
		perl: {
			baseUrl: asset('wasm-perl/'),
			workerUrl: asset('wasm-perl/runner-worker.js', WASM_PERL_ASSET_VERSION)
		},
		tcl: {
			baseUrl: asset('wasm-tcl/'),
			workerUrl: asset('wasm-tcl/runner-worker.js', WASM_TCL_ASSET_VERSION)
		},
		awk: {
			baseUrl: asset('wasm-awk/'),
			workerUrl: asset('wasm-awk/runner-worker.js', WASM_AWK_ASSET_VERSION)
		},
		pascal: {
			baseUrl: asset('wasm-pascal/'),
			workerUrl: asset('wasm-pascal/runner-worker.js', WASM_PASCAL_ASSET_VERSION)
		},
		forth: {
			baseUrl: asset('wasm-forth/'),
			workerUrl: asset('wasm-forth/runner-worker.js', WASM_FORTH_RUNNER_RECEIPT.sha256),
			manifestUrl: asset('wasm-forth/runtime-manifest.v2.json', WASM_FORTH_ASSET_VERSION),
			manifestFingerprint: WASM_FORTH_ASSET_VERSION,
			workerReceipt: WASM_FORTH_RUNNER_RECEIPT
		},
		j: {
			baseUrl: asset('wasm-j/'),
			workerUrl: asset('wasm-j/runner-worker.js', WASM_J_RUNNER_RECEIPT.sha256),
			manifestUrl: asset('wasm-j/runtime-manifest.v2.json', WASM_J_ASSET_VERSION),
			manifestFingerprint: WASM_J_ASSET_VERSION,
			workerReceipt: WASM_J_RUNNER_RECEIPT
		},
		bqn: {
			baseUrl: asset('wasm-bqn/'),
			workerUrl: asset('wasm-bqn/runner-worker.js', WASM_BQN_RUNNER_RECEIPT.sha256),
			manifestUrl: asset('wasm-bqn/runtime-manifest.v2.json', WASM_BQN_ASSET_VERSION),
			manifestFingerprint: WASM_BQN_ASSET_VERSION,
			workerReceipt: WASM_BQN_RUNNER_RECEIPT
		},
		janet: {
			baseUrl: asset('wasm-janet/'),
			workerUrl: asset('wasm-janet/runner-worker.js', WASM_JANET_ASSET_VERSION)
		},
		julia: {
			baseUrl: asset('wasm-julia/'),
			workerUrl: asset('wasm-julia/runner-worker.js', WASM_JULIA_ASSET_VERSION)
		},
		nim: {
			baseUrl: asset('wasm-nim/'),
			workerUrl: asset('wasm-nim/runner-worker.js', WASM_NIM_ASSET_VERSION)
		},
		bash: {
			moduleUrl: asset('wasm-bash/sdk/index.mjs', STATIC_RUNTIME_MODULE_VERSION),
			webcUrl: asset('wasm-bash/bash.webc', WASM_BASH_ASSET_VERSION),
			workerUrl: asset('wasm-bash/sdk/worker.mjs', STATIC_RUNTIME_MODULE_VERSION),
			webcReceipt: WASM_BASH_WEBC_RECEIPT
		},
		clojurescript: {
			baseUrl: asset('wasm-clojurescript/'),
			workerUrl: asset(
				'wasm-clojurescript/runner-worker.js',
				WASM_CLOJURESCRIPT_RUNNER_RECEIPT.sha256
			),
			manifestUrl: asset(
				'wasm-clojurescript/runtime-manifest.v2.json',
				WASM_CLOJURESCRIPT_ASSET_VERSION
			),
			manifestFingerprint: WASM_CLOJURESCRIPT_ASSET_VERSION,
			workerReceipt: WASM_CLOJURESCRIPT_RUNNER_RECEIPT
		},
		swift: {
			baseUrl: asset('wasm-swift/'),
			workerUrl: asset('wasm-swift/runner-worker.js', WASM_SWIFT_ASSET_VERSION),
			manifestUrl: asset('wasm-swift/runtime-manifest.v1.json', WASM_SWIFT_ASSET_VERSION)
		},
		ocaml: {
			moduleUrl: asset(
				'wasm-of-js-of-ocaml/browser-native/src/index.js',
				WASM_OCAML_ASSET_VERSION
			),
			manifestUrl: asset(
				'wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json',
				WASM_OCAML_ASSET_VERSION
			)
		},
		tinygo: {
			moduleUrl: asset('wasm-tinygo/runtime.js', WASM_TINYGO_ASSET_VERSION)
		},
		typescript: {
			moduleUrl: asset('wasm-typescript/index.js', WASM_TYPESCRIPT_ASSET_VERSION),
			libUrl: asset('lsp/typescript-libs.json.gz', WASM_TYPESCRIPT_ASSET_VERSION)
		},
		wat: {
			moduleUrl: asset('wasm-wat/index.js', WASM_WAT_ASSET_VERSION)
		},
		lua: {
			moduleUrl: asset('wasm-lua/index.js', WASM_LUA_ASSET_VERSION)
		},
		zig: {
			compilerUrl: asset('wasm-zig/zig_small.wasm', WASM_ZIG_ASSET_VERSION),
			stdlibUrl: asset('wasm-zig/std.tar.gz', WASM_ZIG_ASSET_VERSION),
			integrity: WASM_ZIG_ASSET_RECEIPTS
		},
		lisp: {
			moduleUrl: asset('wasm-lisp/index.js', WASM_LISP_ASSET_VERSION)
		},
		ruby: {
			moduleUrl: asset('wasm-ruby/runtime.mjs', RUBY_RUNTIME_ASSET_VERSION),
			wasmUrl: asset(`wasm-ruby/${RUBY_RUNTIME_ASSET_PATH}`, RUBY_RUNTIME_ASSET_VERSION),
			integrity: RUBY_RUNTIME_ASSET_RECEIPTS
		},
		haskell: {
			moduleUrl: asset('wasm-haskell/dyld.mjs', WASM_HASKELL_ASSET_VERSION),
			rootfsUrl: asset('wasm-haskell/rootfs.tar.zst', WASM_HASKELL_ASSET_VERSION),
			bsdtarUrl: asset('wasm-haskell/bsdtar.wasm', WASM_HASKELL_ASSET_VERSION)
		},
		fortran: {
			baseUrl: asset('wasm-fortran/'),
			f2cWasmUrl: asset('wasm-fortran/f2c.wasm', WASM_FORTRAN_EXECUTION_ASSET_VERSION),
			libf2cUrl: asset('wasm-fortran/libf2c.a', WASM_FORTRAN_EXECUTION_ASSET_VERSION),
			f2cHeaderUrl: asset('wasm-fortran/f2c.h', WASM_FORTRAN_EXECUTION_ASSET_VERSION),
			analyzerUrl: asset('wasm-fortran/analyzer.js', WASM_FORTRAN_ASSET_VERSION),
			integrity: WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS
		},
		cobol: {
			baseUrl: asset('wasm-cobol/')
		},
		objectivec: {
			baseUrl: asset('wasm-objectivec/'),
			libobjcUrl: asset('wasm-objectivec/libobjc.a', WASM_OBJECTIVEC_ASSET_VERSION),
			headersUrl: asset('wasm-objectivec/headers.json', WASM_OBJECTIVEC_ASSET_VERSION),
			libgnustepBaseUrl: asset(
				'wasm-objectivec/libgnustep-base.a',
				WASM_OBJECTIVEC_ASSET_VERSION
			),
			libgnustepBaseObjectUrl: asset(
				'wasm-objectivec/libgnustep-base.o',
				WASM_OBJECTIVEC_ASSET_VERSION
			),
			foundationHeadersUrl: asset(
				'wasm-objectivec/foundation-headers.json',
				WASM_OBJECTIVEC_ASSET_VERSION
			),
			libffiUrl: asset('wasm-objectivec/libffi.a', WASM_OBJECTIVEC_ASSET_VERSION),
			integrity: WASM_OBJECTIVEC_ASSET_RECEIPTS
		},
		r: {
			baseUrl: asset(`webr/${WASM_R_ASSET_VERSION}/`)
		},
		octave: {
			baseUrl: asset('wasm-octave/runtime/'),
			workerUrl: asset('wasm-octave/runner-worker.js', WASM_OCTAVE_ASSET_VERSION),
			manifestUrl: asset(
				'wasm-octave/runtime/runtime-manifest.v1.json',
				WASM_OCTAVE_ASSET_VERSION
			)
		},
		sqlite: {
			moduleUrl: asset('wasm-sqlite/runtime.mjs', STATIC_RUNTIME_MODULE_VERSION)
		}
	};
}
