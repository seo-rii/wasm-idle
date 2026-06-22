import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	rewriteSharedEmscriptenLldAssets,
	validateSharedEmscriptenLldAssets
} from './shared-emscripten-lld.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-d', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-d');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmDVersion.ts'
);
const DEFAULT_SHARED_LLD_DIR = path.resolve(REPO_ROOT, 'static', 'shared', 'emscripten-lld');

function shouldSkipCopy(sourcePath) {
	return sourcePath.endsWith('.d.ts') || sourcePath.endsWith('.tsbuildinfo');
}

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

async function listFiles(rootDir) {
	const entries = await readdir(rootDir, { withFileTypes: true });
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

async function computeBundleFingerprint(sourceDir, additionalFiles = []) {
	const hash = createHash('sha256');
	for (const filePath of await listFiles(sourceDir)) {
		hash.update(path.relative(sourceDir, filePath));
		hash.update('\0');
		hash.update(await readFile(filePath));
		hash.update('\n');
	}
	for (const filePath of additionalFiles) {
		hash.update(`shared/${path.basename(filePath)}`);
		hash.update('\0');
		hash.update(await readFile(filePath));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

async function normalizeTextAssets(targetDir) {
	const lldJsPath = path.join(targetDir, 'runtime', 'bin', 'lld.js');
	const lldJs = await readFile(lldJsPath, 'utf8');
	const normalizedLldJs = lldJs.replace(/[ \t]+$/gm, '');
	if (normalizedLldJs !== lldJs) {
		await writeFile(lldJsPath, normalizedLldJs, 'utf8');
	}
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_D_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

export async function syncWasmDDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	sharedLldDir = DEFAULT_SHARED_LLD_DIR
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`wasm-d dist directory was not found at ${sourceDir}. Build wasm-d first with "pnpm --dir runtimes/wasm-d build".`
		);
	}
	const requiredFiles = [
		'index.js',
		'runtime/runtime-manifest.v1.json',
		'runtime/runtime-build.json',
		'runtime/bin/ldc2.wasm.gz',
		'runtime/bin/lld.js',
		'runtime/bin/lld.wasm.gz',
		'runtime/bin/lld.data.gz',
		'runtime/toolchain/toolchain.tar.gz'
	];
	for (const filePath of requiredFiles) {
		const absolutePath = path.join(sourceDir, filePath);
		const fileStats = await stat(absolutePath).catch(() => null);
		if (!fileStats?.isFile())
			throw new Error(`wasm-d dist file was not found at ${absolutePath}.`);
	}
	await validateSharedEmscriptenLldAssets({
		sourceAssetDir: path.join(sourceDir, 'runtime', 'bin'),
		sharedAssetDir: sharedLldDir
	});

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	await copyDirectory(sourceDir, targetDir);
	await normalizeTextAssets(targetDir);
	await rewriteSharedEmscriptenLldAssets({
		targetAssetDir: path.join(targetDir, 'runtime', 'bin'),
		manifestPath: path.join(targetDir, 'runtime', 'runtime-manifest.v1.json'),
		localWasmAsset: 'bin/lld.wasm.gz',
		localDataAsset: 'bin/lld.data.gz'
	});
	const fingerprint = await computeBundleFingerprint(targetDir, [
		path.join(sharedLldDir, 'lld.wasm.gz'),
		path.join(sharedLldDir, 'lld.data.gz')
	]);
	await writeVersionModule(versionModulePath, fingerprint);
	return { sourceDir, targetDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmDDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-d from ${sourceDir} to ${targetDir}`);
}
