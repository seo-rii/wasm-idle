import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTinyGoCompilerWorkerSource } from '../../../runtimes/wasm-tinygo/src/runtime-assets';

const PUBLIC_PATH_SNIPPET = '__webpack_require__.p=new URL("./",self.location.href).href';
const BASE_URL_SNIPPET = '__webpack_require__.b=self.location+""';
const CACHED_LAZY_FILE_SNIPPET = 'async cachedLazyFile(e,r,t,n){const o=await this._cache;';
const CACHED_ASSET_READ_SNIPPET =
	'const r=this.readFile(`${o}/${t}`,{encoding:"binary"});this.writeFile(e,r)';
const XHR_ASSET_RESULT_SNIPPET =
	'return void 0!==e.response?new Uint8Array(e.response||[]):intArrayFromString(e.responseText||"",!0)';
const CACHE_POPULATION_END_SNIPPET =
	'await e.cachedLazyFile(n,...t)}e.exists("/emscripten/cache/cache.lock")';

const createWorkerSource = () =>
	`${PUBLIC_PATH_SNIPPET};${BASE_URL_SNIPPET};${CACHED_LAZY_FILE_SNIPPET}${CACHED_ASSET_READ_SNIPPET};${XHR_ASSET_RESULT_SNIPPET};}persist(e){};${CACHE_POPULATION_END_SNIPPET}`;

const createWorkerAssetValidators = (maxAssetBytes = 8) => {
	const source = createTinyGoCompilerWorkerSource({
		assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
		maxAssetBytes,
		source: createWorkerSource()
	});
	const prelude = source.slice(0, source.indexOf('__webpack_require__.p='));
	const createValidators = new Function(
		`${prelude}return { loadAsset: __wasmIdleLoadTinyGoCompilerAsset, validateBytes: __wasmIdleValidateTinyGoCompilerAssetBytes, validateSize: __wasmIdleValidateTinyGoCompilerAssetSize };`
	) as () => {
		loadAsset(url: string, expectedSize: number, label: string): Promise<Uint8Array>;
		validateBytes(
			bytes: ArrayBufferView | number[],
			expectedSize: number,
			label: string
		): unknown;
		validateSize(size: number, label: string): void;
	};
	return createValidators();
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('TinyGo compiler worker asset base', () => {
	it('rewrites both webpack URL bases for blob worker execution', () => {
		const source = createTinyGoCompilerWorkerSource({
			assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
			maxAssetBytes: 8,
			source: createWorkerSource()
		});

		expect(source).toContain(
			'__webpack_require__.p="https://runtime.invalid/vendor/emception/"'
		);
		expect(source).toContain(
			'__webpack_require__.b="https://runtime.invalid/vendor/emception/"'
		);
		expect(source).not.toContain('self.location');
		expect(source).toContain('const __wasmIdleTinyGoCompilerAssetMaxBytes=8;');
		expect(source).toContain(
			'async cachedLazyFile(e,r,t,n){__wasmIdleValidateTinyGoCompilerAssetSize(r,e);'
		);
		expect(source).toContain(
			'__wasmIdleValidateTinyGoCompilerAssetBytes(n,r,e);this.writeFile(e,n)'
		);
		expect(source).toContain('const a=await __wasmIdleLoadTinyGoCompilerAsset(n,r,e)');
		expect(source).toContain(
			'await e.cachedLazyFile(n,...t)}await e.push(),e.exists("/emscripten/cache/cache.lock")'
		);
		expect(source).not.toContain('new XMLHttpRequest');
	});

	it('rejects oversized declared, downloaded, and cached compiler assets', () => {
		const validators = createWorkerAssetValidators();

		expect(() => validators.validateSize(9, '/toolchain/oversized.a')).toThrow(
			'exceeds the 8 byte limit'
		);
		expect(() => validators.validateBytes(new Uint8Array(9), 9, 'downloaded.a')).toThrow(
			'exceeds the 8 byte limit'
		);
		expect(() => validators.validateBytes(new Array(9).fill(0), 9, 'fallback.a')).toThrow(
			'exceeds the 8 byte limit'
		);
		expect(validators.validateBytes(new Uint8Array(8), 8, 'cached.a')).toHaveLength(8);
	});

	it('streams compiler assets into their declared-size buffer', async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), {
					headers: { 'content-length': '8' }
				})
		);
		vi.stubGlobal('fetch', fetchMock);
		const validators = createWorkerAssetValidators();

		await expect(
			validators.loadAsset(
				'https://runtime.invalid/vendor/emception/toolchain.a',
				8,
				'toolchain.a'
			)
		).resolves.toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
		expect(fetchMock).toHaveBeenCalledWith(
			'https://runtime.invalid/vendor/emception/toolchain.a',
			expect.objectContaining({ credentials: 'omit', redirect: 'error' })
		);
	});

	it('cancels a compiler asset stream that exceeds its declared size', async () => {
		let cancelled = false;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(new Uint8Array(9));
							},
							cancel() {
								cancelled = true;
								return new Promise<void>(() => {});
							}
						})
					)
			)
		);
		const validators = createWorkerAssetValidators();

		await expect(
			validators.loadAsset(
				'https://runtime.invalid/vendor/emception/oversized.a',
				8,
				'oversized.a'
			)
		).rejects.toThrow('exceeds its declared 8 byte size');
		expect(cancelled).toBe(true);
	});

	it('rejects worker layouts whose URL initializers cannot be patched exactly once', () => {
		expect(() =>
			createTinyGoCompilerWorkerSource({
				assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
				maxAssetBytes: 8,
				source: PUBLIC_PATH_SNIPPET
			})
		).toThrow('base-URL initializer');
		expect(() =>
			createTinyGoCompilerWorkerSource({
				assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
				maxAssetBytes: 8,
				source: `${PUBLIC_PATH_SNIPPET};${PUBLIC_PATH_SNIPPET};${BASE_URL_SNIPPET}`
			})
		).toThrow('public-path initializer');
		expect(() =>
			createTinyGoCompilerWorkerSource({
				assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
				maxAssetBytes: 8,
				source: `${PUBLIC_PATH_SNIPPET};${BASE_URL_SNIPPET}`
			})
		).toThrow('lazy-file initializer');
	});
});
