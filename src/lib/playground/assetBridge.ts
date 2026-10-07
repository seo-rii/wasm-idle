import {
	RUNTIME_LOAD_ASSETS,
	type ResolvedRuntimeAssetConfig,
	type RuntimeAssetLoaderResult,
	type RuntimeAssetRuntime
} from '$lib/playground/assets';
import {
	ProtocolError,
	verifyRuntimeAssetIntegrity,
	verifyRuntimeAssetPair,
	readPersistentRuntimeAsset,
	writePersistentRuntimeAsset,
	resolveRuntimeAssetLockEntry,
	resolveRuntimeAssetCacheOptions,
	type RuntimeAssetCacheOptions,
	type ResolvedRuntimeAssetCacheOptions,
	type ProgressLike
} from '@wasm-idle/core';
import { decompressGzip } from '@wasm-idle/llvm-core';
import { readPythonPackageAssets } from '$lib/playground/pythonPackageLock';
import { BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES } from '$lib/playground/clangAssetIntegrity';
import { shouldStreamBundledClang } from '$lib/playground/clangStreamingPolicy';
import { compileVerifiedWasmAsset } from '@wasm-idle/llvm-core/core/verified-wasm';
import { BUNDLED_CLANG_ASSET_INTEGRITY } from '$lib/playground/clangAssetIntegrity';
import { RuntimeAssetCache } from '$lib/playground/runtimeAssetCache';

interface AssetRequestMessage {
	id: number;
	asset: string;
	module?: boolean;
}

type CachedRuntimeAsset = { bytes: Uint8Array; mimeType?: string; transferOwnership?: boolean };

type AssetPreparationProgress =
	| { kind: 'download'; asset: string; loaded: number; total?: number }
	| { kind: 'activity'; asset: string; phase: 'decompressing' | 'verifying' };

type AssetLoadContext = {
	config: ResolvedRuntimeAssetConfig;
	maxAssetBytes: number;
	expectedAssets: ReadonlySet<string>;
	pythonPackageAssets: ReadonlySet<string>;
	progress: Pick<RuntimeLoadProgress, 'update' | 'activity'>;
};

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

type AssetBridgeState = 'active' | 'rebinding' | 'disposed';

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

const requireBridgeMaxAssetBytes = (value: number) => {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError('Worker asset bridge maxAssetBytes must be a positive safe integer');
	}
	return value;
};

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

const cSysrootAsset = BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES.c.asset;
const cppAddonAsset = BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES.cppAddon.asset;
const fullSysrootAsset = 'bin/sysroot.tar.gz';
const printscanLongDoubleAsset = 'libc-printscan-long-double.a.gz';

const canUseClangLanguageSysroots = (
	runtime: RuntimeAssetRuntime,
	config: ResolvedRuntimeAssetConfig,
	requested: boolean
) => runtime === 'clang' && requested && config.useAssetBridge && shouldStreamBundledClang(config);

