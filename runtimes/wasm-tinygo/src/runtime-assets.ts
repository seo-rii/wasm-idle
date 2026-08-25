interface TinyGoRuntimeAssetReceipt {
	bytes: number;
	sha256: string;
	uncompressedBytes?: number;
	uncompressedSha256?: string;
}

export type TinyGoRuntimeAssetLoaderResult =
	| string
	| URL
	| ArrayBuffer
	| Uint8Array
	| Blob
	| {
			url?: string | URL | null;
			data?: string | ArrayBuffer | Uint8Array | Blob | null;
			mimeType?: string;
	  }
	| null
	| undefined;

export type TinyGoRuntimeAssetLoader = (options: {
	assetPath: string;
	assetUrl: string;
	label: string;
	signal?: AbortSignal;
}) => TinyGoRuntimeAssetLoaderResult | Promise<TinyGoRuntimeAssetLoaderResult>;

export type TinyGoRuntimeAssetProgress = {
	assetPath: string;
	assetUrl: string;
	label: string;
	loaded: number;
	total: number | null;
};

export type TinyGoRuntimeAssetProgressCallback = (progress: TinyGoRuntimeAssetProgress) => void;

export type TinyGoRuntimeAssetPackReference = {
	index: string;
	asset: string;
	fileCount: number;
	totalBytes: number;
};

export interface TinyGoRuntimePackIndexEntry {
	runtimePath: string;
	offset: number;
	length: number;
}

export interface TinyGoRuntimePackIndex {
	format: 'wasm-tinygo-runtime-pack-index-v1' | 'wasm-rust-runtime-pack-index-v1';
	fileCount: number;
	totalBytes: number;
	entries: TinyGoRuntimePackIndexEntry[];
}

const runtimePackBytesCache = new Map<string, Promise<Uint8Array>>();
const runtimePackIndexCache = new Map<string, Promise<TinyGoRuntimePackIndex>>();
const cacheIdentityIds = new WeakMap<object, number>();
let nextCacheIdentityId = 0;

export const DEFAULT_MAX_TINYGO_ASSET_BYTES = 128 * 1024 * 1024;
export const MAX_TINYGO_RUNTIME_PACK_FILES = 65_536;
export const MAX_TINYGO_RUNTIME_PATH_LENGTH = 4_096;
const DEFAULT_TINYGO_ASSET_BUFFER_BYTES = 64 * 1024;
const EMCEPTION_BLOB_PUBLIC_PATH_SNIPPET =
	'__webpack_require__.p=new URL("./",self.location.href).href';
const EMCEPTION_BLOB_BASE_URL_SNIPPET = '__webpack_require__.b=self.location+""';
const EMCEPTION_CACHED_LAZY_FILE_SNIPPET =
	'async cachedLazyFile(e,r,t,n){const o=await this._cache;';
const EMCEPTION_CACHED_LAZY_FILE_END_SNIPPET = '}persist(e){';
const EMCEPTION_CACHED_ASSET_READ_SNIPPET =
	'const r=this.readFile(`${o}/${t}`,{encoding:"binary"});this.writeFile(e,r)';
const EMCEPTION_XHR_ASSET_RESULT_SNIPPET =
	'return void 0!==e.response?new Uint8Array(e.response||[]):intArrayFromString(e.responseText||"",!0)';
const EMCEPTION_CACHE_POPULATION_END_SNIPPET =
	'await e.cachedLazyFile(n,...t)}e.exists("/emscripten/cache/cache.lock")';
const EMCEPTION_WASM_FETCH_FALLBACK_SNIPPET =
	'.catch((function(){return getBinary(wasmBinaryFile)}))';
const EMCEPTION_WASM_FETCH_FALLBACK_COUNT = 6;
const EMCEPTION_WASM_ASSET_COUNT = 2;

function cacheIdentity(value: object | undefined) {
	if (!value) return 'none';
	let id = cacheIdentityIds.get(value);
	if (!id) {
		id = ++nextCacheIdentityId;
		cacheIdentityIds.set(value, id);
	}
	return String(id);
}

function runtimePackCacheKey(options: {
	url: string;
	fetchImpl: typeof fetch;
	loader?: TinyGoRuntimeAssetLoader;
	signal?: AbortSignal;
	maxAssetBytes: number;
}) {
	return [
		options.url,
		options.maxAssetBytes,
		cacheIdentity(options.fetchImpl),
		cacheIdentity(options.loader),
		cacheIdentity(options.signal)
	].join('\0');
}

function enforceAssetSize(assetPath: string, bytes: Uint8Array, maxAssetBytes: number) {
	if (bytes.byteLength > maxAssetBytes) {
		throw new Error(
			`wasm-tinygo runtime asset ${assetPath} exceeds the ${maxAssetBytes} byte limit`
		);
	}
	return bytes;
}

async function verifyRuntimeAssetReceipt<Buffer extends ArrayBufferLike>(
	assetLabel: string,
	bytes: Uint8Array<Buffer>,
	receipt: TinyGoRuntimeAssetReceipt | undefined,
	stage: 'storage' | 'logical'
): Promise<Uint8Array<Buffer>> {
	if (!receipt) return bytes;
	const expectedBytes =
		stage === 'logical' ? (receipt.uncompressedBytes ?? receipt.bytes) : receipt.bytes;
	const expectedSha256 =
		stage === 'logical' ? (receipt.uncompressedSha256 ?? receipt.sha256) : receipt.sha256;
	if (bytes.byteLength !== expectedBytes) {
		throw new Error(`${assetLabel} ${stage} byte length differs from its runtime profile`);
	}
	if (!globalThis.crypto?.subtle) {
		throw new Error('wasm-tinygo runtime asset verification requires Web Crypto');
	}
	const digestInput =
		bytes.buffer instanceof ArrayBuffer
			? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			: Uint8Array.from(bytes);
	const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
	const actualSha256 = [...new Uint8Array(digest)]
		.map((value) => value.toString(16).padStart(2, '0'))
		.join('');
	if (actualSha256 !== expectedSha256) {
		throw new Error(`${assetLabel} ${stage} SHA-256 differs from its runtime profile`);
	}
	return bytes;
}

function resolveMaxAssetBytes(maxAssetBytes?: number) {
	const resolved = maxAssetBytes ?? DEFAULT_MAX_TINYGO_ASSET_BYTES;
	if (!Number.isSafeInteger(resolved) || resolved < 0) {
		throw new Error('wasm-tinygo maxAssetBytes must be a non-negative safe integer');
	}
	return resolved;
}

