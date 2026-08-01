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
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	Symbol.toStringTag
)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	'byteLength'
)?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	'byteOffset'
)?.get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	'byteLength'
)?.get;
const blobSizeGetter = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
const blobTypeGetter = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')?.get;

const runtimeAssetSizeError = (asset: string, maxBytes = MAX_RUNTIME_ASSET_BYTES) =>
	new Error(`Runtime asset ${asset} exceeds the ${maxBytes} byte limit`);

const requireRuntimeAssetSize = (
	asset: string,
	byteLength: number,
	maxBytes = MAX_RUNTIME_ASSET_BYTES
) => {
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new Error(`Runtime asset ${asset} has an invalid byte length`);
	}
	if (byteLength > maxBytes) throw runtimeAssetSizeError(asset, maxBytes);
};

const canonicalUint8Array = (value: Uint8Array) => {
	if (
		!typedArrayTagGetter ||
		!typedArrayBufferGetter ||
		!typedArrayByteLengthGetter ||
		!typedArrayByteOffsetGetter
	) {
		throw new Error('Uint8Array intrinsic accessors are unavailable');
	}
	if (Reflect.apply(typedArrayTagGetter, value, []) !== 'Uint8Array') {
		throw new TypeError('Runtime asset byte data must be a Uint8Array');
	}
	const buffer = Reflect.apply(typedArrayBufferGetter, value, []) as ArrayBufferLike;
	const byteLength = Reflect.apply(typedArrayByteLengthGetter, value, []) as number;
	const byteOffset = Reflect.apply(typedArrayByteOffsetGetter, value, []) as number;
	return new Uint8Array(buffer, byteOffset, byteLength);
};

const detachedRuntimeAssetBytesError = (asset: string) =>
	new Error(`Runtime asset ${asset} byte data is detached or invalid`);

const tryCanonicalUint8Array = (value: unknown, asset: string) => {
	if (!typedArrayTagGetter) throw new Error('Uint8Array intrinsic accessors are unavailable');
	let tag: unknown;
	try {
		tag = Reflect.apply(typedArrayTagGetter, value, []);
	} catch {
		return undefined;
	}
	if (tag !== 'Uint8Array') return undefined;
	try {
		return canonicalUint8Array(value as Uint8Array);
	} catch {
		throw detachedRuntimeAssetBytesError(asset);
	}
};

const tryArrayBufferByteLength = (value: unknown) => {
	if (!arrayBufferByteLengthGetter) return undefined;
	try {
		return Reflect.apply(arrayBufferByteLengthGetter, value, []) as number;
	} catch {
		return undefined;
	}
};

const snapshotArrayBufferBytes = (value: unknown, asset: string, maxBytes: number) => {
	const byteLength = tryArrayBufferByteLength(value);
	if (byteLength === undefined) return undefined;
	requireRuntimeAssetSize(asset, byteLength, maxBytes);
	try {
		return Uint8Array.from(new Uint8Array(value as ArrayBuffer));
	} catch {
		throw detachedRuntimeAssetBytesError(asset);
	}
};

const snapshotLoaderBytes = (value: unknown, asset: string, maxBytes: number) => {
	const bytes = tryCanonicalUint8Array(value, asset);
	if (!bytes) return snapshotArrayBufferBytes(value, asset, maxBytes);
	requireRuntimeAssetSize(asset, bytes.byteLength, maxBytes);
	return Uint8Array.from(bytes);
};

const snapshotMaterializedArrayBuffer = (value: unknown, asset: string, maxBytes: number) => {
	const bytes = snapshotArrayBufferBytes(value, asset, maxBytes);
	if (!bytes) {
		throw new Error(`Runtime asset ${asset} materialization did not return an ArrayBuffer`);
	}
	return bytes;
};

const tryCanonicalBlob = (value: unknown) => {
	if (!blobSizeGetter || !blobTypeGetter) return undefined;
	try {
		return {
			blob: value as Blob,
			size: Reflect.apply(blobSizeGetter, value, []) as number,
			type: Reflect.apply(blobTypeGetter, value, []) as string
		};
	} catch {
		return undefined;
	}
};

