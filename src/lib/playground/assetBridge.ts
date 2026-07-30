import {
	RUNTIME_LOAD_ASSETS,
	type ResolvedRuntimeAssetConfig,
	type RuntimeAssetLoaderResult,
	type RuntimeAssetRuntime
} from '$lib/playground/assets';
import {
	ProtocolError,
	verifyRuntimeAssetIntegrity,
	verifyRuntimeAssetPair
} from '@wasm-idle/core';
import { decompressGzip } from '@wasm-idle/llvm-core';

type ProgressLike = { set?: (value: number) => void };

interface AssetRequestMessage {
	id: number;
	asset: string;
}

interface AssetProgressMessage {
	asset: string;
	loaded: number;
	total?: number;
}

type LoadedAsset = {
	bytes: Uint8Array;
	contentEncoding?: string;
	mimeType?: string;
	transferOwnership?: boolean;
};

const encoder = new TextEncoder();
const DEFAULT_STREAM_BUFFER_BYTES = 64 * 1024;
const MAX_RUNTIME_ASSET_BYTES = 128 * 1024 * 1024;

const runtimeAssetAbortReason = (signal: AbortSignal) =>
	signal.reason ?? new DOMException('Runtime asset load aborted', 'AbortError');

const transferBuffer = (bytes: Uint8Array, transferOwnership = false) =>
	transferOwnership &&
	bytes.byteOffset === 0 &&
	bytes.byteLength === bytes.buffer.byteLength &&
	bytes.buffer instanceof ArrayBuffer
		? bytes.buffer
		: Uint8Array.from(bytes).buffer;

const expectedAssetsForRuntime = (runtime: RuntimeAssetRuntime) =>
	new Set<string>(RUNTIME_LOAD_ASSETS[runtime]);

const integrityKey = (config: ResolvedRuntimeAssetConfig) =>
	JSON.stringify(
		Object.entries(config.integrity || {})
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([asset, entry]) => [
				asset,
				typeof entry === 'string'
					? entry
					: {
							sha256: entry.sha256,
							bytes: entry.bytes,
							mediaType: entry.mediaType,
							uncompressedSha256: entry.uncompressedSha256,
							uncompressedBytes: entry.uncompressedBytes
						}
			])
	);

const allowedBaseUrlsKey = (config: ResolvedRuntimeAssetConfig) =>
	JSON.stringify([...(config.allowedBaseUrls || [])].sort());

class RuntimeLoadProgress {
	private readonly fractions = new Map<string, number>();
	private readonly expectedAssets: Set<string>;
	private progress?: ProgressLike;

	constructor(runtime: RuntimeAssetRuntime) {
		this.expectedAssets = expectedAssetsForRuntime(runtime);
		this.reset();
	}

	reset(progress?: ProgressLike) {
		this.progress = progress;
		this.fractions.clear();
		for (const asset of this.expectedAssets) this.fractions.set(asset, 0);
		this.emit();
	}

	update(asset: string, loaded: number, total?: number) {
		if (!this.expectedAssets.has(asset)) return;
		if (!total || total <= 0) return;
		const fraction = Math.min(loaded / total, 1);
		this.fractions.set(asset, fraction);
		this.emit();
	}

	private emit() {
		if (!this.progress) return;
		if (!this.fractions.size) return this.progress.set?.(0);
		let total = 0;
		for (const fraction of this.fractions.values()) total += fraction;
		this.progress.set?.(total / this.fractions.size);
	}
}

export class WorkerAssetBridge {
	private worker: Worker;
	private readonly runtime: RuntimeAssetRuntime;
	private config: ResolvedRuntimeAssetConfig;
	private readonly progress: RuntimeLoadProgress;
	private readonly expectedAssets: Set<string>;
	private generation = 0;
	private readonly activeLoads = new Set<AbortController>();

