declare const self: {
	postMessage: (message: any) => void;
};

export interface WorkerRuntimeAssetConfig {
	baseUrl: string;
	maxAssetBytes?: number;
	useAssetBridge: boolean;
}

interface LoadedWorkerAsset {
	bytes: Uint8Array;
	mimeType?: string;
}

interface PendingAssetRequest {
	resolve: (asset: LoadedWorkerAsset) => void;
	reject: (reason?: unknown) => void;
}

const decoder = new TextDecoder();
const DEFAULT_MAX_ASSET_BYTES = 128 * 1024 * 1024;
const DEFAULT_STREAM_BUFFER_BYTES = 64 * 1024;
const originalFetch = globalThis.fetch.bind(globalThis);
const NativeXMLHttpRequest = globalThis.XMLHttpRequest;

let activeConfig: WorkerRuntimeAssetConfig | null = null;
let interceptorsInstalled = false;
let nextAssetRequestId = 0;

const pendingAssetRequests = new Map<number, PendingAssetRequest>();

const cancelResponseBody = (response: Response, reason?: unknown) => {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the validation or HTTP failure that caused cancellation.
	}
};

const configuredBaseUrl = () => {
	if (!activeConfig) return null;
	const locationOrigin = globalThis.location?.origin;
	const locationHref = globalThis.location?.href;
	const fallbackBaseUrl =
		locationOrigin && locationOrigin !== 'null'
			? `${locationOrigin}/`
			: locationHref?.startsWith('blob:')
				? locationHref.slice('blob:'.length)
				: locationHref || 'http://localhost/';
	let baseUrl: URL;
	try {
		baseUrl = new URL(activeConfig.baseUrl, fallbackBaseUrl);
	} catch {
		throw new Error(`Runtime asset base URL is invalid: ${activeConfig.baseUrl}`);
	}
	if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
		throw new Error(`Runtime asset base URL must use HTTP(S): ${activeConfig.baseUrl}`);
	}
	if (baseUrl.username || baseUrl.password || baseUrl.hash || baseUrl.search) {
		throw new Error(
			`Runtime asset base URL must not include credentials, a query, or a fragment: ${activeConfig.baseUrl}`
		);
	}
	if (!baseUrl.pathname.endsWith('/')) {
		baseUrl.pathname += '/';
	}
	return baseUrl;
};

const responseBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const buffer = bytes.buffer as ArrayBuffer;
	return bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength
		? buffer
		: buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const trackedAssetUrl = (input: RequestInfo | URL) => {
	const baseUrl = configuredBaseUrl();
	if (!baseUrl) return null;
	try {
		if (typeof input === 'string') return new URL(input, baseUrl).href;
		if (input instanceof URL) return input.href;
		return input.url;
	} catch {
		return null;
	}
};

const trackedAssetName = (url: string) => {
	const baseUrl = configuredBaseUrl();
	if (!baseUrl) return null;
	let assetUrl: URL;
	try {
		assetUrl = new URL(url, baseUrl);
	} catch {
		return null;
	}
	if (assetUrl.protocol !== 'http:' && assetUrl.protocol !== 'https:') return null;
	if (assetUrl.username || assetUrl.password || assetUrl.hash) return null;
	if (/%2f|%5c/iu.test(assetUrl.pathname)) return null;
	if (assetUrl.origin !== baseUrl.origin || !assetUrl.pathname.startsWith(baseUrl.pathname)) {
		return null;
	}
	return `${assetUrl.pathname.slice(baseUrl.pathname.length)}${assetUrl.search}`;
};

const isTrackedAssetUrl = (url: string) => trackedAssetName(url) !== null;

const loadAssetFromBridge = async (asset: string) => {
	const id = ++nextAssetRequestId;
	return await new Promise<LoadedWorkerAsset>((resolve, reject) => {
		pendingAssetRequests.set(id, { resolve, reject });
		self.postMessage({
			assetRequest: {
				id,
				asset
			}
		});
	});
};