export const boundedUtf8ByteLength = (value: string, maxBytes = MAX_RUNTIME_ASSET_BYTES) => {
	let byteLength = 0;
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit <= 0x7f) {
			byteLength += 1;
		} else if (codeUnit <= 0x7ff) {
			byteLength += 2;
		} else if (
			codeUnit >= 0xd800 &&
			codeUnit <= 0xdbff &&
			index + 1 < value.length &&
			value.charCodeAt(index + 1) >= 0xdc00 &&
			value.charCodeAt(index + 1) <= 0xdfff
		) {
			byteLength += 4;
			index += 1;
		} else {
			byteLength += 3;
		}
		if (byteLength > maxBytes) return byteLength;
	}
	return byteLength;
};

const runtimeAssetAbortReason = (signal: AbortSignal) =>
	signal.reason ?? new DOMException('Runtime asset load aborted', 'AbortError');

const cancelResponseBody = (response: Response, reason?: unknown) => {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the asset failure that caused cancellation.
	}
};

const readAbortableArrayBuffer = async (
	source: { arrayBuffer(): Promise<ArrayBuffer> },
	signal: AbortSignal
) => {
	if (signal.aborted) throw runtimeAssetAbortReason(signal);
	let cancelOnAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		cancelOnAbort = () => reject(runtimeAssetAbortReason(signal));
		signal.addEventListener('abort', cancelOnAbort, { once: true });
	});
	try {
		const materialized = source.arrayBuffer();
		const bytes = await Promise.race([materialized, aborted]);
		if (signal.aborted) throw runtimeAssetAbortReason(signal);
		return bytes;
	} finally {
		if (cancelOnAbort) signal.removeEventListener('abort', cancelOnAbort);
	}
};

