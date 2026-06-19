import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_CACHE_DIR = path.resolve(REPO_ROOT, '.cache', 'wasm-tcl');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-tcl');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-tcl-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmTclVersion.ts'
);

export const WACL_VERSION = '2017-05-29';
export const WACL_PACKAGE_FILE = 'wacl.zip';
export const WACL_PACKAGE_URL = 'https://ecky-l.github.io/wacl/releases/wacl.zip';
const REQUIRED_SOURCE_FILES = [
	'js/require.js',
	'js/tcl/wacl-custom.data',
	'js/tcl/wacl-library.data',
	'js/tcl/wacl.js',
	'js/tcl/wacl.wasm'
];
const REQUIRED_TARGET_FILES = [
	'require.js',
	'tcl/wacl-custom.data',
	'tcl/wacl-library.data',
	'tcl/wacl.js',
	'tcl/wacl.wasm'
];

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
	const archivePath = path.join(cacheDir, WACL_PACKAGE_FILE);
	const extractDir = path.join(cacheDir, 'wacl');
	if (!(await fileExists(archivePath))) await downloadFile(WACL_PACKAGE_URL, archivePath);
	if (!(await fileExists(path.join(extractDir, 'js', 'tcl', 'wacl.js')))) {
		await rm(extractDir, { recursive: true, force: true });
		await mkdir(extractDir, { recursive: true });
		unzipArchive(archivePath, extractDir);
	}
	return extractDir;
}

function replaceOnce(source, search, replacement) {
	if (!source.includes(search)) {
		throw new Error(`Wacl glue patch target was not found: ${search.slice(0, 64)}`);
	}
	return source.replace(search, replacement);
}

function patchWaclGlue(source) {
	let patched = replaceOnce(
		source,
		'var Module;if(typeof Module==="undefined")Module=eval("(function() { try { return Module || {} } catch(e) { return {} } })()");',
		'var Module;if(typeof Module==="undefined")Module=(typeof self!=="undefined"&&self.Module)||eval("(function() { try { return Module || {} } catch(e) { return {} } })()");'
	);
	patched = replaceOnce(
		patched,
		'Module["print"]=(function(txt){console.log("wacl stdout: "+txt)});',
		'Module["print"]=Module["print"]||(function(txt){console.log("wacl stdout: "+txt)});'
	);
	patched = replaceOnce(
		patched,
		'Module["printErr"]=(function(txt){console.error("wacl stderr: "+txt)});',
		'Module["printErr"]=Module["printErr"]||(function(txt){console.error("wacl stderr: "+txt)});'
	);
	patched = replaceOnce(
		patched,
		'delete window.Module;',
		'if(typeof window!=="undefined")delete window.Module;'
	);
	return `${patched.replace(/\n+$/u, '')}\n`;
}

function normalizeTextData(source) {
	return `${source.replace(/[ \t]+$/gmu, '').replace(/\n+$/u, '')}\n`;
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_TCL_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
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
		format: 'wasm-tcl-runtime-manifest-v1',
		version: WACL_VERSION,
		package: WACL_PACKAGE_FILE,
		packageUrl: WACL_PACKAGE_URL,
		fingerprint,
		files: REQUIRED_TARGET_FILES
	};
	await writeFile(
		path.join(targetDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

export async function syncWasmTclAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	cacheDir = DEFAULT_CACHE_DIR
} = {}) {
	const resolvedSourceDir = sourceDir || (await ensureDefaultSourceDir(cacheDir));
	for (const fileName of REQUIRED_SOURCE_FILES) {
		if (!(await fileExists(path.join(resolvedSourceDir, fileName)))) {
			throw new Error(`Wacl Tcl asset ${fileName} was not found in ${resolvedSourceDir}.`);
		}
	}
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(path.join(targetDir, 'tcl'), { recursive: true });
	await cp(path.join(resolvedSourceDir, 'js', 'require.js'), path.join(targetDir, 'require.js'));
	await writeFile(
		path.join(targetDir, 'tcl', 'wacl-custom.data'),
		normalizeTextData(
			await readFile(path.join(resolvedSourceDir, 'js', 'tcl', 'wacl-custom.data'), 'utf8')
		),
		'utf8'
	);
	await cp(
		path.join(resolvedSourceDir, 'js', 'tcl', 'wacl-library.data'),
		path.join(targetDir, 'tcl', 'wacl-library.data')
	);
	await cp(
		path.join(resolvedSourceDir, 'js', 'tcl', 'wacl.wasm'),
		path.join(targetDir, 'tcl', 'wacl.wasm')
	);
	await writeFile(
		path.join(targetDir, 'tcl', 'wacl.js'),
		patchWaclGlue(await readFile(path.join(resolvedSourceDir, 'js', 'tcl', 'wacl.js'), 'utf8')),
		'utf8'
	);
	await cp(workerSourcePath, path.join(targetDir, 'runner-worker.js'));
	const copiedFiles = [...REQUIRED_TARGET_FILES, 'runner-worker.js'];
	const fingerprint = await computeFingerprint(targetDir, copiedFiles);
	await writeRuntimeManifest(targetDir, fingerprint);
	await writeVersionModule(versionModulePath, fingerprint);
	return { sourceDir: resolvedSourceDir, targetDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmTclAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-tcl from ${sourceDir} to ${targetDir}`);
}
