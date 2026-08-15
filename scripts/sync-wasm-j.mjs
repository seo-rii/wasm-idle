import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, '..', 'j-playground', 'bin', 'html2');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-j');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-j-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmJVersion.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-j-assets.lock.json');
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const VERIFIED_WASM_STORAGE_FILE = 'jamalgam.wasm.gz.bin';
const LOGICAL_ASSET_PATHS = ['jamalgam.js', 'jamalgam.wasm'];
export const J_MANIFEST_FORMAT = 'wasm-j-runtime-manifest-v2';
export const J_FINGERPRINT_DOMAIN = 'wasm-idle:j-runtime-manifest:v2';

/** @typedef {{ bytes: number; sha256: string }} JAssetReceipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} JLogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'identity' | 'gzip'; size: number; sha256: string }} JStorageAsset */

/**
 * @typedef {object} SyncWasmJOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [lockFilePath]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
 */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {string} filePath */
async function isRegularFile(filePath) {
	return !!(await lstat(filePath).catch(() => null))?.isFile();
}

/** @param {string} parent @param {string} candidate */
function containsPath(parent, candidate) {
	const relative = path.relative(parent, candidate);
	return (
		relative === '' ||
		(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
	);
}

/** @param {string} left @param {string} right */
const pathsOverlap = (left, right) => containsPath(left, right) || containsPath(right, left);

/** @param {string} filePath Resolve existing ancestors so symlink spellings cannot bypass publication boundaries. */
async function resolveBoundaryPath(filePath) {
	let cursor = path.resolve(filePath);
	/** @type {string[]} */
	const unresolved = [];
	for (;;) {
		try {
			return path.join(await realpath(cursor), ...unresolved.reverse());
		} catch (error) {
			const code =
				error && typeof error === 'object' && 'code' in error ? error.code : undefined;
			if (code !== 'ENOENT') throw error;
			const parent = path.dirname(cursor);
			if (parent === cursor) return path.resolve(filePath);
			unresolved.push(path.basename(cursor));
			cursor = parent;
		}
	}
}

/** @param {unknown} value @param {string} label */
function validateReceipt(value, label) {
	if (
		!isObject(value) ||
		!Number.isSafeInteger(value.bytes) ||
		/** @type {number} */ (value.bytes) <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`${label} has invalid size or SHA-256 metadata`);
	}
	return Object.freeze({
		bytes: /** @type {number} */ (value.bytes),
		sha256: value.sha256
	});
}

