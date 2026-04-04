import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, '..', 'wasm-go', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-go');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmGoVersion.ts'
);

/**
 * @param {string} sourcePath
 */
function shouldSkipCopy(sourcePath) {
	return sourcePath.endsWith('.d.ts') || sourcePath.endsWith('.tsbuildinfo');
}

/**
 * @param {string} sourceDir
 * @param {string} targetDir
 */
async function copyDirectory(sourceDir, targetDir) {
	const entries = await readdir(sourceDir, { withFileTypes: true });

	for (const entry of entries) {
		const sourcePath = path.join(sourceDir, entry.name);
		if (shouldSkipCopy(sourcePath)) continue;

		const targetPath = path.join(targetDir, entry.name);
		if (entry.isDirectory()) {
			await mkdir(targetPath, { recursive: true });
			await copyDirectory(sourcePath, targetPath);
			continue;
		}
		await cp(sourcePath, targetPath);
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
		if (shouldSkipCopy(entryPath)) continue;
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

/**
 * @param {string} sourceDir
 */
async function computeBundleFingerprint(sourceDir) {
	const hash = createHash('sha256');
	for (const filePath of await listFiles(sourceDir)) {
		hash.update(path.relative(sourceDir, filePath));
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
	const moduleSource = `export const WASM_GO_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

/**
 * @param {{ sourceDir?: string; targetDir?: string; versionModulePath?: string }} [options]
 */
export async function syncWasmGoDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`wasm-go dist directory was not found at ${sourceDir}. Build wasm-go first with "cd ../wasm-go && npm run build && npm run prepare:runtime".`
		);
	}

	const entryModulePath = path.join(sourceDir, 'index.js');
	const entryModuleStats = await stat(entryModulePath).catch(() => null);
	if (!entryModuleStats?.isFile()) {
		throw new Error(`wasm-go dist entry was not found at ${entryModulePath}.`);
	}
	const vendoredBrowserWasiShimPath = path.join(
		sourceDir,
		'vendor',
		'browser_wasi_shim',
		'index.js'
	);
	const vendoredBrowserWasiShimStats = await stat(vendoredBrowserWasiShimPath).catch(() => null);
	if (!vendoredBrowserWasiShimStats?.isFile()) {
		throw new Error(
			`wasm-go browser bundle is incomplete. Expected vendored browser_wasi_shim at ${vendoredBrowserWasiShimPath}.`
		);
	}

	const runtimeManifestPath = path.join(sourceDir, 'runtime', 'runtime-manifest.v1.json');
	const runtimeManifestStats = await stat(runtimeManifestPath).catch(() => null);
	if (!runtimeManifestStats?.isFile()) {
		throw new Error(`wasm-go runtime manifest was not found at ${runtimeManifestPath}.`);
	}

	const runtimeBuildPath = path.join(sourceDir, 'runtime', 'runtime-build.json');
	const runtimeBuildStats = await stat(runtimeBuildPath).catch(() => null);
	if (!runtimeBuildStats?.isFile()) {
		throw new Error(`wasm-go runtime build metadata was not found at ${runtimeBuildPath}.`);
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	await copyDirectory(sourceDir, targetDir);
	const fingerprint = await computeBundleFingerprint(sourceDir);
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
	const { sourceDir, targetDir } = await syncWasmGoDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-go from ${sourceDir} to ${targetDir}`);
}