	constructor(
		worker: Worker,
		runtime: RuntimeAssetRuntime,
		config: ResolvedRuntimeAssetConfig,
		progress?: ProgressLike
	) {
		this.worker = worker;
		this.runtime = runtime;
		this.config = config;
		this.progress = new RuntimeLoadProgress(runtime);
		this.expectedAssets = expectedAssetsForRuntime(runtime);
		this.progress.reset(progress);
	}

	matches(config: ResolvedRuntimeAssetConfig) {
		return (
			this.config.baseUrl === config.baseUrl &&
			this.config.loader === config.loader &&
			integrityKey(this.config) === integrityKey(config) &&
			allowedBaseUrlsKey(this.config) === allowedBaseUrlsKey(config) &&
			this.config.useAssetBridge === config.useAssetBridge
		);
	}

	rebind(worker: Worker, config: ResolvedRuntimeAssetConfig, progress?: ProgressLike) {
		this.generation += 1;
		this.abortActiveLoads();
		this.worker = worker;
		this.config = config;
		this.progress.reset(progress);
	}

	dispose() {
		this.generation += 1;
		this.abortActiveLoads();
	}

	resetProgress(progress?: ProgressLike) {
		this.progress.reset(progress);
	}

	handleMessage(event: MessageEvent<any>) {
		const assetRequest = event.data?.assetRequest as AssetRequestMessage | undefined;
		if (assetRequest) {
			void this.respond(assetRequest);
			return true;
		}
		const assetProgress = event.data?.assetProgress as AssetProgressMessage | undefined;
		if (assetProgress) {
			this.progress.update(assetProgress.asset, assetProgress.loaded, assetProgress.total);
			return true;
		}
		return false;
	}

	private async respond(request: AssetRequestMessage) {
		const worker = this.worker;
		const generation = this.generation;
		const controller = new AbortController();
		this.activeLoads.add(controller);
		try {
			const loaded = await this.loadAsset(request.asset, controller.signal);
			if (loaded.bytes.byteLength > MAX_RUNTIME_ASSET_BYTES) {
				throw new Error(
					`Runtime asset ${request.asset} exceeds the ${MAX_RUNTIME_ASSET_BYTES} byte limit`
				);
			}
			const runtimeBytes = request.asset.endsWith('.gz')
				? await decompressGzip(loaded.bytes, request.asset)
				: loaded.bytes;
			if (runtimeBytes.byteLength > MAX_RUNTIME_ASSET_BYTES) {
				throw new Error(
					`Runtime asset ${request.asset} exceeds the ${MAX_RUNTIME_ASSET_BYTES} byte limit`
				);
			}
			const httpDecodedGzip = (loaded.contentEncoding || '')
				.toLowerCase()
				.split(',')
				.map((encoding) => encoding.trim())
				.includes('gzip');
			await this.verifyIntegrity(
				request.asset,
				loaded.bytes,
				runtimeBytes,
				loaded.mimeType,
				!httpDecodedGzip
			);
			if (controller.signal.aborted || generation !== this.generation) return;
			const buffer = transferBuffer(
				runtimeBytes,
				runtimeBytes === loaded.bytes ? loaded.transferOwnership : true
			);
			worker.postMessage(
				{
					assetResponse: {
						id: request.id,
						ok: true,
						bytes: buffer,
						mimeType: loaded.mimeType
					}
				},
				[buffer]
			);
		} catch (error) {
			if (controller.signal.aborted || generation !== this.generation) return;
			try {
				worker.postMessage({
					assetResponse: {
						id: request.id,
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					}
				});
			} catch {
				// The worker may already be terminated. There is no remaining response channel.
			}
		} finally {
			this.activeLoads.delete(controller);
		}
	}

