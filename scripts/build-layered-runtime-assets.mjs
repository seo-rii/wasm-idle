import { createHash } from 'node:crypto';
import { readdir, readFile, rename, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_ROOT_DIR = path.join(REPO_ROOT, 'static');
const UINT32_MAX = 0xffffffff;
const MAX_ANCHOR_CANDIDATES = 8;
const LAYER_MANIFEST_FILE = 'layered-runtime-assets.v1.json';
const COMPRESSED_MANIFEST_FILE = 'compressed-runtime-assets.v1.json';

export const COPY_LITERAL_DELTA_FORMAT = 'copy-literal-v1';
export const COPY_LITERAL_ANCHOR_BYTES = 16;
export const COPY_LITERAL_MIN_COPY_BYTES = 32;
export const MAX_LAYER_RAW_BYTES = 16 * 1024 * 1024;

let temporaryFileCounter = 0;

/** @typedef {{ changed: boolean, beforeBytes: number, afterBytes: number, savedBytes: number, assetCount: number }} BuildSummary */
/** @typedef {{ runtimePath: string, offset: number, length: number }} PackIndexEntry */
/** @typedef {{ entries: PackIndexEntry[], fileCount: number, totalBytes: number }} PackIndex */
/** @typedef {{ index: PackIndex, indexGzip: Buffer, indexPath: string, pack: Buffer, packGzip: Buffer, packPath: string }} PackBundle */
/** @typedef {{ filePath: string, bytes: Buffer }} OutputFile */
/** @typedef {{ layer: string, offset: number, length: number }} LayeredAssetEntry */
/** @typedef {{ path?: string, length?: number, compressedLength?: number, sha256?: string }} LayerDescriptor */
/** @typedef {{ schemaVersion: number, maxLayerBytes?: number, layers: Record<string, string | LayerDescriptor>, assets: Record<string, LayeredAssetEntry> }} LayerManifest */
/** @typedef {{ path: string, size: number }} SourceFile */
/** @typedef {{ originalPath: string | null, compressedPath: string | null, sourceFiles: SourceFile[] }} SourceRecord */
/** @typedef {{ family: 'tinygo' | 'dotnet', prefix: string, directory: string, layerPath: (index: number) => string }} LayerConfig */
/** @typedef {{ path: string, rawBytes: number, chunks: Buffer[] }} PendingLayer */

/** @param {Uint8Array} bytes @param {string} label @returns {Buffer} */
function bytesAsBuffer(bytes, label) {
	if (Buffer.isBuffer(bytes)) return bytes;
	if (bytes instanceof Uint8Array) {
		return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}
	throw new TypeError(`${label} must be a Uint8Array`);
}

/** @param {Buffer} bytes @param {number} offset */
function anchorHash(bytes, offset) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < COPY_LITERAL_ANCHOR_BYTES; index += 1) {
		hash = Math.imul(hash ^ bytes[offset + index], 0x01000193);
	}
	return hash >>> 0;
}

/**
 * Encode target bytes as deterministic literal and base-copy operations.
 *
 * Literal: 0x00, u32LE byte length, literal bytes.
 * Copy:    0x01, u32LE base offset, u32LE byte length.
 *
 * @param {Uint8Array} baseBytes
 * @param {Uint8Array} targetBytes
 */
