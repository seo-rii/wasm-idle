import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const STATIC_DIR = path.resolve(REPO_ROOT, 'static');
const BUILD_DIR = path.resolve(REPO_ROOT, 'build');
const MANIFEST_FILE_NAME = 'compressed-runtime-assets.v1.json';
export const STATIC_RUNTIME_MIN_COMPRESS_BYTES = 256 * 1024;
const COMPRESSIBLE_EXTENSIONS = new Set([
	'.a',
	'.avm',
	'.bin',
	'.data',
	'.dat',
	'.dll',
	'.js',
	'.json',
	'.mjs',
	'.o',
	'.oct',
	'.pdb',
	'.qch',
	'.so',
	'.symbols',
	'.tar',
	'.wasm',
	'.webc'
]);
const PRECOMPRESSED_EXTENSIONS = new Set(['.br', '.brotli', '.gz', '.tgz', '.zip', '.zst']);
const PRECOMPRESSED_SUFFIXES = ['.gz.bin'];
const RUNTIME_TOP_LEVEL_DIRS = new Set(['clang', 'clangd', 'pyodide', 'teavm', 'webr']);

/**
 * @typedef {object} CompressedAsset
 * @property {string} compressedPath
 * @property {number} compressedSize
 * @property {string} originalPath
 * @property {number} originalSize
 */

/**
 * @typedef {object} CompressedManifestEntry
 * @property {string} assetPath
 * @property {number} originalSize
 */

/** @param {string | undefined} value */
function rootDirFromArg(value) {
	if (!value || value === 'static') return STATIC_DIR;
	if (value === 'build') return BUILD_DIR;
	return path.resolve(REPO_ROOT, value);
}

/** @param {string} rootDir @param {string} filePath */
function relativeToRoot(rootDir, filePath) {
	return path.relative(rootDir, filePath).split(path.sep).join('/');
}

/** @param {string} rootDir @param {string} filePath */
function isUnderCompressibleRuntime(rootDir, filePath) {
	const relativePath = relativeToRoot(rootDir, filePath);
	if (/^_app\/immutable\/(assets|workers)\//.test(relativePath)) return true;
	const [topLevel] = relativePath.split('/');
	return topLevel.startsWith('wasm-') || RUNTIME_TOP_LEVEL_DIRS.has(topLevel);
}

/** @param {string} filePath */
function hasCompressibleExtension(filePath) {
	const normalizedPath = filePath.toLowerCase();
	if (PRECOMPRESSED_SUFFIXES.some((suffix) => normalizedPath.endsWith(suffix))) return false;
	const extension = path.extname(filePath).toLowerCase();
	if (!extension) return true;
	if (PRECOMPRESSED_EXTENSIONS.has(extension)) return false;
	return COMPRESSIBLE_EXTENSIONS.has(extension);
}

/**
 * @param {string} rootDir
 * @param {string} filePath
 * @param {import('node:fs').Stats} fileStats
 */
function isCompressibleFile(rootDir, filePath, fileStats) {
	if (!isUnderCompressibleRuntime(rootDir, filePath)) return false;
	if (!hasCompressibleExtension(filePath)) return false;
	if (path.basename(filePath) === MANIFEST_FILE_NAME) return false;
	return fileStats.size >= STATIC_RUNTIME_MIN_COMPRESS_BYTES;
}

/** @param {string} rootDir @returns {Promise<string[]>} */
async function collectFiles(rootDir) {
	const entries = await readdir(rootDir, { withFileTypes: true });
	/** @type {string[]} */
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) files.push(entryPath);
	}
	return files.sort();
}

/** @param {Buffer} bytes @param {string} filePath */
function gzipOriginalSize(bytes, filePath) {
	if (bytes.byteLength < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
		throw new Error(`invalid gzip runtime asset at ${filePath}`);
	}
	// gzip ISIZE is exact for these single-member runtime assets, which are all below 4 GiB.
	return bytes.readUInt32LE(bytes.byteLength - 4);
}

/** @param {string} rootDir @returns {Promise<{ assets?: unknown }>} */
async function readExistingCompressedAssetManifest(rootDir) {
	const manifest = await readFile(path.join(rootDir, MANIFEST_FILE_NAME), 'utf8')
		.then((value) => /** @type {unknown} */ (JSON.parse(value)))
		.catch(() => /** @type {unknown} */ ({}));
	return manifest && typeof manifest === 'object'
		? /** @type {{ assets?: unknown }} */ (manifest)
		: {};
}

/**
 * @param {string} rootDir
 * @param {CompressedAsset[]} compressed
 * @returns {Promise<CompressedManifestEntry[]>}
 */