export function createTinyGoCompilerWorkerSource(options: {
	assetBaseUrl: string;
	maxAssetBytes: number;
	source: string;
}) {
	const maxAssetBytes = resolveMaxAssetBytes(options.maxAssetBytes);
	let assetBaseUrl: URL;
	try {
		assetBaseUrl = new URL('./', options.assetBaseUrl);
	} catch {
		throw new Error('wasm-tinygo compiler worker asset base URL must be absolute');
	}
	if (assetBaseUrl.protocol !== 'http:' && assetBaseUrl.protocol !== 'https:') {
		throw new Error(
			`unsupported wasm-tinygo compiler worker asset base URL scheme: ${assetBaseUrl.protocol}`
		);
	}
	if (assetBaseUrl.username || assetBaseUrl.password) {
		throw new Error('wasm-tinygo compiler worker asset base URL must not include credentials');
	}
	const publicPathIndex = options.source.indexOf(EMCEPTION_BLOB_PUBLIC_PATH_SNIPPET);
	if (
		publicPathIndex < 0 ||
		publicPathIndex !== options.source.lastIndexOf(EMCEPTION_BLOB_PUBLIC_PATH_SNIPPET)
	) {
		throw new Error(
			'wasm-tinygo compiler worker does not contain exactly one supported public-path initializer'
		);
	}
	const baseUrlIndex = options.source.indexOf(EMCEPTION_BLOB_BASE_URL_SNIPPET);
	if (
		baseUrlIndex < 0 ||
		baseUrlIndex !== options.source.lastIndexOf(EMCEPTION_BLOB_BASE_URL_SNIPPET)
	) {
		throw new Error(
			'wasm-tinygo compiler worker does not contain exactly one supported base-URL initializer'
		);
	}
	const cachedLazyFileIndex = options.source.indexOf(EMCEPTION_CACHED_LAZY_FILE_SNIPPET);
	if (
		cachedLazyFileIndex < 0 ||
		cachedLazyFileIndex !== options.source.lastIndexOf(EMCEPTION_CACHED_LAZY_FILE_SNIPPET)
	) {
		throw new Error(
			'wasm-tinygo compiler worker does not contain exactly one supported lazy-file initializer'
		);
	}
	const cachedAssetReadIndex = options.source.indexOf(EMCEPTION_CACHED_ASSET_READ_SNIPPET);
	if (
		cachedAssetReadIndex < 0 ||
		cachedAssetReadIndex !== options.source.lastIndexOf(EMCEPTION_CACHED_ASSET_READ_SNIPPET)
	) {
		throw new Error(
			'wasm-tinygo compiler worker does not contain exactly one supported cached-asset read'
		);
	}
	const xhrAssetResultIndex = options.source.indexOf(EMCEPTION_XHR_ASSET_RESULT_SNIPPET);
	if (
		xhrAssetResultIndex < 0 ||
		xhrAssetResultIndex !== options.source.lastIndexOf(EMCEPTION_XHR_ASSET_RESULT_SNIPPET)
	) {
		throw new Error(
			'wasm-tinygo compiler worker does not contain exactly one supported XHR asset result'
		);
	}
	const cachedLazyFileEndIndex = options.source.indexOf(
		EMCEPTION_CACHED_LAZY_FILE_END_SNIPPET,
		cachedLazyFileIndex
	);
	if (
		cachedLazyFileEndIndex < 0 ||
		cachedLazyFileEndIndex !==
			options.source.lastIndexOf(EMCEPTION_CACHED_LAZY_FILE_END_SNIPPET)
	) {
		throw new Error(
			'wasm-tinygo compiler worker does not contain exactly one supported lazy-file boundary'
		);
	}
	const cachePopulationEndIndex = options.source.indexOf(EMCEPTION_CACHE_POPULATION_END_SNIPPET);
	if (
		cachePopulationEndIndex < 0 ||
		cachePopulationEndIndex !==
			options.source.lastIndexOf(EMCEPTION_CACHE_POPULATION_END_SNIPPET)
	) {
		throw new Error(
			'wasm-tinygo compiler worker does not contain exactly one supported cache-population boundary'
		);
	}
	const wasmFetchFallbackCount =
		options.source.split(EMCEPTION_WASM_FETCH_FALLBACK_SNIPPET).length - 1;
	if (wasmFetchFallbackCount !== EMCEPTION_WASM_FETCH_FALLBACK_COUNT) {
		throw new Error(
			`wasm-tinygo compiler worker contains ${wasmFetchFallbackCount} supported Wasm fetch fallbacks; expected ${EMCEPTION_WASM_FETCH_FALLBACK_COUNT}`
		);
	}
	const wasmAssetNames = [
		...options.source.matchAll(/e\.exports=t\.p\+"([^"/\\]+\.wasm)"/gu)
	].map((match) => match[1]);
	if (
		wasmAssetNames.length !== EMCEPTION_WASM_ASSET_COUNT ||
		new Set(wasmAssetNames).size !== EMCEPTION_WASM_ASSET_COUNT
	) {
		throw new Error(
			`wasm-tinygo compiler worker contains ${wasmAssetNames.length} supported Wasm assets; expected ${EMCEPTION_WASM_ASSET_COUNT}`
		);
	}
	const wasmAssetUrls = wasmAssetNames.map((assetName) => new URL(assetName, assetBaseUrl).href);
	const boundedCachedAssetMethod =
		'async cachedLazyFile(e,r,t,n){' +
		'__wasmIdleValidateTinyGoCompilerAssetSize(r,e);' +
		'const o=await this._cache;' +
		'if(this.exists(e)&&this.unlink(e),this.exists(`${o}/${t}`)){' +
		'const n=this.readFile(`${o}/${t}`,{encoding:"binary"});' +
		'__wasmIdleValidateTinyGoCompilerAssetBytes(n,r,e);this.writeFile(e,n)' +
		'}else{' +
		'const a=await __wasmIdleLoadTinyGoCompilerAsset(n,r,e);' +
		'this.writeFile(e,a);this.writeFile(`${o}/${t}`,a)' +
		'}}';
	const workerWithBoundedCachedAssets =
		options.source.slice(0, cachedLazyFileIndex) +
		boundedCachedAssetMethod +
		options.source.slice(cachedLazyFileEndIndex + 1);
	const assetLimitPrelude = `
const __wasmIdleTinyGoCompilerAssetMaxBytes=${maxAssetBytes};
const __wasmIdleTinyGoCompilerAssetBaseUrl=new URL(${JSON.stringify(assetBaseUrl.href)});
const __wasmIdleTinyGoCompilerWasmAssetUrls=new Set(${JSON.stringify(wasmAssetUrls)});
const __wasmIdleTinyGoCompilerFetch=typeof globalThis.fetch==="function"?globalThis.fetch.bind(globalThis):null;
const __wasmIdleCancelTinyGoCompilerAssetBody=(body,reason)=>{try{const pending=body?.cancel(reason);if(pending&&typeof pending.catch==="function")pending.catch(()=>{})}catch{}};
const __wasmIdleValidateTinyGoCompilerAssetSize=(size,label)=>{
	if(!Number.isSafeInteger(size)||size<0)throw new Error("wasm-tinygo compiler asset "+label+" has an invalid declared size");
	if(size>__wasmIdleTinyGoCompilerAssetMaxBytes)throw new Error("wasm-tinygo compiler asset "+label+" exceeds the "+__wasmIdleTinyGoCompilerAssetMaxBytes+" byte limit");
};
const __wasmIdleValidateTinyGoCompilerAssetBytes=(bytes,expectedSize,label)=>{
	__wasmIdleValidateTinyGoCompilerAssetSize(expectedSize,label);
	const size=bytes?.byteLength??bytes?.length;
	if(!Number.isSafeInteger(size)||size<0)throw new Error("wasm-tinygo compiler asset "+label+" has an invalid byte length");
	if(size>__wasmIdleTinyGoCompilerAssetMaxBytes)throw new Error("wasm-tinygo compiler asset "+label+" exceeds the "+__wasmIdleTinyGoCompilerAssetMaxBytes+" byte limit");
	if(size!==expectedSize)throw new Error("wasm-tinygo compiler asset "+label+" expected "+expectedSize+" bytes but received "+size);
	return bytes;
};
const __wasmIdleLoadTinyGoCompilerAsset=async(url,expectedSize,label)=>{
	__wasmIdleValidateTinyGoCompilerAssetSize(expectedSize,label);
	if(!__wasmIdleTinyGoCompilerFetch)throw new Error("wasm-tinygo compiler assets require fetch");
	const resolvedUrl=new URL(url,__wasmIdleTinyGoCompilerAssetBaseUrl);
	if((resolvedUrl.protocol!=="http:"&&resolvedUrl.protocol!=="https:")||resolvedUrl.username||resolvedUrl.password||resolvedUrl.hash||resolvedUrl.origin!==__wasmIdleTinyGoCompilerAssetBaseUrl.origin||!resolvedUrl.pathname.startsWith(__wasmIdleTinyGoCompilerAssetBaseUrl.pathname))throw new Error("wasm-tinygo compiler asset "+label+" is outside the configured asset base");
	const response=await __wasmIdleTinyGoCompilerFetch(resolvedUrl.href,{credentials:"omit",redirect:"error",referrerPolicy:"no-referrer"});
	if(!response.ok){const error=new Error("failed to fetch wasm-tinygo compiler asset "+label+": HTTP "+response.status);__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}
	if(response.url){let finalUrl;try{finalUrl=new URL(response.url).href}catch{const error=new Error("wasm-tinygo compiler asset "+label+" returned an invalid final URL");__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}if(finalUrl!==resolvedUrl.href){const error=new Error("wasm-tinygo compiler asset "+label+" returned an unexpected final URL");__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}}
	const contentLengthValue=response.headers.get("content-length");
	if(contentLengthValue!==null){
		if(!/^\\d+$/.test(contentLengthValue)){const error=new Error("wasm-tinygo compiler asset "+label+" has an invalid Content-Length");__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}
		try{__wasmIdleValidateTinyGoCompilerAssetSize(Number(contentLengthValue),label)}catch(error){__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}
	}
	if(!response.body)throw new Error("wasm-tinygo compiler asset "+label+" did not provide a readable response body");
	let bytes;try{bytes=new Uint8Array(expectedSize)}catch(error){__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}
	let reader;try{reader=response.body.getReader()}catch(error){__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}
	let loaded=0;
	try{
		while(true){
			const {done,value}=await reader.read();
			if(done)break;
			if(!value)continue;
			const nextLength=loaded+value.byteLength;
			if(nextLength>expectedSize)throw new Error("wasm-tinygo compiler asset "+label+" exceeds its declared "+expectedSize+" byte size");
			bytes.set(value,loaded);loaded=nextLength;
		}
	}catch(error){__wasmIdleCancelTinyGoCompilerAssetBody(reader,error);throw error}finally{try{reader.releaseLock()}catch{}}
	return __wasmIdleValidateTinyGoCompilerAssetBytes(bytes.subarray(0,loaded),expectedSize,label);
};
const __wasmIdleBoundedTinyGoCompilerFetch=async(input,init={})=>{
	if(!__wasmIdleTinyGoCompilerFetch)throw new Error("wasm-tinygo compiler assets require fetch");
	if(typeof input!=="string"&&!(input instanceof URL))throw new Error("wasm-tinygo compiler asset request has an invalid URL");
	const inputUrl=String(input);
	const method=String(init?.method??"GET").toUpperCase();
	if(method!=="GET")throw new Error("wasm-tinygo compiler assets only allow GET requests");
	let resolvedUrl;try{resolvedUrl=new URL(inputUrl,__wasmIdleTinyGoCompilerAssetBaseUrl)}catch{throw new Error("wasm-tinygo compiler asset request has an invalid URL")}
	const label="Wasm toolchain asset";
	if((resolvedUrl.protocol!=="http:"&&resolvedUrl.protocol!=="https:")||resolvedUrl.username||resolvedUrl.password||resolvedUrl.hash||resolvedUrl.origin!==__wasmIdleTinyGoCompilerAssetBaseUrl.origin||!resolvedUrl.pathname.startsWith(__wasmIdleTinyGoCompilerAssetBaseUrl.pathname))throw new Error("wasm-tinygo compiler asset request is outside the configured asset base");
	if(!__wasmIdleTinyGoCompilerWasmAssetUrls.has(resolvedUrl.href))throw new Error("wasm-tinygo compiler asset request is not declared by the worker bundle");
	const response=await __wasmIdleTinyGoCompilerFetch(resolvedUrl.href,{...init,method:"GET",credentials:"omit",redirect:"error",referrerPolicy:"no-referrer"});
	if(!response.ok){const error=new Error("failed to fetch wasm-tinygo compiler "+label+": HTTP "+response.status);__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}
	if(response.url){let finalUrl;try{finalUrl=new URL(response.url).href}catch{const error=new Error("wasm-tinygo compiler "+label+" returned an invalid final URL");__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}if(finalUrl!==resolvedUrl.href){const error=new Error("wasm-tinygo compiler "+label+" returned an unexpected final URL");__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}}
	const contentLengthValue=response.headers.get("content-length");
	let contentLength=null;
	if(contentLengthValue!==null){
		if(!/^\\d+$/.test(contentLengthValue)){const error=new Error("wasm-tinygo compiler "+label+" has an invalid Content-Length");__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}
		contentLength=Number(contentLengthValue);
		try{__wasmIdleValidateTinyGoCompilerAssetSize(contentLength,label)}catch(error){__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}
	}
	if(!response.body)throw new Error("wasm-tinygo compiler "+label+" did not provide a readable response body");
	const initialCapacity=Math.min(__wasmIdleTinyGoCompilerAssetMaxBytes,contentLength??65536);
	let bytes;try{bytes=new Uint8Array(initialCapacity)}catch(error){__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}
	let reader;try{reader=response.body.getReader()}catch(error){__wasmIdleCancelTinyGoCompilerAssetBody(response.body,error);throw error}
	let loaded=0;
	try{
		while(true){
			const {done,value}=await reader.read();
			if(done)break;
			if(!value)continue;
			const nextLength=loaded+value.byteLength;
			if(nextLength>__wasmIdleTinyGoCompilerAssetMaxBytes)throw new Error("wasm-tinygo compiler "+label+" exceeds the "+__wasmIdleTinyGoCompilerAssetMaxBytes+" byte limit");
			if(nextLength>bytes.byteLength){const capacity=Math.min(__wasmIdleTinyGoCompilerAssetMaxBytes,Math.max(nextLength,Math.max(bytes.byteLength*2,1)));const grown=new Uint8Array(capacity);grown.set(bytes.subarray(0,loaded));bytes=grown}
			bytes.set(value,loaded);loaded=nextLength;
		}
	}catch(error){__wasmIdleCancelTinyGoCompilerAssetBody(reader,error);throw error}finally{try{reader.releaseLock()}catch{}}
	const headers=new Headers(response.headers);headers.delete("content-length");
	return new Response(bytes.subarray(0,loaded),{status:response.status,statusText:response.statusText,headers});
};
globalThis.fetch=__wasmIdleBoundedTinyGoCompilerFetch;
`;
	return (
		assetLimitPrelude +
		workerWithBoundedCachedAssets
			.replace(
				EMCEPTION_BLOB_PUBLIC_PATH_SNIPPET,
				`__webpack_require__.p=${JSON.stringify(assetBaseUrl.href)}`
			)
			.replace(
				EMCEPTION_BLOB_BASE_URL_SNIPPET,
				`__webpack_require__.b=${JSON.stringify(assetBaseUrl.href)}`
			)
			.replace(
				EMCEPTION_CACHE_POPULATION_END_SNIPPET,
				'await e.cachedLazyFile(n,...t)}await e.push(),e.exists("/emscripten/cache/cache.lock")'
			)
			.split(EMCEPTION_WASM_FETCH_FALLBACK_SNIPPET)
			.join('.catch((function(error){throw error}))')
	);
}