export function encodeCopyLiteralDelta(baseBytes, targetBytes) {
	const base = bytesAsBuffer(baseBytes, 'baseBytes');
	const target = bytesAsBuffer(targetBytes, 'targetBytes');
	if (base.byteLength > UINT32_MAX + 1) {
		throw new RangeError('baseBytes exceed the copy-literal u32 address space');
	}

	/** @type {Map<number, number[]>} */
	const anchors = new Map();
	for (
		let offset = 0;
		offset + COPY_LITERAL_ANCHOR_BYTES <= base.byteLength;
		offset += COPY_LITERAL_ANCHOR_BYTES
	) {
		const hash = anchorHash(base, offset);
		const candidates = anchors.get(hash);
		if (!candidates) {
			anchors.set(hash, [offset]);
		} else if (candidates.length < MAX_ANCHOR_CANDIDATES) {
			candidates.push(offset);
		}
	}

	/** @type {Buffer[]} */
	const chunks = [];
	/** @param {number} start @param {number} end */
	const emitLiteral = (start, end) => {
		let cursor = start;
		while (cursor < end) {
			const length = Math.min(end - cursor, UINT32_MAX);
			const header = Buffer.allocUnsafe(5);
			header[0] = 0;
			header.writeUInt32LE(length, 1);
			chunks.push(header, target.subarray(cursor, cursor + length));
			cursor += length;
		}
	};
	/** @param {number} offset @param {number} length */
	const emitCopy = (offset, length) => {
		let remaining = length;
		let cursor = offset;
		while (remaining > 0) {
			const operationLength = Math.min(remaining, UINT32_MAX);
			const operation = Buffer.allocUnsafe(9);
			operation[0] = 1;
			operation.writeUInt32LE(cursor, 1);
			operation.writeUInt32LE(operationLength, 5);
			chunks.push(operation);
			cursor += operationLength;
			remaining -= operationLength;
		}
	};

	let literalStart = 0;
	let targetCursor = 0;
	while (targetCursor + COPY_LITERAL_ANCHOR_BYTES <= target.byteLength) {
		const candidates = anchors.get(anchorHash(target, targetCursor)) || [];
		let bestBaseStart = -1;
		let bestTargetStart = -1;
		let bestLength = 0;
		for (const candidateOffset of candidates) {
			let anchorMatches = true;
			for (let index = 0; index < COPY_LITERAL_ANCHOR_BYTES; index += 1) {
				if (base[candidateOffset + index] !== target[targetCursor + index]) {
					anchorMatches = false;
					break;
				}
			}
			if (!anchorMatches) continue;

			let backwardLength = 0;
			while (
				targetCursor - backwardLength > literalStart &&
				candidateOffset - backwardLength > 0 &&
				target[targetCursor - backwardLength - 1] ===
					base[candidateOffset - backwardLength - 1]
			) {
				backwardLength += 1;
			}
			let forwardLength = COPY_LITERAL_ANCHOR_BYTES;
			while (
				targetCursor + forwardLength < target.byteLength &&
				candidateOffset + forwardLength < base.byteLength &&
				target[targetCursor + forwardLength] === base[candidateOffset + forwardLength]
			) {
				forwardLength += 1;
			}
			const matchLength = backwardLength + forwardLength;
			const matchBaseStart = candidateOffset - backwardLength;
			if (
				matchLength >= COPY_LITERAL_MIN_COPY_BYTES &&
				(matchLength > bestLength ||
					(matchLength === bestLength &&
						(matchBaseStart < bestBaseStart ||
							(bestBaseStart === matchBaseStart &&
								targetCursor - backwardLength < bestTargetStart))))
			) {
				bestBaseStart = matchBaseStart;
				bestTargetStart = targetCursor - backwardLength;
				bestLength = matchLength;
			}
		}

		if (bestLength === 0) {
			targetCursor += 1;
			continue;
		}
		emitLiteral(literalStart, bestTargetStart);
		emitCopy(bestBaseStart, bestLength);
		targetCursor = bestTargetStart + bestLength;
		literalStart = targetCursor;
	}
	emitLiteral(literalStart, target.byteLength);
	return Buffer.concat(chunks);
}

/** @param {Uint8Array} baseBytes @param {Uint8Array} deltaBytes */
export function decodeCopyLiteralDelta(baseBytes, deltaBytes) {
	const base = bytesAsBuffer(baseBytes, 'baseBytes');
	const delta = bytesAsBuffer(deltaBytes, 'deltaBytes');
	/** @type {Buffer[]} */
	const chunks = [];
	let cursor = 0;
	while (cursor < delta.byteLength) {
		const opcode = delta[cursor];
		if (opcode === 0) {
			if (cursor + 5 > delta.byteLength)
				throw new Error('truncated copy-literal literal header');
			const length = delta.readUInt32LE(cursor + 1);
			const end = cursor + 5 + length;
			if (end > delta.byteLength) throw new Error('truncated copy-literal literal bytes');
			chunks.push(delta.subarray(cursor + 5, end));
			cursor = end;
			continue;
		}
		if (opcode === 1) {
			if (cursor + 9 > delta.byteLength)
				throw new Error('truncated copy-literal copy header');
			const offset = delta.readUInt32LE(cursor + 1);
			const length = delta.readUInt32LE(cursor + 5);
			if (offset + length > base.byteLength) {
				throw new Error(`copy-literal range ${offset}+${length} exceeds base bytes`);
			}
			chunks.push(base.subarray(offset, offset + length));
			cursor += 9;
			continue;
		}
		throw new Error(`unknown copy-literal opcode ${opcode}`);
	}
	return Buffer.concat(chunks);
}

/** @param {string} runtimePath */
export function normalizeRustMatchingKey(runtimePath) {
	if (typeof runtimePath !== 'string' || runtimePath.length === 0) {
		throw new TypeError('Rust runtimePath must be a non-empty string');
	}
	return runtimePath
		.replace(/wasm32-wasip[123]/gu, '{target-triple}')
		.replace(/-[0-9a-f]{16}(?=\.(?:rlib|rmeta)$)/iu, '-{metadata-hash}');
}

export const normalizeRustRuntimePathForMatching = normalizeRustMatchingKey;

/** @returns {BuildSummary} */
function emptySummary() {
	return {
		changed: false,
		beforeBytes: 0,
		afterBytes: 0,
		savedBytes: 0,
		assetCount: 0
	};
}

/** @param {string} filePath @param {{ optional?: boolean }} [options] @returns {Promise<any>} */
async function readJson(filePath, { optional = false } = {}) {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch (error) {
		if (
			optional &&
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		)
			return null;
		throw error;
	}
}