/** @param {string} lockFilePath */
async function readInputLock(lockFilePath) {
	if (!(await isRegularFile(lockFilePath))) {
		throw new Error(`wasm-j input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-j input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!isObject(value) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!/^jsoftware-j-playground-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		!isObject(value.source) ||
		value.source.repository !== 'https://github.com/jsoftware/j-playground' ||
		value.source.path !== 'bin/html2' ||
		typeof value.source.revision !== 'string' ||
		!/^[A-Za-z0-9:;._-]+$/u.test(value.source.revision) ||
		!Array.isArray(value.assets) ||
		value.assets.length !== LOGICAL_ASSET_PATHS.length
	) {
		throw new Error('wasm-j input lock has invalid profile or source metadata');
	}
	const receipts = new Map();
	for (const candidate of value.assets) {
		if (
			!isObject(candidate) ||
			typeof candidate.path !== 'string' ||
			!LOGICAL_ASSET_PATHS.includes(candidate.path) ||
			receipts.has(candidate.path)
		) {
			throw new Error('wasm-j input lock has an invalid or duplicate asset path');
		}
		receipts.set(candidate.path, validateReceipt(candidate, `wasm-j input ${candidate.path}`));
	}
	if (LOGICAL_ASSET_PATHS.some((assetPath) => !receipts.has(assetPath))) {
		throw new Error('wasm-j input lock is missing a required asset');
	}
	return Object.freeze({
		profileId: value.profileId,
		source: Object.freeze({
			repository: value.source.repository,
			path: value.source.path,
			revision: value.source.revision
		}),
		receipts
	});
}

/**
 * @param {{ profileId: string; source: { repository: string; path: string; revision: string }; assets: JLogicalAsset[]; storage: JStorageAsset[] }} manifest
 */
export function computeJRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${J_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${J_MANIFEST_FORMAT}\n`);
	hash.update('runtime\0jsoftware-j-playground\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(
		`source\0${manifest.source.repository}\0${manifest.source.path}\0${manifest.source.revision}\n`
	);
	for (const asset of [...manifest.assets].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		hash.update(`asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`);
	}
	for (const asset of [...manifest.storage].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		hash.update(
			`storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`
		);
	}
	return hash.digest('hex');
}

/** @param {string | undefined} sourceDir @param {string} targetDir */
async function resolveSourceDir(sourceDir, targetDir) {
	if (sourceDir) return path.resolve(sourceDir);
	const configuredSourceDir = process.env.WASM_J_SOURCE_DIR
		? path.resolve(process.env.WASM_J_SOURCE_DIR)
		: DEFAULT_SOURCE_DIR;
	if (
		(await isRegularFile(path.join(configuredSourceDir, 'jamalgam.js'))) &&
		(await isRegularFile(path.join(configuredSourceDir, 'jamalgam.wasm')))
	) {
		return configuredSourceDir;
	}
	if (
		(await isRegularFile(path.join(targetDir, 'jamalgam.js'))) &&
		((await isRegularFile(path.join(targetDir, 'jamalgam.wasm'))) ||
			(await isRegularFile(path.join(targetDir, 'jamalgam.wasm.gz'))))
	) {
		return null;
	}
	throw new Error(
		'J playground runtime assets were not found. Set WASM_J_SOURCE_DIR or pass a source dir containing jamalgam.js and jamalgam.wasm.'
	);
}

/** @param {SyncWasmJOptions} [options] */
export async function syncWasmJAssets(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === path.resolve(DEFAULT_TARGET_DIR)
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const renamePath = options.renamePath || rename;
	const [targetStats, versionStats] = await Promise.all([
		lstat(targetDir).catch(() => null),
		lstat(versionModulePath).catch(() => null)
	]);
	if (targetStats && !targetStats.isDirectory()) {
		throw new Error(`wasm-j runtime target must be a directory: ${targetDir}`);
	}
	if (versionStats && !versionStats.isFile()) {
		throw new Error(`wasm-j version module must be a regular file: ${versionModulePath}`);
	}
	const [targetBoundary, versionBoundary, workerBoundary, lockBoundary] = await Promise.all(
		[targetDir, versionModulePath, workerSourcePath, lockFilePath].map(resolveBoundaryPath)
	);
	if (pathsOverlap(targetBoundary, versionBoundary)) {
		throw new Error('wasm-j runtime target and version module must not overlap');
	}
	for (const [candidateBoundary, label] of [
		[workerBoundary, 'worker source'],
		[lockBoundary, 'input lock']
	]) {
		if (pathsOverlap(targetBoundary, candidateBoundary)) {
			throw new Error(`wasm-j runtime target and ${label} must not overlap`);
		}
		if (pathsOverlap(versionBoundary, candidateBoundary)) {
			throw new Error(`wasm-j version module and ${label} must not overlap`);
		}
	}
	if (!(await isRegularFile(workerSourcePath))) {
		throw new Error(`wasm-j worker source must be a regular file: ${workerSourcePath}`);
	}

	const lock = await readInputLock(lockFilePath);
	const resolvedSourceDir = await resolveSourceDir(options.sourceDir, targetDir);
	const sourceBoundary = resolvedSourceDir
		? await resolveBoundaryPath(resolvedSourceDir)
		: targetBoundary;
	if (resolvedSourceDir && pathsOverlap(targetBoundary, sourceBoundary)) {
		throw new Error('wasm-j source directory and runtime target must not overlap');
	}
	const sourceBase = resolvedSourceDir || targetDir;
	const sourceModulePath = path.join(sourceBase, 'jamalgam.js');
	const sourceWasmPath = path.join(sourceBase, 'jamalgam.wasm');
	const sourceGzipPath = `${sourceWasmPath}.gz`;
	if (!(await isRegularFile(sourceModulePath))) {
		throw new Error(`J runtime module must be a regular file: ${sourceModulePath}`);
	}
	const hasRawWasm = await isRegularFile(sourceWasmPath);
	if (!hasRawWasm && !(await isRegularFile(sourceGzipPath))) {
		throw new Error(`J runtime Wasm must be a regular file: ${sourceWasmPath}`);
	}
	const [moduleBytes, storedWasmBytes, workerBytes] = await Promise.all([
		readFile(sourceModulePath),
		readFile(hasRawWasm ? sourceWasmPath : sourceGzipPath),
		readFile(workerSourcePath)
	]);
	let wasmBytes;
	try {
		wasmBytes = hasRawWasm ? storedWasmBytes : gunzipSync(storedWasmBytes);
	} catch {
		throw new Error('J runtime Wasm gzip source is invalid');
	}
	let moduleSource;
	try {
		moduleSource = new TextDecoder('utf-8', { fatal: true }).decode(moduleBytes);
	} catch {
		throw new Error('jamalgam.js is not valid UTF-8 JavaScript');
	}
	if (!moduleSource.includes('em_jdo') || !moduleSource.includes('WebAssembly.instantiate')) {
		throw new Error('jamalgam.js does not look like the expected J WebAssembly runtime.');
	}
	for (const assetPath of LOGICAL_ASSET_PATHS) {
		const bytes = assetPath === 'jamalgam.js' ? moduleBytes : wasmBytes;
		const receipt = lock.receipts.get(assetPath);
		if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
			throw new Error(`J runtime source ${assetPath} does not match the input lock`);
		}
	}

	const compressedWasmBytes = gzipSync(wasmBytes, { level: 9 });
	/** @type {JLogicalAsset[]} */
	const assets = [
		{
			path: 'jamalgam.js',
			mediaType: 'text/javascript',
			size: moduleBytes.byteLength,
			sha256: sha256(moduleBytes)
		},
		{
			path: 'jamalgam.wasm',
			mediaType: 'application/wasm',
			size: wasmBytes.byteLength,
			sha256: sha256(wasmBytes)
		}
	];
	/** @type {JStorageAsset[]} */
	const storage = [
		{
			path: 'jamalgam.js',
			logicalPath: 'jamalgam.js',
			encoding: 'identity',
			size: moduleBytes.byteLength,
			sha256: sha256(moduleBytes)
		},
		{
			path: VERIFIED_WASM_STORAGE_FILE,
			logicalPath: 'jamalgam.wasm',
			encoding: 'gzip',
			size: compressedWasmBytes.byteLength,
			sha256: sha256(compressedWasmBytes)
		}
	];
	const fingerprint = computeJRuntimeFingerprint({
		profileId: lock.profileId,
		source: lock.source,
		assets,
		storage
	});
	const workerReceipt = Object.freeze({
		bytes: workerBytes.byteLength,
		sha256: sha256(workerBytes)
	});
	const manifest = {
		format: J_MANIFEST_FORMAT,
		runtime: 'jsoftware-j-playground',
		profileId: lock.profileId,
		fingerprint,
		source: lock.source,
		assets,
		storage
	};
	const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`;
	const manifestBytes = Buffer.from(manifestSource, 'utf8');
	const manifestReceipt = Object.freeze({
		bytes: manifestBytes.byteLength,
		sha256: sha256(manifestBytes)
	});
	const moduleReceipt = Object.freeze({
		bytes: assets[0].size,
		sha256: assets[0].sha256
	});
	const wasmReceipt = Object.freeze({
		bytes: storage[1].size,
		sha256: storage[1].sha256,
		uncompressedBytes: assets[1].size,
		uncompressedSha256: assets[1].sha256
	});
	const legacyManifest = {
		format: 'wasm-j-runtime-manifest-v1',
		runtime: 'jsoftware-j-playground',
		fingerprint: fingerprint.slice(0, 16),
		files: ['jamalgam.js', 'jamalgam.wasm.gz']
	};
	const versionModuleSource = `export const WASM_J_RUNTIME_PROFILE = {\n\tprofileId: '${lock.profileId}',\n\tsourceRevision: '${lock.source.revision}',\n\tmanifestFingerprint: '${fingerprint}',\n\tmanifestReceipt: {\n\t\tbytes: ${manifestReceipt.bytes},\n\t\tsha256: '${manifestReceipt.sha256}'\n\t},\n\tmoduleReceipt: {\n\t\tbytes: ${moduleReceipt.bytes},\n\t\tsha256: '${moduleReceipt.sha256}'\n\t},\n\twasmReceipt: {\n\t\tbytes: ${wasmReceipt.bytes},\n\t\tsha256: '${wasmReceipt.sha256}',\n\t\tuncompressedBytes: ${wasmReceipt.uncompressedBytes},\n\t\tuncompressedSha256: '${wasmReceipt.uncompressedSha256}'\n\t}\n} as const;\nexport const WASM_J_ASSET_VERSION = WASM_J_RUNTIME_PROFILE.manifestFingerprint;\nexport const WASM_J_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;

	await mkdir(path.dirname(targetDir), { recursive: true });
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const publicationId = randomUUID();
	const temporaryTarget = path.join(
		path.dirname(targetDir),
		`.${path.basename(targetDir)}.staging-${publicationId}`
	);
	const previousTarget = path.join(
		path.dirname(targetDir),
		`.${path.basename(targetDir)}.previous-${publicationId}`
	);
	const temporaryVersion = path.join(
		path.dirname(versionModulePath),
		`.${path.basename(versionModulePath)}.staging-${publicationId}`
	);
	const previousVersion = path.join(
		path.dirname(versionModulePath),
		`.${path.basename(versionModulePath)}.previous-${publicationId}`
	);
	await rm(temporaryTarget, { recursive: true, force: true });
	await mkdir(temporaryTarget, { recursive: true });
	try {
		await Promise.all([
			writeFile(path.join(temporaryTarget, 'jamalgam.js'), moduleBytes),
			writeFile(path.join(temporaryTarget, 'jamalgam.wasm.gz'), compressedWasmBytes),
			writeFile(path.join(temporaryTarget, VERIFIED_WASM_STORAGE_FILE), compressedWasmBytes),
			writeFile(path.join(temporaryTarget, 'runner-worker.js'), workerBytes),
			writeFile(
				path.join(temporaryTarget, LEGACY_MANIFEST_FILE),
				`${JSON.stringify(legacyManifest, null, 2)}\n`,
				'utf8'
			),
			writeFile(path.join(temporaryTarget, MANIFEST_FILE), manifestSource, 'utf8'),
			writeFile(temporaryVersion, versionModuleSource, 'utf8')
		]);
		const [
			installedModule,
			installedLegacyWasmGzip,
			installedVerifiedWasmGzip,
			installedWorker,
			installedManifest
		] = await Promise.all([
			readFile(path.join(temporaryTarget, 'jamalgam.js')),
			readFile(path.join(temporaryTarget, 'jamalgam.wasm.gz')),
			readFile(path.join(temporaryTarget, VERIFIED_WASM_STORAGE_FILE)),
			readFile(path.join(temporaryTarget, 'runner-worker.js')),
			readFile(path.join(temporaryTarget, MANIFEST_FILE), 'utf8')
		]);
		if (
			sha256(installedModule) !== assets[0].sha256 ||
			!installedLegacyWasmGzip.equals(installedVerifiedWasmGzip) ||
			sha256(installedVerifiedWasmGzip) !== storage[1].sha256 ||
			sha256(gunzipSync(installedVerifiedWasmGzip)) !== assets[1].sha256 ||
			sha256(installedWorker) !== workerReceipt.sha256 ||
			installedManifest !== manifestSource
		) {
			throw new Error('wasm-j temporary installation failed receipt verification');
		}

		const hadTarget = !!(await lstat(targetDir).catch(() => null));
		const hadVersion = !!(await lstat(versionModulePath).catch(() => null));
		let targetPublished = false;
		let versionPublished = false;
		try {
			if (hadTarget) await renamePath(targetDir, previousTarget);
			await renamePath(temporaryTarget, targetDir);
			targetPublished = true;
			if (hadVersion) await renamePath(versionModulePath, previousVersion);
			await renamePath(temporaryVersion, versionModulePath);
			versionPublished = true;
		} catch (error) {
			const rollbackErrors = [];
			if (versionPublished) {
				try {
					await rm(versionModulePath, { force: true });
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (hadVersion && (await lstat(previousVersion).catch(() => null))) {
				try {
					await rename(previousVersion, versionModulePath);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (targetPublished) {
				try {
					await rm(targetDir, { recursive: true, force: true });
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (hadTarget && (await lstat(previousTarget).catch(() => null))) {
				try {
					await rename(previousTarget, targetDir);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (rollbackErrors.length) {
				throw new AggregateError(
					[error, ...rollbackErrors],
					'wasm-j publication failed and rollback was incomplete'
				);
			}
			throw error;
		}
		if (hadTarget) await rm(previousTarget, { recursive: true, force: true });
		if (hadVersion) await rm(previousVersion, { force: true });
	} finally {
		await rm(temporaryTarget, { recursive: true, force: true });
		await rm(temporaryVersion, { force: true });
	}

	return {
		sourceDir: resolvedSourceDir || targetDir,
		targetDir,
		fingerprint,
		versionModulePath,
		workerReceipt
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmJAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-j from ${sourceDir} to ${targetDir}`);
}