const loadAssetFromUrl = async (url: string, asset: string) => {
	const requestUrl = trackedAssetUrl(url);
	if (!requestUrl || trackedAssetName(requestUrl) !== asset || !activeConfig) {
		throw new Error('Untracked runtime asset request');
	}
	const maxAssetBytes = activeConfig.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
	const response = await originalFetch(requestUrl, {
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer'
	});
	if (response.url) {
		let responseUrl: URL;
		try {
			responseUrl = new URL(response.url);
		} catch {
			const error = new Error(`Runtime asset response URL is invalid: ${response.url}`);
			cancelResponseBody(response, error);
			throw error;
		}
		if (responseUrl.href !== requestUrl) {
			const error = new Error(
				`Runtime asset response URL mismatch: expected ${requestUrl}, received ${responseUrl.href}`
			);
			cancelResponseBody(response, error);
			throw error;
		}
	}
	if (!response.ok) {
		const error = new Error(`Failed to load ${asset}: ${response.status}`);
		cancelResponseBody(response, error);
		throw error;
	}
	const rawContentLength = response.headers.get('content-length');
	let total: number | undefined;
	if (rawContentLength !== null) {
		const parsedContentLength = Number(rawContentLength);
		if (!/^\d+$/u.test(rawContentLength.trim()) || !Number.isSafeInteger(parsedContentLength)) {
			const error = new Error(`Runtime asset ${asset} has an invalid Content-Length`);
			cancelResponseBody(response, error);
			throw error;
		}
		total = parsedContentLength || undefined;
	}
	if (total !== undefined && total > maxAssetBytes) {
		const error = new Error(`Runtime asset ${asset} exceeds the ${maxAssetBytes} byte limit`);
		cancelResponseBody(response, error);
		throw error;
	}
	const mimeType = response.headers.get('content-type') || undefined;
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxAssetBytes) {
			throw new Error(`Runtime asset ${asset} exceeds the ${maxAssetBytes} byte limit`);
		}
		self.postMessage({
			assetProgress: {
				asset,
				loaded: bytes.byteLength,
				total: total ?? bytes.byteLength
			}
		});
		return { bytes, mimeType };
	}

	const reader = response.body.getReader();
	let readerCancelled = false;
	const cancelReader = (reason?: unknown) => {
		if (readerCancelled) return;
		readerCancelled = true;
		try {
			void Promise.resolve(reader.cancel(reason)).catch(() => undefined);
		} catch {
			// Preserve the stream or size-limit failure that caused cancellation.
		}
	};
	let receivedLength = 0;
	let bytes!: Uint8Array<ArrayBuffer>;
	let releaseFailure: { error: unknown } | undefined;
	try {
		bytes = new Uint8Array(total || Math.min(DEFAULT_STREAM_BUFFER_BYTES, maxAssetBytes));
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxAssetBytes) {
				const error = new Error(
					`Runtime asset ${asset} exceeds the ${maxAssetBytes} byte limit`
				);
				cancelReader(error);
				throw error;
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					maxAssetBytes,
					Math.max(nextLength, bytes.byteLength * 2)
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, receivedLength));
				bytes = grown;
			}
			bytes.set(value, receivedLength);
			receivedLength = nextLength;
			self.postMessage({
				assetProgress: {
					asset,
					loaded: receivedLength,
					total
				}
			});
		}
	} catch (error) {
		cancelReader(error);
		throw error;
	} finally {
		try {
			reader.releaseLock();
		} catch (error) {
			releaseFailure = { error };
		}
	}
	if (releaseFailure) throw releaseFailure.error;
	if (receivedLength !== bytes.byteLength) bytes = bytes.slice(0, receivedLength);
	self.postMessage({
		assetProgress: {
			asset,
			loaded: receivedLength,
			total: total ?? receivedLength
		}
	});
	return { bytes, mimeType };
};

async function loadTrackedAsset(url: string): Promise<LoadedWorkerAsset> {
	const asset = trackedAssetName(url);
	if (!asset || !activeConfig) throw new Error('Untracked runtime asset request');
	return activeConfig.useAssetBridge
		? await loadAssetFromBridge(asset)
		: await loadAssetFromUrl(url, asset);
}

function createTrackedResponse(asset: LoadedWorkerAsset) {
	return new Response(responseBuffer(asset.bytes), {
		status: 200,
		headers: asset.mimeType ? { 'Content-Type': asset.mimeType } : undefined
	});
}

