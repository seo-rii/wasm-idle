import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const require = createRequire(import.meta.url);
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-forth');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-forth-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmForthVersion.ts'
);
const REQUIRED_FILES = ['waforth.js'];

/**
 * @typedef {object} SyncWasmForthOptions
 * @property {string} [sourceFile]
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

function resolveDefaultSourceFile() {
	const packageJsonPath = require.resolve('waforth/package.json');
	return path.join(path.dirname(packageJsonPath), 'dist', 'index.js');
}

/**
 * @param {string} source
 */
function wrapWaforthBundle(source) {
	const normalized = source.replace(/[ \t]+$/gmu, '').replace(/\n+$/u, '\n');
	return [
		'var module = { exports: {} };',
		'var exports = module.exports;',
		normalized,
		'self.WAForthPackage = module.exports;',
		''
	].join('\n');
}

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 */
async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_FORTH_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current !== moduleSource) await writeFile(versionModulePath, moduleSource, 'utf8');
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
 */
async function writeRuntimeManifest(targetDir, fingerprint) {
	const packageInfo = JSON.parse(
		await readFile(
			path.join(path.dirname(resolveDefaultSourceFile()), '..', 'package.json'),
			'utf8'
		)
	);
	const manifest = {
		format: 'wasm-forth-runtime-manifest-v1',
		runtime: 'waforth',
		waforthVersion: packageInfo.version,
		fingerprint,
		files: REQUIRED_FILES
	};
	await writeFile(
		path.join(targetDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

/**
 * @param {SyncWasmForthOptions} [options]
 */
export async function syncWasmForthAssets({
	sourceFile,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const resolvedSourceFile = sourceFile ? path.resolve(sourceFile) : resolveDefaultSourceFile();
	if (!(await fileExists(resolvedSourceFile))) {
		throw new Error(`waforth bundle was not found at ${resolvedSourceFile}.`);
	}
	const bundleSource = await readFile(resolvedSourceFile, 'utf8');
	if (
		!bundleSource.includes('module.exports') ||
		!bundleSource.includes('WebAssembly.instantiate')
	) {
		throw new Error('waforth bundle does not look like the expected WebAssembly runtime.');
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	await writeFile(path.join(targetDir, 'waforth.js'), wrapWaforthBundle(bundleSource), 'utf8');
	await cp(workerSourcePath, path.join(targetDir, 'runner-worker.js'));
	const copiedFiles = ['waforth.js', 'runner-worker.js'];
	const fingerprint = await computeFingerprint(targetDir, copiedFiles);
	await writeRuntimeManifest(targetDir, fingerprint);
	await writeVersionModule(versionModulePath, fingerprint);
	return { sourceFile: resolvedSourceFile, targetDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceFileArg, targetDirArg] = process.argv;
	const { sourceFile, targetDir } = await syncWasmForthAssets({
		sourceFile: sourceFileArg ? path.resolve(sourceFileArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-forth from ${sourceFile} to ${targetDir}`);
}
