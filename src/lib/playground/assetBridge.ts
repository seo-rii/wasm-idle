import {
	JAVA_RUNTIME_LOAD_ASSETS,
	PYTHON_RUNTIME_LOAD_ASSETS,
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
};

const encoder = new TextEncoder();

const transferBuffer = (bytes: Uint8Array) =>
	bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
		? bytes.buffer
		: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const expectedAssetsForRuntime = (runtime: RuntimeAssetRuntime) =>
	new Set<string>(
		runtime === 'python' ? [...PYTHON_RUNTIME_LOAD_ASSETS] : [...JAVA_RUNTIME_LOAD_ASSETS]
	);

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
		const fraction = total && total > 0 ? Math.min(loaded / total, 1) : loaded > 0 ? 1 : 0;
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
		this.worker = worker;
		this.config = config;
		this.progress.reset(progress);
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
		try {
			const loaded = await this.loadAsset(request.asset);
			const buffer = transferBuffer(loaded.bytes);
			this.worker.postMessage(
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
			this.worker.postMessage({
				assetResponse: {
					id: request.id,
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				}
			});
		}
	}

	private async loadAsset(asset: string): Promise<LoadedAsset> {
		const reportProgress = (loaded: number, total?: number) =>
			this.progress.update(asset, loaded, total);
		if (this.config.loader) {
			const loaded = await this.normalizeLoaderResult(
				await this.config.loader({
					runtime: this.runtime,
					asset,
					reportProgress
				}),
				asset
			);
			if (loaded) return loaded;
		}
		return await this.fetchAsset(new URL(asset, this.config.baseUrl).href, asset);
	}

	private async normalizeLoaderResult(
		result: RuntimeAssetLoaderResult,
		asset: string
	): Promise<LoadedAsset | null> {
		if (!result) return null;
		if (typeof result === 'string' || result instanceof URL) {
			return await this.fetchAsset(String(result), asset);
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
			return { bytes, mimeType: result.type || undefined };
		}
		if ('url' in result && result.url) {
			return await this.fetchAsset(String(result.url), asset);
		}
		if ('data' in result) {
			if (typeof result.data === 'string') {
				const bytes = encoder.encode(result.data);
				this.progress.update(asset, bytes.byteLength, bytes.byteLength);
				return { bytes, mimeType: result.mimeType };
			}
			if (result.data instanceof ArrayBuffer) {
				const bytes = new Uint8Array(result.data);
				this.progress.update(asset, bytes.byteLength, bytes.byteLength);
				return { bytes, mimeType: result.mimeType };
			}
			if (result.data instanceof Uint8Array) {
				this.progress.update(asset, result.data.byteLength, result.data.byteLength);
				return { bytes: result.data, mimeType: result.mimeType };
			}
			const bytes = new Uint8Array(await result.data.arrayBuffer());
			this.progress.update(asset, bytes.byteLength, bytes.byteLength);
			return { bytes, mimeType: result.mimeType || result.data.type || undefined };
		}
		return null;
	}

	private async fetchAsset(url: string, asset: string): Promise<LoadedAsset> {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Failed to load ${asset}: ${response.status}`);
		const contentLength = Number(response.headers.get('content-length') || 0) || undefined;
		const mimeType = response.headers.get('content-type') || undefined;
		if (!response.body) {
			const bytes = new Uint8Array(await response.arrayBuffer());
			this.progress.update(asset, bytes.byteLength, contentLength ?? bytes.byteLength);
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
			this.progress.update(asset, receivedLength, contentLength);
		}
		const bytes = new Uint8Array(receivedLength);
		let position = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, position);
			position += chunk.byteLength;
		}
		this.progress.update(asset, receivedLength, contentLength ?? receivedLength);
		return { bytes, mimeType };
	}
}