const expectedAssetsForRuntime = (runtime: RuntimeAssetRuntime, languageSysroots = false) => {
	const assets = new Set<string>(RUNTIME_LOAD_ASSETS[runtime]);
	if (runtime === 'clang') assets.add(printscanLongDoubleAsset);
	if (runtime === 'clang' && languageSysroots) {
		assets.add(cSysrootAsset);
		assets.add(cppAddonAsset);
	}
	return assets;
};

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
	private readonly samples = new Map<string, { loaded: number; total?: number }>();
	private readonly optionalSamples = new Map<string, { loaded: number; total?: number }>();
	private readonly expectedAssets: Set<string>;
	private readonly optionalAssets: Set<string>;
	private readonly phaseId: string;
	private progress?: ProgressLike;
	private lockedTotal: number | undefined;
	private measurementInvalid = false;

	constructor(runtime: RuntimeAssetRuntime, languageSysroots = false, clangdHeaders = false) {
		this.expectedAssets = expectedAssetsForRuntime(runtime);
		this.optionalAssets = new Set<string>();
		if (runtime === 'clangd' && !clangdHeaders) {
			this.expectedAssets.delete('clangd.headers.json.gz');
			this.optionalAssets.add('clangd.headers.json.gz');
		}
		if (runtime === 'clang') {
			this.expectedAssets.delete(printscanLongDoubleAsset);
			this.optionalAssets.add(printscanLongDoubleAsset);
		}
		if (runtime === 'clang' && languageSysroots) {
			this.expectedAssets.delete(fullSysrootAsset);
			this.expectedAssets.add(cSysrootAsset);
			this.optionalAssets.add(fullSysrootAsset);
			this.optionalAssets.add(cppAddonAsset);
		}
		this.phaseId = `${runtime}:runtime-assets`;
		this.reset();
	}

	reset(progress?: ProgressLike) {
		this.progress = progress;
		this.samples.clear();
		this.optionalSamples.clear();
		this.lockedTotal = undefined;
		this.measurementInvalid = false;
		for (const asset of this.expectedAssets) this.samples.set(asset, { loaded: 0 });
		this.emit();
	}

	update(asset: string, loaded: number, total?: number) {
		if (!this.expectedAssets.has(asset)) {
			if (this.optionalAssets.has(asset) && this.progress) {
				const previous = this.optionalSamples.get(asset) || { loaded: 0 };
				// A completed optional transfer may receive a duplicate or an unrelated
				// worker-side progress sample. Keep its final measurement terminal;
				// a subsequent unmeasured activity would turn 100% back into 99%.
				if (previous.total !== undefined && previous.loaded === previous.total) return;
				const nextLoaded = Math.max(previous.loaded, loaded);
				const nextTotal = total ?? previous.total;
				const valid =
					Number.isSafeInteger(loaded) &&
					loaded >= 0 &&
					(total === undefined ||
						(Number.isSafeInteger(total) &&
							total > 0 &&
							(previous.total === undefined || previous.total === total))) &&
					(nextTotal === undefined || nextLoaded <= nextTotal);
				if (valid) {
					this.optionalSamples.set(asset, {
						loaded: nextLoaded,
						...(nextTotal === undefined ? {} : { total: nextTotal })
					});
				}
				const label = `Downloading ${asset}`;
				if (this.progress.report) {
					this.progress.report({
						kind: 'activity',
						phase: 'downloading',
						phaseId: `${this.phaseId}:${asset}`,
						label,
						...(valid && nextTotal !== undefined
							? {
									measurement: {
										kind: 'bytes',
										completed: nextLoaded,
										total: nextTotal
									} as const
								}
							: {})
					});
				} else {
					this.progress.set?.(
						valid && nextTotal !== undefined ? nextLoaded / nextTotal : 0,
						label
					);
				}
			}
			return;
		}
		if (!Number.isSafeInteger(loaded) || loaded < 0) {
			this.measurementInvalid = true;
			this.emit();
			return;
		}
		const previous = this.samples.get(asset) || { loaded: 0 };
		let nextTotal = previous.total;
		if (total !== undefined) {
			if (!Number.isSafeInteger(total) || total <= 0) {
				this.measurementInvalid = true;
			} else if (previous.total !== undefined && previous.total !== total) {
				this.measurementInvalid = true;
			} else {
				nextTotal = total;
			}
		}
		const nextLoaded = Math.max(previous.loaded, loaded);
		if (nextTotal !== undefined && nextLoaded > nextTotal) {
			this.measurementInvalid = true;
		}
		this.samples.set(asset, {
			loaded: nextLoaded,
			...(nextTotal === undefined ? {} : { total: nextTotal })
		});
		this.emit();
	}

	activity(phase: 'decompressing' | 'verifying', asset: string) {
		if (!this.progress) return;
		const action = phase === 'decompressing' ? 'Decompressing' : 'Verifying';
		const label = `${action} ${asset}`;
		if (this.progress.report) {
			this.progress.report({
				kind: 'activity',
				phase,
				phaseId: `${this.phaseId}:${asset}`,
				label
			});
			return;
		}
		this.progress.set?.(0, label);
	}

	private emit() {
		if (!this.progress) return;
		let completedBytes = 0;
		let totalBytes = 0;
		let allTotalsKnown = this.samples.size > 0;
		for (const sample of this.samples.values()) {
			if (sample.total === undefined) {
				allTotalsKnown = false;
				continue;
			}
			completedBytes += sample.loaded;
			totalBytes += sample.total;
		}
		if (!Number.isSafeInteger(completedBytes) || !Number.isSafeInteger(totalBytes)) {
			this.measurementInvalid = true;
		}
		if (allTotalsKnown && this.lockedTotal === undefined) this.lockedTotal = totalBytes;
		if (this.lockedTotal !== undefined && this.lockedTotal !== totalBytes) {
			this.measurementInvalid = true;
		}

		const measurement =
			allTotalsKnown && !this.measurementInvalid && totalBytes > 0
				? ({ kind: 'bytes', completed: completedBytes, total: totalBytes } as const)
				: undefined;
		if (this.progress.report) {
			this.progress.report({
				kind: 'activity',
				phase: 'downloading',
				phaseId: this.phaseId,
				label: 'Downloading runtime assets',
				...(measurement ? { measurement } : {})
			});
			return;
		}
		this.progress.set?.(measurement ? measurement.completed / measurement.total : 0);
	}
}

