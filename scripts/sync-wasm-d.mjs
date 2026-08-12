import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	EMSCRIPTEN_LLD_PROFILE,
	rewriteSharedEmscriptenLldAssets,
	syncCanonicalEmscriptenLldAssets,
	validateSharedEmscriptenLldAssets
} from './llvm-contracts/emscripten-lld.mjs';

/** @typedef {{ bytes: number; sha256: string; uncompressedBytes: number; uncompressedSha256: string }} DAssetReceipt */

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
const DEFAULT_INTEGRITY_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmDIntegrity.ts'
);
const DEFAULT_LSP_INTEGRITY_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'lsp',
	'src',
	'bundledDRuntimeIntegrity.ts'
);
const DEFAULT_SHARED_LLD_DIR = path.resolve(REPO_ROOT, 'static', 'shared', 'emscripten-lld');

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
		if (entry.isFile()) files.push(entryPath);
	}
	return files.sort();
}

/** @param {string} sourceDir @param {string[]} additionalFiles */
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

/** @param {string} versionModulePath @param {string} fingerprint */
async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_D_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

/** @param {Buffer | Uint8Array} bytes */
function sha256Bytes(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * @param {string} filePath
 * @param {'gzip' | undefined} compression
 * @returns {Promise<Readonly<DAssetReceipt>>}
 */
async function pairedReceipt(filePath, compression) {
	const delivery = await readFile(filePath);
	if (delivery.byteLength <= 0) {
		throw new Error(`wasm-d runtime asset must be non-empty: ${filePath}`);
	}
	const runtime = compression === 'gzip' ? gunzipSync(delivery) : delivery;
	if (runtime.byteLength <= 0) {
		throw new Error(`wasm-d logical runtime asset must be non-empty: ${filePath}`);
	}
	return Object.freeze({
		bytes: delivery.byteLength,
		sha256: sha256Bytes(delivery),
		uncompressedBytes: runtime.byteLength,
		uncompressedSha256: sha256Bytes(runtime)
	});
}

/** @param {unknown} value @param {string} label */
function requireObject(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`wasm-d ${label} is missing from the runtime manifest`);
	}
	return /** @type {Record<string, any>} */ (value);
}

/**
 * @param {string} targetDir
 * @param {string} sharedLldDir
 * @param {string} manifestPath
 * @param {string} runtimeBuildPath
 */