const transferBuffer = (bytes: Uint8Array, transferOwnership = false) => {
	const canonicalBytes = canonicalUint8Array(bytes);
	const buffer = canonicalBytes.buffer;
	const transferableBuffer = buffer instanceof ArrayBuffer ? buffer : undefined;
	const transferableByteLength =
		transferableBuffer && arrayBufferByteLengthGetter
			? (Reflect.apply(arrayBufferByteLengthGetter, transferableBuffer, []) as number)
			: undefined;
	return transferOwnership &&
		transferableBuffer &&
		canonicalBytes.byteOffset === 0 &&
		canonicalBytes.byteLength === transferableByteLength
		? transferableBuffer
		: Uint8Array.from(canonicalBytes).buffer;
};

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
	private readonly maxAssetBytes = MAX_RUNTIME_ASSET_BYTES;

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
			const deliveryBytes = canonicalUint8Array(loaded.bytes);
			requireRuntimeAssetSize(request.asset, deliveryBytes.byteLength, this.maxAssetBytes);
			const normalizedRuntimeBytes = request.asset.endsWith('.gz')
				? await decompressGzip(
						deliveryBytes,
						request.asset,
						this.maxAssetBytes,
						controller.signal
					)
				: deliveryBytes;
			const runtimeBytes = canonicalUint8Array(normalizedRuntimeBytes);
			requireRuntimeAssetSize(request.asset, runtimeBytes.byteLength, this.maxAssetBytes);
			const httpDecodedGzip = (loaded.contentEncoding || '')
				.toLowerCase()
				.split(',')
				.map((encoding) => encoding.trim())
				.includes('gzip');
			if (controller.signal.aborted || generation !== this.generation) return;
			let cancelOnAbort: (() => void) | undefined;
			const aborted = new Promise<never>((_resolve, reject) => {
				cancelOnAbort = () => reject(runtimeAssetAbortReason(controller.signal));
				controller.signal.addEventListener('abort', cancelOnAbort, { once: true });
			});
			try {
				const verification = this.verifyIntegrity(
					request.asset,
					deliveryBytes,
					runtimeBytes,
					loaded.mimeType,
					!httpDecodedGzip
				);
				await Promise.race([verification, aborted]);
			} finally {
				if (cancelOnAbort) {
					controller.signal.removeEventListener('abort', cancelOnAbort);
				}
			}
			if (controller.signal.aborted || generation !== this.generation) return;
			const buffer = transferBuffer(
				runtimeBytes,
				normalizedRuntimeBytes === deliveryBytes ? loaded.transferOwnership : true
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
		const directBytes = snapshotLoaderBytes(result, asset, this.maxAssetBytes);
		if (directBytes) {
			this.progress.update(asset, directBytes.byteLength, directBytes.byteLength);
			return { bytes: directBytes, transferOwnership: true };
		}
		const directBlob = tryCanonicalBlob(result);
		const wrappedBlob =
			typeof result === 'object' && result !== null && 'data' in result
				? {
						value: tryCanonicalBlob(result.data),
						mimeType: result.mimeType
					}
				: undefined;
		const loaderBlob = directBlob
			? { ...directBlob, mimeType: directBlob.type || undefined }
			: wrappedBlob?.value
				? {
						...wrappedBlob.value,
						mimeType: wrappedBlob.mimeType || wrappedBlob.value.type || undefined
					}
				: undefined;
		if (loaderBlob) {
			const { blob, size, mimeType } = loaderBlob;
			requireRuntimeAssetSize(asset, size, this.maxAssetBytes);
			const source = await readAbortableArrayBuffer(blob, signal);
			const bytes = snapshotMaterializedArrayBuffer(source, asset, this.maxAssetBytes);
			this.progress.update(asset, bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType, transferOwnership: true };
		}
		if ('url' in result && result.url) {
			return await this.fetchAsset(String(result.url), asset, signal);
		}
		if ('data' in result) {
			if (typeof result.data === 'string') {
				requireRuntimeAssetSize(
					asset,
					boundedUtf8ByteLength(result.data, this.maxAssetBytes),
					this.maxAssetBytes
				);
				const bytes = canonicalUint8Array(encoder.encode(result.data));
				requireRuntimeAssetSize(asset, bytes.byteLength, this.maxAssetBytes);
				this.progress.update(asset, bytes.byteLength, bytes.byteLength);
				return { bytes, mimeType: result.mimeType, transferOwnership: true };
			}
			const bytes = snapshotLoaderBytes(result.data, asset, this.maxAssetBytes);
			if (bytes) {
				this.progress.update(asset, bytes.byteLength, bytes.byteLength);
				return {
					bytes,
					mimeType: result.mimeType,
					transferOwnership: true
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
				redirect: 'error',
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
						cancelResponseBody(candidate, reason);
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
			cancelResponseBody(response, reason);
			throw reason;
		}
		if (response.url) {
			let finalResponseUrl: string;
			try {
				finalResponseUrl = new URL(response.url).href;
			} catch {
				const error = new Error(
					`Runtime asset ${asset} final response URL does not match the requested asset`
				);
				cancelResponseBody(response, error);
				throw error;
			}
			if (response.redirected || finalResponseUrl !== requestUrl.href) {
				const error = new Error(
					`Runtime asset ${asset} final response URL does not match the requested asset`
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
					`Runtime asset ${asset} has an invalid ${contentLengthHeader}`,
					{ phase: 'asset', runtimeId: this.runtime }
				);
				cancelResponseBody(response, error);
				throw error;
			}
			contentLength = parsedContentLength;
		}
		if (contentLength !== undefined && contentLength > this.maxAssetBytes) {
			const error = runtimeAssetSizeError(asset, this.maxAssetBytes);
			cancelResponseBody(response, error);
			throw error;
		}
		const mimeType = response.headers.get('content-type') || undefined;
		const contentEncoding = response.headers.get('content-encoding') || undefined;
		if (!response.body) {
			const bytes = snapshotMaterializedArrayBuffer(
				await readAbortableArrayBuffer(response, signal),
				asset,
				this.maxAssetBytes
			);
			this.progress.update(asset, bytes.byteLength, contentLength ?? bytes.byteLength);
			return { bytes, contentEncoding, mimeType, transferOwnership: true };
		}

		const reader = response.body.getReader();
		let readerCancelled = false;
		if (signal.aborted) {
			const reason = runtimeAssetAbortReason(signal);
			readerCancelled = true;
			try {
				void reader.cancel(reason).catch(() => undefined);
			} catch {}
			try {
				reader.releaseLock();
			} catch {}
			throw reason;
		}
		let cancelOnAbort: (() => void) | undefined;
		const aborted = new Promise<never>((_resolve, reject) => {
			cancelOnAbort = () => {
				const reason = runtimeAssetAbortReason(signal);
				if (!readerCancelled) {
					readerCancelled = true;
					try {
						void reader.cancel(reason).catch(() => undefined);
					} catch {}
				}
				reject(reason);
			};
			signal.addEventListener('abort', cancelOnAbort, { once: true });
		});
		let receivedLength = 0;
		let bytes = new Uint8Array(contentLength || DEFAULT_STREAM_BUFFER_BYTES);
		let loadedAsset!: LoadedAsset;
		let releaseError: unknown;
		try {
			while (true) {
				if (signal.aborted) throw runtimeAssetAbortReason(signal);
				const pendingRead = reader.read();
				const { done, value } = await Promise.race([pendingRead, aborted]);
				if (signal.aborted) throw runtimeAssetAbortReason(signal);
				if (done) break;
				if (!value) continue;
				const chunk = canonicalUint8Array(value);
				const nextLength = receivedLength + chunk.byteLength;
				if (nextLength > this.maxAssetBytes) {
					const error = runtimeAssetSizeError(asset, this.maxAssetBytes);
					readerCancelled = true;
					try {
						void reader.cancel(error).catch(() => undefined);
					} catch {}
					throw error;
				}
				if (nextLength > bytes.byteLength) {
					const nextCapacity = Math.min(
						this.maxAssetBytes,
						Math.max(nextLength, bytes.byteLength * 2)
					);
					const grown = new Uint8Array(nextCapacity);
					grown.set(bytes.subarray(0, receivedLength));
					bytes = grown;
				}
				bytes.set(chunk, receivedLength);
				receivedLength = nextLength;
				this.progress.update(asset, receivedLength, contentLength);
			}
			if (receivedLength !== bytes.byteLength) bytes = bytes.slice(0, receivedLength);
			this.progress.update(asset, receivedLength, contentLength ?? receivedLength);
			loadedAsset = { bytes, contentEncoding, mimeType, transferOwnership: true };
		} catch (error) {
			if (signal.aborted) {
				const reason = runtimeAssetAbortReason(signal);
				if (!readerCancelled) {
					readerCancelled = true;
					try {
						void reader.cancel(reason).catch(() => undefined);
					} catch {}
				}
				throw reason;
			}
			if (!readerCancelled) {
				readerCancelled = true;
				try {
					void reader.cancel(error).catch(() => undefined);
				} catch {}
			}
			throw error;
		} finally {
			if (cancelOnAbort) signal.removeEventListener('abort', cancelOnAbort);
			try {
				reader.releaseLock();
			} catch (error) {
				if (!signal.aborted) releaseError = error;
			}
		}
		if (releaseError) throw releaseError;
		return loadedAsset;
	}

	private requireAllowedAssetUrl(asset: string, value: string) {
		let url: URL;
		try {
			url = new URL(value, this.config.baseUrl);
		} catch {
			throw new Error(`Runtime asset ${asset} has an invalid URL`);
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
			throw new Error(`Runtime asset ${asset} URL is outside the allowed asset bases`);
		}
		return url;
	}

	private abortActiveLoads() {
		for (const controller of this.activeLoads) controller.abort();
		this.activeLoads.clear();
	}
}