export class WorkerAssetBridge {
	private worker: Worker;
	private readonly runtime: RuntimeAssetRuntime;
	private config: ResolvedRuntimeAssetConfig;
	private persistentCacheBaseline: ResolvedRuntimeAssetCacheOptions;
	private progress: RuntimeLoadProgress;
	private expectedAssets: Set<string>;
	private languageSysroots: boolean;
	private pythonPackageAssets = new Set<string>();
	private generation = 0;
	private state: AssetBridgeState = 'active';
	private readonly activeLoads = new Set<AbortController>();
	private maxAssetBytes: number;

	constructor(
		worker: Worker,
		runtime: RuntimeAssetRuntime,
		config: ResolvedRuntimeAssetConfig,
		progress?: ProgressLike,
		maxAssetBytes = MAX_RUNTIME_ASSET_BYTES,
		languageSysroots = false,
		private readonly cache?: RuntimeAssetCache
	) {
		this.worker = worker;
		this.runtime = runtime;
		this.persistentCacheBaseline = resolveRuntimeAssetCacheOptions(config.persistentCache);
		this.config = { ...config, persistentCache: this.persistentCacheBaseline };
		this.maxAssetBytes = requireBridgeMaxAssetBytes(maxAssetBytes);
		this.languageSysroots = canUseClangLanguageSysroots(runtime, config, languageSysroots);
		this.progress = new RuntimeLoadProgress(
			runtime,
			this.languageSysroots,
			config.assetPrefix === 'clangd' || !!config.integrity?.['clangd.headers.json.gz']
		);
		this.expectedAssets = expectedAssetsForRuntime(runtime, this.languageSysroots);
		this.progress.reset(progress);
	}

	matches(
		config: ResolvedRuntimeAssetConfig,
		maxAssetBytes = this.maxAssetBytes,
		languageSysroots = this.languageSysroots
	) {
		return (
			this.state === 'active' &&
			this.languageSysroots ===
				canUseClangLanguageSysroots(this.runtime, config, languageSysroots) &&
			this.maxAssetBytes === requireBridgeMaxAssetBytes(maxAssetBytes) &&
			this.config.baseUrl === config.baseUrl &&
			this.config.loader === config.loader &&
			integrityKey(this.config) === integrityKey(config) &&
			allowedBaseUrlsKey(this.config) === allowedBaseUrlsKey(config) &&
			this.config.useAssetBridge === config.useAssetBridge &&
			JSON.stringify(this.persistentCacheBaseline) ===
				JSON.stringify(resolveRuntimeAssetCacheOptions(config.persistentCache))
		);
	}

	/** Apply one execution's policy without changing the configuration established by load(). */
	setExecutionPersistentCache(override?: RuntimeAssetCacheOptions) {
		if (this.state !== 'active')
			throw new Error('Cannot configure an inactive worker asset bridge');
		const cache = resolveRuntimeAssetCacheOptions(this.persistentCacheBaseline, override);
		this.config = { ...this.config, persistentCache: cache };
		return cache;
	}

