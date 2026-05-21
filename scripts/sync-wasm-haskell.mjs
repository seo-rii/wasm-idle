import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-haskell', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-haskell');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmHaskellVersion.ts'
);
const DEFAULT_GHC_IN_BROWSER_BASE_URL = 'https://haskell-wasm.github.io/ghc-in-browser';
const DEFAULT_BSDTAR_URL = 'https://haskell-wasm.github.io/bsdtar-wasm/bsdtar.wasm';
const BROWSER_WASI_SHIM_DIR = path.resolve(
	REPO_ROOT,
	'node_modules',
	'@bjorn3',
	'browser_wasi_shim',
	'dist'
);

const TEXT_ASSETS = ['dyld.mjs', 'prelude.mjs', 'post-link.mjs'];
const BINARY_ASSETS = ['rootfs.tar.zst', 'bsdtar.wasm'];

/**
 * @typedef {{
 *   sourceDir?: string;
 *   targetDir?: string;
 *   versionModulePath?: string;
 *   ghcInBrowserBaseUrl?: string;
 *   bsdtarUrl?: string;
 * }} SyncWasmHaskellOptions
 */

/** @param {string} filePath */
async function fileExists(filePath) {
	const stats = await stat(filePath).catch(() => null);
	return !!stats?.isFile();
}

/**
 * @param {{
 *   sourceDir: string;
 *   fileName: string;
 *   url: string;
 * }} options
 */
async function readLocalOrRemoteAsset({ sourceDir, fileName, url }) {
	const sourcePath = path.join(sourceDir, fileName);
	if (await fileExists(sourcePath)) {
		return await readFile(sourcePath);
	}

	const sourceStats = await stat(sourceDir).catch(() => null);
	if (sourceStats?.isDirectory()) {
		throw new Error(`wasm-haskell asset was not found at ${sourcePath}.`);
	}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`failed to download wasm-haskell asset from ${url}: ${response.status}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

/** @param {string} source */
function patchDyldSource(source) {
	return source
		.replace(
			'await import("https://esm.sh/gh/haskell-wasm/browser_wasi_shim")',
			'await import("./browser_wasi_shim/index.js")'
		)
		.replaceAll(
			'new wasi.PreopenDirectory("/", [["tmp", new wasi.Directory([])]])',
			'new wasi.PreopenDirectory("/", new Map([["tmp", new wasi.Directory(new Map())]]))'
		);
}

/** @param {string} targetDir */
async function copyBrowserWasiShim(targetDir) {
	const shimStats = await stat(BROWSER_WASI_SHIM_DIR).catch(() => null);
	if (!shimStats?.isDirectory()) {
		throw new Error(
			`browser_wasi_shim dist directory was not found at ${BROWSER_WASI_SHIM_DIR}. Run pnpm install first.`
		);
	}
	const targetShimDir = path.join(targetDir, 'browser_wasi_shim');
	await mkdir(targetShimDir, { recursive: true });
	const entries = await readdir(BROWSER_WASI_SHIM_DIR, { withFileTypes: true });
	for (const entry of entries) {
		if (
			!entry.isFile() ||
			entry.name.endsWith('.d.ts') ||
			entry.name.endsWith('.map') ||
			entry.name.endsWith('.tsbuildinfo')
		) {
			continue;
		}
		await cp(
			path.join(BROWSER_WASI_SHIM_DIR, entry.name),
			path.join(targetShimDir, entry.name)
		);
	}
}

/**
 * @param {string} rootDir
 * @returns {Promise<string[]>}
 */
async function listFiles(rootDir) {
	const entries = await readdir(rootDir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) files.push(entryPath);
	}
	return files.sort();
}

/** @param {string} targetDir */
async function computeBundleFingerprint(targetDir) {
	const hash = createHash('sha256');
	for (const filePath of await listFiles(targetDir)) {
		hash.update(path.relative(targetDir, filePath));
		hash.update('\0');
		hash.update(await readFile(filePath));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 */
async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_HASKELL_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

/** @param {SyncWasmHaskellOptions} [options] */
export async function syncWasmHaskellAssets({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	ghcInBrowserBaseUrl = DEFAULT_GHC_IN_BROWSER_BASE_URL,
	bsdtarUrl = DEFAULT_BSDTAR_URL
} = {}) {
	const files = [];
	const baseUrl = ghcInBrowserBaseUrl.replace(/\/$/, '');

	for (const fileName of TEXT_ASSETS) {
		const data = await readLocalOrRemoteAsset({
			sourceDir,
			fileName,
			url: `${baseUrl}/${fileName}`
		});
		files.push({
			fileName,
			data:
				fileName === 'dyld.mjs' ? Buffer.from(patchDyldSource(data.toString('utf8'))) : data
		});
	}
	for (const fileName of BINARY_ASSETS) {
		const data = await readLocalOrRemoteAsset({
			sourceDir,
			fileName,
			url: fileName === 'bsdtar.wasm' ? bsdtarUrl : `${baseUrl}/${fileName}`
		});
		if (fileName.endsWith('.wasm') && !isWasm(data)) {
			throw new Error(`${fileName} is not a valid wasm binary.`);
		}
		files.push({ fileName, data });
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	for (const file of files) {
		await writeFile(path.join(targetDir, file.fileName), file.data);
	}
	await copyBrowserWasiShim(targetDir);
	const fingerprint = await computeBundleFingerprint(targetDir);
	await writeVersionModule(versionModulePath, fingerprint);

	return { sourceDir, targetDir, fingerprint, versionModulePath };
}

/** @param {Buffer | Uint8Array} data */
function isWasm(data) {
	return (
		data.byteLength >= 4 &&
		data[0] === 0x00 &&
		data[1] === 0x61 &&
		data[2] === 0x73 &&
		data[3] === 0x6d
	);
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmHaskellAssets({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-haskell from ${sourceDir} to ${targetDir}`);
}