/** @param {unknown} value */
function jsonBytes(value) {
	return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** @param {Buffer} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {OutputFile[]} files */
async function commitFiles(files) {
	/** @type {{ filePath: string, temporaryPath: string }[]} */
	const staged = [];
	try {
		for (const file of files) {
			await mkdir(path.dirname(file.filePath), { recursive: true });
			const temporaryPath = `${file.filePath}.tmp-${process.pid}-${temporaryFileCounter++}`;
			await writeFile(temporaryPath, file.bytes);
			staged.push({ filePath: file.filePath, temporaryPath });
		}
		for (const file of staged) await rename(file.temporaryPath, file.filePath);
	} catch (error) {
		await Promise.all(staged.map((file) => rm(file.temporaryPath, { force: true })));
		throw error;
	}
}

/** @param {string} runtimeDir @param {string} assetPath */
function resolveRuntimeAsset(runtimeDir, assetPath) {
	if (typeof assetPath !== 'string' || assetPath.length === 0) {
		throw new Error('runtime asset reference must be a non-empty string');
	}
	const resolved = path.resolve(runtimeDir, assetPath);
	const relative = path.relative(runtimeDir, resolved);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`runtime asset escapes its runtime directory: ${assetPath}`);
	}
	return resolved;
}

/** @param {string} runtimeDir @param {any} reference @param {string} label @returns {Promise<PackBundle>} */
async function readPackBundle(runtimeDir, reference, label) {
	if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
		throw new Error(`${label} is missing a runtime pack reference`);
	}
	const packPath = resolveRuntimeAsset(runtimeDir, reference.asset);
	const indexPath = resolveRuntimeAsset(runtimeDir, reference.index);
	const [packGzip, indexGzip] = await Promise.all([readFile(packPath), readFile(indexPath)]);
	const pack = gunzipSync(packGzip);
	const index = /** @type {PackIndex} */ (JSON.parse(gunzipSync(indexGzip).toString('utf8')));
	if (!index || typeof index !== 'object' || !Array.isArray(index.entries)) {
		throw new Error(`${label} has an invalid runtime pack index`);
	}
	if (index.fileCount !== index.entries.length || index.totalBytes !== pack.byteLength) {
		throw new Error(`${label} runtime pack index does not match its pack`);
	}
	const seenRuntimePaths = new Set();
	for (const [entryIndex, entry] of index.entries.entries()) {
		if (
			!entry ||
			typeof entry !== 'object' ||
			typeof entry.runtimePath !== 'string' ||
			!Number.isSafeInteger(entry.offset) ||
			entry.offset < 0 ||
			!Number.isSafeInteger(entry.length) ||
			entry.length < 0 ||
			entry.offset > pack.byteLength - entry.length
		) {
			throw new Error(`${label} has an invalid runtime pack entry at index ${entryIndex}`);
		}
		if (seenRuntimePaths.has(entry.runtimePath)) {
			throw new Error(`${label} has duplicate runtime path ${entry.runtimePath}`);
		}
		seenRuntimePaths.add(entry.runtimePath);
	}
	return { index, indexGzip, indexPath, pack, packGzip, packPath };
}

/**
 * @param {PackBundle} baseBundle
 * @param {PackBundle} targetBundle
 * @param {(runtimePath: string) => string} matchingKey
 * @param {string} indexFormat
 */
function buildDeltaPack(baseBundle, targetBundle, matchingKey, indexFormat) {
	/** @type {Map<string, PackIndexEntry>} */
	const baseEntries = new Map();
	for (const entry of baseBundle.index.entries) {
		const key = matchingKey(entry.runtimePath);
		if (baseEntries.has(key)) throw new Error(`duplicate normalized base runtime path ${key}`);
		baseEntries.set(key, entry);
	}

	/** @type {Buffer[]} */
	const chunks = [];
	/** @type {Array<PackIndexEntry & { decodedLength: number, baseRuntimePath?: string }>} */
	const entries = [];
	let totalBytes = 0;
	for (const targetEntry of targetBundle.index.entries) {
		const baseEntry = baseEntries.get(matchingKey(targetEntry.runtimePath));
		const targetBytes = targetBundle.pack.subarray(
			targetEntry.offset,
			targetEntry.offset + targetEntry.length
		);
		const deltaBytes = baseEntry
			? encodeCopyLiteralDelta(
					baseBundle.pack.subarray(baseEntry.offset, baseEntry.offset + baseEntry.length),
					targetBytes
				)
			: encodeCopyLiteralDelta(Buffer.alloc(0), targetBytes);
		entries.push({
			runtimePath: targetEntry.runtimePath,
			offset: totalBytes,
			length: deltaBytes.byteLength,
			decodedLength: targetEntry.length,
			...(baseEntry ? { baseRuntimePath: baseEntry.runtimePath } : {})
		});
		chunks.push(deltaBytes);
		totalBytes += deltaBytes.byteLength;
	}
	return {
		pack: Buffer.concat(chunks, totalBytes),
		index: {
			format: indexFormat,
			fileCount: entries.length,
			totalBytes,
			decodedTotalBytes: targetBundle.pack.byteLength,
			entries
		}
	};
}

