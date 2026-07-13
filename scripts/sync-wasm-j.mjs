import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, '..', 'j-playground', 'bin', 'html2');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-j');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-j-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmJVersion.ts'
);
const RUNTIME_FILES = ['jamalgam.js', 'jamalgam.wasm'];

/**
 * @typedef {object} SyncWasmJOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
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
		(await fileExists(path.join(targetDir, 'jamalgam.js'))) &&
		(await targetRuntimeFileExists(targetDir, 'jamalgam.wasm'))
	);
}

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 */
async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_J_ASSET_VERSION = '${fingerprint}';\n`;
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
		if (await fileExists(path.join(targetDir, `${file}.gz`))) {
			files.push(`${file}.gz`);
		}
	}
	if (await fileExists(path.join(targetDir, 'runner-worker.js'))) files.push('runner-worker.js');
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
		format: 'wasm-j-runtime-manifest-v1',
		runtime: 'jsoftware-j-playground',
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
	const configuredSourceDir = process.env.WASM_J_SOURCE_DIR
		? path.resolve(process.env.WASM_J_SOURCE_DIR)
		: DEFAULT_SOURCE_DIR;
	if (await sourceLooksUsable(configuredSourceDir)) return configuredSourceDir;
	if (await targetLooksUsable(targetDir)) return null;
	throw new Error(
		`J playground runtime assets were not found. Set WASM_J_SOURCE_DIR or pass a source dir containing ${RUNTIME_FILES.join(
			', '
		)}.`
	);
}

/**
 * @param {SyncWasmJOptions} [options]
 */
export async function syncWasmJAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const resolvedTargetDir = path.resolve(targetDir);
	const resolvedSourceDir = await resolveSourceDir(sourceDir, resolvedTargetDir);
	if (resolvedSourceDir) {
		const moduleSource = await readFile(path.join(resolvedSourceDir, 'jamalgam.js'), 'utf8');
		if (!moduleSource.includes('em_jdo') || !moduleSource.includes('WebAssembly.instantiate')) {
			throw new Error('jamalgam.js does not look like the expected J WebAssembly runtime.');
		}
		await rm(resolvedTargetDir, { recursive: true, force: true });
		await mkdir(resolvedTargetDir, { recursive: true });
		for (const file of RUNTIME_FILES) {
			await cp(path.join(resolvedSourceDir, file), path.join(resolvedTargetDir, file));
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
		throw new Error(`J runtime target is missing one of: ${RUNTIME_FILES.join(', ')}`);
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
	const { sourceDir, targetDir } = await syncWasmJAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-j from ${sourceDir} to ${targetDir}`);
}
