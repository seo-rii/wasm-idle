import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, '..', 'wasm-tinygo', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-tinygo');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmTinyGoVersion.ts'
);

/**
 * @param {string} relativePath
 */
function shouldInclude(relativePath) {
	const normalized = relativePath.split(path.sep).join('/');
	if (
		normalized.startsWith('vendor/emception/') ||
		normalized.startsWith('vendor/wasm-rust-runtime/')
	) {
		return true;
	}
	if (normalized.startsWith('assets/runtime-') && normalized.endsWith('.js')) {
		return true;
	}
	const exactAllowlist = new Set([
		'runtime.js',
		'tools/go-probe.wasm',
		'tools/tinygo-compiler.wasm',
		'tools/tinygo-compiler.json',
		'tools/tinygo-upstream-probe.wasm',
		'tools/tinygo-upstream-probe.json',
		'tools/tinygo-upstream-frontend-probe.wasm',
		'tools/tinygo-upstream-frontend-probe.json'
	]);
	return exactAllowlist.has(normalized);
}

/**
 * @param {string} rootDir
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
			if (shouldInclude(relativePath)) {
				files.push(entryPath);
			}
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
	const moduleSource =
		`export const WASM_TINYGO_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

/**
 * @param {{ sourceDir?: string; targetDir?: string; versionModulePath?: string }} [options]
 */
export async function syncWasmTinyGoDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`wasm-tinygo dist directory was not found at ${sourceDir}. Build wasm-tinygo first with "cd ../wasm-tinygo && npm run build".`
		);
	}

	const entryHtmlPath = path.join(sourceDir, 'index.html');
	const entryHtmlStats = await stat(entryHtmlPath).catch(() => null);
	if (!entryHtmlStats?.isFile()) {
		throw new Error(`wasm-tinygo dist entry was not found at ${entryHtmlPath}.`);
	}
	const runtimeModulePath = path.join(sourceDir, 'runtime.js');
	const runtimeModuleStats = await stat(runtimeModulePath).catch(() => null);
	if (!runtimeModuleStats?.isFile()) {
		throw new Error(`wasm-tinygo runtime module was not found at ${runtimeModulePath}.`);
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
	const { sourceDir, targetDir } = await syncWasmTinyGoDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-tinygo from ${sourceDir} to ${targetDir}`);
}