	rebind(
		worker: Worker,
		config: ResolvedRuntimeAssetConfig,
		progress?: ProgressLike,
		maxAssetBytes = this.maxAssetBytes,
		languageSysroots = this.languageSysroots
	) {
		if (this.state === 'disposed') {
			throw new Error('Cannot rebind a disposed worker asset bridge');
		}
		if (this.state === 'rebinding') {
			throw new Error('Cannot rebind a worker asset bridge while another rebind is active');
		}
		const nextMaxAssetBytes = requireBridgeMaxAssetBytes(maxAssetBytes);
		const nextLanguageSysroots = canUseClangLanguageSysroots(
			this.runtime,
			config,
			languageSysroots
		);
		const preservePythonPackageAssets = this.matches(
			config,
			nextMaxAssetBytes,
			nextLanguageSysroots
		);
		this.state = 'rebinding';
		const generation = ++this.generation;
		this.progress.reset();
		try {
			this.abortActiveLoads();
			if (!preservePythonPackageAssets) this.pythonPackageAssets.clear();
			if (this.state !== 'rebinding' || this.generation !== generation) {
				throw new Error('Cannot rebind a disposed worker asset bridge');
			}
			this.worker = worker;
			this.persistentCacheBaseline = resolveRuntimeAssetCacheOptions(config.persistentCache);
			this.config = { ...config, persistentCache: this.persistentCacheBaseline };
			this.maxAssetBytes = nextMaxAssetBytes;
			this.languageSysroots = nextLanguageSysroots;
			this.expectedAssets = expectedAssetsForRuntime(this.runtime, nextLanguageSysroots);
			this.progress = new RuntimeLoadProgress(
				this.runtime,
				nextLanguageSysroots,
				config.assetPrefix === 'clangd' || !!config.integrity?.['clangd.headers.json.gz']
			);
			this.progress.reset(progress);
			if (this.state !== 'rebinding' || this.generation !== generation) {
				throw new Error('Cannot rebind a disposed worker asset bridge');
			}
			this.state = 'active';
		} catch (error) {
			if (this.state === 'rebinding' && this.generation === generation) this.dispose();
			throw error;
		}
	}

	dispose() {
		if (this.state === 'disposed') return;
		this.state = 'disposed';
		this.generation += 1;
		this.progress.reset();
		this.pythonPackageAssets.clear();
		this.abortActiveLoads();
	}

	resetProgress(progress?: ProgressLike) {
		if (this.state !== 'active') return;
		this.progress.reset(progress);
	}

	private configuredReceiptByteLimit(context: AssetLoadContext, asset: string, value: unknown) {
		if (value === undefined) return undefined;
		if (!Number.isSafeInteger(value) || (value as number) < 0) {
			throw new ProtocolError(`Runtime asset ${asset} has an invalid integrity byte count`, {
				phase: 'asset',
				runtimeId: this.runtime
			});
		}
		const byteLimit = value as number;
		if (byteLimit > context.maxAssetBytes) {
			throw runtimeAssetSizeError(asset, context.maxAssetBytes);
		}
		return byteLimit;
	}

	private runtimeAssetByteLimit(context: AssetLoadContext, asset: string) {
		const configured = context.config.integrity?.[asset];
		if (!configured || typeof configured === 'string') return context.maxAssetBytes;
		return (
			this.configuredReceiptByteLimit(
				context,
				asset,
				configured.uncompressedBytes ?? configured.bytes
			) ?? context.maxAssetBytes
		);
	}

	private sourceAssetByteLimit(context: AssetLoadContext, asset: string) {
		const configured = context.config.integrity?.[asset];
		if (!configured || typeof configured === 'string') return context.maxAssetBytes;
		const paired =
			configured.uncompressedBytes !== undefined ||
			configured.uncompressedSha256 !== undefined;
		if (asset.endsWith('.gz')) {
			if (!paired) return context.maxAssetBytes;
			const deliveryLimit = this.configuredReceiptByteLimit(context, asset, configured.bytes);
			const runtimeLimit = this.configuredReceiptByteLimit(
				context,
				asset,
				configured.uncompressedBytes
			);
			return deliveryLimit !== undefined || runtimeLimit !== undefined
				? Math.max(deliveryLimit ?? 0, runtimeLimit ?? 0)
				: context.maxAssetBytes;
		}
		const deliveryLimit = this.configuredReceiptByteLimit(context, asset, configured.bytes);
		const runtimeLimit = this.configuredReceiptByteLimit(
			context,
			asset,
			configured.uncompressedBytes
		);
		return deliveryLimit !== undefined || runtimeLimit !== undefined
			? Math.max(deliveryLimit ?? 0, runtimeLimit ?? 0)
			: context.maxAssetBytes;
	}