	private async loadAsset(asset: string, signal: AbortSignal): Promise<LoadedAsset> {
		if (!this.expectedAssets.has(asset)) {
			throw new Error(`Unexpected ${this.runtime} runtime asset: ${asset}`);
		}
		if (this.config.integrity && !Object.hasOwn(this.config.integrity, asset)) {
			throw new Error(`Runtime asset ${asset} is missing integrity metadata`);
		}
		if (signal.aborted) {
			throw runtimeAssetAbortReason(signal);
		}
		const reportProgress = (loaded: number, total?: number) => {
			if (!signal.aborted) this.progress.update(asset, loaded, total);
		};
		if (this.config.loader) {
			const pendingResult = Promise.resolve(
				this.config.loader({
					runtime: this.runtime,
					asset,
					reportProgress,
					signal
				})
			);
			const result = await new Promise<RuntimeAssetLoaderResult>((resolve, reject) => {
				let settled = false;
				const onAbort = () => {
					if (settled) return;
					settled = true;
					signal.removeEventListener('abort', onAbort);
					reject(runtimeAssetAbortReason(signal));
				};
				signal.addEventListener('abort', onAbort, { once: true });
				void pendingResult.then(
					(value) => {
						if (settled) return;
						settled = true;
						signal.removeEventListener('abort', onAbort);
						resolve(value);
					},
					(error) => {
						if (settled) return;
						settled = true;
						signal.removeEventListener('abort', onAbort);
						reject(error);
					}
				);
				if (signal.aborted) onAbort();
			});
			if (signal.aborted) {
				throw runtimeAssetAbortReason(signal);
			}
			const loaded = await this.normalizeLoaderResult(result, asset, signal);
			if (signal.aborted) {
				throw runtimeAssetAbortReason(signal);
			}
			if (loaded) return loaded;
		}
		return await this.fetchAsset(asset, asset, signal);
	}

	private async verifyIntegrity(
		asset: string,
		deliveryBytes: Uint8Array,
		runtimeBytes: Uint8Array,
		mimeType?: string,
		hasDeliveryBytes = true
	) {
		const configured = this.config.integrity?.[asset];
		if (!configured) return;
		const expected = typeof configured === 'string' ? { sha256: configured } : configured;
		if (expected.uncompressedSha256 !== undefined || expected.uncompressedBytes !== undefined) {
			if (hasDeliveryBytes) {
				await verifyRuntimeAssetPair({
					asset,
					compressed: deliveryBytes,
					uncompressed: runtimeBytes,
					expected,
					mimeType
				});
			} else {
				await verifyRuntimeAssetIntegrity({
					asset,
					bytes: runtimeBytes,
					expected,
					stage: 'uncompressed',
					mimeType
				});
			}
			return;
		}
		await verifyRuntimeAssetIntegrity({
			asset,
			bytes: runtimeBytes,
			expected: {
				...expected,
				uncompressedSha256: expected.sha256,
				uncompressedBytes: expected.bytes ?? runtimeBytes.byteLength
			},
			stage: 'uncompressed',
			mimeType
		});
	}

