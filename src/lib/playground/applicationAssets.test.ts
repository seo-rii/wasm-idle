import {
	HASKELL_RUNTIME_ASSET_RECEIPTS,
	RUBY_RUNTIME_BUNDLE,
	RUBY_RUNTIME_MANIFEST_PATH,
	RUBY_RUNTIME_MODULE_STORAGE_PATH,
	RUBY_RUNTIME_WASM_STORAGE_PATH,
	createRuntimeAssetsKey
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';
import {
	createApplicationAssetResolver,
	createApplicationRuntimeAssets,
	normalizeApplicationAssetRootUrl
} from './applicationAssets';
import { STATIC_RUNTIME_MODULE_VERSION } from './staticRuntimeModuleVersion';
import { WASM_BASH_RUNTIME_PROFILE } from './wasmBashVersion';
import { WASM_BQN_ASSET_VERSION, WASM_BQN_RUNNER_RECEIPT } from './wasmBqnVersion';
import {
	WASM_CLOJURESCRIPT_ASSET_VERSION,
	WASM_CLOJURESCRIPT_RUNNER_RECEIPT
} from './wasmClojureScriptVersion';
import { WASM_D_INTEGRITY_VERSION, WASM_D_OUTER_ASSET_RECEIPTS } from './wasmDIntegrity';
import { WASM_ELIXIR_ASSET_RECEIPTS, WASM_ELIXIR_ASSET_VERSION } from './wasmElixirVersion';
import {
	WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS,
	WASM_FORTRAN_EXECUTION_ASSET_VERSION
} from './wasmFortranExecutionAssets';
import { WASM_FORTRAN_ASSET_VERSION } from './wasmFortranVersion';
import { WASM_FORTH_ASSET_VERSION, WASM_FORTH_RUNNER_RECEIPT } from './wasmForthVersion';
import { WASM_GO_ASSET_VERSION } from './wasmGoVersion';
import { WASM_GLEAM_ASSET_VERSION, WASM_GLEAM_RUNNER_RECEIPT } from './wasmGleamVersion';
import { WASM_HASKELL_ASSET_VERSION } from './wasmHaskellVersion';
import { WASM_J_ASSET_VERSION, WASM_J_RUNNER_RECEIPT } from './wasmJVersion';
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
import { WASM_LISP_ASSET_VERSION } from './wasmLispVersion';
import {
	WASM_NIM_ASSET_VERSION,
	WASM_NIM_RUNNER_RECEIPT,
	WASM_NIM_RUNTIME_PROFILE
} from './wasmNimVersion';
import { WASM_OBJECTIVEC_ASSET_RECEIPTS } from './wasmObjectiveCVersion';
import {
	WASM_PASCAL_ASSET_VERSION,
	WASM_PASCAL_RUNNER_RECEIPT,
	WASM_PASCAL_RUNTIME_PROFILE
} from './wasmPascalVersion';
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
import { WASM_R_ASSET_VERSION } from './wasmRVersion';
import { WASM_RUST_ASSET_VERSION } from './wasmRustVersion';
import {
	WASM_TCL_ASSET_VERSION,
	WASM_TCL_RUNNER_RECEIPT,
	WASM_TCL_RUNTIME_PROFILE
} from './wasmTclVersion';
import { WASM_TINYGO_ASSET_VERSION, WASM_TINYGO_RUNTIME_PROFILE } from './wasmTinyGoVersion';
import { WASM_ZIG_ASSET_RECEIPTS, WASM_ZIG_ASSET_VERSION } from './wasmZigVersion';

describe('application runtime asset root', () => {
	it.each([
		['', 'wasm-rust/index.js', '/wasm-rust/index.js'],
		['/', '/wasm-rust/index.js', '/wasm-rust/index.js'],
		['/wasm-idle/', 'wasm-rust/index.js', '/wasm-idle/wasm-rust/index.js'],
		['/foo/bar', '/wasm-rust/index.js', '/foo/bar/wasm-rust/index.js'],
		[
			'https://assets.example.com/foo/',
			'wasm-rust/index.js',
			'https://assets.example.com/foo/wasm-rust/index.js'
		]
	])('resolves %s under one explicit application root', (rootUrl, assetPath, expected) => {
		expect(createApplicationAssetResolver(rootUrl)(assetPath)).toBe(expected);
	});

	it('normalizes root suffixes and versions asset requests', () => {
		expect(normalizeApplicationAssetRootUrl(' /foo/bar/// ')).toBe('/foo/bar');
		expect(createApplicationAssetResolver('/foo/bar')('runtime.js', 'build 1')).toBe(
			'/foo/bar/runtime.js?v=build%201'
		);
		expect(() => createApplicationAssetResolver('/foo/bar')('/')).toThrow(
			'Application asset path must not be empty'
		);
	});

	it.each([
		['/', ''],
		['/wasm-idle/', '/wasm-idle'],
		['/foo/bar/', '/foo/bar']
	])('confines every runtime asset under the %s deployment base', (rootUrl, expectedRoot) => {
		const assets = createApplicationRuntimeAssets(rootUrl);

		expect(assets.rootUrl).toBe(expectedRoot);
		for (const [runtime, config] of Object.entries(assets)) {
			if (runtime === 'rootUrl' || typeof config !== 'object' || !config) continue;
			for (const [assetKey, value] of Object.entries(config)) {
				if (typeof value !== 'string' || !assetKey.endsWith('Url')) continue;
				expect(
					value.startsWith(`${expectedRoot}/`),
					`${runtime}.${assetKey} escaped ${rootUrl}: ${value}`
				).toBe(true);
			}
		}
	});

	it('projects every non-debug page runtime from the shared root', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar/');

		expect(Object.keys(assets).sort()).toEqual([
			'assemblyscript',
			'awk',
			'bash',
			'bqn',
			'clojurescript',
			'cobol',
			'd',
			'dotnet',
			'duckdb',
			'elixir',
			'erlang',
			'forth',
			'fortran',
			'gleam',
			'go',
			'haskell',
			'j',
			'janet',
			'julia',
			'lisp',
			'lua',
			'nim',
			'objectivec',
			'ocaml',
			'octave',
			'pascal',
			'perl',
			'php',
			'prolog',
			'r',
			'rootUrl',
			'ruby',
			'rust',
			'sqlite',
			'swift',
			'tcl',
			'tinygo',
			'typescript',
			'wat',
			'zig'
		]);
		expect(assets.rootUrl).toBe('/foo/bar');
		expect(assets.debug).toBeUndefined();
		expect(assets.rust).toEqual({
			compilerUrl: `/foo/bar/wasm-rust/index.js?v=${WASM_RUST_ASSET_VERSION}`,
			manifestUrl: `/foo/bar/wasm-rust/runtime/runtime-manifest.v3.json?v=${WASM_RUST_ASSET_VERSION}`
		});
		expect(assets.go).toEqual({
			compilerUrl: `/foo/bar/wasm-go/index.js?v=${WASM_GO_ASSET_VERSION}`,
			manifestUrl: `/foo/bar/wasm-go/runtime/runtime-manifest.v1.json?v=${WASM_GO_ASSET_VERSION}`
		});
		expect(assets.pascal).toEqual({
			baseUrl: '/foo/bar/wasm-pascal/',
			workerUrl: `/foo/bar/wasm-pascal/runner-worker.js?v=${WASM_PASCAL_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-pascal/runtime-manifest.v2.json?v=${WASM_PASCAL_ASSET_VERSION}`,
			compilerJavaScriptUrl: `/foo/bar/wasm-pascal/compiler.js.gz.bin?v=${WASM_PASCAL_RUNTIME_PROFILE.compilerJavaScriptReceipt.sha256}`,
			rtlJavaScriptUrl: `/foo/bar/wasm-pascal/rtl.js.bin?v=${WASM_PASCAL_RUNTIME_PROFILE.rtlJavaScriptReceipt.sha256}`,
			systemPascalUrl: `/foo/bar/wasm-pascal/system.pas.bin?v=${WASM_PASCAL_RUNTIME_PROFILE.systemPascalReceipt.sha256}`,
			...WASM_PASCAL_RUNTIME_PROFILE,
			workerReceipt: WASM_PASCAL_RUNNER_RECEIPT
		});
		expect(assets.lisp).toEqual({
			moduleUrl: `/foo/bar/wasm-lisp/index.js?v=${WASM_LISP_ASSET_VERSION}`,
			manifestUrl: `/foo/bar/wasm-lisp/runtime-manifest.v2.json?v=${WASM_LISP_ASSET_VERSION}`,
			manifestFingerprint: WASM_LISP_ASSET_VERSION
		});
		expect(assets.prolog).toEqual({
			baseUrl: '/foo/bar/wasm-prolog/',
			workerUrl: `/foo/bar/wasm-prolog/runner-worker.js?v=${WASM_PROLOG_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-prolog/runtime-manifest.v2.json?v=${WASM_PROLOG_ASSET_VERSION}`,
			...WASM_PROLOG_RUNTIME_PROFILE,
			workerReceipt: WASM_PROLOG_RUNNER_RECEIPT
		});
		expect(assets.perl).toEqual({
			baseUrl: '/foo/bar/wasm-perl/',
			workerUrl: `/foo/bar/wasm-perl/runner-worker.js?v=${WASM_PERL_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-perl/runtime-manifest.v2.json?v=${WASM_PERL_ASSET_VERSION}`,
			...WASM_PERL_RUNTIME_PROFILE,
			workerReceipt: WASM_PERL_RUNNER_RECEIPT
		});
		expect(assets.tcl).toEqual({
			baseUrl: '/foo/bar/wasm-tcl/',
			workerUrl: `/foo/bar/wasm-tcl/runner-worker.js?v=${WASM_TCL_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-tcl/runtime-manifest.v2.json?v=${WASM_TCL_ASSET_VERSION}`,
			...WASM_TCL_RUNTIME_PROFILE,
			workerReceipt: WASM_TCL_RUNNER_RECEIPT
		});
		expect(assets.gleam).toEqual({
			baseUrl: '/foo/bar/wasm-gleam/',
			workerUrl: `/foo/bar/wasm-gleam/runner-worker.js?v=${WASM_GLEAM_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-gleam/source-manifest.v2.json?v=${WASM_GLEAM_ASSET_VERSION}`,
			manifestFingerprint: WASM_GLEAM_ASSET_VERSION,
			workerReceipt: WASM_GLEAM_RUNNER_RECEIPT
		});
		expect(assets.forth).toEqual({
			baseUrl: '/foo/bar/wasm-forth/',
			workerUrl: `/foo/bar/wasm-forth/runner-worker.js?v=${WASM_FORTH_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-forth/runtime-manifest.v2.json?v=${WASM_FORTH_ASSET_VERSION}`,
			manifestFingerprint: WASM_FORTH_ASSET_VERSION,
			workerReceipt: WASM_FORTH_RUNNER_RECEIPT
		});
		expect(assets.j).toEqual({
			baseUrl: '/foo/bar/wasm-j/',
			workerUrl: `/foo/bar/wasm-j/runner-worker.js?v=${WASM_J_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-j/runtime-manifest.v2.json?v=${WASM_J_ASSET_VERSION}`,
			manifestFingerprint: WASM_J_ASSET_VERSION,
			workerReceipt: WASM_J_RUNNER_RECEIPT
		});
		expect(assets.bqn).toEqual({
			baseUrl: '/foo/bar/wasm-bqn/',
			workerUrl: `/foo/bar/wasm-bqn/runner-worker.js?v=${WASM_BQN_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-bqn/runtime-manifest.v2.json?v=${WASM_BQN_ASSET_VERSION}`,
			manifestFingerprint: WASM_BQN_ASSET_VERSION,
			workerReceipt: WASM_BQN_RUNNER_RECEIPT
		});
		expect(assets.janet).toEqual({
			baseUrl: '/foo/bar/wasm-janet/',
			workerUrl: `/foo/bar/wasm-janet/runner-worker.js?v=${WASM_JANET_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-janet/runtime-manifest.v2.json?v=${WASM_JANET_ASSET_VERSION}`,
			...WASM_JANET_RUNTIME_PROFILE,
			workerReceipt: WASM_JANET_RUNNER_RECEIPT
		});
		expect(assets.julia).toEqual({
			baseUrl: '/foo/bar/wasm-julia/',
			workerUrl: `/foo/bar/wasm-julia/runner-worker.js?v=${WASM_JULIA_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-julia/runtime-manifest.v2.json?v=${WASM_JULIA_ASSET_VERSION}`,
			...WASM_JULIA_RUNTIME_PROFILE,
			workerReceipt: WASM_JULIA_RUNNER_RECEIPT
		});
		expect(assets.nim).toEqual({
			baseUrl: '/foo/bar/wasm-nim/',
			workerUrl: `/foo/bar/wasm-nim/runner-worker.js?v=${WASM_NIM_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-nim/runtime-manifest.v2.json?v=${WASM_NIM_ASSET_VERSION}`,
			...WASM_NIM_RUNTIME_PROFILE,
			workerReceipt: WASM_NIM_RUNNER_RECEIPT
		});
		expect(assets.clojurescript).toEqual({
			baseUrl: '/foo/bar/wasm-clojurescript/',
			workerUrl: `/foo/bar/wasm-clojurescript/runner-worker.js?v=${WASM_CLOJURESCRIPT_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-clojurescript/runtime-manifest.v2.json?v=${WASM_CLOJURESCRIPT_ASSET_VERSION}`,
			manifestFingerprint: WASM_CLOJURESCRIPT_ASSET_VERSION,
			workerReceipt: WASM_CLOJURESCRIPT_RUNNER_RECEIPT
		});
		expect(assets.bash).toEqual({
			baseUrl: '/foo/bar/wasm-bash/',
			manifestUrl: `/foo/bar/wasm-bash/runtime-manifest.v2.json?v=${WASM_BASH_RUNTIME_PROFILE.manifestFingerprint}`,
			moduleUrl: `/foo/bar/wasm-bash/sdk/index.mjs.bin?v=${WASM_BASH_RUNTIME_PROFILE.sdkJavaScriptReceipt.sha256}`,
			wasmerWasmUrl: `/foo/bar/wasm-bash/sdk/wasmer_js_bg.wasm.gz.bin?v=${WASM_BASH_RUNTIME_PROFILE.wasmerWasmReceipt.sha256}`,
			webcUrl: `/foo/bar/wasm-bash/bash.webc.gz.bin?v=${WASM_BASH_RUNTIME_PROFILE.webcReceipt.sha256}`,
			...WASM_BASH_RUNTIME_PROFILE
		});
		expect(assets.elixir).toEqual({
			bundleUrl: `/foo/bar/wasm-elixir/bundle.avm?v=${WASM_ELIXIR_ASSET_VERSION}`,
			integrity: WASM_ELIXIR_ASSET_RECEIPTS
		});
		expect(assets.erlang).toEqual(assets.elixir);
		expect(assets.fortran).toEqual({
			baseUrl: '/foo/bar/wasm-fortran/',
			f2cWasmUrl: `/foo/bar/wasm-fortran/f2c.wasm?v=${WASM_FORTRAN_EXECUTION_ASSET_VERSION}`,
			libf2cUrl: `/foo/bar/wasm-fortran/libf2c.a?v=${WASM_FORTRAN_EXECUTION_ASSET_VERSION}`,
			f2cHeaderUrl: `/foo/bar/wasm-fortran/f2c.h?v=${WASM_FORTRAN_EXECUTION_ASSET_VERSION}`,
			analyzerUrl: `/foo/bar/wasm-fortran/analyzer.js?v=${WASM_FORTRAN_ASSET_VERSION}`,
			integrity: WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS
		});
		expect(assets.zig).toEqual({
			compilerUrl: `/foo/bar/wasm-zig/zig_small.wasm?v=${WASM_ZIG_ASSET_VERSION}`,
			stdlibUrl: `/foo/bar/wasm-zig/std.tar.gz?v=${WASM_ZIG_ASSET_VERSION}`,
			integrity: WASM_ZIG_ASSET_RECEIPTS
		});
		expect(assets.typescript?.libUrl).toMatch(
			/^\/foo\/bar\/lsp\/typescript-libs\.json\.gz\?v=/u
		);
		expect(assets.objectivec?.foundationHeadersUrl).toMatch(
			/^\/foo\/bar\/wasm-objectivec\/foundation-headers\.json\?v=/u
		);
		expect(assets.objectivec?.integrity).toBe(WASM_OBJECTIVEC_ASSET_RECEIPTS);
		expect(assets.r?.baseUrl).toBe(`/foo/bar/webr/${WASM_R_ASSET_VERSION}/`);
		expect(assets.sqlite?.moduleUrl).toBe(
			`/foo/bar/wasm-sqlite/runtime.mjs?v=${STATIC_RUNTIME_MODULE_VERSION}`
		);
		expect(assets.ruby).toEqual({
			baseUrl: '/foo/bar/wasm-ruby/',
			manifestUrl: `/foo/bar/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}?v=${RUBY_RUNTIME_BUNDLE.profile.manifestFingerprint}`,
			moduleUrl: `/foo/bar/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}?v=${RUBY_RUNTIME_BUNDLE.profile.moduleJavaScriptReceipt.sha256}`,
			wasmUrl: `/foo/bar/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}?v=${RUBY_RUNTIME_BUNDLE.profile.wasmReceipt.sha256}`,
			...RUBY_RUNTIME_BUNDLE.profile
		});
		expect(assets.haskell).toEqual({
			moduleUrl: `/foo/bar/wasm-haskell/dyld.mjs?v=${WASM_HASKELL_ASSET_VERSION}`,
			rootfsUrl: `/foo/bar/wasm-haskell/rootfs.tar.zst?v=${WASM_HASKELL_ASSET_VERSION}`,
			bsdtarUrl: `/foo/bar/wasm-haskell/bsdtar.wasm?v=${WASM_HASKELL_ASSET_VERSION}`,
			integrity: HASKELL_RUNTIME_ASSET_RECEIPTS
		});

		for (const [runtime, config] of Object.entries(assets)) {
			if (runtime === 'rootUrl' || typeof config !== 'object' || !config) continue;
			for (const [assetKey, value] of Object.entries(config)) {
				if (typeof value === 'string' && assetKey.endsWith('Url')) {
					expect(value).toMatch(/^\/foo\/bar\//u);
				}
			}
		}
	});

	it('includes compiler manifests in runtime cache identity', () => {
		const key = JSON.parse(
			createRuntimeAssetsKey(createApplicationRuntimeAssets('/foo/bar')) || '{}'
		) as Record<string, unknown>;
		const serializedElixirIntegrity = JSON.stringify(
			Object.entries(WASM_ELIXIR_ASSET_RECEIPTS)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([asset, entry]) => [
					asset,
					{
						sha256: entry.sha256,
						bytes: entry.bytes,
						uncompressedSha256: entry.uncompressedSha256,
						uncompressedBytes: entry.uncompressedBytes
					}
				])
		);
		const serializedFortranIntegrity = JSON.stringify(
			Object.entries(WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([asset, entry]) => [
					asset,
					{
						sha256: entry.sha256,
						bytes: entry.bytes
					}
				])
		);
		const serializedZigIntegrity = JSON.stringify(
			Object.entries(WASM_ZIG_ASSET_RECEIPTS)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([asset, entry]) => [
					asset,
					{
						sha256: entry.sha256,
						bytes: entry.bytes,
						...('uncompressedSha256' in entry
							? {
									uncompressedSha256: entry.uncompressedSha256,
									uncompressedBytes: entry.uncompressedBytes
								}
							: {})
					}
				])
		);
		const serializedHaskellIntegrity = JSON.stringify(
			Object.entries(HASKELL_RUNTIME_ASSET_RECEIPTS)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([asset, entry]) => [asset, { sha256: entry.sha256, bytes: entry.bytes }])
		);

		expect(key).toMatchObject({
			rustManifestUrl: `/foo/bar/wasm-rust/runtime/runtime-manifest.v3.json?v=${WASM_RUST_ASSET_VERSION}`,
			goManifestUrl: `/foo/bar/wasm-go/runtime/runtime-manifest.v1.json?v=${WASM_GO_ASSET_VERSION}`,
			prologManifestFingerprint: WASM_PROLOG_ASSET_VERSION,
			prologProfileId: WASM_PROLOG_RUNTIME_PROFILE.profileId,
			prologPackageRevision: WASM_PROLOG_RUNTIME_PROFILE.packageRevision,
			prologSwiplRevision: WASM_PROLOG_RUNTIME_PROFILE.swiplRevision,
			prologManifestReceipt: expect.any(String),
			prologJavaScriptReceipt: expect.any(String),
			prologWasmReceipt: expect.any(String),
			prologDataReceipt: expect.any(String),
			prologWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_PROLOG_RUNNER_RECEIPT.sha256,
						bytes: WASM_PROLOG_RUNNER_RECEIPT.bytes
					}
				]
			]),
			perlManifestFingerprint: WASM_PERL_ASSET_VERSION,
			perlProfileId: WASM_PERL_RUNTIME_PROFILE.profileId,
			perlArtifactRevision: WASM_PERL_RUNTIME_PROFILE.artifactRevision,
			perlWebperlRevision: WASM_PERL_RUNTIME_PROFILE.webperlRevision,
			perlPerlRevision: WASM_PERL_RUNTIME_PROFILE.perlRevision,
			perlEmscriptenRevision: WASM_PERL_RUNTIME_PROFILE.emscriptenRevision,
			perlManifestReceipt: expect.any(String),
			perlJavaScriptReceipt: expect.any(String),
			perlWasmReceipt: expect.any(String),
			perlDataReceipt: expect.any(String),
			perlWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_PERL_RUNNER_RECEIPT.sha256,
						bytes: WASM_PERL_RUNNER_RECEIPT.bytes
					}
				]
			]),
			tclManifestFingerprint: WASM_TCL_ASSET_VERSION,
			tclProfileId: WASM_TCL_RUNTIME_PROFILE.profileId,
			tclArtifactRevision: WASM_TCL_RUNTIME_PROFILE.artifactRevision,
			tclWaclRevision: WASM_TCL_RUNTIME_PROFILE.waclRevision,
			tclTclRevision: WASM_TCL_RUNTIME_PROFILE.tclRevision,
			tclRequireJsRevision: WASM_TCL_RUNTIME_PROFILE.requireJsRevision,
			tclEmscriptenRevision: WASM_TCL_RUNTIME_PROFILE.emscriptenRevision,
			tclManifestReceipt: expect.any(String),
			tclRequireJsReceipt: expect.any(String),
			tclCustomDataReceipt: expect.any(String),
			tclLibraryDataReceipt: expect.any(String),
			tclGlueReceipt: expect.any(String),
			tclWasmReceipt: expect.any(String),
			tclWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_TCL_RUNNER_RECEIPT.sha256,
						bytes: WASM_TCL_RUNNER_RECEIPT.bytes
					}
				]
			]),
			pascalBaseUrl: '/foo/bar/wasm-pascal/',
			pascalWorkerUrl: `/foo/bar/wasm-pascal/runner-worker.js?v=${WASM_PASCAL_RUNNER_RECEIPT.sha256}`,
			pascalManifestUrl: `/foo/bar/wasm-pascal/runtime-manifest.v2.json?v=${WASM_PASCAL_ASSET_VERSION}`,
			pascalCompilerJavaScriptUrl: `/foo/bar/wasm-pascal/compiler.js.gz.bin?v=${WASM_PASCAL_RUNTIME_PROFILE.compilerJavaScriptReceipt.sha256}`,
			pascalRtlJavaScriptUrl: `/foo/bar/wasm-pascal/rtl.js.bin?v=${WASM_PASCAL_RUNTIME_PROFILE.rtlJavaScriptReceipt.sha256}`,
			pascalSystemPascalUrl: `/foo/bar/wasm-pascal/system.pas.bin?v=${WASM_PASCAL_RUNTIME_PROFILE.systemPascalReceipt.sha256}`,
			pascalManifestFingerprint: WASM_PASCAL_ASSET_VERSION,
			pascalProfileId: WASM_PASCAL_RUNTIME_PROFILE.profileId,
			pascalArtifactRevision: WASM_PASCAL_RUNTIME_PROFILE.artifactRevision,
			pascalPas2jsVersion: WASM_PASCAL_RUNTIME_PROFILE.pas2jsVersion,
			pascalPas2jsRevision: WASM_PASCAL_RUNTIME_PROFILE.pas2jsRevision,
			pascalManifestReceipt: expect.any(String),
			pascalCompilerJavaScriptReceipt: expect.any(String),
			pascalRtlJavaScriptReceipt: expect.any(String),
			pascalSystemPascalReceipt: expect.any(String),
			pascalWorkerReceipt: expect.any(String),
			gleamManifestFingerprint: WASM_GLEAM_ASSET_VERSION,
			gleamWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_GLEAM_RUNNER_RECEIPT.sha256,
						bytes: WASM_GLEAM_RUNNER_RECEIPT.bytes
					}
				]
			]),
			forthManifestFingerprint: WASM_FORTH_ASSET_VERSION,
			forthWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_FORTH_RUNNER_RECEIPT.sha256,
						bytes: WASM_FORTH_RUNNER_RECEIPT.bytes
					}
				]
			]),
			jManifestFingerprint: WASM_J_ASSET_VERSION,
			jWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_J_RUNNER_RECEIPT.sha256,
						bytes: WASM_J_RUNNER_RECEIPT.bytes
					}
				]
			]),
			bqnManifestFingerprint: WASM_BQN_ASSET_VERSION,
			bqnWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_BQN_RUNNER_RECEIPT.sha256,
						bytes: WASM_BQN_RUNNER_RECEIPT.bytes
					}
				]
			]),
			janetManifestFingerprint: WASM_JANET_ASSET_VERSION,
			janetProfileId: WASM_JANET_RUNTIME_PROFILE.profileId,
			janetArtifactRevision: WASM_JANET_RUNTIME_PROFILE.artifactRevision,
			janetJanetVersion: WASM_JANET_RUNTIME_PROFILE.janetVersion,
			janetEmscriptenVersion: WASM_JANET_RUNTIME_PROFILE.emscriptenVersion,
			janetManifestReceipt: expect.any(String),
			janetJavaScriptReceipt: expect.any(String),
			janetWasmReceipt: expect.any(String),
			janetWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_JANET_RUNNER_RECEIPT.sha256,
						bytes: WASM_JANET_RUNNER_RECEIPT.bytes
					}
				]
			]),
			juliaManifestFingerprint: WASM_JULIA_ASSET_VERSION,
			juliaProfileId: WASM_JULIA_RUNTIME_PROFILE.profileId,
			juliaPackageRevision: WASM_JULIA_RUNTIME_PROFILE.packageRevision,
			juliaImportedByCommit: WASM_JULIA_RUNTIME_PROFILE.importedByCommit,
			juliaJuliaVersion: WASM_JULIA_RUNTIME_PROFILE.juliaVersion,
			juliaEmscriptenVersion: WASM_JULIA_RUNTIME_PROFILE.emscriptenVersion,
			juliaManifestReceipt: expect.any(String),
			juliaJavaScriptReceipt: expect.any(String),
			juliaWasmReceipt: expect.any(String),
			juliaDataReceipt: expect.any(String),
			juliaWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_JULIA_RUNNER_RECEIPT.sha256,
						bytes: WASM_JULIA_RUNNER_RECEIPT.bytes
					}
				]
			]),
			nimManifestFingerprint: WASM_NIM_ASSET_VERSION,
			nimProfileId: WASM_NIM_RUNTIME_PROFILE.profileId,
			nimArtifactRevision: WASM_NIM_RUNTIME_PROFILE.artifactRevision,
			nimNimRevision: WASM_NIM_RUNTIME_PROFILE.nimRevision,
			nimLlvmRevision: WASM_NIM_RUNTIME_PROFILE.llvmRevision,
			nimMemfsRevision: WASM_NIM_RUNTIME_PROFILE.memfsRevision,
			nimEmscriptenRevision: WASM_NIM_RUNTIME_PROFILE.emscriptenRevision,
			nimManifestReceipt: expect.any(String),
			nimJavaScriptReceipt: expect.any(String),
			nimWasmReceipt: expect.any(String),
			nimNimbaseReceipt: expect.any(String),
			nimClangJavaScriptReceipt: expect.any(String),
			nimClangWasmReceipt: expect.any(String),
			nimLldWasmReceipt: expect.any(String),
			nimMemfsWasmReceipt: expect.any(String),
			nimSysrootReceipt: expect.any(String),
			nimWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_NIM_RUNNER_RECEIPT.sha256,
						bytes: WASM_NIM_RUNNER_RECEIPT.bytes
					}
				]
			]),
			bashBaseUrl: '/foo/bar/wasm-bash/',
			bashManifestFingerprint: WASM_BASH_RUNTIME_PROFILE.manifestFingerprint,
			bashProfileId: WASM_BASH_RUNTIME_PROFILE.profileId,
			bashPackageVersion: WASM_BASH_RUNTIME_PROFILE.bashPackageVersion,
			bashSourceRevision: WASM_BASH_RUNTIME_PROFILE.bashSourceRevision,
			bashWasmerSdkVersion: WASM_BASH_RUNTIME_PROFILE.wasmerSdkVersion,
			bashWasmerSdkPackageIntegrity: WASM_BASH_RUNTIME_PROFILE.wasmerSdkPackageIntegrity,
			bashManifestReceipt: expect.any(String),
			bashSdkJavaScriptReceipt: expect.any(String),
			bashWasmerWasmReceipt: expect.any(String),
			bashWebcReceipt: expect.any(String),
			elixirIntegrity: serializedElixirIntegrity,
			erlangIntegrity: serializedElixirIntegrity,
			fortranIntegrity: serializedFortranIntegrity,
			zigIntegrity: serializedZigIntegrity,
			haskellIntegrity: serializedHaskellIntegrity,
			rubyBaseUrl: '/foo/bar/wasm-ruby/',
			rubyManifestUrl: `/foo/bar/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}?v=${RUBY_RUNTIME_BUNDLE.profile.manifestFingerprint}`,
			rubyModuleUrl: `/foo/bar/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}?v=${RUBY_RUNTIME_BUNDLE.profile.moduleJavaScriptReceipt.sha256}`,
			rubyWasmUrl: `/foo/bar/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}?v=${RUBY_RUNTIME_BUNDLE.profile.wasmReceipt.sha256}`,
			rubyProfileId: RUBY_RUNTIME_BUNDLE.profile.profileId,
			rubyArtifactRevision: RUBY_RUNTIME_BUNDLE.profile.artifactRevision,
			rubyVersion: RUBY_RUNTIME_BUNDLE.profile.rubyVersion,
			rubyRevision: RUBY_RUNTIME_BUNDLE.profile.rubyRevision,
			rubyWasmVersion: RUBY_RUNTIME_BUNDLE.profile.rubyWasmVersion,
			rubyWasmRevision: RUBY_RUNTIME_BUNDLE.profile.rubyWasmRevision,
			rubyWasiSdkVersion: RUBY_RUNTIME_BUNDLE.profile.wasiSdkVersion,
			rubyManifestFingerprint: RUBY_RUNTIME_BUNDLE.profile.manifestFingerprint,
			rubyManifestReceipt: expect.any(String),
			rubyModuleJavaScriptReceipt: expect.any(String),
			rubyWasmReceipt: expect.any(String),
			objectiveCIntegrity: JSON.stringify(
				Object.entries(WASM_OBJECTIVEC_ASSET_RECEIPTS)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([asset, entry]) => [asset, { sha256: entry.sha256, bytes: entry.bytes }])
			)
		});
	});

	it('includes every specialized application asset in runtime cache identity', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const key = JSON.parse(createRuntimeAssetsKey(assets) || '{}') as Record<string, unknown>;

		expect(key).toMatchObject({
			dModuleUrl: assets.d?.moduleUrl,
			dManifestUrl: assets.d?.manifestUrl,
			dIntegrity: expect.any(String),
			elixirIntegrity: expect.any(String),
			erlangIntegrity: expect.any(String),
			lispModuleUrl: assets.lisp?.moduleUrl,
			lispManifestUrl: assets.lisp?.manifestUrl,
			lispManifestFingerprint: assets.lisp?.manifestFingerprint,
			prologManifestUrl: assets.prolog?.manifestUrl,
			prologManifestFingerprint: assets.prolog?.manifestFingerprint,
			prologProfileId: assets.prolog?.profileId,
			prologPackageRevision: assets.prolog?.packageRevision,
			prologSwiplRevision: assets.prolog?.swiplRevision,
			prologManifestReceipt: expect.any(String),
			prologJavaScriptReceipt: expect.any(String),
			prologWasmReceipt: expect.any(String),
			prologDataReceipt: expect.any(String),
			prologWorkerReceipt: expect.any(String),
			perlManifestUrl: assets.perl?.manifestUrl,
			perlManifestFingerprint: assets.perl?.manifestFingerprint,
			perlProfileId: assets.perl?.profileId,
			perlArtifactRevision: assets.perl?.artifactRevision,
			perlWebperlRevision: assets.perl?.webperlRevision,
			perlPerlRevision: assets.perl?.perlRevision,
			perlEmscriptenRevision: assets.perl?.emscriptenRevision,
			perlManifestReceipt: expect.any(String),
			perlJavaScriptReceipt: expect.any(String),
			perlWasmReceipt: expect.any(String),
			perlDataReceipt: expect.any(String),
			perlWorkerReceipt: expect.any(String),
			bashBaseUrl: assets.bash?.baseUrl,
			bashManifestUrl: assets.bash?.manifestUrl,
			bashModuleUrl: assets.bash?.moduleUrl,
			bashWasmerWasmUrl: assets.bash?.wasmerWasmUrl,
			bashWebcUrl: assets.bash?.webcUrl,
			bashManifestFingerprint: assets.bash?.manifestFingerprint,
			bashProfileId: assets.bash?.profileId,
			bashPackageVersion: assets.bash?.bashPackageVersion,
			bashSourceRevision: assets.bash?.bashSourceRevision,
			bashWasmerSdkVersion: assets.bash?.wasmerSdkVersion,
			bashWasmerSdkPackageIntegrity: assets.bash?.wasmerSdkPackageIntegrity,
			bashManifestReceipt: expect.any(String),
			bashSdkJavaScriptReceipt: expect.any(String),
			bashWasmerWasmReceipt: expect.any(String),
			bashWebcReceipt: expect.any(String),
			tclManifestUrl: assets.tcl?.manifestUrl,
			tclManifestFingerprint: assets.tcl?.manifestFingerprint,
			tclProfileId: assets.tcl?.profileId,
			tclArtifactRevision: assets.tcl?.artifactRevision,
			tclWaclRevision: assets.tcl?.waclRevision,
			tclTclRevision: assets.tcl?.tclRevision,
			tclRequireJsRevision: assets.tcl?.requireJsRevision,
			tclEmscriptenRevision: assets.tcl?.emscriptenRevision,
			tclManifestReceipt: expect.any(String),
			tclRequireJsReceipt: expect.any(String),
			tclCustomDataReceipt: expect.any(String),
			tclLibraryDataReceipt: expect.any(String),
			tclGlueReceipt: expect.any(String),
			tclWasmReceipt: expect.any(String),
			tclWorkerReceipt: expect.any(String),
			forthManifestUrl: assets.forth?.manifestUrl,
			forthManifestFingerprint: assets.forth?.manifestFingerprint,
			forthWorkerReceipt: expect.any(String),
			jManifestUrl: assets.j?.manifestUrl,
			jManifestFingerprint: assets.j?.manifestFingerprint,
			jWorkerReceipt: expect.any(String),
			clojurescriptManifestUrl: assets.clojurescript?.manifestUrl,
			clojurescriptManifestFingerprint: assets.clojurescript?.manifestFingerprint,
			clojurescriptWorkerReceipt: expect.any(String),
			janetManifestUrl: assets.janet?.manifestUrl,
			janetManifestFingerprint: assets.janet?.manifestFingerprint,
			janetProfileId: assets.janet?.profileId,
			janetArtifactRevision: assets.janet?.artifactRevision,
			janetJanetVersion: assets.janet?.janetVersion,
			janetEmscriptenVersion: assets.janet?.emscriptenVersion,
			janetManifestReceipt: expect.any(String),
			janetJavaScriptReceipt: expect.any(String),
			janetWasmReceipt: expect.any(String),
			janetWorkerReceipt: expect.any(String),
			juliaManifestUrl: assets.julia?.manifestUrl,
			juliaManifestFingerprint: assets.julia?.manifestFingerprint,
			juliaProfileId: assets.julia?.profileId,
			juliaPackageRevision: assets.julia?.packageRevision,
			juliaImportedByCommit: assets.julia?.importedByCommit,
			juliaJuliaVersion: assets.julia?.juliaVersion,
			juliaEmscriptenVersion: assets.julia?.emscriptenVersion,
			juliaManifestReceipt: expect.any(String),
			juliaJavaScriptReceipt: expect.any(String),
			juliaWasmReceipt: expect.any(String),
			juliaDataReceipt: expect.any(String),
			juliaWorkerReceipt: expect.any(String),
			nimManifestUrl: assets.nim?.manifestUrl,
			nimManifestFingerprint: assets.nim?.manifestFingerprint,
			nimWorkerReceipt: expect.any(String),
			rubyBaseUrl: assets.ruby?.baseUrl,
			rubyManifestUrl: assets.ruby?.manifestUrl,
			rubyModuleUrl: assets.ruby?.moduleUrl,
			rubyWasmUrl: assets.ruby?.wasmUrl,
			rubyProfileId: assets.ruby?.profileId,
			rubyArtifactRevision: assets.ruby?.artifactRevision,
			rubyVersion: assets.ruby?.rubyVersion,
			rubyRevision: assets.ruby?.rubyRevision,
			rubyWasmVersion: assets.ruby?.rubyWasmVersion,
			rubyWasmRevision: assets.ruby?.rubyWasmRevision,
			rubyWasiSdkVersion: assets.ruby?.wasiSdkVersion,
			rubyManifestFingerprint: assets.ruby?.manifestFingerprint,
			rubyManifestReceipt: expect.any(String),
			rubyModuleJavaScriptReceipt: expect.any(String),
			rubyWasmReceipt: expect.any(String),
			haskellModuleUrl: assets.haskell?.moduleUrl,
			haskellRootfsUrl: assets.haskell?.rootfsUrl,
			haskellBsdtarUrl: assets.haskell?.bsdtarUrl,
			haskellIntegrity: expect.any(String),
			typeScriptLibUrl: assets.typescript?.libUrl,
			fortranBaseUrl: assets.fortran?.baseUrl,
			fortranF2cWasmUrl: assets.fortran?.f2cWasmUrl,
			fortranLibf2cUrl: assets.fortran?.libf2cUrl,
			fortranF2cHeaderUrl: assets.fortran?.f2cHeaderUrl,
			fortranAnalyzerUrl: assets.fortran?.analyzerUrl,
			fortranIntegrity: expect.any(String),
			zigCompilerUrl: assets.zig?.compilerUrl,
			zigStdlibUrl: assets.zig?.stdlibUrl,
			zigIntegrity: expect.any(String),
			objectiveCBaseUrl: assets.objectivec?.baseUrl,
			objectiveCLibobjcUrl: assets.objectivec?.libobjcUrl,
			objectiveCHeadersUrl: assets.objectivec?.headersUrl,
			objectiveCLibgnustepBaseUrl: assets.objectivec?.libgnustepBaseUrl,
			objectiveCLibgnustepBaseObjectUrl: assets.objectivec?.libgnustepBaseObjectUrl,
			objectiveCFoundationHeadersUrl: assets.objectivec?.foundationHeadersUrl,
			objectiveCLibffiUrl: assets.objectivec?.libffiUrl,
			objectiveCIntegrity: expect.any(String)
		});
	});

	it('includes every Ruby URL, identity field, and receipt in cache identity', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const ruby = assets.ruby!;
		const baseline = createRuntimeAssetsKey(assets);
		for (const field of [
			'baseUrl',
			'manifestUrl',
			'moduleUrl',
			'wasmUrl',
			'profileId',
			'artifactRevision',
			'rubyVersion',
			'rubyRevision',
			'rubyWasmVersion',
			'rubyWasmRevision',
			'wasiSdkVersion',
			'manifestFingerprint'
		] as const) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					ruby: { ...ruby, [field]: `${ruby[field]}-changed` }
				})
			).not.toBe(baseline);
		}
		for (const field of [
			'manifestReceipt',
			'moduleJavaScriptReceipt',
			'wasmReceipt'
		] as const) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					ruby: {
						...ruby,
						[field]: { ...ruby[field]!, sha256: 'f'.repeat(64) }
					}
				})
			).not.toBe(baseline);
		}
	});

	it('changes the runtime cache identity for every Prolog profile receipt field', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const originalKey = createRuntimeAssetsKey(assets);
		const prolog = assets.prolog!;
		const replacements = [
			{ profileId: `${prolog.profileId}-custom` },
			{ packageRevision: 'a'.repeat(40) },
			{ swiplRevision: 'b'.repeat(40) },
			{ manifestFingerprint: 'c'.repeat(64) },
			{ manifestReceipt: { ...prolog.manifestReceipt!, sha256: 'd'.repeat(64) } },
			{ javascriptReceipt: { ...prolog.javascriptReceipt!, sha256: 'e'.repeat(64) } },
			{ wasmReceipt: { ...prolog.wasmReceipt!, uncompressedSha256: 'f'.repeat(64) } },
			{ dataReceipt: { ...prolog.dataReceipt!, uncompressedBytes: 123 } }
		];

		for (const replacement of replacements) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					prolog: { ...prolog, ...replacement }
				})
			).not.toBe(originalKey);
		}
	});

	it('changes the runtime cache identity for every WebPerl profile and receipt field', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const originalKey = createRuntimeAssetsKey(assets);
		const perl = assets.perl!;
		const replacements = [
			{ profileId: `${perl.profileId}-custom` },
			{ artifactRevision: 'a'.repeat(40) },
			{ webperlRevision: 'b'.repeat(40) },
			{ perlRevision: 'c'.repeat(40) },
			{ emscriptenRevision: 'd'.repeat(40) },
			{ manifestFingerprint: 'e'.repeat(64) },
			{ manifestReceipt: { ...perl.manifestReceipt!, sha256: 'f'.repeat(64) } },
			{
				javascriptReceipt: {
					...perl.javascriptReceipt!,
					uncompressedSha256: '1'.repeat(64)
				}
			},
			{ wasmReceipt: { ...perl.wasmReceipt!, uncompressedBytes: 123 } },
			{ dataReceipt: { ...perl.dataReceipt!, sha256: '2'.repeat(64) } },
			{ workerReceipt: { ...perl.workerReceipt!, sha256: '3'.repeat(64) } }
		];

		for (const replacement of replacements) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					perl: { ...perl, ...replacement }
				})
			).not.toBe(originalKey);
		}
	});

	it('changes the runtime cache identity for every Bash URL, profile, and receipt field', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const originalKey = createRuntimeAssetsKey(assets);
		const bash = assets.bash!;
		const replacements = [
			{ baseUrl: '/custom/wasm-bash/' },
			{ manifestUrl: '/custom/wasm-bash/runtime-manifest.v2.json?v=custom' },
			{ moduleUrl: '/custom/wasm-bash/sdk/index.mjs.bin?v=custom' },
			{ wasmerWasmUrl: '/custom/wasm-bash/sdk/wasmer_js_bg.wasm.gz.bin?v=custom' },
			{ webcUrl: '/custom/wasm-bash/bash.webc.gz.bin?v=custom' },
			{ workerUrl: '/custom/legacy-worker.mjs' },
			{ profileId: `${bash.profileId}-custom` },
			{ bashPackageVersion: `${bash.bashPackageVersion}-custom` },
			{ bashSourceRevision: 'a'.repeat(40) },
			{ wasmerSdkVersion: `${bash.wasmerSdkVersion}-custom` },
			{ wasmerSdkPackageIntegrity: 'sha512-custom' },
			{ manifestFingerprint: 'b'.repeat(64) },
			{ manifestReceipt: { ...bash.manifestReceipt!, sha256: 'c'.repeat(64) } },
			{ sdkJavaScriptReceipt: { ...bash.sdkJavaScriptReceipt!, bytes: 123 } },
			{
				wasmerWasmReceipt: {
					...bash.wasmerWasmReceipt!,
					uncompressedSha256: 'd'.repeat(64)
				}
			},
			{ webcReceipt: { ...bash.webcReceipt!, bytes: 456 } }
		];

		for (const replacement of replacements) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					bash: { ...bash, ...replacement }
				})
			).not.toBe(originalKey);
		}
	});

	it('changes the runtime cache identity for every Pascal URL, profile, and receipt field', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const originalKey = createRuntimeAssetsKey(assets);
		const pascal = assets.pascal!;
		const replacements = [
			{ baseUrl: '/custom/wasm-pascal/' },
			{ workerUrl: '/custom/wasm-pascal/runner-worker.js?v=custom' },
			{ manifestUrl: '/custom/wasm-pascal/runtime-manifest.v2.json?v=custom' },
			{ compilerJavaScriptUrl: '/custom/wasm-pascal/compiler.js.gz.bin?v=custom' },
			{ rtlJavaScriptUrl: '/custom/wasm-pascal/rtl.js.bin?v=custom' },
			{ systemPascalUrl: '/custom/wasm-pascal/system.pas.bin?v=custom' },
			{ profileId: `${pascal.profileId}-custom` },
			{ artifactRevision: 'a'.repeat(40) },
			{ pas2jsVersion: `${pascal.pas2jsVersion}-custom` },
			{ pas2jsRevision: 'b'.repeat(12) },
			{ manifestFingerprint: 'c'.repeat(64) },
			{ manifestReceipt: { ...pascal.manifestReceipt!, sha256: 'd'.repeat(64) } },
			{
				compilerJavaScriptReceipt: {
					...pascal.compilerJavaScriptReceipt!,
					uncompressedSha256: 'e'.repeat(64)
				}
			},
			{ rtlJavaScriptReceipt: { ...pascal.rtlJavaScriptReceipt!, bytes: 123 } },
			{ systemPascalReceipt: { ...pascal.systemPascalReceipt!, sha256: 'f'.repeat(64) } },
			{ workerReceipt: { ...pascal.workerReceipt!, bytes: 456 } }
		];

		for (const replacement of replacements) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					pascal: { ...pascal, ...replacement }
				})
			).not.toBe(originalKey);
		}
	});

	it('changes the runtime cache identity for every Janet profile and receipt field', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const originalKey = createRuntimeAssetsKey(assets);
		const janet = assets.janet!;
		const replacements = [
			{ profileId: `${janet.profileId}-custom` },
			{ artifactRevision: 'a'.repeat(40) },
			{ janetVersion: `${janet.janetVersion}-custom` },
			{ emscriptenVersion: `${janet.emscriptenVersion}-custom` },
			{ manifestFingerprint: 'b'.repeat(64) },
			{ manifestReceipt: { ...janet.manifestReceipt!, sha256: 'c'.repeat(64) } },
			{ javascriptReceipt: { ...janet.javascriptReceipt!, bytes: 123 } },
			{ wasmReceipt: { ...janet.wasmReceipt!, uncompressedSha256: 'd'.repeat(64) } },
			{ workerReceipt: { ...janet.workerReceipt!, sha256: 'e'.repeat(64) } }
		];

		for (const replacement of replacements) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					janet: { ...janet, ...replacement }
				})
			).not.toBe(originalKey);
		}
	});

	it('changes the runtime cache identity for every Julia profile and receipt field', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const originalKey = createRuntimeAssetsKey(assets);
		const julia = assets.julia!;
		const replacements = [
			{ profileId: `${julia.profileId}-custom` },
			{ packageRevision: 'a'.repeat(40) },
			{ importedByCommit: 'b'.repeat(40) },
			{ juliaVersion: `${julia.juliaVersion}-custom` },
			{ emscriptenVersion: `${julia.emscriptenVersion}-custom` },
			{ manifestFingerprint: 'c'.repeat(64) },
			{ manifestReceipt: { ...julia.manifestReceipt!, sha256: 'd'.repeat(64) } },
			{ javascriptReceipt: { ...julia.javascriptReceipt!, bytes: 123 } },
			{ wasmReceipt: { ...julia.wasmReceipt!, uncompressedSha256: 'e'.repeat(64) } },
			{ dataReceipt: { ...julia.dataReceipt!, uncompressedBytes: 456 } },
			{ workerReceipt: { ...julia.workerReceipt!, sha256: 'f'.repeat(64) } }
		];

		for (const replacement of replacements) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					julia: { ...julia, ...replacement }
				})
			).not.toBe(originalKey);
		}
	});

	it('changes the runtime cache identity for every Nim profile and receipt field', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const originalKey = createRuntimeAssetsKey(assets);
		const nim = assets.nim!;
		const replacements = [
			{ profileId: `${nim.profileId}-custom` },
			{ artifactRevision: '1'.repeat(40) },
			{ nimRevision: '2'.repeat(40) },
			{ llvmRevision: '3'.repeat(40) },
			{ memfsRevision: '4'.repeat(40) },
			{ emscriptenRevision: `${nim.emscriptenRevision}-custom` },
			{ manifestFingerprint: '5'.repeat(64) },
			{ manifestReceipt: { ...nim.manifestReceipt!, sha256: '6'.repeat(64) } },
			{ nimJavaScriptReceipt: { ...nim.nimJavaScriptReceipt!, bytes: 123 } },
			{ nimWasmReceipt: { ...nim.nimWasmReceipt!, uncompressedBytes: 456 } },
			{ nimbaseReceipt: { ...nim.nimbaseReceipt!, sha256: '7'.repeat(64) } },
			{ clangJavaScriptReceipt: { ...nim.clangJavaScriptReceipt!, bytes: 789 } },
			{ clangWasmReceipt: { ...nim.clangWasmReceipt!, uncompressedSha256: '8'.repeat(64) } },
			{ lldWasmReceipt: { ...nim.lldWasmReceipt!, sha256: '9'.repeat(64) } },
			{ memfsWasmReceipt: { ...nim.memfsWasmReceipt!, uncompressedBytes: 321 } },
			{ sysrootReceipt: { ...nim.sysrootReceipt!, bytes: 654 } },
			{ workerReceipt: { ...nim.workerReceipt!, sha256: 'a'.repeat(64) } }
		];

		for (const replacement of replacements) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					nim: { ...nim, ...replacement }
				})
			).not.toBe(originalKey);
		}
	});

	it('changes the runtime cache identity for every Tcl profile receipt field', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const originalKey = createRuntimeAssetsKey(assets);
		const tcl = assets.tcl!;
		const replacements = [
			{ profileId: `${tcl.profileId}-custom` },
			{ artifactRevision: 'a'.repeat(40) },
			{ waclRevision: 'b'.repeat(40) },
			{ tclRevision: 'c'.repeat(40) },
			{ requireJsRevision: 'd'.repeat(40) },
			{ emscriptenRevision: 'e'.repeat(40) },
			{ manifestFingerprint: 'f'.repeat(64) },
			{ manifestReceipt: { ...tcl.manifestReceipt!, sha256: '1'.repeat(64) } },
			{ requireJsReceipt: { ...tcl.requireJsReceipt!, sha256: '2'.repeat(64) } },
			{ customDataReceipt: { ...tcl.customDataReceipt!, bytes: 123 } },
			{ libraryDataReceipt: { ...tcl.libraryDataReceipt!, uncompressedBytes: 456 } },
			{ glueReceipt: { ...tcl.glueReceipt!, sha256: '3'.repeat(64) } },
			{ wasmReceipt: { ...tcl.wasmReceipt!, uncompressedSha256: '4'.repeat(64) } }
		];

		for (const replacement of replacements) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					tcl: { ...tcl, ...replacement }
				})
			).not.toBe(originalKey);
		}
	});

	it('pins both D outer trust roots to one generated integrity version', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');

		expect(assets.d).toEqual({
			moduleUrl: `/foo/bar/wasm-d/index.js?v=${WASM_D_INTEGRITY_VERSION}`,
			manifestUrl: `/foo/bar/wasm-d/runtime/runtime-manifest.v1.json?v=${WASM_D_INTEGRITY_VERSION}`,
			integrity: WASM_D_OUTER_ASSET_RECEIPTS
		});
	});

	it('keys TinyGo custom loader identity', () => {
		const firstLoader = () => undefined;
		const secondLoader = () => undefined;
		const firstKey = createRuntimeAssetsKey({
			tinygo: { assetLoader: firstLoader }
		});
		const secondKey = createRuntimeAssetsKey({
			tinygo: { assetLoader: secondLoader }
		});

		expect(firstKey).toBe(createRuntimeAssetsKey({ tinygo: { assetLoader: firstLoader } }));
		expect(firstKey).not.toBe(secondKey);
		expect(
			createRuntimeAssetsKey({
				tinygo: {
					assetLoader: firstLoader,
					assetLoaderKey: 'tinygo-loader-v1'
				}
			})
		).toBe(
			createRuntimeAssetsKey({
				tinygo: {
					assetLoader: secondLoader,
					assetLoaderKey: 'tinygo-loader-v1'
				}
			})
		);
	});

	it('pins every TinyGo toolchain profile receipt in runtime cache identity', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		expect(assets.tinygo).toEqual({
			moduleUrl: `/foo/bar/wasm-tinygo/upstream.js?v=${WASM_TINYGO_ASSET_VERSION}`,
			...WASM_TINYGO_RUNTIME_PROFILE
		});
		const originalKey = createRuntimeAssetsKey(assets);
		const tinygo = assets.tinygo!;
		const firstAsset = Object.keys(tinygo.assetReceipts!)[0]!;
		const firstReceipt = tinygo.assetReceipts![firstAsset];
		if (!firstReceipt || typeof firstReceipt === 'string') {
			throw new Error('bundled TinyGo asset receipts must include size metadata');
		}
		const replacements = [
			{ profileId: `${tinygo.profileId}-replacement` },
			{ protocolVersion: 5 },
			{ manifestPath: 'tools/upstream/replacement.json' },
			{ manifestFingerprint: 'f'.repeat(64) },
			{ manifestReceipt: { ...tinygo.manifestReceipt!, sha256: '1'.repeat(64) } },
			{
				assetReceipts: {
					...tinygo.assetReceipts,
					[firstAsset]: { ...firstReceipt, sha256: '2'.repeat(64) }
				}
			}
		];
		for (const replacement of replacements) {
			expect(
				createRuntimeAssetsKey({
					...assets,
					tinygo: { ...tinygo, ...replacement }
				}),
				`TinyGo cache identity did not include ${Object.keys(replacement)[0]}`
			).not.toBe(originalKey);
		}
	});
});