function runtimeAssetAbortReason(signal: AbortSignal) {
	return signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
}

async function runAbortableRuntimeAssetOperation<T>(
	operation: () => T | Promise<T>,
	signal?: AbortSignal,
	onLateResult?: (result: T, reason: unknown) => void | Promise<void>
) {
	if (!signal) return await operation();
	if (signal.aborted) throw runtimeAssetAbortReason(signal);
	let cancelOnAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		cancelOnAbort = () => reject(runtimeAssetAbortReason(signal));
		signal.addEventListener('abort', cancelOnAbort, { once: true });
	});
	let pending: Promise<T> | undefined;
	try {
		pending = Promise.resolve(operation());
		const result = await Promise.race([pending, aborted]);
		if (signal.aborted) throw runtimeAssetAbortReason(signal);
		return result;
	} catch (error) {
		if (signal.aborted) {
			const reason = runtimeAssetAbortReason(signal);
			if (pending && onLateResult) {
				void pending.then((result) => onLateResult(result, reason)).catch(() => {});
			}
			throw reason;
		}
		throw error;
	} finally {
		if (cancelOnAbort) signal.removeEventListener('abort', cancelOnAbort);
	}
}

async function invokeRuntimeAssetLoader(
	loader: TinyGoRuntimeAssetLoader,
	options: Parameters<TinyGoRuntimeAssetLoader>[0]
) {
	return await runAbortableRuntimeAssetOperation(() => loader(options), options.signal);
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-tinygo runtime pack index`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid ${label} in wasm-tinygo runtime pack index`);
	}
	return value;
}

