import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-dotnet', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-dotnet');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmDotnetVersion.ts'
);

/**
 * @typedef {object} SyncWasmDotnetOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [versionModulePath]
 */

/**
 * @param {string} relativePath
 */
function shouldInclude(relativePath) {
	const normalized = relativePath.split(path.sep).join('/');
	return /\.(br|bin|dat|dll|gz|js|mjs|json|pdb|symbols|wasm)$/i.test(normalized);
}

/**
 * @param {string} rootDir
 * @param {string} [baseDir]
 * @returns {Promise<string[]>}
 */
async function listFiles(rootDir, baseDir = rootDir) {
	const entries = await readdir(rootDir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath, baseDir)));
			continue;
		}
		if (entry.isFile()) {
			const relativePath = path.relative(baseDir, entryPath);
			if (shouldInclude(relativePath)) files.push(entryPath);
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
	const moduleSource = `export const WASM_DOTNET_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

/**
 * @param {SyncWasmDotnetOptions} [options]
 */
export async function syncWasmDotnetDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`wasm-dotnet dist directory was not found at ${sourceDir}. Build wasm-dotnet first with "pnpm --dir runtimes/wasm-dotnet build". Run "pnpm --dir runtimes/wasm-dotnet build:runtime" as well when publishing the .NET browser runtime assets.`
		);
	}

	const entryModulePath = path.join(sourceDir, 'index.js');
	const entryModuleStats = await stat(entryModulePath).catch(() => null);
	if (!entryModuleStats?.isFile()) {
		throw new Error(`wasm-dotnet dist entry was not found at ${entryModulePath}.`);
	}

	const runtimeDirPath = path.join(sourceDir, 'runtime');
	const runtimeDirStats = await stat(runtimeDirPath).catch(() => null);
	if (!runtimeDirStats?.isDirectory()) {
		throw new Error(
			`wasm-dotnet runtime directory was not found at ${runtimeDirPath}. Run "pnpm --dir runtimes/wasm-dotnet build:runtime" before syncing wasm-dotnet.`
		);
	}

	const bootManifestPath = path.join(runtimeDirPath, 'blazor.boot.json');
	const bootManifestStats = await stat(bootManifestPath).catch(() => null);
	if (!bootManifestStats?.isFile()) {
		throw new Error(`wasm-dotnet boot manifest was not found at ${bootManifestPath}.`);
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	const filesToCopy = await listFiles(sourceDir);
	for (const sourcePath of filesToCopy) {
		const relativePath = path.relative(sourceDir, sourcePath);
		const targetPath = path.join(targetDir, relativePath);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await cp(sourcePath, targetPath);
	}
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
	const { sourceDir, targetDir } = await syncWasmDotnetDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-dotnet from ${sourceDir} to ${targetDir}`);
}
