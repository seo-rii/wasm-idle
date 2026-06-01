import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-lisp', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-lisp');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmLispVersion.ts'
);

const REQUIRED_ASSETS = [
	'index.js',
	'puppyc.js',
	'puppyc.core.wasm',
	'puppyc.core2.wasm',
	'puppyc.component.wasm',
	'runtime-build.json',
	'vendor/jco/src/browser.js',
	'vendor/jco/obj/js-component-bindgen-component.js',
	'vendor/jco/obj/js-component-bindgen-component.core.wasm',
	'vendor/jco/obj/js-component-bindgen-component.core2.wasm',
	'vendor/preview2-shim/lib/browser/cli.js',
	'vendor/preview2-shim/lib/browser/filesystem.js',
	'vendor/preview2-shim/lib/browser/io.js'
];

/**
 * @typedef {{
 *   sourceDir?: string;
 *   targetDir?: string;
 *   versionModulePath?: string;
 * }} SyncWasmLispOptions
 */

/** @param {string} sourcePath */
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
	/** @type {string[]} */
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name);
		if (shouldSkipCopy(entryPath)) continue;
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) files.push(entryPath);
	}
	return files.sort();
}

/** @param {string} filePath */
async function fileExists(filePath) {
	const stats = await stat(filePath).catch(() => null);
	return !!stats?.isFile();
}

/**
 * @param {string} filePath
 * @param {string} label
 */
async function assertWasmFile(filePath, label) {
	const data = await readFile(filePath);
	if (
		data.byteLength < 8 ||
		data[0] !== 0x00 ||
		data[1] !== 0x61 ||
		data[2] !== 0x73 ||
		data[3] !== 0x6d
	) {
		throw new Error(`${label} is not a valid WebAssembly binary: ${filePath}`);
	}
}

/** @param {string} sourceDir */
async function assertCompleteDist(sourceDir) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`wasm-lisp dist directory was not found at ${sourceDir}. Build wasm-lisp first with "pnpm --dir runtimes/wasm-lisp build".`
		);
	}
	for (const asset of REQUIRED_ASSETS) {
		const assetPath = path.join(sourceDir, asset);
		if (!(await fileExists(assetPath))) {
			throw new Error(`wasm-lisp runtime asset was not found at ${assetPath}.`);
		}
	}
	await assertWasmFile(path.join(sourceDir, 'puppyc.core.wasm'), 'puppyc core module');
	await assertWasmFile(path.join(sourceDir, 'puppyc.core2.wasm'), 'puppyc compiler module');
	await assertWasmFile(path.join(sourceDir, 'puppyc.component.wasm'), 'puppyc component');
}

/** @param {string} sourceDir */
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
	const moduleSource = `export const WASM_LISP_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

/** @param {SyncWasmLispOptions} [options] */
export async function syncWasmLispDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	await assertCompleteDist(sourceDir);
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	await copyDirectory(sourceDir, targetDir);
	const fingerprint = await computeBundleFingerprint(targetDir);
	await writeVersionModule(versionModulePath, fingerprint);
	return { sourceDir, targetDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmLispDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-lisp from ${sourceDir} to ${targetDir}`);
}
