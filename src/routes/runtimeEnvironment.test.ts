import { describe, expect, it } from 'vitest';
import environmentSchema from '../env.ts?raw';
import {
	resolveDebugRuntimeUrls,
	resolveErlangBundleUrl,
	resolveGleamRuntimeAssetConfig,
	resolveJanetRuntimeAssetConfig,
	resolveJuliaRuntimeAssetConfig,
	resolveLispRuntimeAssetConfig,
	resolveNimRuntimeAssetConfig,
	resolvePerlRuntimeAssetConfig,
	resolveRubyRuntimeAssetConfig,
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { createApplicationRuntimeAssets } from '$lib/playground/applicationAssets';
import { applyExampleRuntimeEnvironment } from './runtimeEnvironment';

const currentUrl = 'https://example.test/playground/';
const fingerprint = 'b'.repeat(64);
const workerSha256 = 'c'.repeat(64);

describe('example runtime environment', () => {
	it('leaves bundled options and receipt profiles unchanged when values are absent or blank', () => {
		const assets = createApplicationRuntimeAssets('/playground');
		expect(
			applyExampleRuntimeEnvironment(assets, {
				PUBLIC_TEAVM_BASE_URL: '  ',
				PUBLIC_WASM_C3_BASE_URL: undefined,
				PUBLIC_WASM_SQLITE_WASM_URL: ''
			})
		).toEqual(assets);
	});

	it('covers every optional public runtime variable declared by the example', () => {
		const keys = [...environmentSchema.matchAll(/^\s*(PUBLIC_\w+):/gmu)].map(
			(match) => match[1]
		);
		const reads = new Set<string>();
		const environment = Object.fromEntries(keys.map((key) => [key, undefined]));
		for (const key of keys) {
			Object.defineProperty(environment, key, {
				get() {
					reads.add(key);
					return undefined;
				}
			});
		}
		expect(applyExampleRuntimeEnvironment({}, environment)).toEqual({});
		expect([...reads].sort()).toEqual(keys.sort());
	});

	it('fills missing Java and runtime URL options without changing explicit options or profiles', () => {
		const loader = () => null;
		const options: PlaygroundRuntimeAssets = {
			rootUrl: '/playground',
			java: { loader },
			fortran: { baseUrl: '/explicit-fortran/' },
			sqlite: { moduleUrl: '/explicit-sqlite/runtime.mjs' }
		};
		const configured = applyExampleRuntimeEnvironment(options, {
			PUBLIC_TEAVM_BASE_URL: ' https://cdn.test/java ',
			PUBLIC_WASM_FORTRAN_BASE_URL: 'https://ignored.test/fortran/',
			PUBLIC_WASM_FORTRAN_F2C_WASM_URL: ' /mirrored/f2c.wasm ',
			PUBLIC_WASM_SQLITE_MODULE_URL: '/ignored/runtime.mjs',
			PUBLIC_WASM_SQLITE_WASM_URL: ' /mirrored/sql-wasm.wasm ',
			PUBLIC_WASM_OBJECTIVEC_GNUSTEP_BASE_OBJECT_URL: '/mirrored/libgnustep-base.o'
		});
		expect(configured.java).toEqual({ loader, baseUrl: 'https://cdn.test/java' });
		expect(resolveRuntimeAssetConfig('java', configured, currentUrl).baseUrl).toBe(
			'https://cdn.test/java/'
		);
		expect(configured.fortran).toEqual({
			baseUrl: '/explicit-fortran/',
			f2cWasmUrl: '/mirrored/f2c.wasm'
		});
		expect(configured.sqlite).toEqual({
			moduleUrl: '/explicit-sqlite/runtime.mjs',
			wasmUrl: '/mirrored/sql-wasm.wasm'
		});
		expect(configured.objectivec).toEqual({
			libgnustepBaseObjectUrl: '/mirrored/libgnustep-base.o'
		});
		expect(options.java).toEqual({ loader });
		expect(options.fortran).toEqual({ baseUrl: '/explicit-fortran/' });
	});

	it('keeps existing versioned example URLs and trusted profiles ahead of environment values', () => {
		const assets = createApplicationRuntimeAssets('/playground');
		const configured = applyExampleRuntimeEnvironment(assets, {
			PUBLIC_WASM_RUST_COMPILER_URL: '/different/rust.js',
			PUBLIC_WASM_LISP_MANIFEST_FINGERPRINT: fingerprint,
			PUBLIC_WASM_PERL_BASE_URL: '/different/perl/',
			PUBLIC_WASM_JANET_BASE_URL: '/different/janet/',
			PUBLIC_WASM_JANET_WORKER_SHA256: 'invalid',
			PUBLIC_WASM_JANET_WORKER_BYTES: 'invalid',
			PUBLIC_WASM_JULIA_MANIFEST_URL: '/different/julia/manifest.json',
			PUBLIC_WASM_NIM_WORKER_URL: '/different/nim/worker.js',
			PUBLIC_WASM_GLEAM_MANIFEST_FINGERPRINT: fingerprint,
			PUBLIC_WASM_GLEAM_WORKER_SHA256: workerSha256,
			PUBLIC_WASM_GLEAM_WORKER_BYTES: '123',
			PUBLIC_WASM_RUBY_MODULE_URL: '/different/ruby/runtime.mjs.bin'
		});
		expect(configured).toEqual(assets);
		expect(configured.perl).toBe(assets.perl);
		expect(configured.janet).toBe(assets.janet);
		expect(configured.julia).toBe(assets.julia);
		expect(configured.nim).toBe(assets.nim);
		expect(configured.gleam).toBe(assets.gleam);
		expect(configured.ruby).toBe(assets.ruby);
	});

	it('preserves Erlang-specific environment precedence and the Elixir bundle fallback', () => {
		const explicitElixir = { elixir: { bundleUrl: '/explicit/elixir.avm' } };
		const both = applyExampleRuntimeEnvironment(explicitElixir, {
			PUBLIC_WASM_ERLANG_BUNDLE_URL: ' /environment/erlang.avm ',
			PUBLIC_WASM_ELIXIR_BUNDLE_URL: '/environment/elixir.avm'
		});
		expect(resolveErlangBundleUrl(both, currentUrl)).toBe(
			'https://example.test/environment/erlang.avm'
		);
		const fallback = applyExampleRuntimeEnvironment(
			{},
			{
				PUBLIC_WASM_ELIXIR_BUNDLE_URL: '/environment/shared.avm'
			}
		);
		expect(resolveErlangBundleUrl(fallback, currentUrl)).toBe(
			'https://example.test/environment/shared.avm'
		);
	});

	it('maps custom Lisp manifest identity without inheriting a bundled fingerprint or receipt', () => {
		const configured = applyExampleRuntimeEnvironment(
			{ rootUrl: '/playground' },
			{
				PUBLIC_WASM_LISP_MODULE_URL: ' https://cdn.test/scheme/index.js ',
				PUBLIC_WASM_LISP_MANIFEST_URL: ' https://cdn.test/scheme/manifest.json ',
				PUBLIC_WASM_LISP_MANIFEST_FINGERPRINT: ` ${fingerprint} `
			}
		);
		expect(resolveLispRuntimeAssetConfig(configured, currentUrl)).toEqual({
			moduleUrl: 'https://cdn.test/scheme/index.js',
			manifestUrl: 'https://cdn.test/scheme/manifest.json',
			manifestFingerprint: fingerprint
		});
		const urlOnly = applyExampleRuntimeEnvironment(
			{ rootUrl: '/playground' },
			{ PUBLIC_WASM_LISP_MODULE_URL: 'https://cdn.test/scheme/index.js' }
		);
		expect(resolveLispRuntimeAssetConfig(urlOnly, currentUrl).manifestFingerprint).toBe('');
		expect(resolveLispRuntimeAssetConfig(urlOnly, currentUrl).manifestReceipt).toBeUndefined();
	});

	it.each([
		['Ruby', 'PUBLIC_WASM_RUBY_MODULE_URL', resolveRubyRuntimeAssetConfig],
		['Perl', 'PUBLIC_WASM_PERL_BASE_URL', resolvePerlRuntimeAssetConfig],
		['Janet', 'PUBLIC_WASM_JANET_BASE_URL', resolveJanetRuntimeAssetConfig],
		['Julia', 'PUBLIC_WASM_JULIA_BASE_URL', resolveJuliaRuntimeAssetConfig],
		['Nim', 'PUBLIC_WASM_NIM_BASE_URL', resolveNimRuntimeAssetConfig]
	] as const)(
		'keeps %s URL-only environment overrides outside the bundled trust profile',
		(_name, key, resolve) => {
			const configured = applyExampleRuntimeEnvironment(
				{ rootUrl: '/playground' },
				{ [key]: '/custom/' }
			);
			expect(() => resolve(configured, currentUrl)).toThrow();
		}
	);

	it('translates a complete custom Gleam identity and runner receipt into explicit options', () => {
		const configured = applyExampleRuntimeEnvironment(
			{},
			{
				PUBLIC_WASM_GLEAM_BASE_URL: '/custom/gleam/',
				PUBLIC_WASM_GLEAM_WORKER_URL: '/custom/gleam/worker.js',
				PUBLIC_WASM_GLEAM_MANIFEST_URL: '/custom/gleam/manifest.json',
				PUBLIC_WASM_GLEAM_MANIFEST_FINGERPRINT: fingerprint,
				PUBLIC_WASM_GLEAM_WORKER_SHA256: ` ${workerSha256} `,
				PUBLIC_WASM_GLEAM_WORKER_BYTES: ' 123 '
			}
		);
		expect(resolveGleamRuntimeAssetConfig(configured, currentUrl)).toEqual({
			baseUrl: 'https://example.test/custom/gleam/',
			workerUrl: 'https://example.test/custom/gleam/worker.js',
			manifestUrl: 'https://example.test/custom/gleam/manifest.json',
			manifestFingerprint: fingerprint,
			workerReceipt: { bytes: 123, sha256: workerSha256 }
		});
		const urlOnly = applyExampleRuntimeEnvironment(
			{},
			{ PUBLIC_WASM_GLEAM_BASE_URL: '/custom/gleam/' }
		);
		expect(
			resolveGleamRuntimeAssetConfig(urlOnly, currentUrl).manifestFingerprint
		).toBeUndefined();
		expect(resolveGleamRuntimeAssetConfig(urlOnly, currentUrl).workerReceipt).toBeUndefined();
	});

	it.each(['gleam', 'janet', 'julia', 'nim'] as const)(
		'rejects malformed %s runner receipt values instead of falling back to bundled trust',
		(runtime) => {
			const prefix = `PUBLIC_WASM_${runtime.toUpperCase()}`;
			for (const bytes of ['0', '-1', '1.5', '9007199254740992', '']) {
				expect(() =>
					applyExampleRuntimeEnvironment(
						{},
						{
							[`${prefix}_WORKER_SHA256`]: workerSha256,
							[`${prefix}_WORKER_BYTES`]: bytes
						}
					)
				).toThrow('require a valid receipt');
			}
		}
	);

	it('keeps explicitly supplied debug manifest trust separate from example environment defaults', () => {
		const environment = {
			PUBLIC_WASM_DEBUG_RUNTIME_URL: '/custom/debug/',
			PUBLIC_WASM_DEBUG_RUNTIME_MANIFEST_SHA256: fingerprint
		};
		const configured = applyExampleRuntimeEnvironment({}, environment);
		expect(resolveDebugRuntimeUrls(configured, currentUrl).manifestReceipt).toEqual({
			sha256: fingerprint
		});
		const explicit = applyExampleRuntimeEnvironment(
			{ debug: { baseUrl: '/explicit/debug/' } },
			environment
		);
		expect(explicit.debug).toEqual({ baseUrl: '/explicit/debug/' });
		expect(resolveDebugRuntimeUrls(explicit, currentUrl).manifestReceipt).toBeUndefined();
	});

	it('reads optional environment values during each invocation for reactive example configuration', () => {
		let baseUrl = '/first/java/';
		const environment = {
			get PUBLIC_TEAVM_BASE_URL() {
				return baseUrl;
			}
		};
		expect(applyExampleRuntimeEnvironment({}, environment).java?.baseUrl).toBe('/first/java/');
		baseUrl = '/second/java/';
		expect(applyExampleRuntimeEnvironment({}, environment).java?.baseUrl).toBe('/second/java/');
	});
});