function expectNonNegativeInteger(value: unknown, label: string): number {
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < 0 ||
		!Number.isFinite(value)
	) {
		throw new Error(`invalid ${label} in wasm-tinygo runtime pack index`);
	}
	return value;
}

export function clearTinyGoRuntimePackCache() {
	runtimePackBytesCache.clear();
	runtimePackIndexCache.clear();
}

export function parseTinyGoRuntimePackIndex(value: unknown): TinyGoRuntimePackIndex {
	const root = expectObject(value, 'root');
	if (
		root.format !== 'wasm-tinygo-runtime-pack-index-v1' &&
		root.format !== 'wasm-rust-runtime-pack-index-v1'
	) {
		throw new Error('invalid root.format in wasm-tinygo runtime pack index');
	}
	if (!Array.isArray(root.entries)) {
		throw new Error('invalid root.entries in wasm-tinygo runtime pack index');
	}
	const totalBytes = expectNonNegativeInteger(root.totalBytes, 'root.totalBytes');
	const fileCount = expectNonNegativeInteger(root.fileCount, 'root.fileCount');
	if (fileCount !== root.entries.length) {
		throw new Error('invalid root.fileCount in wasm-tinygo runtime pack index');
	}
	if (fileCount > MAX_TINYGO_RUNTIME_PACK_FILES) {
		throw new Error(
			`invalid root.fileCount in wasm-tinygo runtime pack index: ${fileCount} exceeds ${MAX_TINYGO_RUNTIME_PACK_FILES}`
		);
	}
	const entries = root.entries.map((entry, index) => {
		const object = expectObject(entry, `root.entries[${index}]`);
		const runtimePath = expectString(object.runtimePath, `root.entries[${index}].runtimePath`);
		const expectsAbsolutePath = root.format === 'wasm-rust-runtime-pack-index-v1';
		const pathWithoutRoot = expectsAbsolutePath ? runtimePath.slice(1) : runtimePath;
		const pathSegments = pathWithoutRoot.split('/');
		if (
			runtimePath.length > MAX_TINYGO_RUNTIME_PATH_LENGTH ||
			runtimePath.includes('\0') ||
			runtimePath.includes('\\') ||
			runtimePath.includes('?') ||
			runtimePath.includes('#') ||
			runtimePath.includes('%') ||
			(expectsAbsolutePath ? !runtimePath.startsWith('/') : runtimePath.startsWith('/')) ||
			pathSegments.some(
				(segment, segmentIndex) =>
					segment === '' ||
					segment === '.' ||
					segment === '..' ||
					(segmentIndex === 0 && segment.includes(':'))
			)
		) {
			throw new Error(
				`invalid root.entries[${index}].runtimePath in wasm-tinygo runtime pack index`
			);
		}
		return {
			runtimePath,
			offset: expectNonNegativeInteger(object.offset, `root.entries[${index}].offset`),
			length: expectNonNegativeInteger(object.length, `root.entries[${index}].length`)
		};
	});
	const seenRuntimePaths = new Set<string>();
	let expectedOffset = 0;
	for (const entry of entries) {
		if (seenRuntimePaths.has(entry.runtimePath)) {
			throw new Error(
				`invalid root.entries runtimePath ${entry.runtimePath} in wasm-tinygo runtime pack index`
			);
		}
		seenRuntimePaths.add(entry.runtimePath);
		if (entry.offset > totalBytes || entry.length > totalBytes - entry.offset) {
			throw new Error(
				`invalid runtime pack range for ${entry.runtimePath}: ${entry.offset}+${entry.length} exceeds ${totalBytes}`
			);
		}
		if (entry.offset !== expectedOffset) {
			throw new Error(
				`invalid runtime pack range for ${entry.runtimePath}: expected offset ${expectedOffset} but got ${entry.offset}`
			);
		}
		expectedOffset += entry.length;
	}
	if (expectedOffset !== totalBytes) {
		throw new Error(
			`invalid root.totalBytes in wasm-tinygo runtime pack index: entries cover ${expectedOffset} bytes but expected ${totalBytes}`
		);
	}
	return {
		format: root.format,
		fileCount,
		totalBytes,
		entries
	};
}

