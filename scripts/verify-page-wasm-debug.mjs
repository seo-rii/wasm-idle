import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_ROOT_DIR = path.join(REPO_ROOT, 'build');
const DEFAULT_PROFILE_PATH = path.join(REPO_ROOT, 'scripts/wasm-debug-release.v2.json');
const DEBUG_DIRECTORY = 'wasm-debug';
const DEBUG_MANIFEST = 'runtime-manifest.v2.json';
const COMPRESSED_MANIFEST = 'compressed-runtime-assets.v1.json';
const SHA256 = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_PAGE_WASM_DEBUG_MANIFEST_BYTES = 64 * 1024;
export const MAX_PAGE_WASM_DEBUG_LOGICAL_BYTES = 55_000_000;
export const MAX_PAGE_WASM_DEBUG_STORED_BYTES = 55_000_000;

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeUtf8(bytes, label) {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (cause) {
		throw new Error(`${label} is not valid UTF-8`, { cause });
	}
}

function parseJson(bytes, label) {
	try {
		return JSON.parse(decodeUtf8(bytes, label));
	} catch (cause) {
		if (cause instanceof Error && cause.message.endsWith('is not valid UTF-8')) throw cause;
		throw new Error(`${label} is not valid JSON`, { cause });
	}
}

async function metadataOrNull(filePath) {
	try {
		return await lstat(filePath);
	} catch (error) {
		if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
		throw error;
	}
}

async function readRegularFile(filePath, label, maxBytes) {
	const metadata = await metadataOrNull(filePath);
	if (!metadata) throw new Error(`${label} is missing at ${filePath}`);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new Error(`${label} must be a regular file: ${filePath}`);
	}
	if (metadata.size > maxBytes) {
		throw new Error(`${label} exceeds its ${maxBytes} byte budget`);
	}
	const bytes = await readFile(filePath);
	if (bytes.byteLength > maxBytes) {
		throw new Error(`${label} exceeds its ${maxBytes} byte budget`);
	}
	return bytes;
}

function validateReleaseProfile(value) {
	if (!isRecord(value) || value.schemaVersion !== 1) {
		throw new Error('invalid wasm debug release profile schema');
	}
	if (typeof value.producerRevision !== 'string' || !REVISION.test(value.producerRevision)) {
		throw new Error('invalid wasm debug release profile producerRevision');
	}
	const receipt = value.manifestReceipt;
	if (
		!isRecord(receipt) ||
		typeof receipt.bytes !== 'number' ||
		!Number.isSafeInteger(receipt.bytes) ||
		receipt.bytes < 1 ||
		receipt.bytes > MAX_PAGE_WASM_DEBUG_MANIFEST_BYTES ||
		typeof receipt.sha256 !== 'string' ||
		!SHA256.test(receipt.sha256)
	) {
		throw new Error('invalid wasm debug release profile manifestReceipt');
	}
	return {
		schemaVersion: 1,
		producerRevision: value.producerRevision,
		manifestReceipt: { bytes: receipt.bytes, sha256: receipt.sha256 }
	};
}

async function loadReleaseProfile(profile, profilePath) {
	if (profile !== undefined) return validateReleaseProfile(profile);
	const resolvedProfilePath = path.resolve(profilePath ?? DEFAULT_PROFILE_PATH);
	const bytes = await readRegularFile(
		resolvedProfilePath,
		'wasm debug release profile',
		MAX_JSON_BYTES
	);
	return validateReleaseProfile(parseJson(bytes, 'wasm debug release profile'));
}

function validateRelativeAssetPath(value, label) {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`unsafe ${label} asset path`);
	}
	const segments = value.split('/');
	let decodedSegments;
	try {
		decodedSegments = segments.map((segment) => decodeURIComponent(segment));
	} catch (cause) {
		throw new Error(`unsafe ${label} asset path: ${value}`, { cause });
	}
	if (
		path.isAbsolute(value) ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.includes(':') ||
		value.includes('?') ||
		value.includes('#') ||
		segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
		decodedSegments.some(
			(segment) =>
				segment.length === 0 ||
				segment === '.' ||
				segment === '..' ||
				segment.includes('/') ||
				segment.includes('\\') ||
				segment.includes('\0')
		)
	) {
		throw new Error(`unsafe ${label} asset path: ${value}`);
	}
	return value;
}