async function finalizeInstalledRuntimeReceipts(
	targetDir,
	sharedLldDir,
	manifestPath,
	runtimeBuildPath
) {
	const manifest = requireObject(
		JSON.parse(await readFile(manifestPath, 'utf8')),
		'runtime manifest'
	);
	const compiler = requireObject(manifest.compiler, 'compiler');
	const linker = requireObject(compiler.linker, 'compiler.linker');
	/** @type {Array<[string, Record<string, any>]>} */
	const assetEntries = [
		['compiler.ldc2', requireObject(compiler.ldc2, 'compiler.ldc2')],
		['compiler.toolchain', requireObject(compiler.toolchain, 'compiler.toolchain')],
		['compiler.linker.js', requireObject(linker.js, 'compiler.linker.js')],
		['compiler.linker.wasm', requireObject(linker.wasm, 'compiler.linker.wasm')],
		['compiler.linker.data', requireObject(linker.data, 'compiler.linker.data')]
	];
	const runtimeDir = path.dirname(manifestPath);
	const installedReceipts = [];
	for (const [label, entry] of assetEntries) {
		if (typeof entry.asset !== 'string' || entry.asset.length === 0) {
			throw new Error(`wasm-d ${label}.asset is invalid`);
		}
		if (entry.compression !== undefined && entry.compression !== 'gzip') {
			throw new Error(`wasm-d ${label}.compression is invalid`);
		}
		const assetPath = path.resolve(runtimeDir, entry.asset);
		const allowedRoots = [path.resolve(targetDir), path.resolve(sharedLldDir)];
		if (
			!allowedRoots.some(
				(root) => assetPath === root || assetPath.startsWith(`${root}${path.sep}`)
			)
		) {
			throw new Error(`wasm-d ${label}.asset escapes the installed runtime roots`);
		}
		const integrity = await pairedReceipt(assetPath, entry.compression);
		entry.integrity = integrity;
		installedReceipts.push({
			asset: entry.asset,
			size: integrity.bytes,
			sha256: integrity.sha256,
			uncompressedSize: integrity.uncompressedBytes,
			uncompressedSha256: integrity.uncompressedSha256
		});
	}
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

	const runtimeBuild = requireObject(
		JSON.parse(await readFile(runtimeBuildPath, 'utf8')),
		'runtime build receipt'
	);
	runtimeBuild.assets = installedReceipts;
	runtimeBuild.manifestSha256 = sha256Bytes(await readFile(manifestPath));
	runtimeBuild.sharedLlvmProfiles = [
		{
			id: EMSCRIPTEN_LLD_PROFILE.id,
			profileVersion: EMSCRIPTEN_LLD_PROFILE.version,
			llvmVersion: EMSCRIPTEN_LLD_PROFILE.llvmVersion,
			llvmCommit: EMSCRIPTEN_LLD_PROFILE.llvmCommit,
			assets: EMSCRIPTEN_LLD_PROFILE.assets
		}
	];
	await writeFile(runtimeBuildPath, `${JSON.stringify(runtimeBuild, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} targetDir
 * @param {string} integrityModulePath
 * @param {{ version: string, receipts: string }} exports
 */
async function writeIntegrityModule(targetDir, integrityModulePath, exports) {
	const receiptEntries = await Promise.all(
		[
			['index.js', path.join(targetDir, 'index.js')],
			[
				'runtime/runtime-manifest.v1.json',
				path.join(targetDir, 'runtime', 'runtime-manifest.v1.json')
			]
		].map(
			async ([asset, filePath]) =>
				/** @type {[string, Readonly<DAssetReceipt>]} */ ([
					asset,
					await pairedReceipt(filePath, undefined)
				])
		)
	);
	const receipts = Object.fromEntries(receiptEntries);
	const fingerprint = sha256Bytes(
		Buffer.from(
			receiptEntries
				.map(([asset, receipt]) => `${asset}\0${receipt.bytes}\0${receipt.sha256}\n`)
				.join(''),
			'utf8'
		)
	).slice(0, 16);
	const receiptSource = receiptEntries
		.map(
			([asset, receipt]) => `\t'${asset}': Object.freeze({
\t\tbytes: ${receipt.bytes},
\t\tsha256: '${receipt.sha256}',
\t\tuncompressedBytes: ${receipt.uncompressedBytes},
\t\tuncompressedSha256: '${receipt.uncompressedSha256}'
\t})`
		)
		.join(',\n');
	const source = `export const ${exports.version} = '${fingerprint}';

export const ${exports.receipts} = Object.freeze({
${receiptSource}
});
`;
	await mkdir(path.dirname(integrityModulePath), { recursive: true });
	await writeFile(integrityModulePath, source, 'utf8');
	return { fingerprint, receipts };
}

/**
 * @typedef {object} SyncWasmDDistOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [versionModulePath]
 * @property {string} [integrityModulePath]
 * @property {string} [lspIntegrityModulePath]
 * @property {string} [sharedLldDir]
 * @property {string} [canonicalLldDir]
 */

/** @param {SyncWasmDDistOptions} [options] */
export async function syncWasmDDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	integrityModulePath = DEFAULT_INTEGRITY_MODULE_PATH,
	lspIntegrityModulePath = DEFAULT_LSP_INTEGRITY_MODULE_PATH,
	sharedLldDir = DEFAULT_SHARED_LLD_DIR,
	canonicalLldDir = sharedLldDir
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
		sharedAssetDir: canonicalLldDir
	});
	if (path.resolve(canonicalLldDir) !== path.resolve(sharedLldDir)) {
		await syncCanonicalEmscriptenLldAssets({
			canonicalAssetDir: canonicalLldDir,
			targetAssetDir: sharedLldDir
		});
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	await copyDirectory(sourceDir, targetDir);
	await rewriteSharedEmscriptenLldAssets({
		targetAssetDir: path.join(targetDir, 'runtime', 'bin'),
		manifestPath: path.join(targetDir, 'runtime', 'runtime-manifest.v1.json'),
		localJsAsset: 'bin/lld.js',
		localWasmAsset: 'bin/lld.wasm.gz',
		localDataAsset: 'bin/lld.data.gz'
	});
	const manifestPath = path.join(targetDir, 'runtime', 'runtime-manifest.v1.json');
	const runtimeBuildPath = path.join(targetDir, 'runtime', 'runtime-build.json');
	await finalizeInstalledRuntimeReceipts(targetDir, sharedLldDir, manifestPath, runtimeBuildPath);
	const integrity = await writeIntegrityModule(targetDir, integrityModulePath, {
		version: 'WASM_D_INTEGRITY_VERSION',
		receipts: 'WASM_D_OUTER_ASSET_RECEIPTS'
	});
	await writeIntegrityModule(targetDir, lspIntegrityModulePath, {
		version: 'BUNDLED_D_INTEGRITY_VERSION',
		receipts: 'BUNDLED_D_OUTER_ASSET_RECEIPTS'
	});
	const fingerprint = await computeBundleFingerprint(targetDir, [
		path.join(sharedLldDir, 'lld.js'),
		path.join(sharedLldDir, 'lld.wasm.gz'),
		path.join(sharedLldDir, 'lld.data.gz')
	]);
	await writeVersionModule(versionModulePath, fingerprint);
	return {
		sourceDir,
		targetDir,
		fingerprint,
		versionModulePath,
		integrityModulePath,
		lspIntegrityModulePath,
		integrity
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmDDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-d from ${sourceDir} to ${targetDir}`);
}