/** @param {string} rootDir */
async function transformRustSysroots(rootDir) {
	const runtimeDir = path.join(rootDir, 'wasm-rust', 'runtime');
	const manifestPath = path.join(runtimeDir, 'runtime-manifest.v3.json');
	const manifest = await readJson(manifestPath, { optional: true });
	if (!manifest) return emptySummary();
	const baseReference = manifest.targets?.['wasm32-wasip1']?.sysrootPack;
	const pendingTargets = ['wasm32-wasip2', 'wasm32-wasip3'].filter((targetTriple) => {
		const reference = manifest.targets?.[targetTriple]?.sysrootPack;
		return reference && reference.delta?.format !== COPY_LITERAL_DELTA_FORMAT;
	});
	if (pendingTargets.length === 0) return emptySummary();
	const baseBundle = await readPackBundle(runtimeDir, baseReference, 'Rust wasm32-wasip1');
	/** @type {OutputFile[]} */
	const outputFiles = [];
	const details = [];
	let beforeBytes = 0;
	let afterBytes = 0;
	for (const targetTriple of pendingTargets) {
		const targetConfig = manifest.targets[targetTriple];
		const targetReference = targetConfig.sysrootPack;
		const targetBundle = await readPackBundle(
			runtimeDir,
			targetReference,
			`Rust ${targetTriple}`
		);
		const delta = buildDeltaPack(
			baseBundle,
			targetBundle,
			normalizeRustMatchingKey,
			'wasm-rust-runtime-delta-pack-index-v1'
		);
		const packGzip = gzipSync(delta.pack, { level: 9 });
		const indexGzip = gzipSync(jsonBytes(delta.index), { level: 9 });
		const targetBeforeBytes =
			targetBundle.packGzip.byteLength + targetBundle.indexGzip.byteLength;
		const targetAfterBytes = packGzip.byteLength + indexGzip.byteLength;
		beforeBytes += targetBeforeBytes;
		afterBytes += targetAfterBytes;
		details.push({
			target: targetTriple,
			beforeBytes: targetBeforeBytes,
			afterBytes: targetAfterBytes,
			savedBytes: targetBeforeBytes - targetAfterBytes
		});
		outputFiles.push(
			{ filePath: targetBundle.packPath, bytes: packGzip },
			{ filePath: targetBundle.indexPath, bytes: indexGzip }
		);
		targetConfig.sysrootPack = {
			...targetReference,
			fileCount: delta.index.fileCount,
			totalBytes: delta.index.totalBytes,
			decodedTotalBytes: delta.index.decodedTotalBytes,
			delta: {
				format: COPY_LITERAL_DELTA_FORMAT,
				base: { ...baseReference }
			}
		};
	}
	outputFiles.push({ filePath: manifestPath, bytes: jsonBytes(manifest) });
	await commitFiles(outputFiles);
	return {
		changed: true,
		beforeBytes,
		afterBytes,
		savedBytes: beforeBytes - afterBytes,
		assetCount: pendingTargets.length,
		details
	};
}

/** @param {string} rootDir */
async function transformGoSysroot(rootDir) {
	const runtimeDir = path.join(rootDir, 'wasm-go', 'runtime');
	const manifestPath = path.join(runtimeDir, 'runtime-manifest.v1.json');
	const manifest = await readJson(manifestPath, { optional: true });
	if (!manifest) return emptySummary();
	const baseReference = manifest.targets?.['wasip1/wasm']?.sysrootPack;
	const targetReference = manifest.targets?.['js/wasm']?.sysrootPack;
	if (!targetReference || !baseReference) return emptySummary();

	if (targetReference.delta?.format === COPY_LITERAL_DELTA_FORMAT) {
		return emptySummary();
	}

	const [baseBundle, targetBundle] = await Promise.all([
		readPackBundle(runtimeDir, baseReference, 'Go wasip1/wasm'),
		readPackBundle(runtimeDir, targetReference, 'Go js/wasm')
	]);
	const delta = buildDeltaPack(
		baseBundle,
		targetBundle,
		/** @param {string} runtimePath */ (runtimePath) => runtimePath,
		'wasm-go-runtime-delta-pack-index-v1'
	);
	const packGzip = gzipSync(delta.pack, { level: 9 });
	const indexGzip = gzipSync(jsonBytes(delta.index), { level: 9 });
	const nextReference = {
		...targetReference,
		fileCount: delta.index.fileCount,
		totalBytes: delta.index.totalBytes,
		decodedTotalBytes: delta.index.decodedTotalBytes,
		delta: {
			format: COPY_LITERAL_DELTA_FORMAT,
			base: { ...baseReference }
		}
	};
	for (const targetConfig of Object.values(manifest.targets)) {
		const reference = targetConfig?.sysrootPack;
		if (
			reference?.asset === targetReference.asset &&
			reference?.index === targetReference.index
		) {
			targetConfig.sysrootPack = { ...nextReference };
		}
	}
	await commitFiles([
		{ filePath: targetBundle.packPath, bytes: packGzip },
		{ filePath: targetBundle.indexPath, bytes: indexGzip },
		{ filePath: manifestPath, bytes: jsonBytes(manifest) }
	]);
	const beforeBytes = targetBundle.packGzip.byteLength + targetBundle.indexGzip.byteLength;
	const afterBytes = packGzip.byteLength + indexGzip.byteLength;
	return {
		changed: true,
		beforeBytes,
		afterBytes,
		savedBytes: beforeBytes - afterBytes,
		assetCount: 1
	};
}