	handleMessage(event: MessageEvent<any>) {
		const assetRequest = event.data?.assetRequest as AssetRequestMessage | undefined;
		if (assetRequest) {
			if (this.state === 'active') void this.respond(assetRequest);
			return true;
		}
		const assetProgress = event.data?.assetProgress as AssetProgressMessage | undefined;
		if (assetProgress) {
			if (this.state === 'active') {
				this.progress.update(
					assetProgress.asset,
					assetProgress.loaded,
					assetProgress.total
				);
			}
			return true;
		}
		return false;
	}

	private async respond(request: AssetRequestMessage) {
		if (this.state !== 'active') return;
		const worker = this.worker;
		const generation = this.generation;
		const controller = new AbortController();
		const progress = this.progress;
		const context = this.captureLoadContext();
		const receiveProgress = (event: AssetPreparationProgress) => {
			if (controller.signal.aborted || generation !== this.generation) return;
			if (event.kind === 'download') {
				progress.update(event.asset, event.loaded, event.total);
			} else {
				progress.activity(event.phase, event.asset);
			}
		};
		const loadContext = (report: (event: AssetPreparationProgress, key?: string) => void) => ({
			...context,
			progress: {
				update: (asset: string, loaded: number, total?: number) =>
					report({ kind: 'download', asset, loaded, total }, `download:${asset}`),
				activity: (phase: 'decompressing' | 'verifying', asset: string) =>
					report({ kind: 'activity', asset, phase }, `activity:${asset}`)
			}
		});
		this.activeLoads.add(controller);
		try {
			this.validateAssetRequest(loadContext(receiveProgress), request.asset);
			const identity = [
				this.runtime,
				context.config.baseUrl,
				this.cache?.identity(context.config.loader),
				integrityKey(context.config),
				allowedBaseUrlsKey(context.config),
				context.config.useAssetBridge,
				context.maxAssetBytes,
				this.languageSysroots,
				request.asset
			];
			const bytesKey = JSON.stringify([...identity, 'bytes']);
			const moduleKey = JSON.stringify([...identity, 'module']);
			const share = <T>(
				key: string,
				signal: AbortSignal,
				start: (
					signal: AbortSignal,
					report: (event: AssetPreparationProgress, key?: string) => void
				) => Promise<T>,
				report = receiveProgress
			) => {
				// Completed verified values can cross storage policies. In-flight work cannot:
				// a request disabling persistence must not join a load that reads or writes it.
				const operationKey = JSON.stringify([key, context.config.persistentCache]);
				return this.cache
					? this.cache.share(operationKey, signal, start, report)
					: start(signal, report);
			};
			const loadBytes = async (
				signal: AbortSignal,
				report = receiveProgress,
				retain = false
			): Promise<CachedRuntimeAsset> => {
				let loaded = this.cache?.get<CachedRuntimeAsset>(bytesKey);
				if (loaded) return loaded;
				loaded = await share(
					bytesKey,
					signal,
					async (operationSignal, publish) => {
						const loaded = await this.loadVerifiedAsset(
							loadContext(publish),
							request.asset,
							operationSignal
						);
						// Keep shared backing buffers private, even when the result exceeds retention limits.
						return this.cache
							? { bytes: Uint8Array.from(loaded.bytes), mimeType: loaded.mimeType }
							: loaded;
					},
					report
				);
				if (signal.aborted) throw runtimeAssetAbortReason(signal);
				if (retain) this.cache?.set(bytesKey, loaded, loaded.bytes.byteLength);
				return loaded;
			};
			if (request.module === true) {
				if (!/\.wasm(?:\.gz)?$/u.test(request.asset)) {
					throw new Error('Only runtime Wasm assets can be compiled');
				}
				let module = this.cache?.get<WebAssembly.Module>(moduleKey);
				if (!module) {
					module = await share(moduleKey, controller.signal, async (signal, report) => {
						const streaming =
							this.runtime === 'clang' &&
							shouldStreamBundledClang(context.config) &&
							(request.asset === 'bin/clang.wasm.gz' ||
								request.asset === 'bin/lld.wasm.gz');
						let bytes: number;
						let module: WebAssembly.Module;
						if (streaming) {
							const receipt =
								BUNDLED_CLANG_ASSET_INTEGRITY[
									request.asset as 'bin/clang.wasm.gz' | 'bin/lld.wasm.gz'
								];
							module = await compileVerifiedWasmAsset(
								new URL(request.asset, context.config.baseUrl).href,
								receipt,
								{
									fetch: globalThis.fetch.bind(globalThis),
									persistentCache: context.config.persistentCache,
									maxAssetBytes: context.maxAssetBytes,
									signal,
									onProgress: (loaded, total) =>
										report(
											{
												kind: 'download',
												asset: request.asset,
												loaded,
												total
											},
											`download:${request.asset}`
										)
								}
							);
							bytes = receipt.uncompressedBytes;
						} else {
							const loaded = await loadBytes(signal, (event) =>
								report(event, `${event.kind}:${event.asset}`)
							);
							bytes = loaded.bytes.byteLength;
							module = await WebAssembly.compile(Uint8Array.from(loaded.bytes));
						}
						if (signal.aborted) throw runtimeAssetAbortReason(signal);
						this.cache?.set(moduleKey, module, bytes);
						return module;
					});
				}
				if (controller.signal.aborted || generation !== this.generation) return;
				worker.postMessage({ assetResponse: { id: request.id, ok: true, module } });
				return;
			}
			const loaded = await loadBytes(controller.signal, receiveProgress, true);
			if (this.runtime === 'python' && request.asset === 'pyodide-lock.json') {
				this.pythonPackageAssets = readPythonPackageAssets(loaded.bytes);
			}
			if (controller.signal.aborted || generation !== this.generation) return;
			const buffer = transferBuffer(
				loaded.bytes,
				this.cache ? false : loaded.transferOwnership
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
				// The worker may already be terminated.
			}
		} finally {
			this.activeLoads.delete(controller);
		}
	}

