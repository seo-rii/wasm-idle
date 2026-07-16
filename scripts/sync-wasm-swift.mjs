import { createHash } from 'node:crypto';
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	REQUIRED_RUNTIME_FILES,
	buildFileEntries,
	createSwiftRuntimeManifest,
	fingerprintFileEntries,
	validateSwiftRunnerWorkerSource,
	validateSwiftRuntimeFileSignatures,
	validateSwiftRuntimeManifest,
	validateSwiftRuntimeManifestFiles
} from './llvm-contracts/swift/runtime-manifest.mjs';
import {
	BUILD_PLAN_SNAPSHOT_FILE,
	BROWSER_BUILD_LOG_SNAPSHOT_FILE,
	SOURCE_BOOTSTRAP_RECEIPT_SNAPSHOT_FILE,
	validateSwiftRuntimeBuildInfo,
	validateSwiftRuntimeSdkChecksum
} from './llvm-contracts/swift/runtime-build-info.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-swift');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmSwiftVersion.ts'
);
const COMPRESSED_RUNTIME_ASSET_MANIFEST = 'compressed-runtime-assets.v1.json';
export const SWIFT_SYNC_RECEIPT_FILE = 'sync-receipt.v1.json';
export const SWIFT_SYNC_RECEIPT_FORMAT = 'wasm-swift-sync-receipt-v1';
const OPTIONAL_SOURCE_FILES = [
	'LICENSE',
	'README.md',
	'SOURCE.txt',
	BUILD_PLAN_SNAPSHOT_FILE,
	BROWSER_BUILD_LOG_SNAPSHOT_FILE,
	SOURCE_BOOTSTRAP_RECEIPT_SNAPSHOT_FILE
];
const BASELINE_RECEIPT_SNAPSHOT_PATTERN = /^upstream-baseline-[A-Za-z0-9._+-]+\.snapshot\.json$/u;

/**
 * @param {string | undefined} sourceDir
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment
 */
function resolveConfiguredSourceDir(sourceDir, environment = process.env) {
	const configuredSourceDir = sourceDir || environment.WASM_SWIFT_RUNTIME_SOURCE_DIR;
	if (!configuredSourceDir) {
		throw new Error(
			'Swift runtime sourceDir is required. Pass it explicitly or set WASM_SWIFT_RUNTIME_SOURCE_DIR to an externally produced runtime bundle.'
		);
	}
	return path.resolve(configuredSourceDir);
}

/** @param {string} filePath */
async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

/**
 * @param {string} sourceDir
 * @param {string} relativePath
 */
async function resolveSourceRuntimeFile(sourceDir, relativePath) {
	const filePath = path.join(sourceDir, relativePath);
	if (await fileExists(filePath)) return { sourcePath: filePath, targetPath: relativePath };
	if (relativePath.endsWith('.wasm')) {
		const compressedPath = `${filePath}.gz`;
		if (await fileExists(compressedPath)) {
			return { sourcePath: compressedPath, targetPath: `${relativePath}.gz` };
		}
	}
	return null;
}

/** @param {string} buildInfoPath */
async function readBuildInfo(buildInfoPath) {
	const source = await readFile(buildInfoPath, 'utf8').catch(() => '');
	if (!source) {
		throw new Error(
			`Swift runtime build metadata was not found at ${buildInfoPath}. Expected runtime-build.json with swiftVersion and wasmSdkId.`
		);
	}
	const parsed = JSON.parse(source);
	const errors = validateSwiftRuntimeBuildInfo(parsed);
	if (errors.length > 0) {
		throw new Error(`${buildInfoPath} is invalid:\n${errors.join('\n')}`);
	}
	return parsed;
}

/** @param {any} buildInfo */
function assertBuildInfoProvenance(buildInfo) {
	if (typeof buildInfo.source !== 'string' || buildInfo.source.trim().length === 0) {
		throw new Error(
			'Swift runtime build metadata must include source provenance before syncing app assets.'
		);
	}
}

export { validateSwiftRuntimeBuildInfo };

/** @param {string} sourceDir */
async function assertRequiredFiles(sourceDir) {
	for (const relativePath of REQUIRED_RUNTIME_FILES) {
		if (!(await resolveSourceRuntimeFile(sourceDir, relativePath))) {
			const suffix = relativePath.endsWith('.wasm') ? ` or ${relativePath}.gz` : '';
			throw new Error(
				`Swift runtime asset ${relativePath}${suffix} was not found in ${sourceDir}.`
			);
		}
	}
}