/** @param {string} directory @returns {Promise<string[]>} */
async function collectFiles(directory) {
	const directoryStats = await stat(directory).catch(() => null);
	if (!directoryStats?.isDirectory()) return [];
	/** @type {string[]} */
	const files = [];
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
		left.name < right.name ? -1 : left.name > right.name ? 1 : 0
	)) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
		else if (entry.isFile()) files.push(entryPath);
	}
	return files;
}

/** @param {string} rootDir @param {string} filePath */
function relativeToRoot(rootDir, filePath) {
	return path.relative(rootDir, filePath).split(path.sep).join('/');
}

/** @param {any} value @returns {LayerManifest} */
function normalizedLayerManifest(value) {
	if (!value) {
		return {
			schemaVersion: 1,
			maxLayerBytes: MAX_LAYER_RAW_BYTES,
			layers: {},
			assets: {}
		};
	}
	if (
		value.schemaVersion !== 1 ||
		!value.layers ||
		typeof value.layers !== 'object' ||
		Array.isArray(value.layers) ||
		!value.assets ||
		typeof value.assets !== 'object' ||
		Array.isArray(value.assets)
	) {
		throw new Error(`invalid ${LAYER_MANIFEST_FILE}`);
	}
	return value;
}

/** @param {string} rootDir */
async function buildServiceWorkerLayers(rootDir) {
	const compressedManifestPath = path.join(rootDir, COMPRESSED_MANIFEST_FILE);
	const layerManifestPath = path.join(rootDir, LAYER_MANIFEST_FILE);
	const compressedManifest = (await readJson(compressedManifestPath, { optional: true })) || {
		assets: [],
		sizes: {}
	};
	const existingLayerManifest = normalizedLayerManifest(
		await readJson(layerManifestPath, { optional: true })
	);
	/** @type {Set<string>} */
	const compressedAssets = new Set();
	if (Array.isArray(compressedManifest.assets)) {
		for (const assetPath of compressedManifest.assets) {
			if (typeof assetPath === 'string') compressedAssets.add(assetPath);
		}
	}
	/** @type {LayerConfig[]} */
	const configs = [
		{
			family: 'tinygo',
			prefix: 'wasm-tinygo/vendor/emception/',
			directory: path.join(rootDir, 'wasm-tinygo', 'vendor', 'emception'),
			layerPath: (/** @type {number} */ index) =>
				`wasm-tinygo/layers/emception-${String(index).padStart(2, '0')}.pack.gz`
		},
		...['ref', 'csharp', 'fsharp', 'vbnet'].map(
			(runtime) =>
				/** @type {LayerConfig} */ ({
					family: 'dotnet',
					prefix: `wasm-dotnet/runtime/${runtime}/`,
					directory: path.join(rootDir, 'wasm-dotnet', 'runtime', runtime),
					layerPath: (index) =>
						`wasm-dotnet/runtime/layers/${runtime}-${String(index).padStart(2, '0')}.pack.gz`
				})
		)
	];
	const existingAssets = existingLayerManifest.assets;
	const nextAssets = { ...existingAssets };
	const nextLayers = { ...existingLayerManifest.layers };
	/** @type {OutputFile[]} */
	const layerFiles = [];
	/** @type {Set<string>} */
	const sourcePathsToRemove = new Set();
	/** @type {Set<string>} */
	const staleLayerPathsToRemove = new Set();
	/** @type {Record<'tinygo' | 'dotnet', BuildSummary>} */
	const summaries = { tinygo: emptySummary(), dotnet: emptySummary() };

	for (const config of configs) {
		const candidates = new Set(
			[...compressedAssets].filter((assetPath) => assetPath.startsWith(config.prefix))
		);
		for (const filePath of await collectFiles(config.directory)) {
			const logicalPath = relativeToRoot(rootDir, filePath);
			if (logicalPath.endsWith('.gz') && compressedAssets.has(logicalPath.slice(0, -3))) {
				candidates.add(logicalPath.slice(0, -3));
			} else {
				candidates.add(logicalPath);
			}
		}

		const candidatePaths = [...candidates].sort();
		const existingGroupPaths = Object.keys(existingAssets)
			.filter((logicalPath) => logicalPath.startsWith(config.prefix))
			.sort();
		/** @type {Map<string, SourceRecord>} */
		const sourceRecords = new Map();
		for (const logicalPath of candidatePaths) {
			const originalPath = path.join(rootDir, ...logicalPath.split('/'));
			const compressedPath = `${originalPath}.gz`;
			const originalStats = await stat(originalPath).catch(() => null);
			const compressedStats = compressedAssets.has(logicalPath)
				? await stat(compressedPath).catch(() => null)
				: null;
			const sourceFiles = [
				...(originalStats?.isFile()
					? [{ path: originalPath, size: originalStats.size }]
					: []),
				...(compressedStats?.isFile()
					? [{ path: compressedPath, size: compressedStats.size }]
					: [])
			];
			if (sourceFiles.length === 0) {
				throw new Error(`layer source was not found for ${logicalPath}`);
			}
			sourceRecords.set(logicalPath, {
				originalPath: originalStats?.isFile() ? originalPath : null,
				compressedPath: compressedStats?.isFile() ? compressedPath : null,
				sourceFiles
			});
		}

		/** @type {string | null} */
		let cachedLayerPath = null;
		/** @type {Buffer | null} */
		let cachedLayerBytes = null;
		/** @param {string} logicalPath @returns {Promise<Buffer>} */
		const readSourceBytes = async (logicalPath) => {
			const source = sourceRecords.get(logicalPath);
			if (!source) throw new Error(`layer source was not found for ${logicalPath}`);
			if (source.originalPath) {
				const bytes = await readFile(source.originalPath);
				if (source.compressedPath) {
					const compressedOriginal = gunzipSync(await readFile(source.compressedPath));
					if (!bytes.equals(compressedOriginal)) {
						throw new Error(`compressed runtime asset differs from ${logicalPath}`);
					}
				}
				return bytes;
			}
			if (!source.compressedPath) {
				throw new Error(`compressed layer source was not found for ${logicalPath}`);
			}
			return gunzipSync(await readFile(source.compressedPath));
		};
		/** @param {string} logicalPath @returns {Promise<Buffer>} */
		const readExistingBytes = async (logicalPath) => {
			const entry = existingAssets[logicalPath];
			if (
				!entry ||
				typeof entry !== 'object' ||
				typeof entry.layer !== 'string' ||
				!Number.isSafeInteger(entry.offset) ||
				entry.offset < 0 ||
				!Number.isSafeInteger(entry.length) ||
				entry.length < 0
			) {
				throw new Error(`invalid layered asset entry for ${logicalPath}`);
			}
			const descriptor = existingLayerManifest.layers[entry.layer];
			if (descriptor === undefined) {
				throw new Error(
					`layer ${entry.layer} for ${logicalPath} is missing from the manifest`
				);
			}
			let layerPath = entry.layer;
			if (typeof descriptor === 'string') layerPath = descriptor;
			else if (descriptor && typeof descriptor === 'object' && descriptor.path) {
				layerPath = descriptor.path;
			}
			if (!layerPath.endsWith('.gz')) layerPath = `${layerPath}.gz`;
			if (cachedLayerPath !== layerPath) {
				cachedLayerBytes = gunzipSync(
					await readFile(path.join(rootDir, ...layerPath.split('/')))
				);
				cachedLayerPath = layerPath;
			}
			if (!cachedLayerBytes || entry.offset > cachedLayerBytes.byteLength - entry.length) {
				throw new Error(`layer range for ${logicalPath} exceeds ${entry.layer}`);
			}
			return cachedLayerBytes.subarray(entry.offset, entry.offset + entry.length);
		};

		let rebuildGroup = false;
		for (const logicalPath of candidatePaths) {
			const sourceBytes = await readSourceBytes(logicalPath);
			if (!existingAssets[logicalPath]) {
				if (sourceBytes.byteLength <= MAX_LAYER_RAW_BYTES) rebuildGroup = true;
				continue;
			}
			if (!sourceBytes.equals(await readExistingBytes(logicalPath))) rebuildGroup = true;
		}

		if (!rebuildGroup) {
			for (const logicalPath of candidatePaths) {
				if (!existingAssets[logicalPath]) continue;
				const source = sourceRecords.get(logicalPath);
				if (!source) continue;
				for (const sourceFile of source.sourceFiles) {
					sourcePathsToRemove.add(sourceFile.path);
					summaries[config.family].beforeBytes += sourceFile.size;
				}
			}
			continue;
		}

		const oldLayerKeys = new Set(
			existingGroupPaths.map((logicalPath) => existingAssets[logicalPath].layer)
		);
		for (const layerKey of oldLayerKeys) {
			const descriptor = existingLayerManifest.layers[layerKey];
			let layerPath = layerKey;
			if (typeof descriptor === 'string') layerPath = descriptor;
			else if (descriptor && typeof descriptor === 'object' && descriptor.path) {
				layerPath = descriptor.path;
			}
			if (!layerPath.endsWith('.gz')) layerPath = `${layerPath}.gz`;
			const layerFilePath = path.join(rootDir, ...layerPath.split('/'));
			const layerStats = await stat(layerFilePath).catch(() => null);
			if (layerStats?.isFile()) summaries[config.family].beforeBytes += layerStats.size;
			staleLayerPathsToRemove.add(layerFilePath);
			delete nextLayers[layerKey];
		}
		for (const logicalPath of existingGroupPaths) delete nextAssets[logicalPath];

		let layerNumber = 0;
		/** @type {PendingLayer | null} */
		let currentLayer = null;
		/** @param {PendingLayer} layer */
		const finishLayer = (layer) => {
			const rawBytes = Buffer.concat(layer.chunks, layer.rawBytes);
			const compressedBytes = gzipSync(rawBytes, { level: 9 });
			nextLayers[layer.path] = {
				length: layer.rawBytes,
				compressedLength: compressedBytes.byteLength,
				sha256: sha256(compressedBytes)
			};
			layerFiles.push({
				filePath: path.join(rootDir, ...layer.path.split('/')),
				bytes: compressedBytes
			});
			summaries[config.family].afterBytes += compressedBytes.byteLength;
		};
		const startLayer = () => {
			let layerPath = config.layerPath(layerNumber);
			while (Object.hasOwn(nextLayers, layerPath)) {
				layerNumber += 1;
				layerPath = config.layerPath(layerNumber);
			}
			layerNumber += 1;
			return /** @type {PendingLayer} */ ({ path: layerPath, rawBytes: 0, chunks: [] });
		};

		const rebuiltPaths = [...new Set([...existingGroupPaths, ...candidatePaths])].sort();
		for (const logicalPath of rebuiltPaths) {
			const source = sourceRecords.get(logicalPath);
			const bytes = source
				? await readSourceBytes(logicalPath)
				: await readExistingBytes(logicalPath);
			if (bytes.byteLength > MAX_LAYER_RAW_BYTES) continue;
			if (currentLayer && currentLayer.rawBytes + bytes.byteLength > MAX_LAYER_RAW_BYTES) {
				finishLayer(currentLayer);
				currentLayer = null;
			}
			if (!currentLayer) currentLayer = startLayer();
			nextAssets[logicalPath] = {
				layer: currentLayer.path,
				offset: currentLayer.rawBytes,
				length: bytes.byteLength
			};
			currentLayer.chunks.push(bytes);
			currentLayer.rawBytes += bytes.byteLength;
			if (source) {
				for (const sourceFile of source.sourceFiles) {
					sourcePathsToRemove.add(sourceFile.path);
					summaries[config.family].beforeBytes += sourceFile.size;
				}
			}
			summaries[config.family].assetCount += 1;
			if (currentLayer.rawBytes === MAX_LAYER_RAW_BYTES) {
				finishLayer(currentLayer);
				currentLayer = null;
			}
		}
		if (currentLayer) finishLayer(currentLayer);
	}

	for (const [layerKey, descriptor] of Object.entries(nextLayers)) {
		if (
			descriptor &&
			typeof descriptor === 'object' &&
			typeof descriptor.sha256 === 'string' &&
			/^[0-9a-f]{64}$/u.test(descriptor.sha256)
		) {
			continue;
		}
		let layerPath = layerKey;
		if (typeof descriptor === 'string') layerPath = descriptor;
		else if (descriptor && typeof descriptor === 'object' && descriptor.path) {
			layerPath = descriptor.path;
		}
		if (!layerPath.endsWith('.gz')) layerPath = `${layerPath}.gz`;
		const layerFilePath = path.join(rootDir, ...layerPath.split('/'));
		const stagedLayer = layerFiles.find((file) => file.filePath === layerFilePath);
		const compressedBytes = stagedLayer?.bytes || (await readFile(layerFilePath));
		const rawBytes = gunzipSync(compressedBytes);
		nextLayers[layerKey] = {
			...(descriptor && typeof descriptor === 'object' ? descriptor : { path: layerPath }),
			length: rawBytes.byteLength,
			compressedLength: compressedBytes.byteLength,
			sha256: sha256(compressedBytes)
		};
	}

	const sortedAssets = Object.fromEntries(
		Object.entries(nextAssets).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0
		)
	);
	const sortedLayers = Object.fromEntries(
		Object.entries(nextLayers).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0
		)
	);
	const nextLayerManifest = {
		schemaVersion: 1,
		maxLayerBytes: MAX_LAYER_RAW_BYTES,
		layers: sortedLayers,
		assets: sortedAssets
	};
	const layeredLogicalPaths = new Set(Object.keys(sortedAssets));
	const remainingCompressedAssets = [...compressedAssets]
		.filter((assetPath) => !layeredLogicalPaths.has(assetPath))
		.sort();
	const sizes =
		compressedManifest.sizes && typeof compressedManifest.sizes === 'object'
			? compressedManifest.sizes
			: {};
	const remainingSizes = Object.fromEntries(
		Object.entries(sizes)
			.filter(([assetPath]) => !layeredLogicalPaths.has(assetPath))
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
	);
	const nextCompressedManifest = {
		...compressedManifest,
		assets: remainingCompressedAssets,
		sizes: remainingSizes
	};
	const layerManifestChanged =
		JSON.stringify(nextLayerManifest) !== JSON.stringify(existingLayerManifest);
	const compressedManifestChanged =
		JSON.stringify(nextCompressedManifest) !== JSON.stringify(compressedManifest);
	if (layerFiles.length > 0 || layerManifestChanged || compressedManifestChanged) {
		await commitFiles([
			...layerFiles,
			{ filePath: layerManifestPath, bytes: jsonBytes(nextLayerManifest) },
			{ filePath: compressedManifestPath, bytes: jsonBytes(nextCompressedManifest) }
		]);
	}
	/** @type {Map<string, Buffer>} */
	const decodedLayers = new Map();
	for (const [layerKey, descriptor] of Object.entries(sortedLayers)) {
		let layerPath = layerKey;
		if (typeof descriptor === 'string') layerPath = descriptor;
		else if (
			descriptor &&
			typeof descriptor === 'object' &&
			typeof descriptor.path === 'string'
		) {
			layerPath = descriptor.path;
		}
		if (!layerPath.endsWith('.gz')) layerPath = `${layerPath}.gz`;
		const layerFilePath = resolveRuntimeAsset(rootDir, layerPath);
		const compressedBytes = await readFile(layerFilePath);
		if (
			descriptor &&
			typeof descriptor === 'object' &&
			descriptor.compressedLength !== undefined &&
			descriptor.compressedLength !== compressedBytes.byteLength
		) {
			throw new Error(`compressed length for layer ${layerKey} does not match its manifest`);
		}
		if (
			!descriptor ||
			typeof descriptor !== 'object' ||
			typeof descriptor.sha256 !== 'string' ||
			!/^[0-9a-f]{64}$/u.test(descriptor.sha256) ||
			descriptor.sha256 !== sha256(compressedBytes)
		) {
			throw new Error(`SHA-256 for layer ${layerKey} does not match its manifest`);
		}
		const bytes = gunzipSync(compressedBytes);
		if (
			descriptor &&
			typeof descriptor === 'object' &&
			descriptor.length !== undefined &&
			descriptor.length !== bytes.byteLength
		) {
			throw new Error(`decoded length for layer ${layerKey} does not match its manifest`);
		}
		if (bytes.byteLength > MAX_LAYER_RAW_BYTES) {
			throw new Error(`decoded layer ${layerKey} exceeds ${MAX_LAYER_RAW_BYTES} bytes`);
		}
		decodedLayers.set(layerKey, bytes);
	}
	for (const [logicalPath, entry] of Object.entries(sortedAssets)) {
		if (
			!entry ||
			typeof entry !== 'object' ||
			typeof entry.layer !== 'string' ||
			!Number.isSafeInteger(entry.offset) ||
			entry.offset < 0 ||
			!Number.isSafeInteger(entry.length) ||
			entry.length < 0
		) {
			throw new Error(`invalid layered asset entry for ${logicalPath}`);
		}
		const layerBytes = decodedLayers.get(entry.layer);
		if (!layerBytes || entry.offset > layerBytes.byteLength - entry.length) {
			throw new Error(`layer range for ${logicalPath} exceeds ${entry.layer}`);
		}
	}
	for (const sourcePath of [...sourcePathsToRemove].sort()) {
		await rm(sourcePath, { force: true });
	}
	const retainedLayerPaths = new Set(
		Object.entries(sortedLayers).map(([layerKey, descriptor]) => {
			let layerPath = layerKey;
			if (typeof descriptor === 'string') layerPath = descriptor;
			else if (descriptor && typeof descriptor === 'object' && descriptor.path) {
				layerPath = descriptor.path;
			}
			if (!layerPath.endsWith('.gz')) layerPath = `${layerPath}.gz`;
			return path.join(rootDir, ...layerPath.split('/'));
		})
	);
	for (const staleLayerPath of [...staleLayerPathsToRemove].sort()) {
		if (!retainedLayerPaths.has(staleLayerPath)) await rm(staleLayerPath, { force: true });
	}
	for (const summary of Object.values(summaries)) {
		summary.changed = summary.assetCount > 0 || summary.beforeBytes > 0;
		summary.savedBytes = summary.beforeBytes - summary.afterBytes;
	}
	return summaries;
}

