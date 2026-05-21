import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-zig', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-zig');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmZigVersion.ts'
);
const DEFAULT_RELEASE_BASE_URL = 'https://github.com/Afirium/zigc-wasm/releases/download/v0.11.0';

/**
 * @typedef {{
 *   fileName: string;
 *   label: string;
 *   validate(data: Uint8Array): boolean;
 * }} ZigAsset
 *
 * @typedef {{
 *   fileName: string;
 *   data: Buffer;
 * }} ZigBundleFile
 *
 * @typedef {{
 *   sourceDir?: string;
 *   targetDir?: string;
 *   versionModulePath?: string;
 *   releaseBaseUrl?: string;
 * }} SyncWasmZigOptions
 */

/** @type {readonly ZigAsset[]} */
const ASSETS = [
	{
		fileName: 'zig_small.wasm',
		label: 'zig compiler',
		validate(data) {
			return (
				data.byteLength >= 4 &&
				data[0] === 0x00 &&
				data[1] === 0x61 &&
				data[2] === 0x73 &&
				data[3] === 0x6d
			);
		}
	},
	{
		fileName: 'std.zip',
		label: 'zig standard library',
		validate(data) {
			return data.byteLength >= 4 && data[0] === 0x50 && data[1] === 0x4b;
		}
	}
];

/** @param {string} filePath */
async function fileExists(filePath) {
	const stats = await stat(filePath).catch(() => null);
	return !!stats?.isFile();
}

/**
 * @param {{
 *   sourceDir: string;
 *   releaseBaseUrl: string;
 *   asset: ZigAsset;
 * }} options
 * @returns {Promise<Buffer>}
 */
async function readAsset({ sourceDir, releaseBaseUrl, asset }) {
	const sourcePath = path.join(sourceDir, asset.fileName);
	if (await fileExists(sourcePath)) {
		return await readFile(sourcePath);
	}

	const sourceStats = await stat(sourceDir).catch(() => null);
	if (sourceStats?.isDirectory()) {
		throw new Error(`${asset.label} asset was not found at ${sourcePath}.`);
	}

	const url = `${releaseBaseUrl.replace(/\/$/, '')}/${asset.fileName}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`failed to download ${asset.label} from ${url}: ${response.status}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

/** @param {readonly ZigBundleFile[]} files */
async function computeBundleFingerprint(files) {
	const hash = createHash('sha256');
	for (const file of files) {
		hash.update(file.fileName);
		hash.update('\0');
		hash.update(file.data);
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
	const moduleSource = `export const WASM_ZIG_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

/** @param {SyncWasmZigOptions} [options] */
export async function syncWasmZigAssets({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	releaseBaseUrl = DEFAULT_RELEASE_BASE_URL
} = {}) {
	/** @type {ZigBundleFile[]} */
	const files = [];
	for (const asset of ASSETS) {
		const data = await readAsset({ sourceDir, releaseBaseUrl, asset });
		if (!asset.validate(data)) {
			throw new Error(
				`${asset.label} asset at ${asset.fileName} is not a valid bundle file.`
			);
		}
		files.push({ fileName: asset.fileName, data });
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	for (const file of files) {
		await writeFile(path.join(targetDir, file.fileName), file.data);
	}
	const fingerprint = await computeBundleFingerprint(files);
	await writeVersionModule(versionModulePath, fingerprint);

	return {
		sourceDir,
		targetDir,
		fingerprint,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmZigAssets({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-zig from ${sourceDir} to ${targetDir}`);
}
