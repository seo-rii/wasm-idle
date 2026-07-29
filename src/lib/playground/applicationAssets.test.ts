import { createRuntimeAssetsKey } from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';
import {
	createApplicationAssetResolver,
	createApplicationRuntimeAssets,
	normalizeApplicationAssetRootUrl
} from './applicationAssets';
import { STATIC_RUNTIME_MODULE_VERSION } from './staticRuntimeModuleVersion';
import { WASM_GO_ASSET_VERSION } from './wasmGoVersion';
import { WASM_R_ASSET_VERSION } from './wasmRVersion';
import { WASM_RUST_ASSET_VERSION } from './wasmRustVersion';

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
		expect(assets.typescript?.libUrl).toMatch(
			/^\/foo\/bar\/lsp\/typescript-libs\.json\.gz\?v=/u
		);
		expect(assets.objectivec?.foundationHeadersUrl).toMatch(
			/^\/foo\/bar\/wasm-objectivec\/foundation-headers\.json\?v=/u
		);
		expect(assets.r?.baseUrl).toBe(`/foo/bar/webr/${WASM_R_ASSET_VERSION}/`);
		expect(assets.sqlite?.moduleUrl).toBe(
			`/foo/bar/wasm-sqlite/runtime.mjs?v=${STATIC_RUNTIME_MODULE_VERSION}`
		);

		for (const [runtime, config] of Object.entries(assets)) {
			if (runtime === 'rootUrl' || typeof config !== 'object' || !config) continue;
			for (const value of Object.values(config)) {
				if (typeof value === 'string') expect(value).toMatch(/^\/foo\/bar\//u);
			}
		}
	});

	it('includes compiler manifests in runtime cache identity', () => {
		const key = JSON.parse(
			createRuntimeAssetsKey(createApplicationRuntimeAssets('/foo/bar')) || '{}'
		) as Record<string, unknown>;

		expect(key).toMatchObject({
			rustManifestUrl: `/foo/bar/wasm-rust/runtime/runtime-manifest.v3.json?v=${WASM_RUST_ASSET_VERSION}`,
			goManifestUrl: `/foo/bar/wasm-go/runtime/runtime-manifest.v1.json?v=${WASM_GO_ASSET_VERSION}`
		});
	});

	it('includes every specialized application asset in runtime cache identity', () => {
		const assets = createApplicationRuntimeAssets('/foo/bar');
		const key = JSON.parse(createRuntimeAssetsKey(assets) || '{}') as Record<string, unknown>;

		expect(key).toMatchObject({
			typeScriptLibUrl: assets.typescript?.libUrl,
			fortranBaseUrl: assets.fortran?.baseUrl,
			fortranF2cWasmUrl: assets.fortran?.f2cWasmUrl,
			fortranLibf2cUrl: assets.fortran?.libf2cUrl,
			fortranF2cHeaderUrl: assets.fortran?.f2cHeaderUrl,
			fortranAnalyzerUrl: assets.fortran?.analyzerUrl,
			objectiveCBaseUrl: assets.objectivec?.baseUrl,
			objectiveCLibobjcUrl: assets.objectivec?.libobjcUrl,
			objectiveCHeadersUrl: assets.objectivec?.headersUrl,
			objectiveCLibgnustepBaseUrl: assets.objectivec?.libgnustepBaseUrl,
			objectiveCLibgnustepBaseObjectUrl: assets.objectivec?.libgnustepBaseObjectUrl,
			objectiveCFoundationHeadersUrl: assets.objectivec?.foundationHeadersUrl,
			objectiveCLibffiUrl: assets.objectivec?.libffiUrl
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