async function normalizeLoaderResult(
	result: TinyGoRuntimeAssetLoaderResult,
	assetPath: string,
	maxAssetBytes: number,
	signal?: AbortSignal
): Promise<{ bytes?: Uint8Array; url?: string; mimeType?: string } | null> {
	if (!result) return null;
	if (typeof result === 'string' || result instanceof URL) {
		return { url: String(result) };
	}
	if (result instanceof ArrayBuffer) {
		return { bytes: enforceAssetSize(assetPath, new Uint8Array(result), maxAssetBytes) };
	}
	if (result instanceof Uint8Array) {
		enforceAssetSize(assetPath, result, maxAssetBytes);
		return { bytes: result };
	}
	if (result instanceof Blob) {
		if (result.size > maxAssetBytes) {
			throw new Error(
				`wasm-tinygo runtime asset ${assetPath} exceeds the ${maxAssetBytes} byte limit`
			);
		}
		return {
			bytes: await readBoundedAssetStream({
				stream: result.stream(),
				assetLabel: `wasm-tinygo runtime asset ${assetPath}`,
				maxAssetBytes,
				sizeKind: 'download',
				total: result.size,
				signal
			}),
			mimeType: result.type || undefined
		};
	}
	if (typeof result === 'object') {
		const url = result.url ? String(result.url) : undefined;
		if (url) return { url };
		if (result.data === undefined || result.data === null) return null;
		if (typeof result.data === 'string') {
			if (result.data.length > maxAssetBytes) {
				throw new Error(
					`wasm-tinygo runtime asset ${assetPath} exceeds the ${maxAssetBytes} byte limit`
				);
			}
			return {
				bytes: enforceAssetSize(
					assetPath,
					new TextEncoder().encode(result.data),
					maxAssetBytes
				),
				mimeType: result.mimeType
			};
		}
		if (result.data instanceof ArrayBuffer) {
			return {
				bytes: enforceAssetSize(assetPath, new Uint8Array(result.data), maxAssetBytes),
				mimeType: result.mimeType
			};
		}
		if (result.data instanceof Uint8Array) {
			enforceAssetSize(assetPath, result.data, maxAssetBytes);
			return { bytes: result.data, mimeType: result.mimeType };
		}
		if (result.data.size > maxAssetBytes) {
			throw new Error(
				`wasm-tinygo runtime asset ${assetPath} exceeds the ${maxAssetBytes} byte limit`
			);
		}
		return {
			bytes: await readBoundedAssetStream({
				stream: result.data.stream(),
				assetLabel: `wasm-tinygo runtime asset ${assetPath}`,
				maxAssetBytes,
				sizeKind: 'download',
				total: result.data.size,
				signal
			}),
			mimeType: result.mimeType || result.data.type || undefined
		};
	}
	throw new Error(`unsupported wasm-tinygo asset loader result for ${assetPath}`);
}

