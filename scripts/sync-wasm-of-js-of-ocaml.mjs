import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const staleBinaryenBridgePath = '/' + 'api/binaryen-command';
const DEFAULT_SOURCE_BROWSER_DIST_DIR = path.resolve(
	REPO_ROOT,
	'runtimes',
	'wasm-of-js-of-ocaml',
	'browser-harness',
	'dist'
);
const DEFAULT_SOURCE_BUNDLE_DIR = path.resolve(
	REPO_ROOT,
	'runtimes',
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

/** @param {string} sourcePath */
function shouldSkipCopy(sourcePath) {
	return sourcePath.endsWith('.d.ts') || sourcePath.endsWith('.tsbuildinfo');
}

/** @param {string} sourceDir @param {string} targetDir */
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

/** @param {string} rootDir @returns {Promise<string[]>} */
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
		if (entry.isFile()) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

/** @param {string[]} rootDirs @returns {Promise<string>} */
export async function computeBundleFingerprint(rootDirs) {
	const hash = createHash('sha256');
	hash.update('wasm-idle:wasm-of-js-of-ocaml-bundle:v1\0');
	for (const [rootIndex, rootDir] of rootDirs.entries()) {
		hash.update(`root:${rootIndex}\0`);
		for (const filePath of await listFiles(rootDir)) {
			hash.update(path.relative(rootDir, filePath).split(path.sep).join('/'));
			hash.update('\0');
			hash.update(await readFile(filePath));
			hash.update('\n');
		}
		hash.update('\n---\n');
	}
	return hash.digest('hex');
}

/** @typedef {{readonly bytes: number; readonly sha256: string}} AssetReceipt */

/** @param {string} filePath @returns {Promise<AssetReceipt>} */
async function computeAssetReceipt(filePath) {
	const bytes = await readFile(filePath);
	return Object.freeze({
		bytes: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex')
	});
}

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 * @param {AssetReceipt} moduleReceipt
 * @param {AssetReceipt} manifestReceipt
 */
async function writeVersionModule(versionModulePath, fingerprint, moduleReceipt, manifestReceipt) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_OCAML_ASSET_VERSION =
	'${fingerprint}';

export const WASM_OCAML_RUNTIME_PROFILE = Object.freeze({
	fingerprint: WASM_OCAML_ASSET_VERSION,
	moduleReceipt: Object.freeze({
		bytes: ${moduleReceipt.bytes},
		sha256: '${moduleReceipt.sha256}'
	}),
	manifestReceipt: Object.freeze({
		bytes: ${manifestReceipt.bytes},
		sha256: '${manifestReceipt.sha256}'
	})
});
`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

/** @param {string} nativeWorkerPath */
async function validateBrowserNativeWorker(nativeWorkerPath) {
	const source = await readFile(nativeWorkerPath, 'utf8');
	if (!source.includes('request.binaryenTools') || !source.includes('runBinaryenTool')) {
		throw new Error(
			`wasm-of-js-of-ocaml browser-native worker at ${nativeWorkerPath} does not embed the static Binaryen tool runner. Rebuild wasm-of-js-of-ocaml after applying the browser-native Binaryen patch.`
		);
	}
	if (source.includes(staleBinaryenBridgePath)) {
		throw new Error(
			`wasm-of-js-of-ocaml browser-native worker at ${nativeWorkerPath} still references the Binaryen API bridge. Rebuild wasm-of-js-of-ocaml after applying the static Binaryen patch.`
		);
	}
}

/**
 * @typedef {object} SyncWasmOfJsOfOcamlOptions
 * @property {string} [sourceBrowserDistDir]
 * @property {string} [sourceBundleDir]
 * @property {string} [targetBrowserDistDir]
 * @property {string} [targetBundleDir]
 * @property {string} [versionModulePath]
 */

/** @param {SyncWasmOfJsOfOcamlOptions} [options] */
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
			`wasm-of-js-of-ocaml browser dist directory was not found at ${sourceBrowserDistDir}. Build wasm-of-js-of-ocaml first with "pnpm --dir runtimes/wasm-of-js-of-ocaml build && pnpm --dir runtimes/wasm-of-js-of-ocaml prepare:browser-native -- --force".`
		);
	}
	const bundleStats = await stat(sourceBundleDir).catch(() => null);
	if (!bundleStats?.isDirectory()) {
		throw new Error(
			`wasm-of-js-of-ocaml browser-native bundle directory was not found at ${sourceBundleDir}. Run "pnpm --dir runtimes/wasm-of-js-of-ocaml prepare:browser-native -- --force" first.`
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
			throw new Error(
				`wasm-of-js-of-ocaml static Binaryen tool was not found at ${toolPath}.`
			);
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
	const fingerprint = await computeBundleFingerprint([targetBrowserDistDir, targetBundleDir]);
	const moduleReceipt = await computeAssetReceipt(
		path.join(targetBrowserDistDir, 'src', 'index.js')
	);
	const manifestReceipt = await computeAssetReceipt(targetManifestPath);
	await writeVersionModule(versionModulePath, fingerprint, moduleReceipt, manifestReceipt);

	return {
		sourceBrowserDistDir,
		sourceBundleDir,
		targetBrowserDistDir,
		targetBundleDir,
		fingerprint,
		moduleReceipt,
		manifestReceipt,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const result = await syncWasmOfJsOfOcamlDist();
	console.log(
		`Synced wasm-of-js-of-ocaml from ${result.sourceBrowserDistDir} and ${result.sourceBundleDir} to ${result.targetBrowserDistDir} and ${result.targetBundleDir}`
	);
}
