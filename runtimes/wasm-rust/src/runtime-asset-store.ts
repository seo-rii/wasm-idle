import { resolveVersionedAssetUrl } from './asset-url.js';
import { fetchRuntimeAssetBytes, fetchRuntimeAssetJson } from './runtime-asset.js';
import type { RuntimeAssetPackReference } from './runtime-manifest.js';

export interface RuntimePackIndexEntry {
	runtimePath: string;
	offset: number;
	length: number;
}

export interface RuntimePackIndex {
	format: 'wasm-rust-runtime-pack-index-v1';
	fileCount: number;
	totalBytes: number;
	entries: RuntimePackIndexEntry[];
}

export interface RuntimePackAssetEntry {
	runtimePath: string;
	bytes: Uint8Array;
}

const runtimePackBytesCache = new Map<string, Promise<Uint8Array>>();
const runtimePackIndexCache = new Map<string, Promise<RuntimePackIndex>>();

function expectObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-rust runtime pack index`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid ${label} in wasm-rust runtime pack index`);
	}
	return value;
}

function expectNonNegativeInteger(value: unknown, label: string): number {
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value < 0 ||
		!Number.isFinite(value)
	) {
		throw new Error(`invalid ${label} in wasm-rust runtime pack index`);
	}
	return value;
}

export function clearRuntimeAssetPackCache() {
	runtimePackBytesCache.clear();
	runtimePackIndexCache.clear();
}

export function parseRuntimePackIndex(value: unknown): RuntimePackIndex {
	const root = expectObject(value, 'root');
	if (root.format !== 'wasm-rust-runtime-pack-index-v1') {
		throw new Error('invalid root.format in wasm-rust runtime pack index');
	}
	if (!Array.isArray(root.entries)) {
		throw new Error('invalid root.entries in wasm-rust runtime pack index');
	}
	const totalBytes = expectNonNegativeInteger(root.totalBytes, 'root.totalBytes');
	const entries = root.entries.map((entry, index) => {
		const object = expectObject(entry, `root.entries[${index}]`);
		return {
			runtimePath: expectString(object.runtimePath, `root.entries[${index}].runtimePath`),
			offset: expectNonNegativeInteger(object.offset, `root.entries[${index}].offset`),
			length: expectNonNegativeInteger(object.length, `root.entries[${index}].length`)
		};
	});
	const fileCount = expectNonNegativeInteger(root.fileCount, 'root.fileCount');
	if (fileCount !== entries.length) {
		throw new Error('invalid root.fileCount in wasm-rust runtime pack index');
	}
	const seenRuntimePaths = new Set<string>();
	for (const entry of entries) {
		if (seenRuntimePaths.has(entry.runtimePath)) {
			throw new Error(
				`invalid root.entries runtimePath ${entry.runtimePath} in wasm-rust runtime pack index`
			);
		}
		seenRuntimePaths.add(entry.runtimePath);
		if (entry.offset + entry.length > totalBytes) {
			throw new Error(
				`invalid runtime pack range for ${entry.runtimePath}: ${entry.offset}+${entry.length} exceeds ${totalBytes}`
			);
		}
	}
	return {
		format: 'wasm-rust-runtime-pack-index-v1',
		fileCount,
		totalBytes,
		entries
	};
}

async function loadRuntimePackBytes(
	runtimeBaseUrl: string | URL,
	pack: RuntimeAssetPackReference,
	fetchImpl: typeof fetch,
	onProgress?: (progress: { loaded: number; total?: number }) => void
) {
	const assetUrl = resolveVersionedAssetUrl(runtimeBaseUrl, pack.asset).toString();
	let cachedBytes = runtimePackBytesCache.get(assetUrl);
	if (!cachedBytes) {
		cachedBytes = fetchRuntimeAssetBytes(
			assetUrl,
			`wasm-rust runtime pack ${pack.asset}`,
			fetchImpl,
			true,
			onProgress
		);
		runtimePackBytesCache.set(assetUrl, cachedBytes);
		cachedBytes.catch(() => {
			if (runtimePackBytesCache.get(assetUrl) === cachedBytes) {
				runtimePackBytesCache.delete(assetUrl);
			}
		});
	}
	return cachedBytes;
}

async function loadRuntimePackIndex(
	runtimeBaseUrl: string | URL,
	pack: RuntimeAssetPackReference,
	fetchImpl: typeof fetch
) {
	const indexUrl = resolveVersionedAssetUrl(runtimeBaseUrl, pack.index).toString();
	let cachedIndex = runtimePackIndexCache.get(indexUrl);
	if (!cachedIndex) {
		cachedIndex = fetchRuntimeAssetJson<unknown>(
			indexUrl,
			`wasm-rust runtime pack index ${pack.index}`,
			fetchImpl
		).then((value) => parseRuntimePackIndex(value));
		runtimePackIndexCache.set(indexUrl, cachedIndex);
		cachedIndex.catch(() => {
			if (runtimePackIndexCache.get(indexUrl) === cachedIndex) {
				runtimePackIndexCache.delete(indexUrl);
			}
		});
	}
	return cachedIndex;
}

export async function loadRuntimePackEntries(
	runtimeBaseUrl: string | URL,
	pack: RuntimeAssetPackReference,
	fetchImpl: typeof fetch = fetch,
	onProgress?: (progress: { loaded: number; total?: number }) => void
): Promise<RuntimePackAssetEntry[]> {
	const [index, packBytes] = await Promise.all([
		loadRuntimePackIndex(runtimeBaseUrl, pack, fetchImpl),
		loadRuntimePackBytes(runtimeBaseUrl, pack, fetchImpl, onProgress)
	]);
	if (index.fileCount !== pack.fileCount) {
		throw new Error(
			`invalid wasm-rust runtime pack ${pack.index}: expected ${pack.fileCount} files but got ${index.fileCount}`
		);
	}
	if (index.totalBytes !== pack.totalBytes) {
		throw new Error(
			`invalid wasm-rust runtime pack ${pack.index}: expected ${pack.totalBytes} bytes but got ${index.totalBytes}`
		);
	}
	if (packBytes.byteLength < index.totalBytes) {
		throw new Error(
			`invalid wasm-rust runtime pack ${pack.asset}: expected at least ${index.totalBytes} bytes but got ${packBytes.byteLength}`
		);
	}
	return index.entries.map((entry) => ({
		runtimePath: entry.runtimePath,
		bytes: packBytes.subarray(entry.offset, entry.offset + entry.length)
	}));
}
