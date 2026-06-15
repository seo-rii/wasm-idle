import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const STATIC_DIR = path.resolve(REPO_ROOT, 'static');
const BUILD_DIR = path.resolve(REPO_ROOT, 'build');
const MANIFEST_FILE_NAME = 'compressed-runtime-assets.v1.json';
const MIN_COMPRESS_BYTES = 5_000_000;
const COMPRESSIBLE_EXTENSIONS = new Set([
	'.a',
	'.avm',
	'.bin',
	'.data',
	'.dat',
	'.dll',
	'.js',
	'.mjs',
	'.pdb',
	'.so',
	'.symbols',
	'.wasm'
]);
const PRECOMPRESSED_EXTENSIONS = new Set(['.br', '.brotli', '.gz', '.tgz', '.zip', '.zst']);
const COMPRESSIBLE_TOP_LEVEL_DIRS = [
	'clang',
	'clangd',
	'pyodide',
	'wasm-d',
	'wasm-dotnet',
	'wasm-elixir',
	'wasm-go',
	'wasm-haskell',
	'wasm-lisp',
	'wasm-of-js-of-ocaml',
	'wasm-rust',
	'wasm-tinygo',
	'wasm-wat',
	'wasm-zig',
	'webr'
];

function rootDirFromArg(value) {
	if (!value || value === 'static') return STATIC_DIR;
	if (value === 'build') return BUILD_DIR;
	return path.resolve(REPO_ROOT, value);
}

function relativeToRoot(rootDir, filePath) {
	return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function isUnderCompressibleRuntime(rootDir, filePath) {
	const relativePath = relativeToRoot(rootDir, filePath);
	if (relativePath.startsWith('_app/immutable/workers/')) return true;
	const [topLevel] = relativePath.split('/');
	return COMPRESSIBLE_TOP_LEVEL_DIRS.includes(topLevel);
}

function hasCompressibleExtension(filePath) {
	const extension = path.extname(filePath).toLowerCase();
	if (PRECOMPRESSED_EXTENSIONS.has(extension)) return false;
	return COMPRESSIBLE_EXTENSIONS.has(extension);
}

function isCompressibleFile(rootDir, filePath, fileStats) {
	if (!isUnderCompressibleRuntime(rootDir, filePath)) return false;
	if (!hasCompressibleExtension(filePath)) return false;
	if (path.basename(filePath) === MANIFEST_FILE_NAME) return false;
	return fileStats.size >= MIN_COMPRESS_BYTES;
}

async function collectFiles(rootDir) {
	const entries = await readdir(rootDir, { withFileTypes: true });
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

async function collectCompressedManifestEntries(rootDir) {
	const entries = [];
	for (const filePath of await collectFiles(rootDir)) {
		if (!filePath.endsWith('.gz')) continue;
		const originalPath = filePath.slice(0, -'.gz'.length);
		if (!isUnderCompressibleRuntime(rootDir, originalPath)) continue;
		if (!hasCompressibleExtension(originalPath)) continue;
		entries.push(relativeToRoot(rootDir, originalPath));
	}
	return entries.sort();
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function compressFile(filePath) {
	const sourceBytes = await readFile(filePath);
	const compressedBytes = gzipSync(sourceBytes, { level: 9, mtime: 0 });
	const compressedPath = `${filePath}.gz`;
	const existingCompressedBytes = await readFile(compressedPath).catch(() => null);
	if (!existingCompressedBytes || sha256(existingCompressedBytes) !== sha256(compressedBytes)) {
		await mkdir(path.dirname(compressedPath), { recursive: true });
		await writeFile(compressedPath, compressedBytes);
	}
	await rm(filePath);
	return {
		compressedPath,
		compressedSize: compressedBytes.byteLength,
		originalPath: filePath,
		originalSize: sourceBytes.byteLength
	};
}

async function writeCompressedAssetManifest(rootDir) {
	const assets = await collectCompressedManifestEntries(rootDir);
	await writeFile(
		path.join(rootDir, MANIFEST_FILE_NAME),
		`${JSON.stringify({ assets }, null, 2)}\n`,
		'utf8'
	);
	return assets;
}

export async function compressStaticRuntimeAssets({ rootDir = STATIC_DIR } = {}) {
	const rootStats = await stat(rootDir).catch(() => null);
	if (!rootStats?.isDirectory()) {
		throw new Error(`runtime asset root directory was not found at ${rootDir}`);
	}

	const compressed = [];
	for (const filePath of await collectFiles(rootDir)) {
		const fileStats = await stat(filePath);
		if (!isCompressibleFile(rootDir, filePath, fileStats)) continue;
		compressed.push(await compressFile(filePath));
	}
	const manifestAssets = await writeCompressedAssetManifest(rootDir);
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