	private async normalizeLoaderResult(
		result: RuntimeAssetLoaderResult,
		asset: string,
		signal: AbortSignal
	): Promise<LoadedAsset | null> {
		if (!result) return null;
		if (typeof result === 'string' || result instanceof URL) {
			return await this.fetchAsset(String(result), asset, signal);
		}
		if (result instanceof ArrayBuffer) {
			const bytes = new Uint8Array(result);
			this.progress.update(asset, bytes.byteLength, bytes.byteLength);
			return { bytes };
		}
		if (result instanceof Uint8Array) {
			this.progress.update(asset, result.byteLength, result.byteLength);
			return { bytes: result };
		}
		const loaderBlob =
			result instanceof Blob
				? { blob: result, mimeType: result.type || undefined }
				: 'data' in result && result.data instanceof Blob
					? {
							blob: result.data,
							mimeType: result.mimeType || result.data.type || undefined
						}
					: undefined;
		if (loaderBlob) {
			const { blob, mimeType } = loaderBlob;
			let cancelOnAbort: (() => void) | undefined;
			const aborted = new Promise<never>((_resolve, reject) => {
				cancelOnAbort = () => reject(runtimeAssetAbortReason(signal));
				signal.addEventListener('abort', cancelOnAbort, { once: true });
			});
			let source: ArrayBuffer;
			try {
				if (signal.aborted) throw runtimeAssetAbortReason(signal);
				const materialized = blob.arrayBuffer();
				source = await Promise.race([materialized, aborted]);
				if (signal.aborted) throw runtimeAssetAbortReason(signal);
			} finally {
				if (cancelOnAbort) signal.removeEventListener('abort', cancelOnAbort);
			}
			const bytes = new Uint8Array(source);
			this.progress.update(asset, bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType, transferOwnership: true };
		}
		if ('url' in result && result.url) {
			return await this.fetchAsset(String(result.url), asset, signal);
		}
		if ('data' in result) {
			if (typeof result.data === 'string') {
				const bytes = encoder.encode(result.data);
				this.progress.update(asset, bytes.byteLength, bytes.byteLength);
				return { bytes, mimeType: result.mimeType, transferOwnership: true };
			}
			if (result.data instanceof ArrayBuffer) {
				const bytes = new Uint8Array(result.data);
				this.progress.update(asset, bytes.byteLength, bytes.byteLength);
				return {
					bytes,
					mimeType: result.mimeType,
					transferOwnership: result.transferOwnership === true
				};
			}
			if (result.data instanceof Uint8Array) {
				this.progress.update(asset, result.data.byteLength, result.data.byteLength);
				return {
					bytes: result.data,
					mimeType: result.mimeType,
					transferOwnership: result.transferOwnership === true
				};
			}
		}
		return null;
	}

	private async fetchAsset(
		url: string,
		asset: string,
		signal: AbortSignal
	): Promise<LoadedAsset> {
		const requestUrl = this.requireAllowedAssetUrl(asset, url);
		if (signal.aborted) throw runtimeAssetAbortReason(signal);
		const pendingResponse = Promise.resolve(
			fetch(requestUrl.href, {
				signal,
				credentials: 'omit',
				redirect: 'follow',
				referrerPolicy: 'no-referrer'
			})
		);
		const response = await new Promise<Response>((resolve, reject) => {
			let settled = false;
			const onAbort = () => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', onAbort);
				reject(runtimeAssetAbortReason(signal));
			};
			signal.addEventListener('abort', onAbort, { once: true });
			void pendingResponse.then(
				(candidate) => {
					if (settled) {
						const reason = runtimeAssetAbortReason(signal);
						void Promise.resolve()
							.then(() => candidate.body?.cancel(reason))
							.catch(() => undefined);
						return;
					}
					settled = true;
					signal.removeEventListener('abort', onAbort);
					resolve(candidate);
				},
				(error) => {
					if (settled) return;
					settled = true;
					signal.removeEventListener('abort', onAbort);
					reject(error);
				}
			);
			if (signal.aborted) onAbort();
		});
		if (signal.aborted) {
			const reason = runtimeAssetAbortReason(signal);
			await response.body?.cancel(reason).catch(() => undefined);
			throw reason;
		}
		let finalResponseUrl = requestUrl.href;
		if (response.url) {
			try {
				finalResponseUrl = new URL(response.url).href;
			} catch {
				const error = new Error(
					`Runtime asset ${asset} has an invalid final response URL: ${response.url}`
				);
				await response.body?.cancel(error).catch(() => undefined);
				throw error;
			}
		}
		try {
			this.requireAllowedAssetUrl(asset, finalResponseUrl);
		} catch (error) {
			await response.body?.cancel(error).catch(() => undefined);
			throw error;
		}
		if (!response.ok) {
			const error = new Error(`Failed to load ${asset}: ${response.status}`);
			await response.body?.cancel(error).catch(() => undefined);
			throw error;
		}
		const originalContentLength = response.headers.get('x-wasm-idle-original-content-length');
		const contentLengthHeader =
			originalContentLength !== null
				? 'x-wasm-idle-original-content-length'
				: 'content-length';
		const rawContentLength = originalContentLength ?? response.headers.get('content-length');
		let contentLength: number | undefined;
		if (rawContentLength !== null) {
			const normalizedContentLength = rawContentLength.trim();
			const parsedContentLength = Number(normalizedContentLength);
			if (
				!/^\d+$/u.test(normalizedContentLength) ||
				!Number.isSafeInteger(parsedContentLength)
			) {
				const error = new ProtocolError(
					`Runtime asset ${asset} has an invalid ${contentLengthHeader}: ${rawContentLength}`,
					{ phase: 'asset', runtimeId: this.runtime }
				);
				await response.body?.cancel(error).catch(() => undefined);
				throw error;
			}
			contentLength = parsedContentLength;
		}
		if (contentLength !== undefined && contentLength > MAX_RUNTIME_ASSET_BYTES) {
			const error = new Error(
				`Runtime asset ${asset} exceeds the ${MAX_RUNTIME_ASSET_BYTES} byte limit`
			);
			await response.body?.cancel(error).catch(() => undefined);
			throw error;
		}
		const mimeType = response.headers.get('content-type') || undefined;
		const contentEncoding = response.headers.get('content-encoding') || undefined;
		if (!response.body) {
			const bytes = new Uint8Array(await response.arrayBuffer());
			this.progress.update(asset, bytes.byteLength, contentLength ?? bytes.byteLength);
			return { bytes, contentEncoding, mimeType, transferOwnership: true };
		}