	private captureLoadContext(): AssetLoadContext {
		return {
			config: { ...this.config },
			maxAssetBytes: this.maxAssetBytes,
			expectedAssets: new Set(this.expectedAssets),
			pythonPackageAssets: new Set(this.pythonPackageAssets),
			progress: this.progress
		};
	}

	private async loadVerifiedAsset(
		context: AssetLoadContext,
		asset: string,
		signal: AbortSignal
	): Promise<CachedRuntimeAsset> {
		const loaded = await this.loadAsset(asset, signal, context);
		const deliveryBytes = canonicalUint8Array(loaded.bytes);
		const sourceAssetByteLimit = this.sourceAssetByteLimit(context, asset);
		const runtimeAssetByteLimit = this.runtimeAssetByteLimit(context, asset);
		requireRuntimeAssetSize(asset, deliveryBytes.byteLength, sourceAssetByteLimit);
		let normalizedRuntimeBytes: Uint8Array;
		if (asset.endsWith('.gz')) {
			context.progress.activity('decompressing', asset);
			normalizedRuntimeBytes = await decompressGzip(
				deliveryBytes,
				asset,
				runtimeAssetByteLimit,
				signal
			);
		} else {
			normalizedRuntimeBytes = deliveryBytes;
		}
		const runtimeBytes = canonicalUint8Array(normalizedRuntimeBytes);
		requireRuntimeAssetSize(asset, runtimeBytes.byteLength, runtimeAssetByteLimit);
		const httpDecodedGzip = (loaded.contentEncoding || '')
			.toLowerCase()
			.split(',')
			.map((encoding) => encoding.trim())
			.includes('gzip');
		if (signal.aborted) throw runtimeAssetAbortReason(signal);
		let cancelOnAbort: (() => void) | undefined;
		const aborted = new Promise<never>((_resolve, reject) => {
			cancelOnAbort = () => reject(runtimeAssetAbortReason(signal));
			signal.addEventListener('abort', cancelOnAbort, { once: true });
		});
		try {
			if (context.config.integrity?.[asset]) {
				context.progress.activity('verifying', asset);
			}
			const verification = this.verifyIntegrity(
				context,
				asset,
				deliveryBytes,
				runtimeBytes,
				loaded.mimeType,
				!httpDecodedGzip
			);
			await Promise.race([verification, aborted]);
		} finally {
			if (cancelOnAbort) {
				signal.removeEventListener('abort', cancelOnAbort);
			}
		}
		if (signal.aborted) throw runtimeAssetAbortReason(signal);
		if (this.runtime === 'python' && asset === 'pyodide-lock.json')
			readPythonPackageAssets(runtimeBytes);
		return {
			bytes: runtimeBytes,
			mimeType: loaded.mimeType,
			transferOwnership:
				normalizedRuntimeBytes === deliveryBytes ? loaded.transferOwnership : true
		};
	}

