import {
	RUNTIME_LOAD_ASSETS,
	type ResolvedRuntimeAssetConfig,
	type RuntimeAssetLoaderResult,
	type RuntimeAssetRuntime
} from '$lib/playground/assets';

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
	mimeType?: string;
	transferOwnership?: boolean;
};

const encoder = new TextEncoder();

const transferBuffer = (bytes: Uint8Array, transferOwnership = false) =>
	transferOwnership &&
	bytes.byteOffset === 0 &&
	bytes.byteLength === bytes.buffer.byteLength &&
	bytes.buffer instanceof ArrayBuffer
		? bytes.buffer
		: Uint8Array.from(bytes).buffer;

const expectedAssetsForRuntime = (runtime: RuntimeAssetRuntime) =>
	new Set<string>(RUNTIME_LOAD_ASSETS[runtime]);

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
			if (controller.signal.aborted || generation !== this.generation) return;
			const buffer = transferBuffer(loaded.bytes, loaded.transferOwnership);
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
			worker.postMessage({
				assetResponse: {
					id: request.id,
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				}
			});
		} finally {
			this.activeLoads.delete(controller);
		}
	}

	private async loadAsset(asset: string, signal: AbortSignal): Promise<LoadedAsset> {
		if (!this.expectedAssets.has(asset)) {
			throw new Error(`Unexpected ${this.runtime} runtime asset: ${asset}`);
		}
		const reportProgress = (loaded: number, total?: number) =>
			this.progress.update(asset, loaded, total);
		if (this.config.loader) {
			const loaded = await this.normalizeLoaderResult(
				await this.config.loader({
					runtime: this.runtime,
					asset,
					reportProgress,
					signal
				}),
				asset,
				signal
			);
			if (loaded) return loaded;
		}
		return await this.fetchAsset(new URL(asset, this.config.baseUrl).href, asset, signal);
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
		if (result instanceof Blob) {
			const bytes = new Uint8Array(await result.arrayBuffer());
			this.progress.update(asset, bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType: result.type || undefined, transferOwnership: true };
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
			const bytes = new Uint8Array(await result.data.arrayBuffer());
			this.progress.update(asset, bytes.byteLength, bytes.byteLength);
			return {
				bytes,
				mimeType: result.mimeType || result.data.type || undefined,
				transferOwnership: true
			};
		}
		return null;
	}

	private async fetchAsset(
		url: string,
		asset: string,
		signal: AbortSignal
	): Promise<LoadedAsset> {
		const response = await fetch(url, { signal });
		if (!response.ok) throw new Error(`Failed to load ${asset}: ${response.status}`);
		const contentLength =
			Number(
				response.headers.get('x-wasm-idle-original-content-length') ||
					response.headers.get('content-length') ||
					0
			) || undefined;
		const mimeType = response.headers.get('content-type') || undefined;
		if (!response.body) {
			const bytes = new Uint8Array(await response.arrayBuffer());
			this.progress.update(asset, bytes.byteLength, contentLength ?? bytes.byteLength);
			return { bytes, mimeType, transferOwnership: true };
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
			this.progress.update(asset, receivedLength, contentLength);
		}
		const bytes = new Uint8Array(receivedLength);
		let position = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, position);
			position += chunk.byteLength;
		}
		this.progress.update(asset, receivedLength, contentLength ?? receivedLength);
		return { bytes, mimeType, transferOwnership: true };
	}

	private abortActiveLoads() {
		for (const controller of this.activeLoads) controller.abort();
		this.activeLoads.clear();
	}
}