		const reader = response.body.getReader();
		let receivedLength = 0;
		let bytes = new Uint8Array(contentLength || DEFAULT_STREAM_BUFFER_BYTES);
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;
				const nextLength = receivedLength + value.byteLength;
				if (nextLength > MAX_RUNTIME_ASSET_BYTES) {
					throw new Error(
						`Runtime asset ${asset} exceeds the ${MAX_RUNTIME_ASSET_BYTES} byte limit`
					);
				}
				if (nextLength > bytes.byteLength) {
					const nextCapacity = Math.min(
						MAX_RUNTIME_ASSET_BYTES,
						Math.max(nextLength, bytes.byteLength * 2)
					);
					const grown = new Uint8Array(nextCapacity);
					grown.set(bytes.subarray(0, receivedLength));
					bytes = grown;
				}
				bytes.set(value, receivedLength);
				receivedLength = nextLength;
				this.progress.update(asset, receivedLength, contentLength);
			}
			if (receivedLength !== bytes.byteLength) bytes = bytes.slice(0, receivedLength);
			this.progress.update(asset, receivedLength, contentLength ?? receivedLength);
			return { bytes, contentEncoding, mimeType, transferOwnership: true };
		} catch (error) {
			await reader.cancel(error).catch(() => undefined);
			throw error;
		} finally {
			reader.releaseLock();
		}
	}

	private requireAllowedAssetUrl(asset: string, value: string) {
		let url: URL;
		try {
			url = new URL(value, this.config.baseUrl);
		} catch {
			throw new Error(`Runtime asset ${asset} has an invalid URL: ${value}`);
		}
		if (url.protocol !== 'https:' && url.protocol !== 'http:') {
			throw new Error(
				`Runtime asset ${asset} uses an unsupported URL scheme: ${url.protocol}`
			);
		}
		if (url.username || url.password) {
			throw new Error(`Runtime asset ${asset} URL must not include credentials`);
		}
		if (url.hash) {
			throw new Error(`Runtime asset ${asset} URL must not include a fragment`);
		}
		const allowed = [this.config.baseUrl, ...(this.config.allowedBaseUrls || [])].some(
			(baseUrl) => {
				let base: URL;
				try {
					base = new URL(baseUrl, url);
				} catch {
					return false;
				}
				if (base.protocol !== 'https:' && base.protocol !== 'http:') return false;
				const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
				return url.origin === base.origin && url.pathname.startsWith(basePath);
			}
		);
		if (!allowed) {
			throw new Error(
				`Runtime asset ${asset} URL is outside the allowed asset bases: ${url.href}`
			);
		}
		return url;
	}

	private abortActiveLoads() {
		for (const controller of this.activeLoads) controller.abort();
		this.activeLoads.clear();
	}
}