function containedPath(rootDir, relativePath, label) {
	validateRelativeAssetPath(relativePath, label);
	const resolved = path.resolve(rootDir, relativePath);
	const relative = path.relative(rootDir, resolved);
	if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`unsafe ${label} asset path: ${relativePath}`);
	}
	return resolved;
}

function parseManifestAsset(value, label) {
	if (!isRecord(value)) throw new Error(`invalid ${label} asset in wasm debug manifest`);
	const fields = [
		['js', 'jsSha256'],
		['wasm', 'wasmSha256'],
		['worker', 'workerSha256']
	];
	return fields.map(([pathKey, hashKey]) => {
		const assetPath = validateRelativeAssetPath(value[pathKey], label);
		const expectedSha256 = value[hashKey];
		if (typeof expectedSha256 !== 'string' || !SHA256.test(expectedSha256)) {
			throw new Error(`invalid ${label}.${hashKey} in wasm debug manifest`);
		}
		return { assetPath, expectedSha256 };
	});
}

function parseDebugManifest(value) {
	if (
		!isRecord(value) ||
		value.manifestVersion !== 2 ||
		!isRecord(value.debugger) ||
		value.debugger.protocolVersion !== 1 ||
		value.debugger.transport !== 'shared-ring-v1'
	) {
		throw new Error('invalid wasm debug runtime manifest root contract');
	}
	const lldb = value.debugger.lldb;
	const targetRuntime = value.debugger.targetRuntime;
	if (!isRecord(lldb) || typeof lldb.llvmRevision !== 'string' || !lldb.llvmRevision) {
		throw new Error('invalid LLDB revision in wasm debug manifest');
	}
	if (
		!isRecord(targetRuntime) ||
		targetRuntime.name !== 'wamr' ||
		typeof targetRuntime.revision !== 'string' ||
		!targetRuntime.revision
	) {
		throw new Error('invalid WAMR revision in wasm debug manifest');
	}
	const assets = [
		...parseManifestAsset(lldb, 'LLDB'),
		...parseManifestAsset(targetRuntime, 'WAMR')
	];
	const paths = new Set();
	for (const asset of assets) {
		if (paths.has(asset.assetPath)) {
			throw new Error(`duplicate wasm debug manifest asset path: ${asset.assetPath}`);
		}
		paths.add(asset.assetPath);
	}
	if (assets.length !== 6 || paths.size !== 6) {
		throw new Error('wasm debug manifest must contain exactly six distinct assets');
	}
	return assets;
}

function parseCompressedManifest(value) {
	if (!isRecord(value) || !Array.isArray(value.assets) || !isRecord(value.sizes)) {
		throw new Error('invalid compressed-runtime-assets.v1.json root contract');
	}
	const assets = new Set();
	for (const assetPath of value.assets) {
		const safePath = validateRelativeAssetPath(assetPath, 'compressed runtime');
		if (assets.has(safePath)) {
			throw new Error(`duplicate compressed runtime asset entry: ${safePath}`);
		}
		assets.add(safePath);
	}
	const sizes = new Map();
	for (const [assetPath, size] of Object.entries(value.sizes)) {
		const safePath = validateRelativeAssetPath(assetPath, 'compressed runtime size');
		if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
			throw new Error(`invalid compressed runtime originalSize for ${safePath}`);
		}
		sizes.set(safePath, size);
	}
	return { assets, sizes };
}

async function collectRelativeFiles(rootDir, currentDir = rootDir) {
	const entries = await readdir(currentDir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectRelativeFiles(rootDir, entryPath)));
			continue;
		}
		if (!entry.isFile()) {
			throw new Error(
				`wasm debug Pages bundle contains a non-regular entry: ${path.relative(rootDir, entryPath)}`
			);
		}
		files.push(path.relative(rootDir, entryPath).split(path.sep).join('/'));
	}
	return files;
}

function relevantCompressedPaths(entries) {
	return [...entries].filter(
		(assetPath) => assetPath === DEBUG_DIRECTORY || assetPath.startsWith(`${DEBUG_DIRECTORY}/`)
	);
}

/**
 * Verify the logical LLDB/WAMR bytes that a compressed Pages build will expose.
 *
 * @param {{
 *   buildDir?: string;
 *   profile?: unknown;
 *   profilePath?: string;
 *   maxLogicalBytes?: number;
 *   maxStoredBytes?: number;
 * }} [options]
 */
