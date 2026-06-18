import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_CACHE_DIR = path.resolve(REPO_ROOT, '.cache', 'wasm-octave');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-octave', 'runtime');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmOctaveVersion.ts'
);
const DEFAULT_RUNNER_WORKER_PATH = path.resolve(
	REPO_ROOT,
	'static',
	'wasm-octave',
	'runner-worker.js'
);

export const OCTAVE_VERSION = '10.3.0';
export const OCTAVE_PACKAGE_FILE = 'octave-10.3.0-pl5321h996e327_3.tar.bz2';
export const OCTAVE_PACKAGE_URL =
	'https://repo.prefix.dev/emscripten-forge-4x/emscripten-wasm32/octave-10.3.0-pl5321h996e327_3.tar.bz2';

const ENTRY_SOURCE_FILE = 'bin/octave-cli-10.3.0';
const ENTRY_SCRIPT_FILE = 'bin/octave-cli-10.3.0.js';
const ENTRY_WASM_FILE = 'bin/octave-cli.wasm';
const REQUIRED_RUNTIME_FILES = [ENTRY_SOURCE_FILE, ENTRY_WASM_FILE];

function toPosixPath(filePath) {
	return filePath.split(path.sep).join('/');
}

async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

async function directoryExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isDirectory();
}

async function listFiles(rootDir, relativeDir = '') {
	const entries = await readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relativePath = path.join(relativeDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(rootDir, relativePath)));
			continue;
		}
		if (entry.isFile()) files.push(toPosixPath(relativePath));
	}
	return files.sort();
}

async function downloadFile(url, targetPath) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`failed to download Octave package from ${url}: ${response.status}`);
	}
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
}

function extractTarBzip2(archivePath, targetDir) {
	const result = spawnSync('tar', ['-xjf', archivePath, '-C', targetDir], {
		stdio: 'pipe',
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(
			`failed to extract ${archivePath}: ${result.stderr || result.stdout || `exit ${result.status}`}`
		);
	}
}

async function ensureDefaultSourceDir(cacheDir, packageUrl) {
	const archivePath = path.join(cacheDir, OCTAVE_PACKAGE_FILE);
	const extractDir = path.join(cacheDir, OCTAVE_PACKAGE_FILE.replace(/\.tar\.bz2$/, ''));
	if (!(await fileExists(archivePath))) {
		await downloadFile(packageUrl, archivePath);
	}
	if (!(await fileExists(path.join(extractDir, 'bin', 'octave-cli-10.3.0')))) {
		await rm(extractDir, { recursive: true, force: true });
		await mkdir(extractDir, { recursive: true });
		extractTarBzip2(archivePath, extractDir);
	}
	return extractDir;
}

function isRuntimeFile(relativePath) {
	if (REQUIRED_RUNTIME_FILES.includes(relativePath)) return true;
	if (relativePath.startsWith(`lib/octave/${OCTAVE_VERSION}/`)) {
		return !relativePath.endsWith('.a');
	}
	return (
		relativePath.startsWith(`share/octave/${OCTAVE_VERSION}/`) ||
		relativePath.startsWith('share/octave/site/')
	);
}

async function collectRuntimeFiles(sourceDir) {
	for (const fileName of REQUIRED_RUNTIME_FILES) {
		if (!(await fileExists(path.join(sourceDir, fileName)))) {
			throw new Error(`Octave runtime asset ${fileName} was not found in ${sourceDir}.`);
		}
	}
	if (!(await directoryExists(path.join(sourceDir, 'lib', 'octave', OCTAVE_VERSION)))) {
		throw new Error(`Octave runtime libraries were not found in ${sourceDir}.`);
	}
	if (!(await directoryExists(path.join(sourceDir, 'share', 'octave', OCTAVE_VERSION, 'm')))) {
		throw new Error(`Octave standard library m-files were not found in ${sourceDir}.`);
	}
	return (await listFiles(sourceDir)).filter(isRuntimeFile);
}

function targetRuntimeFileNames(sourceFileName) {
	if (sourceFileName === ENTRY_SOURCE_FILE) return [ENTRY_SOURCE_FILE, ENTRY_SCRIPT_FILE];
	return [sourceFileName];
}

async function sha256File(filePath) {
	return createHash('sha256')
		.update(await readFile(filePath))
		.digest('hex');
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_OCTAVE_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

async function computeFingerprint(targetDir, files, runnerWorkerPath) {
	const hash = createHash('sha256');
	for (const fileName of files) {
		hash.update(fileName);
		hash.update('\0');
		hash.update(await readFile(path.join(targetDir, fileName)));
		hash.update('\n');
	}
	if (runnerWorkerPath && (await fileExists(runnerWorkerPath))) {
		hash.update('runner-worker.js');
		hash.update('\0');
		hash.update(await readFile(runnerWorkerPath));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

async function writeRuntimeManifest(targetDir, files, fingerprint) {
	const manifestFiles = [];
	for (const fileName of files) {
		const targetPath = path.join(targetDir, fileName);
		const fileStats = await stat(targetPath);
		manifestFiles.push({
			path: fileName,
			size: fileStats.size,
			sha256: await sha256File(targetPath)
		});
	}
	const manifest = {
		format: 'wasm-octave-runtime-manifest-v1',
		version: OCTAVE_VERSION,
		package: OCTAVE_PACKAGE_FILE,
		packageUrl: OCTAVE_PACKAGE_URL,
		fingerprint,
		entryScript: ENTRY_SCRIPT_FILE,
		entryWasm: ENTRY_WASM_FILE,
		files: manifestFiles
	};
	await writeFile(
		path.join(targetDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

/**
 * @typedef {object} SyncWasmOctaveOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [versionModulePath]
 * @property {string} [cacheDir]
 * @property {string} [packageUrl]
 * @property {string} [runnerWorkerPath]
 */

/**
 * @param {SyncWasmOctaveOptions} [options]
 */
export async function syncWasmOctaveAssets(options = {}) {
	const {
		sourceDir = '',
		targetDir = DEFAULT_TARGET_DIR,
		versionModulePath = DEFAULT_VERSION_MODULE_PATH,
		cacheDir = DEFAULT_CACHE_DIR,
		packageUrl = OCTAVE_PACKAGE_URL,
		runnerWorkerPath = DEFAULT_RUNNER_WORKER_PATH
	} = options;
	const resolvedSourceDir = sourceDir || (await ensureDefaultSourceDir(cacheDir, packageUrl));
	const sourceStats = await stat(resolvedSourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(`Octave package directory was not found at ${resolvedSourceDir}.`);
	}

	const sourceRuntimeFiles = await collectRuntimeFiles(resolvedSourceDir);
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	const runtimeFiles = [];
	for (const fileName of sourceRuntimeFiles) {
		for (const targetFileName of targetRuntimeFileNames(fileName)) {
			const targetPath = path.join(targetDir, targetFileName);
			await mkdir(path.dirname(targetPath), { recursive: true });
			await cp(path.join(resolvedSourceDir, fileName), targetPath);
			runtimeFiles.push(targetFileName);
		}
	}
	runtimeFiles.sort();

	const fingerprint = await computeFingerprint(targetDir, runtimeFiles, runnerWorkerPath);
	await writeRuntimeManifest(targetDir, runtimeFiles, fingerprint);
	await writeVersionModule(versionModulePath, fingerprint);

	return {
		sourceDir: resolvedSourceDir,
		targetDir,
		fingerprint,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmOctaveAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-octave from ${sourceDir} to ${targetDir}`);
}
