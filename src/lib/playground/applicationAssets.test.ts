import {
	HASKELL_RUNTIME_ASSET_RECEIPTS,
	RUBY_RUNTIME_ASSET_PATH,
	RUBY_RUNTIME_ASSET_RECEIPTS,
	RUBY_RUNTIME_ASSET_VERSION,
	createRuntimeAssetsKey
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';
import {
	createApplicationAssetResolver,
	createApplicationRuntimeAssets,
	normalizeApplicationAssetRootUrl
} from './applicationAssets';
import { STATIC_RUNTIME_MODULE_VERSION } from './staticRuntimeModuleVersion';
import { WASM_BASH_ASSET_VERSION, WASM_BASH_WEBC_RECEIPT } from './wasmBashVersion';
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
import { WASM_JANET_ASSET_VERSION, WASM_JANET_RUNNER_RECEIPT } from './wasmJanetVersion';
import { WASM_JULIA_ASSET_VERSION, WASM_JULIA_RUNNER_RECEIPT } from './wasmJuliaVersion';
import { WASM_LISP_ASSET_VERSION } from './wasmLispVersion';
import { WASM_NIM_ASSET_VERSION, WASM_NIM_RUNNER_RECEIPT } from './wasmNimVersion';
import { WASM_OBJECTIVEC_ASSET_RECEIPTS } from './wasmObjectiveCVersion';
import { WASM_PERL_ASSET_VERSION, WASM_PERL_RUNNER_RECEIPT } from './wasmPerlVersion';
import { WASM_PROLOG_ASSET_VERSION, WASM_PROLOG_RUNNER_RECEIPT } from './wasmPrologVersion';
import { WASM_R_ASSET_VERSION } from './wasmRVersion';
import { WASM_RUST_ASSET_VERSION } from './wasmRustVersion';
import { WASM_TCL_ASSET_VERSION, WASM_TCL_RUNNER_RECEIPT } from './wasmTclVersion';
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
		expect(assets.lisp).toEqual({
			moduleUrl: `/foo/bar/wasm-lisp/index.js?v=${WASM_LISP_ASSET_VERSION}`,
			manifestUrl: `/foo/bar/wasm-lisp/runtime-manifest.v2.json?v=${WASM_LISP_ASSET_VERSION}`,
			manifestFingerprint: WASM_LISP_ASSET_VERSION
		});
		expect(assets.prolog).toEqual({
			baseUrl: '/foo/bar/wasm-prolog/',
			workerUrl: `/foo/bar/wasm-prolog/runner-worker.js?v=${WASM_PROLOG_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-prolog/runtime-manifest.v2.json?v=${WASM_PROLOG_ASSET_VERSION}`,
			manifestFingerprint: WASM_PROLOG_ASSET_VERSION,
			workerReceipt: WASM_PROLOG_RUNNER_RECEIPT
		});
		expect(assets.perl).toEqual({
			baseUrl: '/foo/bar/wasm-perl/',
			workerUrl: `/foo/bar/wasm-perl/runner-worker.js?v=${WASM_PERL_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-perl/runtime-manifest.v2.json?v=${WASM_PERL_ASSET_VERSION}`,
			manifestFingerprint: WASM_PERL_ASSET_VERSION,
			workerReceipt: WASM_PERL_RUNNER_RECEIPT
		});
		expect(assets.tcl).toEqual({
			baseUrl: '/foo/bar/wasm-tcl/',
			workerUrl: `/foo/bar/wasm-tcl/runner-worker.js?v=${WASM_TCL_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-tcl/runtime-manifest.v2.json?v=${WASM_TCL_ASSET_VERSION}`,
			manifestFingerprint: WASM_TCL_ASSET_VERSION,
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
			manifestFingerprint: WASM_JANET_ASSET_VERSION,
			workerReceipt: WASM_JANET_RUNNER_RECEIPT
		});
		expect(assets.julia).toEqual({
			baseUrl: '/foo/bar/wasm-julia/',
			workerUrl: `/foo/bar/wasm-julia/runner-worker.js?v=${WASM_JULIA_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-julia/runtime-manifest.v2.json?v=${WASM_JULIA_ASSET_VERSION}`,
			manifestFingerprint: WASM_JULIA_ASSET_VERSION,
			workerReceipt: WASM_JULIA_RUNNER_RECEIPT
		});
		expect(assets.nim).toEqual({
			baseUrl: '/foo/bar/wasm-nim/',
			workerUrl: `/foo/bar/wasm-nim/runner-worker.js?v=${WASM_NIM_RUNNER_RECEIPT.sha256}`,
			manifestUrl: `/foo/bar/wasm-nim/runtime-manifest.v2.json?v=${WASM_NIM_ASSET_VERSION}`,
			manifestFingerprint: WASM_NIM_ASSET_VERSION,
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
			moduleUrl: `/foo/bar/wasm-bash/sdk/index.mjs?v=${STATIC_RUNTIME_MODULE_VERSION}`,
			webcUrl: `/foo/bar/wasm-bash/bash.webc?v=${WASM_BASH_ASSET_VERSION}`,
			workerUrl: `/foo/bar/wasm-bash/sdk/worker.mjs?v=${STATIC_RUNTIME_MODULE_VERSION}`,
			webcReceipt: WASM_BASH_WEBC_RECEIPT
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
			moduleUrl: `/foo/bar/wasm-ruby/runtime.mjs?v=${RUBY_RUNTIME_ASSET_VERSION}`,
			wasmUrl: `/foo/bar/wasm-ruby/${RUBY_RUNTIME_ASSET_PATH}?v=${RUBY_RUNTIME_ASSET_VERSION}`,
			integrity: RUBY_RUNTIME_ASSET_RECEIPTS
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
		const serializedRubyIntegrity = JSON.stringify(
			Object.entries(RUBY_RUNTIME_ASSET_RECEIPTS)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([asset, entry]) => [asset, { sha256: entry.sha256, bytes: entry.bytes }])
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
			tclWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_TCL_RUNNER_RECEIPT.sha256,
						bytes: WASM_TCL_RUNNER_RECEIPT.bytes
					}
				]
			]),
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
			juliaManifestFingerprint: WASM_JULIA_ASSET_VERSION,
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
			nimWorkerReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_NIM_RUNNER_RECEIPT.sha256,
						bytes: WASM_NIM_RUNNER_RECEIPT.bytes
					}
				]
			]),
			bashWebcReceipt: JSON.stringify([
				[
					'worker',
					{
						sha256: WASM_BASH_WEBC_RECEIPT.sha256,
						bytes: WASM_BASH_WEBC_RECEIPT.bytes
					}
				]
			]),
			elixirIntegrity: serializedElixirIntegrity,
			erlangIntegrity: serializedElixirIntegrity,
			fortranIntegrity: serializedFortranIntegrity,
			zigIntegrity: serializedZigIntegrity,
			haskellIntegrity: serializedHaskellIntegrity,
			rubyIntegrity: serializedRubyIntegrity,
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
			prologWorkerReceipt: expect.any(String),
			perlManifestUrl: assets.perl?.manifestUrl,
			perlManifestFingerprint: assets.perl?.manifestFingerprint,
			perlWorkerReceipt: expect.any(String),
			tclManifestUrl: assets.tcl?.manifestUrl,
			tclManifestFingerprint: assets.tcl?.manifestFingerprint,
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
			juliaManifestUrl: assets.julia?.manifestUrl,
			juliaManifestFingerprint: assets.julia?.manifestFingerprint,
			juliaWorkerReceipt: expect.any(String),
			nimManifestUrl: assets.nim?.manifestUrl,
			nimManifestFingerprint: assets.nim?.manifestFingerprint,
			nimWorkerReceipt: expect.any(String),
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

	it('pins both D outer trust roots to one generated integrity version', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');

		expect(assets.d).toEqual({
			moduleUrl: `/foo/bar/wasm-d/index.js?v=${WASM_D_INTEGRITY_VERSION}`,
			manifestUrl: `/foo/bar/wasm-d/runtime/runtime-manifest.v1.json?v=${WASM_D_INTEGRITY_VERSION}`,
			integrity: WASM_D_OUTER_ASSET_RECEIPTS
		});
	});

	it('keys TinyGo asset packs and custom loader identity', () => {
		const firstLoader = () => undefined;
		const secondLoader = () => undefined;
		const assetPacks = [
			{ index: 'stdlib.index.json', asset: 'stdlib.tar.gz', fileCount: 12, totalBytes: 3456 }
		];
		const firstKey = createRuntimeAssetsKey({
			tinygo: { assetLoader: firstLoader, assetPacks }
		});
		const secondKey = createRuntimeAssetsKey({
			tinygo: { assetLoader: secondLoader, assetPacks }
		});

		expect(firstKey).toBe(
			createRuntimeAssetsKey({ tinygo: { assetLoader: firstLoader, assetPacks } })
		);
		expect(firstKey).not.toBe(secondKey);
		expect(
			createRuntimeAssetsKey({
				tinygo: {
					assetLoader: firstLoader,
					assetLoaderKey: 'tinygo-pack-loader-v1',
					assetPacks
				}
			})
		).toBe(
			createRuntimeAssetsKey({
				tinygo: {
					assetLoader: secondLoader,
					assetLoaderKey: 'tinygo-pack-loader-v1',
					assetPacks
				}
			})
		);
		expect(firstKey).not.toBe(
			createRuntimeAssetsKey({
				tinygo: {
					assetLoader: firstLoader,
					assetPacks: [{ ...assetPacks[0], totalBytes: 3457 }]
				}
			})
		);
	});
});