	private validateAssetRequest(context: AssetLoadContext, asset: string) {
		if (!context.expectedAssets.has(asset) && !context.pythonPackageAssets.has(asset)) {
			throw new Error(`Unexpected ${this.runtime} runtime asset: ${asset}`);
		}
		if (context.config.integrity && !Object.hasOwn(context.config.integrity, asset)) {
			throw new Error(`Runtime asset ${asset} is missing integrity metadata`);
		}
	}

	private async loadAsset(
		asset: string,
		signal: AbortSignal,
		context = this.captureLoadContext()
	): Promise<LoadedAsset> {
		this.validateAssetRequest(context, asset);
		if (signal.aborted) {
			throw runtimeAssetAbortReason(signal);
		}
		const sourceAssetByteLimit = this.sourceAssetByteLimit(context, asset);
		this.runtimeAssetByteLimit(context, asset);
		const reportProgress = (loaded: number, total?: number) => {
			if (!signal.aborted) context.progress.update(asset, loaded, total);
		};
		if (context.config.loader) {
			const pendingResult = Promise.resolve(
				context.config.loader({
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
			const loaded = await this.normalizeLoaderResult(
				context,
				result,
				asset,
				signal,
				sourceAssetByteLimit
			);
			if (signal.aborted) {
				throw runtimeAssetAbortReason(signal);
			}
			if (loaded) return loaded;
		}
		return await this.fetchAsset(context, asset, asset, signal, sourceAssetByteLimit);
	}

	private async verifyIntegrity(
		context: AssetLoadContext,
		asset: string,
		deliveryBytes: Uint8Array,
		runtimeBytes: Uint8Array,
		mimeType?: string,
		hasDeliveryBytes = true
	) {
		const configured = context.config.integrity?.[asset];
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
		context: AssetLoadContext,
		result: RuntimeAssetLoaderResult,
		asset: string,
		signal: AbortSignal,
		maxAssetBytes: number
	): Promise<LoadedAsset | null> {
		if (!result) return null;
		if (typeof result === 'string' || result instanceof URL) {
			return await this.fetchAsset(context, String(result), asset, signal, maxAssetBytes);
		}
		const directBytes = snapshotLoaderBytes(result, asset, maxAssetBytes);
		if (directBytes) {
			context.progress.update(asset, directBytes.byteLength, directBytes.byteLength);
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
			requireRuntimeAssetSize(asset, size, maxAssetBytes);
			const source = await readAbortableArrayBuffer(blob, signal);
			const bytes = snapshotMaterializedArrayBuffer(source, asset, maxAssetBytes);
			context.progress.update(asset, bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType, transferOwnership: true };
		}
		if ('url' in result && result.url) {
			return await this.fetchAsset(context, String(result.url), asset, signal, maxAssetBytes);
		}
		if ('data' in result) {
			if (typeof result.data === 'string') {
				requireRuntimeAssetSize(
					asset,
					boundedUtf8ByteLength(result.data, maxAssetBytes),
					maxAssetBytes
				);
				const bytes = canonicalUint8Array(encoder.encode(result.data));
				requireRuntimeAssetSize(asset, bytes.byteLength, maxAssetBytes);
				context.progress.update(asset, bytes.byteLength, bytes.byteLength);
				return { bytes, mimeType: result.mimeType, transferOwnership: true };
			}
			const bytes = snapshotLoaderBytes(result.data, asset, maxAssetBytes);
			if (bytes) {
				context.progress.update(asset, bytes.byteLength, bytes.byteLength);
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
		context: AssetLoadContext,
		url: string,
		asset: string,
		signal: AbortSignal,
		maxAssetBytes = this.sourceAssetByteLimit(context, asset)
	): Promise<LoadedAsset> {
		const requestUrl = this.requireAllowedAssetUrl(context, asset, url);
		const persistentCache = context.config.persistentCache;
		const configured = context.config.integrity?.[asset];
		const expected = typeof configured === 'string' ? { sha256: configured } : configured;
		const lock = context.config.assetPrefix
			? resolveRuntimeAssetLockEntry(requestUrl, {
					assetRoot: context.config.baseUrl,
					assetPrefix: context.config.assetPrefix
				})
			: undefined;
		// Existing .gz receipts without a pair describe logical bytes, not stored gzip bytes.
		const receipt =
			expected && (!asset.endsWith('.gz') || expected.uncompressedSha256) ? expected : lock;
		const identity = receipt
			? {
					url: requestUrl.href,
					sha256: receipt.sha256,
					bytes: receipt.bytes,
					validationKey: JSON.stringify([
						'bridge-v1',
						context.config.baseUrl,
						allowedBaseUrlsKey(context.config),
						maxAssetBytes
					])
				}
			: undefined;
		if (identity && (identity.bytes === undefined || identity.bytes <= maxAssetBytes)) {
			const bytes = await readPersistentRuntimeAsset({
				identity,
				cache: persistentCache,
				signal
			});
			if (bytes) {
				requireRuntimeAssetSize(asset, bytes.byteLength, maxAssetBytes);
				context.progress.update(asset, bytes.byteLength, bytes.byteLength);
				return { bytes, mimeType: receipt?.mediaType, transferOwnership: true };
			}
		}
		const loaded = await this.fetchAssetFromNetwork(context, url, asset, signal, maxAssetBytes);
		if (identity && !loaded.contentEncoding) {
			// Only checksum-matching bytes are published. Existing runtime validation still runs.
			await writePersistentRuntimeAsset({
				identity,
				cache: persistentCache,
				signal,
				bytes: loaded.bytes
			});
		}
		return loaded;
	}

	private async fetchAssetFromNetwork(
		context: AssetLoadContext,
		url: string,
		asset: string,
		signal: AbortSignal,
		maxAssetBytes = this.sourceAssetByteLimit(context, asset)
	): Promise<LoadedAsset> {
		const requestUrl = this.requireAllowedAssetUrl(context, asset, url);
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
		if (contentLength !== undefined && contentLength > maxAssetBytes) {
			const error = runtimeAssetSizeError(asset, maxAssetBytes);
			cancelResponseBody(response, error);
			throw error;
		}
		const mimeType = response.headers.get('content-type') || undefined;
		const contentEncoding = response.headers.get('content-encoding') || undefined;
		if (!response.body) {
			const bytes = snapshotMaterializedArrayBuffer(
				await readAbortableArrayBuffer(response, signal),
				asset,
				maxAssetBytes
			);
			context.progress.update(asset, bytes.byteLength, contentLength ?? bytes.byteLength);
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
		let bytes = new Uint8Array(
			Math.min(maxAssetBytes, contentLength || DEFAULT_STREAM_BUFFER_BYTES)
		);
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
				if (nextLength > maxAssetBytes) {
					const error = runtimeAssetSizeError(asset, maxAssetBytes);
					readerCancelled = true;
					try {
						void reader.cancel(error).catch(() => undefined);
					} catch {}
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
				bytes.set(chunk, receivedLength);
				receivedLength = nextLength;
				context.progress.update(asset, receivedLength, contentLength);
			}
			if (receivedLength !== bytes.byteLength) bytes = bytes.slice(0, receivedLength);
			context.progress.update(asset, receivedLength, contentLength ?? receivedLength);
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

	private requireAllowedAssetUrl(context: AssetLoadContext, asset: string, value: string) {
		let url: URL;
		try {
			url = new URL(value, context.config.baseUrl);
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
		const allowed = [context.config.baseUrl, ...(context.config.allowedBaseUrls || [])].some(
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
		const controllers = [...this.activeLoads];
		this.activeLoads.clear();
		for (const controller of controllers) controller.abort();
	}
}