function installTrackedFetch() {
	if (typeof NativeXMLHttpRequest === 'undefined') return;

	class RuntimeAssetXMLHttpRequest {
		responseType: XMLHttpRequestResponseType = '';
		response: any = null;
		responseText = '';
		readyState = 0;
		status = 0;
		statusText = '';
		timeout = 0;
		withCredentials = false;
		onload: ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => any) | null = null;
		onerror: ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => any) | null = null;
		onprogress: ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => any) | null = null;
		onreadystatechange: ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => any) | null =
			null;

		private native: XMLHttpRequest | null = null;
		private url = '';

		open(method: string, url: string | URL) {
			const resolvedUrl = trackedAssetUrl(url);
			if (!resolvedUrl || !isTrackedAssetUrl(resolvedUrl)) {
				const nativeUrl = resolvedUrl || (url instanceof URL ? url.href : String(url));
				this.native = new NativeXMLHttpRequest();
				this.native.responseType = this.responseType;
				this.native.timeout = this.timeout;
				this.native.withCredentials = this.withCredentials;
				this.native.onload = (event) => {
					this.response = this.native?.response;
					this.responseText = this.native?.responseText || '';
					this.readyState = this.native?.readyState || 0;
					this.status = this.native?.status || 0;
					this.statusText = this.native?.statusText || '';
					this.onreadystatechange?.call(this as any, event as any);
					this.onload?.call(this as any, event as any);
				};
				this.native.onerror = (event) => {
					this.readyState = this.native?.readyState || 4;
					this.status = this.native?.status || 0;
					this.statusText = this.native?.statusText || '';
					this.onreadystatechange?.call(this as any, event as any);
					this.onerror?.call(this as any, event as any);
				};
				this.native.onprogress = (event) => {
					this.onprogress?.call(this as any, event as any);
				};
				this.native.onreadystatechange = (event) => {
					this.readyState = this.native?.readyState || 0;
					this.onreadystatechange?.call(this as any, event as any);
				};
				this.native.open(method, nativeUrl);
				return;
			}
			this.url = resolvedUrl;
			this.readyState = 1;
			this.onreadystatechange?.call(this as any, new ProgressEvent('readystatechange'));
		}

		setRequestHeader(name: string, value: string) {
			this.native?.setRequestHeader(name, value);
		}

		async send(body?: Document | XMLHttpRequestBodyInit | null) {
			if (this.native) {
				this.native.send(body);
				return;
			}
			try {
				const loaded = await loadTrackedAsset(this.url);
				const buffer = responseBuffer(loaded.bytes);
				this.status = 200;
				this.statusText = 'OK';
				this.readyState = 4;
				if (this.responseType === 'arraybuffer') {
					this.response = buffer;
				} else if (this.responseType === 'blob') {
					this.response = new Blob([buffer], {
						type: loaded.mimeType || 'application/octet-stream'
					});
				} else {
					const text = decoder.decode(loaded.bytes);
					this.responseText = text;
					this.response = text;
				}
				const progressEvent = new ProgressEvent('progress', {
					lengthComputable: true,
					loaded: loaded.bytes.byteLength,
					total: loaded.bytes.byteLength
				});
				this.onprogress?.call(this as any, progressEvent);
				this.onreadystatechange?.call(this as any, new ProgressEvent('readystatechange'));
				this.onload?.call(this as any, new ProgressEvent('load'));
			} catch (error) {
				this.readyState = 4;
				this.status = 0;
				this.statusText = error instanceof Error ? error.message : String(error);
				this.onreadystatechange?.call(this as any, new ProgressEvent('readystatechange'));
				this.onerror?.call(this as any, new ProgressEvent('error'));
			}
		}

		abort() {
			this.native?.abort();
		}

		getAllResponseHeaders() {
			return this.native?.getAllResponseHeaders() || '';
		}

		getResponseHeader(name: string) {
			return this.native?.getResponseHeader(name) || null;
		}
	}

	globalThis.XMLHttpRequest = RuntimeAssetXMLHttpRequest as unknown as typeof XMLHttpRequest;
}

function installRuntimeAssetInterceptors() {
	if (interceptorsInstalled) return;
	interceptorsInstalled = true;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const resolvedUrl = trackedAssetUrl(input);
		if (!resolvedUrl || !isTrackedAssetUrl(resolvedUrl)) return originalFetch(input, init);
		return createTrackedResponse(await loadTrackedAsset(resolvedUrl));
	}) as typeof fetch;
	installTrackedFetch();
}

export function configureWorkerRuntimeAssets(config: WorkerRuntimeAssetConfig | null) {
	if (
		config?.maxAssetBytes !== undefined &&
		(!Number.isSafeInteger(config.maxAssetBytes) || config.maxAssetBytes <= 0)
	) {
		throw new TypeError('Runtime asset maxAssetBytes must be a positive safe integer');
	}
	activeConfig = config;
	installRuntimeAssetInterceptors();
}

export function handleWorkerAssetMessage(data: any) {
	const response = data?.assetResponse;
	if (!response) return false;
	const pending = pendingAssetRequests.get(response.id);
	if (!pending) return true;
	pendingAssetRequests.delete(response.id);
	if (!response.ok) {
		pending.reject(new Error(response.error || 'Runtime asset request failed'));
		return true;
	}
	pending.resolve({
		bytes: new Uint8Array(response.bytes),
		mimeType: response.mimeType || undefined
	});
	return true;
}

export async function loadWorkerRuntimeAsset(asset: string) {
	if (!activeConfig) throw new Error('Runtime asset config unavailable');
	const assetUrl = trackedAssetUrl(asset);
	if (!assetUrl || !isTrackedAssetUrl(assetUrl)) {
		throw new Error('Untracked runtime asset request');
	}
	return await loadTrackedAsset(assetUrl);
}