async function collectCompressedManifestEntries(rootDir, compressed) {
	const existingManifest = await readExistingCompressedAssetManifest(rootDir);
	/** @type {Set<string>} */
	const assetPaths = new Set();
	if (Array.isArray(existingManifest.assets)) {
		for (const assetPath of existingManifest.assets) {
			if (typeof assetPath === 'string') assetPaths.add(assetPath);
		}
	}
	for (const entry of compressed) {
		assetPaths.add(relativeToRoot(rootDir, entry.originalPath));
	}
	/** @type {CompressedManifestEntry[]} */
	const entries = [];
	for (const assetPath of [...assetPaths].sort()) {
		const originalPath = path.resolve(rootDir, assetPath);
		if (relativeToRoot(rootDir, originalPath) !== assetPath) continue;
		if (!isUnderCompressibleRuntime(rootDir, originalPath)) continue;
		if (!hasCompressibleExtension(originalPath)) continue;
		const compressedPath = `${originalPath}.gz`;
		const compressedBytes = await readFile(compressedPath).catch(() => null);
		if (!compressedBytes) continue;
		entries.push({
			assetPath,
			originalSize: gzipOriginalSize(compressedBytes, compressedPath)
		});
	}
	return entries;
}

/** @param {Buffer} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {string} filePath @returns {Promise<CompressedAsset>} */
async function compressFile(filePath) {
	const sourceBytes = await readFile(filePath);
	const compressedBytes = gzipSync(sourceBytes, { level: 9 });
	const compressedPath = `${filePath}.gz`;
	const existingCompressedBytes = await readFile(compressedPath).catch(() => null);
	if (!existingCompressedBytes || sha256(existingCompressedBytes) !== sha256(compressedBytes)) {
		await mkdir(path.dirname(compressedPath), { recursive: true });
		await writeFile(compressedPath, compressedBytes);
	}
	return {
		compressedPath,
		compressedSize: compressedBytes.byteLength,
		originalPath: filePath,
		originalSize: sourceBytes.byteLength
	};
}

/** @param {string} rootDir @param {CompressedAsset[]} compressed */
async function writeCompressedAssetManifest(rootDir, compressed) {
	const entries = await collectCompressedManifestEntries(rootDir, compressed);
	const assets = entries.map((entry) => entry.assetPath);
	const sizes = Object.fromEntries(entries.map((entry) => [entry.assetPath, entry.originalSize]));
	const manifestPath = path.join(rootDir, MANIFEST_FILE_NAME);
	const temporaryManifestPath = `${manifestPath}.tmp-${process.pid}`;
	await writeFile(
		temporaryManifestPath,
		`${JSON.stringify({ assets, sizes }, null, 2)}\n`,
		'utf8'
	);
	await rename(temporaryManifestPath, manifestPath);
	return assets;
}

/** @param {{ rootDir?: string }} [options] */
export async function compressStaticRuntimeAssets({ rootDir = STATIC_DIR } = {}) {
	const rootStats = await stat(rootDir).catch(() => null);
	if (!rootStats?.isDirectory()) {
		throw new Error(`runtime asset root directory was not found at ${rootDir}`);
	}

	/** @type {CompressedAsset[]} */
	const compressed = [];
	for (const filePath of await collectFiles(rootDir)) {
		const fileStats = await stat(filePath);
		if (!isCompressibleFile(rootDir, filePath, fileStats)) continue;
		compressed.push(await compressFile(filePath));
	}
	const manifestAssets = await writeCompressedAssetManifest(rootDir, compressed);
	for (const entry of compressed) {
		await rm(entry.originalPath);
	}
	return { compressed, manifestAssets, rootDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const targetArg = process.argv[2] || 'static';
	const result = await compressStaticRuntimeAssets({
		rootDir: rootDirFromArg(targetArg)
	});
	for (const entry of result.compressed) {
		const originalRelativePath = relativeToRoot(result.rootDir, entry.originalPath);
		const compressedRelativePath = relativeToRoot(result.rootDir, entry.compressedPath);
		const savedBytes = entry.originalSize - entry.compressedSize;
		console.log(
			`${originalRelativePath} -> ${compressedRelativePath} (${entry.originalSize} -> ${entry.compressedSize}, saved ${savedBytes})`
		);
	}
	console.log(
		`Compressed ${result.compressed.length} runtime assets and wrote ${result.manifestAssets.length} manifest entries for ${path.relative(REPO_ROOT, result.rootDir) || '.'}.`
	);
}
