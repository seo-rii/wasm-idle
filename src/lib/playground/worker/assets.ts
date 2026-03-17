declare const self: DedicatedWorkerGlobalScope & {
	postMessage: (message: any) => void;
};

export interface WorkerRuntimeAssetConfig {
	baseUrl: string;
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
const originalFetch = globalThis.fetch.bind(globalThis);
const NativeXMLHttpRequest = globalThis.XMLHttpRequest;

let activeConfig: WorkerRuntimeAssetConfig | null = null;
let interceptorsInstalled = false;
let nextAssetRequestId = 0;

const pendingAssetRequests = new Map<number, PendingAssetRequest>();

const responseBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const buffer = bytes.buffer as ArrayBuffer;
	return bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength
		? buffer
		: buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const trackedAssetUrl = (input: RequestInfo | URL) => {
	if (!activeConfig) return null;
	if (typeof input === 'string') return new URL(input, activeConfig.baseUrl).href;
	if (input instanceof URL) return input.href;
	return input.url;
};

const trackedAssetName = (url: string) => {
	if (!activeConfig || !url.startsWith(activeConfig.baseUrl)) return null;
	return url.slice(activeConfig.baseUrl.length);
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
	const response = await originalFetch(url);
	if (!response.ok) throw new Error(`Failed to load ${asset}: ${response.status}`);
	const total = Number(response.headers.get('content-length') || 0) || undefined;
	const mimeType = response.headers.get('content-type') || undefined;
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
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
	let receivedLength = 0;
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		const chunk = Uint8Array.from(value);
		chunks.push(chunk);
		receivedLength += chunk.byteLength;
		self.postMessage({
			assetProgress: {
				asset,
				loaded: receivedLength,
				total
			}
		});
	}
	const bytes = new Uint8Array(receivedLength);
	let position = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, position);
		position += chunk.byteLength;
	}
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
	return await loadTrackedAsset(new URL(asset, activeConfig.baseUrl).href);
}
