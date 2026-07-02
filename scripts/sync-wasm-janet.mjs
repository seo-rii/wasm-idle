import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, '..', 'janet-wasm', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-janet');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-janet-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmJanetVersion.ts'
);
const RUNTIME_FILES = ['janet.js', 'janet.wasm'];
const LICENSE_FILE_NAME = 'LICENSE.txt';

/**
 * @typedef {object} SyncWasmJanetOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [licenseFile]
 */

/**
 * @param {string} filePath
 */
async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

/**
 * @param {string} dir
 * @param {string} file
 */
async function targetRuntimeFileExists(dir, file) {
	return (
		(await fileExists(path.join(dir, file))) || (await fileExists(path.join(dir, `${file}.gz`)))
	);
}

/**
 * @param {string} sourceDir
 */
async function sourceLooksUsable(sourceDir) {
	return Promise.all(RUNTIME_FILES.map((file) => fileExists(path.join(sourceDir, file)))).then(
		(results) => results.every(Boolean)
	);
}

/**
 * @param {string} targetDir
 */
async function targetLooksUsable(targetDir) {
	return (
		(await fileExists(path.join(targetDir, 'janet.js'))) &&
		(await targetRuntimeFileExists(targetDir, 'janet.wasm'))
	);
}

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 */
async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_JANET_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current !== moduleSource) await writeFile(versionModulePath, moduleSource, 'utf8');
}

/**
 * @param {string} targetDir
 */
async function collectFingerprintFiles(targetDir) {
	const files = [];
	for (const file of RUNTIME_FILES) {
		if (await fileExists(path.join(targetDir, file))) {
			files.push(file);
			continue;
		}
		if (await fileExists(path.join(targetDir, `${file}.gz`))) files.push(`${file}.gz`);
	}
	for (const file of ['runner-worker.js', LICENSE_FILE_NAME]) {
		if (await fileExists(path.join(targetDir, file))) files.push(file);
	}
	return files;
}

/**
 * @param {string} targetDir
 * @param {string[]} files
 */
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

/**
 * @param {string} targetDir
 * @param {string} fingerprint
 * @param {string[]} files
 */
async function writeRuntimeManifest(targetDir, fingerprint, files) {
	const manifest = {
		format: 'wasm-janet-runtime-manifest-v1',
		runtime: 'janet-lang-janet',
		build: {
			emscripten: '3.1.8',
			options: [
				'ENVIRONMENT=worker',
				'MODULARIZE=1',
				'EXPORT_ES6=1',
				'FORCE_FILESYSTEM=1',
				'INVOKE_RUN=0',
				'EXIT_RUNTIME=1',
				'JANET_REDUCED_OS'
			],
			runner: 'scripts/runtime-build/wasm-janet-runner.c'
		},
		fingerprint,
		files: files.filter((file) => file !== 'runner-worker.js')
	};
	await writeFile(
		path.join(targetDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

/**
 * @param {string | undefined} sourceDir
 * @param {string} targetDir
 */
async function resolveSourceDir(sourceDir, targetDir) {
	if (sourceDir) return path.resolve(sourceDir);
	const configuredSourceDir = process.env.WASM_JANET_SOURCE_DIR
		? path.resolve(process.env.WASM_JANET_SOURCE_DIR)
		: DEFAULT_SOURCE_DIR;
	if (await sourceLooksUsable(configuredSourceDir)) return configuredSourceDir;
	if (await targetLooksUsable(targetDir)) return null;
	throw new Error(
		`Janet runtime assets were not found. Set WASM_JANET_SOURCE_DIR or pass a source dir containing ${RUNTIME_FILES.join(
			', '
		)}.`
	);
}

/**
 * @param {string} sourceDir
 * @param {string | undefined} licenseFile
 */
async function resolveLicenseFile(sourceDir, licenseFile) {
	const candidates = [
		licenseFile,
		process.env.WASM_JANET_LICENSE_FILE,
		path.join(sourceDir, LICENSE_FILE_NAME),
		path.join(sourceDir, 'LICENSE'),
		path.join(sourceDir, '..', 'LICENSE')
	].filter(Boolean);
	for (const candidate of candidates) {
		const resolved = path.resolve(String(candidate));
		if (await fileExists(resolved)) return resolved;
	}
	return null;
}

/**
 * @param {SyncWasmJanetOptions} [options]
 */
export async function syncWasmJanetAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	licenseFile
} = {}) {
	const resolvedTargetDir = path.resolve(targetDir);
	const resolvedSourceDir = await resolveSourceDir(sourceDir, resolvedTargetDir);
	if (resolvedSourceDir) {
		const moduleSource = await readFile(path.join(resolvedSourceDir, 'janet.js'), 'utf8');
		if (
			!moduleSource.includes('export default Module') ||
			!moduleSource.includes('callMain') ||
			!moduleSource.includes('FS.init')
		) {
			throw new Error(
				'janet.js does not look like the expected Janet Emscripten ESM runtime with filesystem support.'
			);
		}
		await rm(resolvedTargetDir, { recursive: true, force: true });
		await mkdir(resolvedTargetDir, { recursive: true });
		for (const file of RUNTIME_FILES) {
			await cp(path.join(resolvedSourceDir, file), path.join(resolvedTargetDir, file));
		}
		const resolvedLicenseFile = await resolveLicenseFile(resolvedSourceDir, licenseFile);
		if (resolvedLicenseFile) {
			await cp(resolvedLicenseFile, path.join(resolvedTargetDir, LICENSE_FILE_NAME));
		}
	} else {
		await mkdir(resolvedTargetDir, { recursive: true });
	}
	await cp(workerSourcePath, path.join(resolvedTargetDir, 'runner-worker.js'));
	const copiedFiles = await collectFingerprintFiles(resolvedTargetDir);
	if (
		!RUNTIME_FILES.every(
			(file) => copiedFiles.includes(file) || copiedFiles.includes(`${file}.gz`)
		)
	) {
		throw new Error(`Janet runtime target is missing one of: ${RUNTIME_FILES.join(', ')}`);
	}
	const fingerprint = await computeFingerprint(resolvedTargetDir, copiedFiles);
	await writeRuntimeManifest(resolvedTargetDir, fingerprint, copiedFiles);
	await writeVersionModule(versionModulePath, fingerprint);
	return {
		sourceDir: resolvedSourceDir || resolvedTargetDir,
		targetDir: resolvedTargetDir,
		fingerprint,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmJanetAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-janet from ${sourceDir} to ${targetDir}`);
}