async function readBoundedAssetStream(options: {
	stream: ReadableStream<Uint8Array>;
	assetLabel: string;
	maxAssetBytes: number;
	sizeKind: 'download' | 'decompressed';
	total?: number;
	signal?: AbortSignal;
	onChunk?: (loaded: number, total: number | null) => void;
}) {
	const signal = options.signal;
	const reader = options.stream.getReader();
	let readerCancelled = false;
	const cancelReader = (reason?: unknown) => {
		if (readerCancelled) return;
		readerCancelled = true;
		try {
			void Promise.resolve(reader.cancel(reason)).catch(() => {});
		} catch {}
	};
	if (signal?.aborted) {
		const reason = runtimeAssetAbortReason(signal);
		cancelReader(reason);
		try {
			reader.releaseLock();
		} catch {}
		throw reason;
	}
	let cancelOnAbort: (() => void) | undefined;
	const aborted = signal
		? new Promise<never>((_resolve, reject) => {
				cancelOnAbort = () => {
					const reason = runtimeAssetAbortReason(signal);
					cancelReader(reason);
					reject(reason);
				};
				signal.addEventListener('abort', cancelOnAbort, { once: true });
			})
		: undefined;
	let bytes!: Uint8Array<ArrayBuffer>;
	let loaded = 0;
	let loadedBytes!: Uint8Array<ArrayBuffer>;
	let releaseFailure: { error: unknown } | undefined;
	try {
		bytes = new Uint8Array(
			Math.min(options.maxAssetBytes, options.total ?? DEFAULT_TINYGO_ASSET_BUFFER_BYTES)
		);
		while (true) {
			if (signal?.aborted) throw runtimeAssetAbortReason(signal);
			const pendingRead = reader.read();
			const { done, value } = aborted
				? await Promise.race([pendingRead, aborted])
				: await pendingRead;
			if (signal?.aborted) throw runtimeAssetAbortReason(signal);
			if (done) break;
			if (!value) continue;
			const nextLength = loaded + value.byteLength;
			if (nextLength > options.maxAssetBytes) {
				const error = new Error(
					`${options.assetLabel} ${options.sizeKind} size exceeds the ${options.maxAssetBytes} byte limit`
				);
				cancelReader(error);
				throw error;
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					options.maxAssetBytes,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, loaded));
				bytes = grown;
			}
			bytes.set(value, loaded);
			loaded = nextLength;
			options.onChunk?.(loaded, options.total ?? null);
		}
		if (signal?.aborted) {
			throw runtimeAssetAbortReason(signal);
		}
		options.onChunk?.(loaded, options.total ?? loaded);
		loadedBytes = bytes.subarray(0, loaded);
	} catch (error) {
		if (signal?.aborted) {
			const reason = runtimeAssetAbortReason(signal);
			cancelReader(reason);
			throw reason;
		}
		cancelReader(error);
		throw error;
	} finally {
		if (cancelOnAbort) signal?.removeEventListener('abort', cancelOnAbort);
		try {
			reader.releaseLock();
		} catch (error) {
			if (!signal?.aborted) releaseFailure = { error };
		}
	}
	if (signal?.aborted) {
		const reason = runtimeAssetAbortReason(signal);
		cancelReader(reason);
		throw reason;
	}
	if (releaseFailure) throw releaseFailure.error;
	return loadedBytes;
}

