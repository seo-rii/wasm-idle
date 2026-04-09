import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_BROWSER_DIST_DIR = path.resolve(
	REPO_ROOT,
	'..',
	'wasm-of-js-of-ocaml',
	'browser-harness',
	'dist'
);
const DEFAULT_SOURCE_BUNDLE_DIR = path.resolve(
	REPO_ROOT,
	'..',
	'wasm-of-js-of-ocaml',
	'.cache',
	'browser-native-bundle'
);
const DEFAULT_SOURCE_BINARYEN_BIN_DIR = path.resolve(
	REPO_ROOT,
	'..',
	'wasm-of-js-of-ocaml',
	'.cache',
	'binaryen-version_129',
	'bin'
);
const DEFAULT_TARGET_BROWSER_DIST_DIR = path.resolve(
	REPO_ROOT,
	'static',
	'wasm-of-js-of-ocaml',
	'browser-native'
);
const DEFAULT_TARGET_BUNDLE_DIR = path.resolve(
	REPO_ROOT,
	'static',
	'wasm-of-js-of-ocaml',
	'browser-native-bundle'
);
const LEGACY_TARGET_BUNDLE_DIR = path.resolve(REPO_ROOT, 'static', '.cache', 'browser-native-bundle');
const DEFAULT_TARGET_BINARYEN_BIN_DIR = path.resolve(
	REPO_ROOT,
	'.cache',
	'wasm-of-js-of-ocaml-binaryen',
	'bin'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmOcamlVersion.ts'
);

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
		if (entry.isFile()) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

async function computeBundleFingerprint(rootDirs) {
	const hash = createHash('sha256');
	for (const rootDir of rootDirs) {
		for (const filePath of await listFiles(rootDir)) {
			const fileStats = await stat(filePath);
			hash.update(path.relative(rootDir, filePath));
			hash.update('\0');
			hash.update(String(fileStats.size));
			hash.update('\0');
			hash.update(String(Math.trunc(fileStats.mtimeMs)));
			hash.update('\n');
		}
		hash.update('\n---\n');
	}
	return hash.digest('hex').slice(0, 16);
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_OCAML_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

export async function syncWasmOfJsOfOcamlDist({
	sourceBrowserDistDir = DEFAULT_SOURCE_BROWSER_DIST_DIR,
	sourceBundleDir = DEFAULT_SOURCE_BUNDLE_DIR,
	sourceBinaryenBinDir = DEFAULT_SOURCE_BINARYEN_BIN_DIR,
	targetBrowserDistDir = DEFAULT_TARGET_BROWSER_DIST_DIR,
	targetBundleDir = DEFAULT_TARGET_BUNDLE_DIR,
	targetBinaryenBinDir = DEFAULT_TARGET_BINARYEN_BIN_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const browserDistStats = await stat(sourceBrowserDistDir).catch(() => null);
	if (!browserDistStats?.isDirectory()) {
		throw new Error(
			`wasm-of-js-of-ocaml browser dist directory was not found at ${sourceBrowserDistDir}. Build wasm-of-js-of-ocaml first with "cd ../wasm-of-js-of-ocaml && npm run build && npm run prepare:browser-native -- --force".`
		);
	}
	const bundleStats = await stat(sourceBundleDir).catch(() => null);
	if (!bundleStats?.isDirectory()) {
		throw new Error(
			`wasm-of-js-of-ocaml browser-native bundle directory was not found at ${sourceBundleDir}. Run "cd ../wasm-of-js-of-ocaml && npm run prepare:browser-native -- --force" first.`
		);
	}
	const binaryenBinStats = await stat(sourceBinaryenBinDir).catch(() => null);
	if (!binaryenBinStats?.isDirectory()) {
		throw new Error(
			`wasm-of-js-of-ocaml Binaryen bin directory was not found at ${sourceBinaryenBinDir}. Run "cd ../wasm-of-js-of-ocaml && npm run prepare:browser-native -- --force" first.`
		);
	}

	const browserEntryPath = path.join(sourceBrowserDistDir, 'src', 'index.js');
	const browserEntryStats = await stat(browserEntryPath).catch(() => null);
	if (!browserEntryStats?.isFile()) {
		throw new Error(`wasm-of-js-of-ocaml browser entry was not found at ${browserEntryPath}.`);
	}

	const nativeWorkerPath = path.join(
		sourceBrowserDistDir,
		'browser-harness',
		'native-tool-worker.js'
	);
	const nativeWorkerStats = await stat(nativeWorkerPath).catch(() => null);
	if (!nativeWorkerStats?.isFile()) {
		throw new Error(
			`wasm-of-js-of-ocaml browser-native worker was not found at ${nativeWorkerPath}.`
		);
	}

	const manifestPath = path.join(sourceBundleDir, 'browser-native-manifest.v1.json');
	const manifestStats = await stat(manifestPath).catch(() => null);
	if (!manifestStats?.isFile()) {
		throw new Error(
			`wasm-of-js-of-ocaml browser-native manifest was not found at ${manifestPath}.`
		);
	}

	const wasmOptPath = path.join(sourceBinaryenBinDir, 'wasm-opt');
	const wasmOptStats = await stat(wasmOptPath).catch(() => null);
	if (!wasmOptStats?.isFile()) {
		throw new Error(
			`wasm-of-js-of-ocaml Binaryen tool was not found at ${wasmOptPath}.`
		);
	}

	await rm(targetBrowserDistDir, { recursive: true, force: true });
	await rm(targetBundleDir, { recursive: true, force: true });
	await rm(LEGACY_TARGET_BUNDLE_DIR, { recursive: true, force: true });
	await rm(targetBinaryenBinDir, { recursive: true, force: true });
	await mkdir(targetBrowserDistDir, { recursive: true });
	await mkdir(targetBundleDir, { recursive: true });
	await mkdir(targetBinaryenBinDir, { recursive: true });
	await copyDirectory(sourceBrowserDistDir, targetBrowserDistDir);
	await copyDirectory(sourceBundleDir, targetBundleDir);
	await copyDirectory(sourceBinaryenBinDir, targetBinaryenBinDir);
	const targetManifestPath = path.join(targetBundleDir, 'browser-native-manifest.v1.json');
	const targetManifestSource = await readFile(targetManifestPath, 'utf8');
	const publicBundleRoot = '/wasm-of-js-of-ocaml/browser-native-bundle';
	const rewrittenManifestSource = targetManifestSource.replaceAll(
		'/.cache/browser-native-bundle',
		publicBundleRoot
	);
	if (rewrittenManifestSource !== targetManifestSource) {
		await writeFile(targetManifestPath, rewrittenManifestSource, 'utf8');
	}
	const fingerprint = await computeBundleFingerprint([
		sourceBrowserDistDir,
		sourceBundleDir,
		sourceBinaryenBinDir
	]);
	await writeVersionModule(versionModulePath, fingerprint);

	return {
		sourceBrowserDistDir,
		sourceBundleDir,
		sourceBinaryenBinDir,
		targetBrowserDistDir,
		targetBundleDir,
		targetBinaryenBinDir,
		fingerprint,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const result = await syncWasmOfJsOfOcamlDist();
	console.log(
		`Synced wasm-of-js-of-ocaml from ${result.sourceBrowserDistDir} and ${result.sourceBundleDir} to ${result.targetBrowserDistDir} and ${result.targetBundleDir}`
	);
}