/**
 * Build all delta packs and transparent service-worker layers below a static asset root.
 *
 * @param {{ rootDir?: string }} [options]
 */
export async function buildLayeredRuntimeAssets({ rootDir = DEFAULT_ROOT_DIR } = {}) {
	const resolvedRootDir = path.resolve(rootDir);
	const rootStats = await stat(resolvedRootDir).catch(() => null);
	if (!rootStats?.isDirectory()) {
		throw new Error(`runtime asset root directory was not found at ${resolvedRootDir}`);
	}
	const rust = await transformRustSysroots(resolvedRootDir);
	const go = await transformGoSysroot(resolvedRootDir);
	const layers = await buildServiceWorkerLayers(resolvedRootDir);
	return {
		rootDir: resolvedRootDir,
		rust,
		go,
		tinygo: layers.tinygo,
		dotnet: layers.dotnet
	};
}

/** @param {string} label @param {BuildSummary} summary */
function printSummary(label, summary) {
	console.log(
		`${label}: before ${summary.beforeBytes.toLocaleString('en-US')} bytes, ` +
			`after ${summary.afterBytes.toLocaleString('en-US')} bytes, ` +
			`saved ${summary.savedBytes.toLocaleString('en-US')} bytes`
	);
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const rootDir = process.argv[2]
		? path.resolve(process.cwd(), process.argv[2])
		: DEFAULT_ROOT_DIR;
	buildLayeredRuntimeAssets({ rootDir })
		.then((result) => {
			printSummary('Rust', result.rust);
			printSummary('Go', result.go);
			printSummary('TinyGo', result.tinygo);
			printSummary('.NET', result.dotnet);
		})
		.catch((error) => {
			console.error(error);
			process.exitCode = 1;
		});
}