/** @param {string} sourceDir */
async function assertRunnerWorkerContract(sourceDir) {
	const runnerWorkerPath = path.join(sourceDir, 'runner-worker.js');
	const errors = validateSwiftRunnerWorkerSource(await readFile(runnerWorkerPath, 'utf8'));
	if (errors.length > 0) {
		throw new Error(
			`Swift runner-worker.js does not match the playground contract:\n${errors.join('\n')}`
		);
	}
}

/** @param {string} sourceDir */
async function assertRuntimeFileSignatures(sourceDir) {
	const errors = await validateSwiftRuntimeFileSignatures(sourceDir);
	if (errors.length > 0) {
		throw new Error(`Swift runtime assets have invalid file signatures:\n${errors.join('\n')}`);
	}
}

/**
 * @param {string} sourceDir
 * @param {any} buildInfo
 */
async function assertSourceManifest(sourceDir, buildInfo) {
	const manifestPath = path.join(sourceDir, 'runtime-manifest.v1.json');
	if (!(await fileExists(manifestPath))) {
		throw new Error(
			`Swift source runtime manifest was not found at ${manifestPath}. Run package:wasm-swift before syncing.`
		);
	}
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const errors = await validateSwiftRuntimeManifestFiles(sourceDir, manifest);
	if (manifest.swiftVersion !== buildInfo.swiftVersion) {
		errors.push(
			`source manifest swiftVersion ${manifest.swiftVersion} does not match runtime-build.json ${buildInfo.swiftVersion}`
		);
	}
	if (manifest.wasmSdkId !== buildInfo.wasmSdkId) {
		errors.push(
			`source manifest wasmSdkId ${manifest.wasmSdkId} does not match runtime-build.json ${buildInfo.wasmSdkId}`
		);
	}
	if (manifest.runtimeContract?.format !== buildInfo.runtimeContract?.format) {
		errors.push(
			`source manifest runtimeContract.format ${manifest.runtimeContract?.format} does not match runtime-build.json ${buildInfo.runtimeContract?.format}`
		);
	}
	if (manifest.runtimeContract?.version !== buildInfo.runtimeContract?.version) {
		errors.push(
			`source manifest runtimeContract.version ${manifest.runtimeContract?.version} does not match runtime-build.json ${buildInfo.runtimeContract?.version}`
		);
	}
	if (errors.length > 0) {
		throw new Error(`Swift source runtime manifest is invalid:\n${errors.join('\n')}`);
	}
}

/**
 * @param {string} sourceDir
 * @param {any} buildInfo
 */
async function assertSdkChecksum(sourceDir, buildInfo) {
	const errors = await validateSwiftRuntimeSdkChecksum(buildInfo, {
		bundleDir: sourceDir,
		messagePrefix: 'Swift runtime build metadata '
	});
	if (errors.length > 0) {
		throw new Error(errors.join('\n'));
	}
}

/**
 * @param {string} sourceDir
 * @param {string} targetDir
 */
async function copyRuntimeFiles(sourceDir, targetDir) {
	await mkdir(targetDir, { recursive: true });
	for (const relativePath of REQUIRED_RUNTIME_FILES) {
		const resolved = await resolveSourceRuntimeFile(sourceDir, relativePath);
		if (!resolved) throw new Error(`Swift runtime asset ${relativePath} was not found.`);
		await mkdir(path.dirname(path.join(targetDir, resolved.targetPath)), { recursive: true });
		await cp(resolved.sourcePath, path.join(targetDir, resolved.targetPath));
	}
	for (const relativePath of OPTIONAL_SOURCE_FILES) {
		if (await fileExists(path.join(sourceDir, relativePath))) {
			await cp(path.join(sourceDir, relativePath), path.join(targetDir, relativePath));
		}
	}
	for (const entry of await readdir(sourceDir, { withFileTypes: true }).catch(() => [])) {
		if (entry.isFile() && BASELINE_RECEIPT_SNAPSHOT_PATTERN.test(entry.name)) {
			await cp(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
		}
	}
}

/**
 * @param {string} sourceDir
 * @param {string} targetDir
 */
function assertSafeTargetPath(sourceDir, targetDir) {
	const normalizedSourceDir = path.resolve(sourceDir);
	const normalizedTargetDir = path.resolve(targetDir);
	if (normalizedSourceDir === normalizedTargetDir) {
		throw new Error('targetDir must be different from sourceDir');
	}
	if (normalizedSourceDir.startsWith(`${normalizedTargetDir}${path.sep}`)) {
		throw new Error('targetDir must not be a parent directory of sourceDir');
	}
}

/** @param {string} targetDir */
async function createSyncTempDir(targetDir) {
	const parentDir = path.dirname(path.resolve(targetDir));
	await mkdir(parentDir, { recursive: true });
	return mkdtemp(path.join(parentDir, '.wasm-swift-sync-'));
}

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 */
async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_SWIFT_ASSET_VERSION = '${fingerprint}';\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current !== moduleSource) await writeFile(versionModulePath, moduleSource, 'utf8');
}

