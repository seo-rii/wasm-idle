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
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { format } from 'prettier';
import {
	rewriteSharedEmscriptenLldAssets,
	syncCanonicalEmscriptenLldAssets,
	validateSharedEmscriptenLldAssets
} from './llvm-contracts/emscripten-lld.mjs';
import {
	assertCanonicalRustRuntimeAssetPath,
	validateRustRuntimeProfile
} from './llvm-contracts/rust.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-rust', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-rust');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmRustVersion.ts'
);
const DEFAULT_SHARED_LLD_DIR = path.resolve(REPO_ROOT, 'static', 'shared', 'emscripten-lld');

/**
 * @param {string} sourcePath
 */
function shouldSkipCopy(sourcePath) {
	return (
		sourcePath.endsWith('.d.ts') ||
		sourcePath.endsWith('.tsbuildinfo') ||
		path.basename(sourcePath).startsWith('tmp-public-api-types-')
	);
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

function toImportPath(fromFilePath, targetPath) {
	const relativePath = path
		.relative(path.dirname(fromFilePath), targetPath)
		.replaceAll(path.sep, '/');
	return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function replaceQuotedSpecifier(input, specifier, replacement) {
	return input
		.replaceAll(`'${specifier}'`, `'${replacement}'`)
		.replaceAll(`"${specifier}"`, `"${replacement}"`);
}

/**
 * @param {string} rootDir
 */
async function rewriteBrowserWasiShimImports(rootDir) {
	const replacementTargets = [
		{
			specifier: '@bjorn3/browser_wasi_shim',
			relativeTargetPath: path.join('vendor', 'browser_wasi_shim', 'index.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/fd.js',
			relativeTargetPath: path.join('vendor', 'browser_wasi_shim', 'fd.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/fs_mem.js',
			relativeTargetPath: path.join('vendor', 'browser_wasi_shim', 'fs_mem.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/wasi.js',
			relativeTargetPath: path.join('vendor', 'browser_wasi_shim', 'wasi.js')
		},
		{
			specifier: '@bjorn3/browser_wasi_shim/dist/wasi_defs.js',
			relativeTargetPath: path.join('vendor', 'browser_wasi_shim', 'wasi_defs.js')
		}
	];
	const bundleFiles = await listFiles(rootDir);

	for (const filePath of bundleFiles) {
		if (!filePath.endsWith('.js')) continue;

		const current = await readFile(filePath, 'utf8');
		let next = current;

		for (const rule of replacementTargets) {
			if (!next.includes(rule.specifier)) continue;

			const targetPath = path.join(rootDir, rule.relativeTargetPath);
			const targetStats = await stat(targetPath).catch(() => null);
			if (!targetStats?.isFile()) {
				throw new Error(
					`wasm-rust browser bundle is incomplete. Expected vendored browser_wasi_shim at ${targetPath}.`
				);
			}

			next = replaceQuotedSpecifier(next, rule.specifier, toImportPath(filePath, targetPath));
		}

		if (next !== current) {
			await writeFile(filePath, next, 'utf8');
		}
	}
}

/**
 * @param {string} sourceDir
 */
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
	return hash.digest('hex');
}

const COMPONENT_BINARY_ASSET_PATHS = [
	'wasm-rust/vendor/jco/lib/wasi_snapshot_preview1.command.wasm',
	'wasm-rust/vendor/jco/obj/wasm-tools.core.wasm.gz',
	'wasm-rust/vendor/jco/obj/wasm-tools.core2.wasm',
	'wasm-rust/vendor/jco/obj/js-component-bindgen-component.core.wasm.gz',
	'wasm-rust/vendor/jco/obj/js-component-bindgen-component.core2.wasm'
];

function runtimeReceiptPath(assetPath) {
	const sharedLldPrefix = '../../shared/emscripten-lld/';
	assertCanonicalRustRuntimeAssetPath(assetPath, true);
	const relativePath = assetPath.startsWith(sharedLldPrefix)
		? assetPath.slice(sharedLldPrefix.length)
		: assetPath;
	if (assetPath.startsWith(sharedLldPrefix)) {
		return `shared/emscripten-lld/${relativePath}`;
	}
	return `wasm-rust/runtime/${assetPath}`;
}

function collectPackAssetPaths(pack, assetPaths) {
	if (!pack || typeof pack !== 'object') return;
	if (typeof pack.asset === 'string') assetPaths.add(runtimeReceiptPath(pack.asset));
	if (typeof pack.index === 'string') assetPaths.add(runtimeReceiptPath(pack.index));
	collectPackAssetPaths(pack.delta?.base, assetPaths);
}

function collectRuntimeManifestAssetPaths(manifest) {
	const assetPaths = new Set();
	if (typeof manifest.compiler?.rustcWasm === 'string') {
		assetPaths.add(runtimeReceiptPath(manifest.compiler.rustcWasm));
	}
	let needsComponentAssets = false;
	for (const target of Object.values(manifest.targets || {})) {
		if (!target || typeof target !== 'object') continue;
		collectPackAssetPaths(target.sysrootPack, assetPaths);
		for (const entry of target.sysrootFiles || []) {
			if (typeof entry?.asset === 'string') assetPaths.add(runtimeReceiptPath(entry.asset));
		}
		const compile = target.compile;
		if (
			compile &&
			typeof compile === 'object' &&
			!String(compile.kind).startsWith('integrated-rustc')
		) {
			assetPaths.add(runtimeReceiptPath(compile.llvm?.llcWasm || 'llvm/llc.wasm'));
			assetPaths.add(runtimeReceiptPath(compile.llvm?.lldWasm || 'llvm/lld.wasm'));
			assetPaths.add(runtimeReceiptPath(compile.llvm?.lldData || 'llvm/lld.data'));
			collectPackAssetPaths(compile.link?.pack, assetPaths);
			if (typeof compile.link?.allocatorObjectAsset === 'string') {
				assetPaths.add(runtimeReceiptPath(compile.link.allocatorObjectAsset));
			}
			for (const entry of compile.link?.files || []) {
				if (typeof entry?.asset === 'string')
					assetPaths.add(runtimeReceiptPath(entry.asset));
			}
		}
		needsComponentAssets ||=
			target.artifactFormat === 'component' ||
			target.execution?.kind === 'preview2-component' ||
			String(target.compile?.kind || '').endsWith('+component-encoder');
	}
	if (needsComponentAssets) {
		for (const assetPath of COMPONENT_BINARY_ASSET_PATHS) assetPaths.add(assetPath);
	}
	return [...assetPaths].sort();
}

function receiptForBytes(storageBytes) {
	const storageSha256 = createHash('sha256').update(storageBytes).digest('hex');
	if (storageBytes[0] !== 0x1f || storageBytes[1] !== 0x8b) {
		return { bytes: storageBytes.byteLength, sha256: storageSha256 };
	}
	const logicalBytes = gunzipSync(storageBytes);
	return {
		bytes: storageBytes.byteLength,
		sha256: storageSha256,
		uncompressedBytes: logicalBytes.byteLength,
		uncompressedSha256: createHash('sha256').update(logicalBytes).digest('hex')
	};
}

async function writeRuntimeAssetReceipts(targetDir, sharedLldDir) {
	const runtimeDir = path.join(targetDir, 'runtime');
	const manifestPath = path.join(runtimeDir, 'runtime-manifest.v3.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	delete manifest.assetReceipts;
	const assetReceipts = {};
	for (const assetPath of collectRuntimeManifestAssetPaths(manifest)) {
		const isSharedLldAsset = assetPath.startsWith('shared/emscripten-lld/');
		const assetRootDir = path.resolve(isSharedLldAsset ? sharedLldDir : targetDir);
		const relativePath = isSharedLldAsset
			? assetPath.slice('shared/emscripten-lld/'.length)
			: assetPath.slice('wasm-rust/'.length);
		const filePath = path.resolve(assetRootDir, relativePath);
		const relativeFilePath = path.relative(assetRootDir, filePath);
		if (
			relativeFilePath === '..' ||
			relativeFilePath.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relativeFilePath)
		) {
			throw new Error(`wasm-rust runtime receipt asset escapes its root: ${assetPath}`);
		}
		const storageBytes = await readFile(filePath).catch(() => null);
		if (!storageBytes) {
			throw new Error(`wasm-rust runtime receipt asset was not found: ${assetPath}`);
		}
		assetReceipts[assetPath] = receiptForBytes(storageBytes);
	}
	manifest.assetReceipts = assetReceipts;
	const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
	await writeFile(manifestPath, manifestBytes);
	return {
		assetReceipts,
		manifestReceipt: {
			bytes: manifestBytes.byteLength,
			sha256: createHash('sha256').update(manifestBytes).digest('hex')
		}
	};
}

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 */
async function writeVersionModule(versionModulePath, fingerprint, runtimeProfile) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const unformattedModuleSource = `export const WASM_RUST_RUNTIME_PROFILE = Object.freeze(${JSON.stringify(
		{
			profileId: `wasm-rust-${fingerprint}`,
			protocolVersion: 1,
			manifestPath: 'runtime/runtime-manifest.v3.json',
			manifestFingerprint: fingerprint,
			manifestReceipt: runtimeProfile.manifestReceipt,
			assetReceipts: runtimeProfile.assetReceipts
		},
		null,
		2
	)} as const);\n\nexport const WASM_RUST_ASSET_VERSION = WASM_RUST_RUNTIME_PROFILE.manifestFingerprint;\n`;
	const moduleSource = await format(unformattedModuleSource, {
		parser: 'typescript',
		printWidth: 100,
		singleQuote: true,
		tabWidth: 4,
		trailingComma: 'none',
		useTabs: true
	});
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

export async function refreshWasmRustRuntimeProfile(options = {}) {
	const {
		targetDir = DEFAULT_TARGET_DIR,
		versionModulePath = DEFAULT_VERSION_MODULE_PATH,
		sharedLldDir = DEFAULT_SHARED_LLD_DIR,
		additionalFingerprintFiles = []
	} = options;
	const runtimeProfile = await writeRuntimeAssetReceipts(targetDir, sharedLldDir);
	const fingerprint = await computeBundleFingerprint(targetDir, additionalFingerprintFiles);
	await writeVersionModule(versionModulePath, fingerprint, runtimeProfile);
	return { fingerprint, runtimeProfile, versionModulePath };
}

/**
 * @typedef {object} SyncWasmRustDistOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [versionModulePath]
 * @property {string} [sharedLldDir]
 * @property {string} [canonicalLldDir]
 */

/**
 * @param {SyncWasmRustDistOptions} [options]
 */
export async function syncWasmRustDist(options = {}) {
	const {
		sourceDir = DEFAULT_SOURCE_DIR,
		targetDir = DEFAULT_TARGET_DIR,
		versionModulePath = DEFAULT_VERSION_MODULE_PATH,
		sharedLldDir = DEFAULT_SHARED_LLD_DIR,
		canonicalLldDir = sharedLldDir
	} = options;
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`wasm-rust dist directory was not found at ${sourceDir}. Build wasm-rust first with "pnpm --dir runtimes/wasm-rust build".`
		);
	}

	const entryModulePath = path.join(sourceDir, 'index.js');
	const entryModuleStats = await stat(entryModulePath).catch(() => null);
	if (!entryModuleStats?.isFile()) {
		throw new Error(`wasm-rust dist entry was not found at ${entryModulePath}.`);
	}
	const rustRuntimeProfile = await validateRustRuntimeProfile(sourceDir);
	const hasSharedLldAssets =
		rustRuntimeProfile.hasEmscriptenLld && rustRuntimeProfile.llvmAssetDir
			? await validateSharedEmscriptenLldAssets({
					sourceAssetDir: rustRuntimeProfile.llvmAssetDir,
					sharedAssetDir: canonicalLldDir
				})
			: false;
	if (hasSharedLldAssets) {
		if (path.resolve(canonicalLldDir) !== path.resolve(sharedLldDir)) {
			await syncCanonicalEmscriptenLldAssets({
				canonicalAssetDir: canonicalLldDir,
				targetAssetDir: sharedLldDir
			});
		}
	}

	const targetParentDir = path.dirname(targetDir);
	await mkdir(targetParentDir, { recursive: true });
	const stagingDir = await mkdtemp(path.join(targetParentDir, '.wasm-rust-sync-'));
	const backupDir = `${stagingDir}.backup`;
	let fingerprint;
	let runtimeProfile;
	let targetMovedToBackup = false;
	let stagingMovedToTarget = false;
	const previousVersionModule = await readFile(versionModulePath).catch(() => null);
	try {
		await copyDirectory(sourceDir, stagingDir);
		await rewriteBrowserWasiShimImports(stagingDir);
		if (hasSharedLldAssets) {
			await rewriteSharedEmscriptenLldAssets({
				targetAssetDir: path.join(stagingDir, 'runtime', 'llvm'),
				manifestPath: path.join(stagingDir, 'runtime', 'runtime-manifest.v3.json'),
				localJsAsset: 'llvm/lld.js',
				localWasmAsset: 'llvm/lld.wasm.gz',
				localDataAsset: 'llvm/lld.data.gz'
			});
		}
		runtimeProfile = await writeRuntimeAssetReceipts(stagingDir, sharedLldDir);
		fingerprint = await computeBundleFingerprint(
			stagingDir,
			hasSharedLldAssets
				? [
						path.join(sharedLldDir, 'lld.js'),
						path.join(sharedLldDir, 'lld.wasm.gz'),
						path.join(sharedLldDir, 'lld.data.gz')
					]
				: []
		);

		if ((await stat(targetDir).catch(() => null))?.isDirectory()) {
			await rename(targetDir, backupDir);
			targetMovedToBackup = true;
		}
		try {
			await rename(stagingDir, targetDir);
			stagingMovedToTarget = true;
			await writeVersionModule(versionModulePath, fingerprint, runtimeProfile);
		} catch (error) {
			if (stagingMovedToTarget) {
				await rm(targetDir, { recursive: true, force: true });
			}
			if (targetMovedToBackup) {
				await rename(backupDir, targetDir);
				targetMovedToBackup = false;
			}
			if (previousVersionModule) {
				await writeFile(versionModulePath, previousVersionModule);
			} else {
				await rm(versionModulePath, { force: true });
			}
			throw error;
		}
		if (targetMovedToBackup) {
			await rm(backupDir, { recursive: true, force: true });
			targetMovedToBackup = false;
		}
	} finally {
		if (!stagingMovedToTarget) {
			await rm(stagingDir, { recursive: true, force: true });
		}
	}

	return {
		sourceDir,
		targetDir,
		fingerprint,
		runtimeProfile,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmRustDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-rust from ${sourceDir} to ${targetDir}`);
}
