import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_CACHE_DIR = path.resolve(REPO_ROOT, '.cache', 'wasm-perl');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-perl');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-perl-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmPerlVersion.ts'
);

export const WEBPERL_VERSION = 'v0.09-beta';
export const WEBPERL_PACKAGE_FILE = 'webperl_prebuilt_v0.09-beta.zip';
export const WEBPERL_PACKAGE_URL =
	'https://github.com/haukex/webperl/releases/download/v0.09-beta/webperl_prebuilt_v0.09-beta.zip';
const REQUIRED_FILES = ['emperl.js', 'emperl.wasm', 'emperl.data'];

async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

async function downloadFile(url, targetPath) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`failed to download ${url}: ${response.status}`);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
}

function unzipArchive(archivePath, targetDir) {
	const result = spawnSync('unzip', ['-q', archivePath, '-d', targetDir], {
		stdio: 'pipe',
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(
			`failed to extract ${archivePath}: ${result.stderr || result.stdout || `exit ${result.status}`}`
		);
	}
}

async function ensureDefaultSourceDir(cacheDir) {
	const archivePath = path.join(cacheDir, WEBPERL_PACKAGE_FILE);
	const extractDir = path.join(cacheDir, 'webperl_prebuilt_v0.09-beta');
	if (!(await fileExists(archivePath))) await downloadFile(WEBPERL_PACKAGE_URL, archivePath);
	if (!(await fileExists(path.join(extractDir, 'emperl.js')))) {
		await rm(extractDir, { recursive: true, force: true });
		await mkdir(cacheDir, { recursive: true });
		unzipArchive(archivePath, cacheDir);
	}
	return extractDir;
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_PERL_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current !== moduleSource) await writeFile(versionModulePath, moduleSource, 'utf8');
}

async function computeFingerprint(targetDir, files) {
	const hash = createHash('sha256');
	for (const fileName of files.sort()) {
		hash.update(fileName);
		hash.update('\0');
		hash.update(await readFile(path.join(targetDir, fileName)));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

async function writeRuntimeManifest(targetDir, fingerprint) {
	const manifest = {
		format: 'wasm-perl-runtime-manifest-v1',
		version: WEBPERL_VERSION,
		package: WEBPERL_PACKAGE_FILE,
		packageUrl: WEBPERL_PACKAGE_URL,
		fingerprint,
		files: REQUIRED_FILES
	};
	await writeFile(
		path.join(targetDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

export async function syncWasmPerlAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	cacheDir = DEFAULT_CACHE_DIR
} = {}) {
	const resolvedSourceDir = sourceDir || (await ensureDefaultSourceDir(cacheDir));
	for (const fileName of REQUIRED_FILES) {
		if (!(await fileExists(path.join(resolvedSourceDir, fileName)))) {
			throw new Error(`WebPerl asset ${fileName} was not found in ${resolvedSourceDir}.`);
		}
	}
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	const copiedFiles = [];
	for (const fileName of REQUIRED_FILES) {
		await cp(path.join(resolvedSourceDir, fileName), path.join(targetDir, fileName));
		copiedFiles.push(fileName);
	}
	await cp(workerSourcePath, path.join(targetDir, 'runner-worker.js'));
	copiedFiles.push('runner-worker.js');
	const fingerprint = await computeFingerprint(targetDir, copiedFiles);
	await writeRuntimeManifest(targetDir, fingerprint);
	await writeVersionModule(versionModulePath, fingerprint);
	return { sourceDir: resolvedSourceDir, targetDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmPerlAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-perl from ${sourceDir} to ${targetDir}`);
}