/**
 * @param {string} filePath
 * @param {any} fallback
 * @returns {Promise<any>}
 */
async function readJsonFile(filePath, fallback) {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch {
		return fallback;
	}
}

/** @param {import('node:crypto').BinaryLike} bytes */
function sha256Hex(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {{
 *   sourceDir: string;
 *   targetDir: string;
 *   writeDir?: string;
 *   buildInfoSource: string;
 *   buildInfo: any;
 *   manifest: any;
 *   versionModulePath: string;
 * }} options
 */
async function writeSyncReceipt({
	sourceDir,
	targetDir,
	writeDir = targetDir,
	buildInfoSource,
	buildInfo,
	manifest,
	versionModulePath
}) {
	const receipt = {
		format: SWIFT_SYNC_RECEIPT_FORMAT,
		sourceDir: path.resolve(sourceDir),
		targetDir: path.resolve(targetDir),
		versionModulePath: path.resolve(versionModulePath),
		fingerprint: manifest.fingerprint,
		swiftVersion: buildInfo.swiftVersion,
		wasmSdkId: buildInfo.wasmSdkId,
		runtimeContract: buildInfo.runtimeContract,
		runtimeBuildSha256: sha256Hex(Buffer.from(buildInfoSource, 'utf8'))
	};
	await writeFile(
		path.join(writeDir, SWIFT_SYNC_RECEIPT_FILE),
		`${JSON.stringify(receipt, null, 2)}\n`,
		'utf8'
	);
	return receipt;
}

/**
 * @param {string} targetDir
 * @param {any} manifest
 */
async function syncCompressedManifestForGzipOnlyAssets(targetDir, manifest) {
	const rootDir = path.dirname(targetDir);
	const bundleName = path.basename(targetDir);
	const swiftAssetPrefix = `${bundleName}/`;
	const gzipOnlyAssets = [];
	for (const wasmFile of ['swiftc.wasm', 'swiftpm.wasm']) {
		const compressedPath = path.join(targetDir, `${wasmFile}.gz`);
		const uncompressedPath = path.join(targetDir, wasmFile);
		if ((await fileExists(compressedPath)) && !(await fileExists(uncompressedPath))) {
			gzipOnlyAssets.push(`${swiftAssetPrefix}${wasmFile}`);
		}
	}
	const manifestPath = path.join(rootDir, COMPRESSED_RUNTIME_ASSET_MANIFEST);
	const existingManifest = await readJsonFile(manifestPath, {});
	const existingAssets = /** @type {string[]} */ (
		Array.isArray(existingManifest.assets) ? existingManifest.assets : []
	);
	if (
		gzipOnlyAssets.length === 0 &&
		!existingAssets.some((asset) => asset.startsWith(swiftAssetPrefix))
	) {
		return [];
	}
	const existingSizes =
		existingManifest.sizes && typeof existingManifest.sizes === 'object'
			? existingManifest.sizes
			: {};
	/** @type {Record<string, number>} */
	const sizes = {};
	const assets = [
		...new Set([
			...existingAssets.filter((asset) => !asset.startsWith(swiftAssetPrefix)),
			...gzipOnlyAssets
		])
	].sort();
	for (const asset of assets) {
		const runtimePath = asset.slice(swiftAssetPrefix.length);
		const manifestFiles = /** @type {Array<{ path: string; bytes: number }>} */ (
			manifest.files
		);
		const runtimeEntry = asset.startsWith(swiftAssetPrefix)
			? manifestFiles.find((entry) => entry.path === runtimePath)
			: null;
		const size = runtimeEntry?.bytes ?? existingSizes[asset];
		if (Number.isFinite(size)) sizes[asset] = size;
	}
	await writeFile(manifestPath, `${JSON.stringify({ assets, sizes }, null, 2)}\n`, 'utf8');
	return gzipOnlyAssets;
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment
 */
export function parseSyncWasmSwiftArgs(argv, environment = process.env) {
	const positional = [];
	for (const arg of argv) {
		if (arg === '--help') return { help: true };
		if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
		positional.push(arg);
	}
	if (positional.length > 2) {
		throw new Error('sync:wasm-swift accepts at most sourceDir and targetDir arguments');
	}
	const [sourceDir, targetDir] = positional;
	return {
		sourceDir: resolveConfiguredSourceDir(sourceDir, environment),
		targetDir: targetDir ? path.resolve(targetDir) : DEFAULT_TARGET_DIR
	};
}

function usage() {
	return [
		'Usage: pnpm run sync:wasm-swift [sourceDir] [targetDir]',
		'',
		'Synchronizes an externally produced wasm-swift dist into static/wasm-swift.',
		'Pass sourceDir explicitly or set WASM_SWIFT_RUNTIME_SOURCE_DIR; runtime assets must come from an external producer bundle.',
		'The source directory must be produced by package:wasm-swift and include runtime-build.json source provenance.',
		'runtime-build.json must also record the Swift browser runtimeContract format and version produced by package:wasm-swift.',
		'Compiler inputs may be stored as swiftc.wasm.gz and swiftpm.wasm.gz; sync preserves them as compressed files while validating the manifest against decompressed .wasm bytes.'
	].join('\n');
}

/**
 * @param {{
 *   sourceDir?: string;
 *   targetDir?: string;
 *   buildInfoPath?: string;
 *   versionModulePath?: string;
 * }} options
 */
export async function syncWasmSwiftAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	buildInfoPath,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const normalizedSourceDir = resolveConfiguredSourceDir(sourceDir);
	const normalizedTargetDir = path.resolve(targetDir);
	const normalizedBuildInfoPath = buildInfoPath
		? path.resolve(buildInfoPath)
		: path.join(normalizedSourceDir, 'runtime-build.json');
	const sourceStats = await stat(normalizedSourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`wasm-swift bundle directory was not found at ${normalizedSourceDir}. Build or provide a real browser-hosted Swift compiler bundle first.`
		);
	}
	assertSafeTargetPath(normalizedSourceDir, normalizedTargetDir);
	await assertRequiredFiles(normalizedSourceDir);
	await assertRunnerWorkerContract(normalizedSourceDir);
	await assertRuntimeFileSignatures(normalizedSourceDir);
	const buildInfo = await readBuildInfo(normalizedBuildInfoPath);
	assertBuildInfoProvenance(buildInfo);
	await assertSourceManifest(normalizedSourceDir, buildInfo);
	await assertSdkChecksum(normalizedSourceDir, buildInfo);
	let tempTargetDir = await createSyncTempDir(normalizedTargetDir);
	/** @type {string} */
	let fingerprint;
	/** @type {any} */
	let manifest;
	/** @type {any} */
	let receipt;
	try {
		await copyRuntimeFiles(normalizedSourceDir, tempTargetDir);
		const files = await buildFileEntries(tempTargetDir);
		fingerprint = fingerprintFileEntries(files);
		manifest = createSwiftRuntimeManifest({
			files,
			swiftVersion: buildInfo.swiftVersion,
			wasmSdkId: buildInfo.wasmSdkId,
			fingerprint
		});
		const errors = validateSwiftRuntimeManifest(manifest);
		if (errors.length > 0) {
			throw new Error(`Generated Swift runtime manifest is invalid:\n${errors.join('\n')}`);
		}
		await writeFile(
			path.join(tempTargetDir, 'runtime-manifest.v1.json'),
			`${JSON.stringify(manifest, null, 2)}\n`,
			'utf8'
		);
		const buildInfoSource = `${JSON.stringify(buildInfo, null, 2)}\n`;
		await writeFile(path.join(tempTargetDir, 'runtime-build.json'), buildInfoSource, 'utf8');
		receipt = await writeSyncReceipt({
			sourceDir: normalizedSourceDir,
			targetDir: normalizedTargetDir,
			writeDir: tempTargetDir,
			buildInfoSource,
			buildInfo,
			manifest,
			versionModulePath
		});
		await rm(normalizedTargetDir, { recursive: true, force: true });
		await rename(tempTargetDir, normalizedTargetDir);
		tempTargetDir = '';
	} finally {
		if (tempTargetDir) await rm(tempTargetDir, { recursive: true, force: true });
	}
	await writeVersionModule(versionModulePath, fingerprint);
	const compressedManifestAssets = await syncCompressedManifestForGzipOnlyAssets(
		normalizedTargetDir,
		manifest
	);
	return {
		sourceDir: normalizedSourceDir,
		targetDir: normalizedTargetDir,
		fingerprint,
		manifest,
		receipt,
		compressedManifestAssets,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	try {
		const options = parseSyncWasmSwiftArgs(process.argv.slice(2));
		if (options.help) {
			console.log(usage());
		} else {
			const { sourceDir, targetDir } = await syncWasmSwiftAssets(options);
			console.log(`Synced wasm-swift from ${sourceDir} to ${targetDir}`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