export async function verifyPageWasmDebugRelease({
	buildDir = DEFAULT_ROOT_DIR,
	profile,
	profilePath,
	maxLogicalBytes = MAX_PAGE_WASM_DEBUG_LOGICAL_BYTES,
	maxStoredBytes = MAX_PAGE_WASM_DEBUG_STORED_BYTES
} = {}) {
	for (const [label, limit] of [
		['maxLogicalBytes', maxLogicalBytes],
		['maxStoredBytes', maxStoredBytes]
	]) {
		if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) {
			throw new RangeError(`${label} must be a positive safe integer`);
		}
	}
	const resolvedRoot = path.resolve(buildDir);
	const rootMetadata = await metadataOrNull(resolvedRoot);
	if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
		throw new Error(`Pages output root is missing or is not a directory: ${resolvedRoot}`);
	}
	const releaseProfile = await loadReleaseProfile(profile, profilePath);
	const debugRoot = path.join(resolvedRoot, DEBUG_DIRECTORY);
	const debugRootMetadata = await metadataOrNull(debugRoot);
	if (!debugRootMetadata?.isDirectory() || debugRootMetadata.isSymbolicLink()) {
		throw new Error(
			`wasm debug Pages root is missing or is not a real directory: ${debugRoot}`
		);
	}
	const manifestPath = path.join(debugRoot, DEBUG_MANIFEST);
	const manifestMetadata = await metadataOrNull(manifestPath);
	if (!manifestMetadata?.isFile() || manifestMetadata.isSymbolicLink()) {
		throw new Error(`wasm debug manifest receipt target is missing: ${manifestPath}`);
	}
	if (manifestMetadata.size !== releaseProfile.manifestReceipt.bytes) {
		throw new Error(
			`wasm debug manifest receipt byte mismatch: expected ${releaseProfile.manifestReceipt.bytes}, received ${manifestMetadata.size}`
		);
	}
	const manifestBytes = await readRegularFile(
		manifestPath,
		'wasm debug manifest receipt target',
		releaseProfile.manifestReceipt.bytes
	);
	const manifestSha256 = sha256(manifestBytes);
	if (manifestSha256 !== releaseProfile.manifestReceipt.sha256) {
		throw new Error(
			`wasm debug manifest receipt SHA-256 mismatch: expected ${releaseProfile.manifestReceipt.sha256}, received ${manifestSha256}`
		);
	}
	const manifestAssets = parseDebugManifest(
		parseJson(manifestBytes, 'wasm debug runtime manifest')
	);

	const compressedManifestPath = path.join(resolvedRoot, COMPRESSED_MANIFEST);
	const compressedManifestBytes = await readRegularFile(
		compressedManifestPath,
		COMPRESSED_MANIFEST,
		MAX_JSON_BYTES
	);
	const compressedManifest = parseCompressedManifest(
		parseJson(compressedManifestBytes, COMPRESSED_MANIFEST)
	);
	const logicalPaths = new Set(
		manifestAssets.map(({ assetPath }) => `${DEBUG_DIRECTORY}/${assetPath}`)
	);
	for (const indexedPath of relevantCompressedPaths(compressedManifest.assets)) {
		if (!logicalPaths.has(indexedPath)) {
			throw new Error(`stale compressed wasm debug asset entry: ${indexedPath}`);
		}
	}
	for (const sizedPath of relevantCompressedPaths(compressedManifest.sizes.keys())) {
		if (!logicalPaths.has(sizedPath) || !compressedManifest.assets.has(sizedPath)) {
			throw new Error(`stale compressed wasm debug size entry: ${sizedPath}`);
		}
	}

	let logicalBytes = 0;
	let storedBytes = 0;
	let compressedAssetCount = 0;
	const expectedDebugFiles = new Set([DEBUG_MANIFEST]);
	for (const { assetPath, expectedSha256 } of manifestAssets) {
		const logicalPath = `${DEBUG_DIRECTORY}/${assetPath}`;
		const rawPath = containedPath(debugRoot, assetPath, 'wasm debug manifest');
		const gzipPath = `${rawPath}.gz`;
		const [rawMetadata, gzipMetadata] = await Promise.all([
			metadataOrNull(rawPath),
			metadataOrNull(gzipPath)
		]);
		if (rawMetadata && gzipMetadata) {
			throw new Error(`wasm debug asset has both raw and gzip storage: ${assetPath}`);
		}
		if (!rawMetadata && !gzipMetadata) {
			throw new Error(`wasm debug asset is missing: ${assetPath}`);
		}

		let logical;
		if (rawMetadata) {
			if (!rawMetadata.isFile() || rawMetadata.isSymbolicLink()) {
				throw new Error(`wasm debug raw asset must be a regular file: ${assetPath}`);
			}
			if (
				compressedManifest.assets.has(logicalPath) ||
				compressedManifest.sizes.has(logicalPath)
			) {
				throw new Error(`stale compressed index for raw wasm debug asset: ${assetPath}`);
			}
			if (rawMetadata.size > maxLogicalBytes - logicalBytes) {
				throw new Error(`wasm debug logical byte budget exceeded by ${assetPath}`);
			}
			if (rawMetadata.size > maxStoredBytes - storedBytes) {
				throw new Error(`wasm debug stored byte budget exceeded by ${assetPath}`);
			}
			logical = await readRegularFile(
				rawPath,
				`wasm debug raw asset ${assetPath}`,
				maxLogicalBytes - logicalBytes
			);
			storedBytes += logical.byteLength;
			expectedDebugFiles.add(assetPath);
		} else {
			if (!gzipMetadata.isFile() || gzipMetadata.isSymbolicLink()) {
				throw new Error(`wasm debug gzip asset must be a regular file: ${assetPath}`);
			}
			if (!compressedManifest.assets.has(logicalPath)) {
				throw new Error(
					`wasm debug gzip asset is missing from compressed asset index: ${assetPath}`
				);
			}
			const originalSize = compressedManifest.sizes.get(logicalPath);
			if (originalSize === undefined) {
				throw new Error(`wasm debug gzip asset has no originalSize: ${assetPath}`);
			}
			if (originalSize > maxLogicalBytes - logicalBytes) {
				throw new Error(`wasm debug logical byte budget exceeded by ${assetPath}`);
			}
			if (gzipMetadata.size > maxStoredBytes - storedBytes) {
				throw new Error(`wasm debug stored byte budget exceeded by ${assetPath}`);
			}
			const gzipBytes = await readRegularFile(
				gzipPath,
				`wasm debug gzip asset ${assetPath}`,
				maxStoredBytes - storedBytes
			);
			storedBytes += gzipBytes.byteLength;
			try {
				logical = gunzipSync(gzipBytes, {
					maxOutputLength: Math.min(originalSize + 1, maxLogicalBytes - logicalBytes)
				});
			} catch (cause) {
				throw new Error(`invalid gzip wasm debug asset: ${assetPath}`, { cause });
			}
			if (logical.byteLength !== originalSize) {
				throw new Error(
					`wasm debug originalSize mismatch for ${assetPath}: expected ${originalSize}, received ${logical.byteLength}`
				);
			}
			compressedAssetCount += 1;
			expectedDebugFiles.add(`${assetPath}.gz`);
		}
		logicalBytes += logical.byteLength;
		const actualSha256 = sha256(logical);
		if (actualSha256 !== expectedSha256) {
			throw new Error(
				`wasm debug SHA-256 mismatch for ${assetPath}: expected ${expectedSha256}, received ${actualSha256}`
			);
		}
	}

	for (const relativePath of await collectRelativeFiles(debugRoot)) {
		if (!expectedDebugFiles.has(relativePath)) {
			throw new Error(`stale Pages wasm debug asset: ${DEBUG_DIRECTORY}/${relativePath}`);
		}
	}
	return {
		assetCount: manifestAssets.length,
		compressedAssetCount,
		logicalBytes,
		manifestBytes: manifestBytes.byteLength,
		manifestSha256,
		producerRevision: releaseProfile.producerRevision,
		rootDir: resolvedRoot,
		storedBytes
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const result = await verifyPageWasmDebugRelease({
		buildDir: process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT_DIR,
		profilePath: process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_PROFILE_PATH
	});
	console.log(
		`Verified ${result.assetCount} Pages wasm debug assets (${result.compressedAssetCount} gzip, ${result.logicalBytes} logical bytes) for producer ${result.producerRevision}.`
	);
}
