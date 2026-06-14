import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'node_modules', 'webr', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'webr');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmRVersion.ts'
);

const WEBR_ASSET_ENTRIES = [
	'R.js',
	'R.wasm',
	'webr-worker.js',
	'libRblas.so',
	'libRlapack.so',
	'vfs'
];

async function collectAssetFiles(sourceDir) {
	const files = [];
	for (const entry of WEBR_ASSET_ENTRIES) {
		const sourcePath = path.join(sourceDir, entry);
		const entryStats = await stat(sourcePath).catch(() => null);
		if (!entryStats) {
			throw new Error(`webR asset ${entry} was not found in ${sourceDir}.`);
		}
		if (entryStats.isFile()) {
			files.push(entry);
			continue;
		}
		if (!entryStats.isDirectory()) {
			throw new Error(`webR asset ${entry} is not a file or directory.`);
		}
		await collectDirectoryFiles(sourceDir, entry, files);
	}
	return files.sort();
}

async function collectDirectoryFiles(sourceDir, relativeDir, files) {
	const entries = await readdir(path.join(sourceDir, relativeDir), { withFileTypes: true });
	for (const entry of entries) {
		const relativePath = path.join(relativeDir, entry.name);
		if (entry.isDirectory()) {
			await collectDirectoryFiles(sourceDir, relativePath, files);
			continue;
		}
		if (entry.isFile()) {
			files.push(relativePath);
		}
	}
}

async function computeFingerprint(sourceDir, assetFiles) {
	const hash = createHash('sha256');
	for (const fileName of assetFiles) {
		const sourcePath = path.join(sourceDir, fileName);
		hash.update(fileName);
		hash.update('\0');
		hash.update(await readFile(sourcePath));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_R_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

export async function syncWebRAssets({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`webR dist directory was not found at ${sourceDir}. Install dependencies with "pnpm install".`
		);
	}
	const assetFiles = await collectAssetFiles(sourceDir);

	const fingerprint = await computeFingerprint(sourceDir, assetFiles);
	const versionedTargetDir = path.join(targetDir, fingerprint);
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(versionedTargetDir, { recursive: true });
	for (const fileName of assetFiles) {
		const targetPath = path.join(versionedTargetDir, fileName);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await cp(path.join(sourceDir, fileName), targetPath);
		if (fileName.endsWith('.wasm') || fileName.endsWith('.so')) await chmod(targetPath, 0o644);
	}
	await writeVersionModule(versionModulePath, fingerprint);
	return { sourceDir, targetDir: versionedTargetDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWebRAssets({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced webR from ${sourceDir} to ${targetDir}`);
}
