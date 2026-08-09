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
const WASM_FETCH_FALLBACK_SNIPPET = '.catch((function(){return getBinary(wasmBinaryFile)}))';
const WASM_ASSET_SNIPPETS = 'e.exports=t.p+"tool-a.wasm";e.exports=t.p+"tool-b.wasm";';

const createWorkerSource = () =>
	`${WASM_ASSET_SNIPPETS}${PUBLIC_PATH_SNIPPET};${BASE_URL_SNIPPET};${CACHED_LAZY_FILE_SNIPPET}${CACHED_ASSET_READ_SNIPPET};${XHR_ASSET_RESULT_SNIPPET};}persist(e){};${CACHE_POPULATION_END_SNIPPET};${WASM_FETCH_FALLBACK_SNIPPET.repeat(6)}`;

const createWorkerAssetValidators = (maxAssetBytes = 8) => {
	const source = createTinyGoCompilerWorkerSource({
		assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
		maxAssetBytes,
		source: createWorkerSource()
	});
	const prelude = source.slice(0, source.indexOf(WASM_ASSET_SNIPPETS));
	const createValidators = new Function(
		`${prelude}return { boundedFetch: __wasmIdleBoundedTinyGoCompilerFetch, loadAsset: __wasmIdleLoadTinyGoCompilerAsset, validateBytes: __wasmIdleValidateTinyGoCompilerAssetBytes, validateSize: __wasmIdleValidateTinyGoCompilerAssetSize };`
	) as () => {
		boundedFetch(input: string | URL, init?: RequestInit): Promise<Response>;
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
		expect(source).toContain('globalThis.fetch=__wasmIdleBoundedTinyGoCompilerFetch;');
		expect(source).not.toContain(WASM_FETCH_FALLBACK_SNIPPET);
		expect(source.match(/\.catch\(\(function\(error\)\{throw error\}\)\)/gu)).toHaveLength(6);
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

		const wasmResponse = await validators.boundedFetch(
			'https://runtime.invalid/vendor/emception/tool-a.wasm',
			{ credentials: 'same-origin' }
		);
		await expect(wasmResponse.arrayBuffer()).resolves.toEqual(
			new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer
		);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://runtime.invalid/vendor/emception/tool-a.wasm',
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

	it('bounds Wasm fetches without waiting for stalled stream cleanup', async () => {
		let cancelled = false;
		const fetchMock = vi.fn(
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
		);
		vi.stubGlobal('fetch', fetchMock);
		const validators = createWorkerAssetValidators();

		await expect(
			validators.boundedFetch('https://runtime.invalid/vendor/emception/tool-a.wasm')
		).rejects.toThrow('exceeds the 8 byte limit');
		expect(cancelled).toBe(true);
		await expect(validators.boundedFetch('https://attacker.invalid/tool.wasm')).rejects.toThrow(
			'outside the configured asset base'
		);
		await expect(
			validators.boundedFetch('https://runtime.invalid/vendor/emception/undeclared.wasm')
		).rejects.toThrow('not declared by the worker bundle');
		expect(fetchMock).toHaveBeenCalledOnce();
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
		expect(() =>
			createTinyGoCompilerWorkerSource({
				assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
				maxAssetBytes: 8,
				source: createWorkerSource().replace(WASM_FETCH_FALLBACK_SNIPPET, '')
			})
		).toThrow('contains 5 supported Wasm fetch fallbacks; expected 6');
		expect(() =>
			createTinyGoCompilerWorkerSource({
				assetBaseUrl: 'https://runtime.invalid/vendor/emception/',
				maxAssetBytes: 8,
				source: createWorkerSource().replace(
					WASM_ASSET_SNIPPETS,
					'e.exports=t.p+"tool-a.wasm";'
				)
			})
		).toThrow('contains 1 supported Wasm assets; expected 2');
	});
});
