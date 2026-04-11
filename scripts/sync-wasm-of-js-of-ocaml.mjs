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
const LEGACY_TARGET_BUNDLE_DIR = path.resolve(
	REPO_ROOT,
	'static',
	'.cache',
	'browser-native-bundle'
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

async function validateBrowserNativeWorker(nativeWorkerPath) {
	const source = await readFile(nativeWorkerPath, 'utf8');
	if (!source.includes('request.binaryenTools') || !source.includes('runBinaryenTool')) {
		throw new Error(
			`wasm-of-js-of-ocaml browser-native worker at ${nativeWorkerPath} does not embed the static Binaryen tool runner. Rebuild wasm-of-js-of-ocaml after applying the browser-native Binaryen patch.`
		);
	}
	if (source.includes('/api/binaryen-command')) {
		throw new Error(
			`wasm-of-js-of-ocaml browser-native worker at ${nativeWorkerPath} still references the Binaryen API bridge. Rebuild wasm-of-js-of-ocaml after applying the static Binaryen patch.`
		);
	}
}

export async function syncWasmOfJsOfOcamlDist({
	sourceBrowserDistDir = DEFAULT_SOURCE_BROWSER_DIST_DIR,
	sourceBundleDir = DEFAULT_SOURCE_BUNDLE_DIR,
	targetBrowserDistDir = DEFAULT_TARGET_BROWSER_DIST_DIR,
	targetBundleDir = DEFAULT_TARGET_BUNDLE_DIR,
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
	await validateBrowserNativeWorker(nativeWorkerPath);

	const manifestPath = path.join(sourceBundleDir, 'browser-native-manifest.v1.json');
	const manifestStats = await stat(manifestPath).catch(() => null);
	if (!manifestStats?.isFile()) {
		throw new Error(
			`wasm-of-js-of-ocaml browser-native manifest was not found at ${manifestPath}.`
		);
	}
	const manifestSource = await readFile(manifestPath, 'utf8');
	if (!manifestSource.includes('"binaryenTools"')) {
		throw new Error(
			`wasm-of-js-of-ocaml browser-native manifest at ${manifestPath} does not declare static Binaryen tools.`
		);
	}
	for (const relativeToolPath of [
		'tools/wasm-opt.browser.js',
		'tools/wasm-merge.browser.js',
		'tools/wasm-metadce.browser.js'
	]) {
		const toolPath = path.join(sourceBundleDir, relativeToolPath);
		const toolStats = await stat(toolPath).catch(() => null);
		if (!toolStats?.isFile()) {
			throw new Error(`wasm-of-js-of-ocaml static Binaryen tool was not found at ${toolPath}.`);
		}
	}

	await rm(targetBrowserDistDir, { recursive: true, force: true });
	await rm(targetBundleDir, { recursive: true, force: true });
	await rm(LEGACY_TARGET_BUNDLE_DIR, { recursive: true, force: true });
	await mkdir(targetBrowserDistDir, { recursive: true });
	await mkdir(targetBundleDir, { recursive: true });
	await copyDirectory(sourceBrowserDistDir, targetBrowserDistDir);
	await copyDirectory(sourceBundleDir, targetBundleDir);
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
		sourceBundleDir
	]);
	await writeVersionModule(versionModulePath, fingerprint);

	return {
		sourceBrowserDistDir,
		sourceBundleDir,
		targetBrowserDistDir,
		targetBundleDir,
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