async function fetchRuntimeAssetBytes(
	assetUrl: string,
	assetLabel: string,
	fetchImpl: typeof fetch,
	options: {
		allowCompressedFallback?: boolean;
		onProgress?: TinyGoRuntimeAssetProgressCallback;
		signal?: AbortSignal;
		maxAssetBytes: number;
		receipt?: TinyGoRuntimeAssetReceipt;
	}
): Promise<Uint8Array<ArrayBuffer>> {
	let resolvedAssetUrlObject: URL;
	try {
		resolvedAssetUrlObject = new URL(assetUrl, globalThis.location?.href);
	} catch {
		throw new Error('wasm-tinygo runtime asset URLs must be absolute outside a browser');
	}
	if (
		resolvedAssetUrlObject.protocol !== 'http:' &&
		resolvedAssetUrlObject.protocol !== 'https:'
	) {
		throw new Error(
			`unsupported wasm-tinygo runtime asset URL scheme: ${resolvedAssetUrlObject.protocol}`
		);
	}
	if (resolvedAssetUrlObject.username || resolvedAssetUrlObject.password) {
		throw new Error('wasm-tinygo runtime asset URLs must not include credentials');
	}
	if (resolvedAssetUrlObject.hash) {
		throw new Error('wasm-tinygo runtime asset URLs must not include fragments');
	}
	if (options.signal?.aborted) {
		throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
	}
	const resolvedAssetUrl = resolvedAssetUrlObject.href;
	const emitProgress = (loaded: number, total: number | null) => {
		if (!options.onProgress) return;
		try {
			options.onProgress({
				assetPath: resolvedAssetUrlObject.pathname.replace(/^\/+/, ''),
				assetUrl: resolvedAssetUrl,
				label: assetLabel,
				loaded,
				total
			});
		} catch {}
	};
	let response: Response;
	try {
		response = await runAbortableRuntimeAssetOperation(
			() =>
				fetchImpl(resolvedAssetUrl, {
					credentials: 'omit',
					redirect: 'error',
					referrerPolicy: 'no-referrer',
					signal: options.signal
				}),
			options.signal,
			async (lateResponse, reason) => {
				await lateResponse.body?.cancel(reason).catch(() => {});
			}
		);
	} catch (error) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
		}
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}. This usually means the browser loaded a stale wasm-tinygo bundle or blocked a nested runtime asset request; hard refresh and resync the runtime assets.`
		);
	}
	if (response.url) {
		let finalUrl: string;
		try {
			finalUrl = new URL(response.url).href;
		} catch {
			try {
				void response.body?.cancel().catch(() => {});
			} catch {}
			throw new Error(
				`wasm-tinygo runtime asset ${assetLabel} returned an invalid final URL`
			);
		}
		if (finalUrl !== resolvedAssetUrl) {
			try {
				void response.body?.cancel().catch(() => {});
			} catch {}
			throw new Error(
				`wasm-tinygo runtime asset ${assetLabel} returned an unexpected final URL`
			);
		}
	}
	const contentLengthValue = response.headers.get('content-length');
	let contentLength: number | undefined;
	if (contentLengthValue !== null) {
		contentLength = Number(contentLengthValue);
		if (!/^\d+$/u.test(contentLengthValue) || !Number.isSafeInteger(contentLength)) {
			try {
				void response.body?.cancel().catch(() => {});
			} catch {}
			throw new Error(
				`wasm-tinygo runtime asset ${assetLabel} has an invalid Content-Length`
			);
		}
	}
	if (contentLength !== undefined && contentLength > options.maxAssetBytes) {
		try {
			void response.body?.cancel().catch(() => {});
		} catch {}
		throw new Error(
			`${assetLabel} download size exceeds the ${options.maxAssetBytes} byte limit`
		);
	}
	let assetBytes: Uint8Array<ArrayBuffer>;
	if (response.body) {
		assetBytes = await readBoundedAssetStream({
			stream: response.body,
			assetLabel,
			maxAssetBytes: options.maxAssetBytes,
			sizeKind: 'download',
			total: contentLength,
			signal: options.signal,
			onChunk: emitProgress
		});
	} else {
		assetBytes = new Uint8Array();
		emitProgress(0, contentLength ?? 0);
	}
	const assetPreview = new TextDecoder()
		.decode(assetBytes.subarray(0, 128))
		.replace(/^\uFEFF/, '')
		.trimStart()
		.toLowerCase();
	const responseLooksLikeHtml =
		assetPreview.startsWith('<!doctype html') ||
		assetPreview.startsWith('<html') ||
		assetPreview.startsWith('<head') ||
		assetPreview.startsWith('<body');
	if (
		(options.allowCompressedFallback ?? true) &&
		!resolvedAssetUrlObject.pathname.endsWith('.gz') &&
		(!response.ok || responseLooksLikeHtml)
	) {
		const compressedAssetUrl = new URL(resolvedAssetUrl);
		compressedAssetUrl.pathname = `${compressedAssetUrl.pathname}.gz`;
		try {
			return await fetchRuntimeAssetBytes(
				compressedAssetUrl.toString(),
				assetLabel,
				fetchImpl,
				{
					...options,
					allowCompressedFallback: false
				}
			);
		} catch (error) {
			if (options.signal?.aborted) throw error;
		}
	}
	if (!response.ok) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status}). This usually means the browser loaded a stale wasm-tinygo bundle or a nested runtime asset is missing.`
		);
	}
	if (responseLooksLikeHtml) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: expected a wasm-tinygo runtime asset but got HTML instead. This usually means the browser loaded a stale or wrong wasm-tinygo bundle, or the host rewrote a missing nested asset request to index.html; hard refresh and resync the runtime assets.`
		);
	}
	if (!resolvedAssetUrlObject.pathname.endsWith('.gz')) {
		return await verifyRuntimeAssetReceipt(assetLabel, assetBytes, options.receipt, 'logical');
	}
	if (assetBytes.byteLength < 2 || assetBytes[0] !== 0x1f || assetBytes[1] !== 0x8b) {
		return await verifyRuntimeAssetReceipt(assetLabel, assetBytes, options.receipt, 'logical');
	}
	await verifyRuntimeAssetReceipt(assetLabel, assetBytes, options.receipt, 'storage');
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: this browser does not support DecompressionStream('gzip').`
		);
	}
	try {
		const decompressed = new Blob([
			assetBytes.buffer.slice(
				assetBytes.byteOffset,
				assetBytes.byteOffset + assetBytes.byteLength
			)
		])
			.stream()
			.pipeThrough(new DecompressionStream('gzip'));
		const logicalBytes = await readBoundedAssetStream({
			stream: decompressed,
			assetLabel,
			maxAssetBytes: options.maxAssetBytes,
			sizeKind: 'decompressed',
			signal: options.signal
		});
		return await verifyRuntimeAssetReceipt(
			assetLabel,
			logicalBytes,
			options.receipt,
			'logical'
		);
	} catch (error) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
		}
		throw new Error(
			`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

async function loadRuntimePackBytes(
	assetBaseUrl: string,
	pack: TinyGoRuntimeAssetPackReference,
	fetchImpl: typeof fetch,
	loader?: TinyGoRuntimeAssetLoader,
	onProgress?: TinyGoRuntimeAssetProgressCallback,
	signal?: AbortSignal,
	maxAssetBytes = DEFAULT_MAX_TINYGO_ASSET_BYTES
) {
	const assetUrl = new URL(pack.asset, assetBaseUrl).toString();
	const cacheKey = runtimePackCacheKey({
		url: assetUrl,
		fetchImpl,
		loader,
		signal,
		maxAssetBytes
	});
	let cachedBytes = runtimePackBytesCache.get(cacheKey);
	if (!cachedBytes) {
		cachedBytes = loadRuntimeAssetBytes({
			assetPath: pack.asset,
			assetUrl,
			label: `wasm-tinygo runtime pack ${pack.asset}`,
			fetchImpl,
			loader,
			packs: null,
			onProgress,
			signal,
			maxAssetBytes
		});
		runtimePackBytesCache.set(cacheKey, cachedBytes);
		cachedBytes.catch(() => {
			if (runtimePackBytesCache.get(cacheKey) === cachedBytes) {
				runtimePackBytesCache.delete(cacheKey);
			}
		});
	}
	return cachedBytes;
}

async function loadRuntimePackIndex(
	assetBaseUrl: string,
	pack: TinyGoRuntimeAssetPackReference,
	fetchImpl: typeof fetch,
	loader?: TinyGoRuntimeAssetLoader,
	onProgress?: TinyGoRuntimeAssetProgressCallback,
	signal?: AbortSignal,
	maxAssetBytes = DEFAULT_MAX_TINYGO_ASSET_BYTES
) {
	const indexUrl = new URL(pack.index, assetBaseUrl).toString();
	const cacheKey = runtimePackCacheKey({
		url: indexUrl,
		fetchImpl,
		loader,
		signal,
		maxAssetBytes
	});
	let cachedIndex = runtimePackIndexCache.get(cacheKey);
	if (!cachedIndex) {
		cachedIndex = loadRuntimeAssetBytes({
			assetPath: pack.index,
			assetUrl: indexUrl,
			label: `wasm-tinygo runtime pack index ${pack.index}`,
			fetchImpl,
			loader,
			packs: null,
			assetBaseUrl,
			onProgress,
			signal,
			maxAssetBytes
		}).then((value) =>
			parseTinyGoRuntimePackIndex(JSON.parse(new TextDecoder().decode(value)))
		);
		runtimePackIndexCache.set(cacheKey, cachedIndex);
		cachedIndex.catch(() => {
			if (runtimePackIndexCache.get(cacheKey) === cachedIndex) {
				runtimePackIndexCache.delete(cacheKey);
			}
		});
	}
	return cachedIndex;
}

async function loadRuntimePackEntries(
	assetBaseUrl: string,
	pack: TinyGoRuntimeAssetPackReference,
	fetchImpl: typeof fetch,
	loader?: TinyGoRuntimeAssetLoader,
	onProgress?: TinyGoRuntimeAssetProgressCallback,
	signal?: AbortSignal,
	maxAssetBytes = DEFAULT_MAX_TINYGO_ASSET_BYTES
): Promise<Map<string, Uint8Array>> {
	if (typeof pack.index !== 'string' || pack.index.length === 0 || pack.index.includes('\0')) {
		throw new Error('invalid wasm-tinygo runtime pack index reference');
	}
	if (typeof pack.asset !== 'string' || pack.asset.length === 0 || pack.asset.includes('\0')) {
		throw new Error(`invalid wasm-tinygo runtime pack asset reference for ${pack.index}`);
	}
	if (
		typeof pack.fileCount !== 'number' ||
		!Number.isSafeInteger(pack.fileCount) ||
		pack.fileCount < 0 ||
		pack.fileCount > MAX_TINYGO_RUNTIME_PACK_FILES
	) {
		throw new Error(`invalid wasm-tinygo runtime pack fileCount for ${pack.index}`);
	}
	if (
		typeof pack.totalBytes !== 'number' ||
		!Number.isSafeInteger(pack.totalBytes) ||
		pack.totalBytes < 0
	) {
		throw new Error(`invalid wasm-tinygo runtime pack totalBytes for ${pack.index}`);
	}
	if (pack.totalBytes > maxAssetBytes) {
		throw new Error(
			`wasm-tinygo runtime pack ${pack.asset} exceeds the ${maxAssetBytes} byte limit`
		);
	}
	const [index, packBytes] = await Promise.all([
		loadRuntimePackIndex(
			assetBaseUrl,
			pack,
			fetchImpl,
			loader,
			onProgress,
			signal,
			maxAssetBytes
		),
		loadRuntimePackBytes(
			assetBaseUrl,
			pack,
			fetchImpl,
			loader,
			onProgress,
			signal,
			maxAssetBytes
		)
	]);
	if (index.fileCount !== pack.fileCount) {
		throw new Error(
			`invalid wasm-tinygo runtime pack ${pack.index}: expected ${pack.fileCount} files but got ${index.fileCount}`
		);
	}
	if (index.totalBytes !== pack.totalBytes) {
		throw new Error(
			`invalid wasm-tinygo runtime pack ${pack.index}: expected ${pack.totalBytes} bytes but got ${index.totalBytes}`
		);
	}
	if (packBytes.byteLength !== index.totalBytes) {
		throw new Error(
			`invalid wasm-tinygo runtime pack ${pack.asset}: expected exactly ${index.totalBytes} bytes but got ${packBytes.byteLength}`
		);
	}
	const entries = new Map<string, Uint8Array>();
	for (const entry of index.entries) {
		entries.set(
			entry.runtimePath,
			packBytes.subarray(entry.offset, entry.offset + entry.length)
		);
	}
	return entries;
}

export async function loadRuntimeAssetBytes(options: {
	assetPath: string;
	assetUrl: string;
	label: string;
	fetchImpl?: typeof fetch;
	loader?: TinyGoRuntimeAssetLoader;
	assetBaseUrl?: string;
	packs?: TinyGoRuntimeAssetPackReference[] | null;
	receipt?: TinyGoRuntimeAssetReceipt;
	onProgress?: TinyGoRuntimeAssetProgressCallback;
	signal?: AbortSignal;
	maxAssetBytes?: number;
}): Promise<Uint8Array> {
	const maxAssetBytes = resolveMaxAssetBytes(options.maxAssetBytes);
	if (options.signal?.aborted) {
		throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
	}
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	if (!fetchImpl) {
		throw new Error('wasm-tinygo runtime asset loading requires fetch');
	}
	const loader = options.loader;
	if (options.packs?.length) {
		if (!options.assetBaseUrl) {
			throw new Error('wasm-tinygo asset packs require assetBaseUrl');
		}
		for (const pack of options.packs) {
			const entries = await loadRuntimePackEntries(
				options.assetBaseUrl,
				pack,
				fetchImpl,
				loader,
				options.onProgress,
				options.signal,
				maxAssetBytes
			);
			const packed = entries.get(options.assetPath);
			if (packed) {
				return await verifyRuntimeAssetReceipt(
					options.label,
					packed,
					options.receipt,
					'logical'
				);
			}
		}
	}
	if (loader) {
		const normalized = await normalizeLoaderResult(
			await invokeRuntimeAssetLoader(loader, {
				assetPath: options.assetPath,
				assetUrl: options.assetUrl,
				label: options.label,
				signal: options.signal
			}),
			options.assetPath,
			maxAssetBytes,
			options.signal
		);
		if (normalized?.bytes) {
			return await verifyRuntimeAssetReceipt(
				options.label,
				normalized.bytes,
				options.receipt,
				'logical'
			);
		}
		if (normalized?.url) {
			return await fetchRuntimeAssetBytes(normalized.url, options.label, fetchImpl, {
				allowCompressedFallback: true,
				onProgress: options.onProgress,
				signal: options.signal,
				maxAssetBytes,
				receipt: options.receipt
			});
		}
	}
	return await fetchRuntimeAssetBytes(options.assetUrl, options.label, fetchImpl, {
		allowCompressedFallback: true,
		onProgress: options.onProgress,
		signal: options.signal,
		maxAssetBytes,
		receipt: options.receipt
	});
}

export async function resolveRuntimeAssetUrl(options: {
	assetPath: string;
	assetUrl: string;
	label: string;
	loader?: TinyGoRuntimeAssetLoader;
	signal?: AbortSignal;
	maxAssetBytes?: number;
}): Promise<string> {
	const maxAssetBytes = resolveMaxAssetBytes(options.maxAssetBytes);
	if (options.signal?.aborted) {
		throw options.signal.reason ?? new Error('wasm-tinygo runtime asset load was aborted');
	}
	const loader = options.loader;
	if (!loader) return options.assetUrl;
	const normalized = await normalizeLoaderResult(
		await invokeRuntimeAssetLoader(loader, {
			assetPath: options.assetPath,
			assetUrl: options.assetUrl,
			label: options.label,
			signal: options.signal
		}),
		options.assetPath,
		maxAssetBytes,
		options.signal
	);
	if (!normalized) return options.assetUrl;
	if (normalized.url) return normalized.url;
	throw new Error(
		`wasm-tinygo asset loader returned bytes for ${options.assetPath}; worker assets must be provided as URLs`
	);
}
