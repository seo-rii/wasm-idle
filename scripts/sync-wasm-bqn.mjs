import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, '..', 'cbqn-wasm', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-bqn');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-bqn-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmBqnVersion.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-bqn-assets.lock.json');
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const LICENSE_FILE = 'LICENSE-GPLv3.txt';
const LOGICAL_ASSET_PATHS = ['BQN.js', 'BQN.wasm'];
const BUILD_OPTIONS = ['ENVIRONMENT=worker', 'MODULARIZE=1', 'EXPORT_ES6=1', 'FORCE_FILESYSTEM=1'];
export const BQN_MANIFEST_FORMAT = 'wasm-bqn-runtime-manifest-v2';
export const BQN_FINGERPRINT_DOMAIN = 'wasm-idle:bqn-runtime-manifest:v2';

/** @typedef {{ bytes: number; sha256: string }} BqnAssetReceipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} BqnLogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'identity' | 'gzip'; size: number; sha256: string }} BqnStorageAsset */

/**
 * @typedef {object} SyncWasmBqnOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [licenseFile]
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
		throw new Error(`wasm-bqn input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-bqn input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!isObject(value) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!/^dzaima-cbqn-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		!isObject(value.source) ||
		value.source.repository !== 'https://github.com/dzaima/CBQN' ||
		value.source.path !== 'dist' ||
		typeof value.source.revision !== 'string' ||
		!/^[A-Za-z0-9:;._-]+$/u.test(value.source.revision) ||
		!isObject(value.build) ||
		value.build.emscripten !== '3.1.8' ||
		!Array.isArray(value.build.options) ||
		JSON.stringify(value.build.options) !== JSON.stringify(BUILD_OPTIONS) ||
		!isObject(value.license) ||
		value.license.path !== LICENSE_FILE ||
		value.license.spdx !== 'GPL-3.0-or-later' ||
		!Array.isArray(value.assets) ||
		value.assets.length !== LOGICAL_ASSET_PATHS.length
	) {
		throw new Error(
			'wasm-bqn input lock has invalid profile, source, build, or license metadata'
		);
	}
	const licenseReceipt = validateReceipt(value.license, 'wasm-bqn input license');
	const receipts = new Map();
	for (const candidate of value.assets) {
		if (
			!isObject(candidate) ||
			typeof candidate.path !== 'string' ||
			!LOGICAL_ASSET_PATHS.includes(candidate.path) ||
			receipts.has(candidate.path)
		) {
			throw new Error('wasm-bqn input lock has an invalid or duplicate asset path');
		}
		receipts.set(
			candidate.path,
			validateReceipt(candidate, `wasm-bqn input ${candidate.path}`)
		);
	}
	if (LOGICAL_ASSET_PATHS.some((assetPath) => !receipts.has(assetPath))) {
		throw new Error('wasm-bqn input lock is missing a required asset');
	}
	return Object.freeze({
		profileId: value.profileId,
		source: Object.freeze({
			repository: value.source.repository,
			path: value.source.path,
			revision: value.source.revision
		}),
		build: Object.freeze({
			emscripten: value.build.emscripten,
			options: Object.freeze([...value.build.options])
		}),
		license: Object.freeze({
			path: value.license.path,
			spdx: value.license.spdx,
			...licenseReceipt
		}),
		receipts
	});
}

/**
 * @param {{ profileId: string; source: { repository: string; path: string; revision: string }; build: { emscripten: string; options: readonly string[] }; license: { path: string; spdx: string; size: number; sha256: string }; assets: BqnLogicalAsset[]; storage: BqnStorageAsset[] }} manifest
 */
export function computeBqnRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${BQN_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${BQN_MANIFEST_FORMAT}\n`);
	hash.update('runtime\0dzaima-cbqn\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(
		`source\0${manifest.source.repository}\0${manifest.source.path}\0${manifest.source.revision}\n`
	);
	hash.update(`build\0emscripten\0${manifest.build.emscripten}\n`);
	for (const option of manifest.build.options) hash.update(`build-option\0${option}\n`);
	hash.update(
		`license\0${manifest.license.path}\0${manifest.license.spdx}\0${manifest.license.size}\0${manifest.license.sha256}\n`
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
	const configuredSourceDir = process.env.WASM_BQN_SOURCE_DIR
		? path.resolve(process.env.WASM_BQN_SOURCE_DIR)
		: DEFAULT_SOURCE_DIR;
	if (
		(await isRegularFile(path.join(configuredSourceDir, 'BQN.js'))) &&
		(await isRegularFile(path.join(configuredSourceDir, 'BQN.wasm')))
	) {
		return configuredSourceDir;
	}
	if (
		(await isRegularFile(path.join(targetDir, 'BQN.js'))) &&
		((await isRegularFile(path.join(targetDir, 'BQN.wasm'))) ||
			(await isRegularFile(path.join(targetDir, 'BQN.wasm.gz'))))
	) {
		return null;
	}
	throw new Error(
		'CBQN runtime assets were not found. Set WASM_BQN_SOURCE_DIR or pass a source dir containing BQN.js and BQN.wasm.'
	);
}

/** @param {string | null} sourceDir @param {string} targetDir @param {string | undefined} licenseFile */
async function resolveLicenseFile(sourceDir, targetDir, licenseFile) {
	const candidates = sourceDir
		? [
				licenseFile,
				process.env.WASM_BQN_LICENSE_FILE,
				path.join(sourceDir, LICENSE_FILE),
				path.join(sourceDir, 'licenses', 'LICENSE-GPLv3'),
				path.join(sourceDir, '..', 'licenses', 'LICENSE-GPLv3')
			].filter(Boolean)
		: [path.join(targetDir, LICENSE_FILE)];
	for (const candidate of candidates) {
		const resolved = path.resolve(String(candidate));
		if (await isRegularFile(resolved)) return resolved;
	}
	throw new Error('CBQN GPL-3.0 license file was not found or is not a regular file.');
}

/** @param {SyncWasmBqnOptions} [options] */
export async function syncWasmBqnAssets(options = {}) {
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
		throw new Error(`wasm-bqn runtime target must be a directory: ${targetDir}`);
	}
	if (versionStats && !versionStats.isFile()) {
		throw new Error(`wasm-bqn version module must be a regular file: ${versionModulePath}`);
	}
	if (!(await isRegularFile(workerSourcePath))) {
		throw new Error(`wasm-bqn worker source must be a regular file: ${workerSourcePath}`);
	}

	const lock = await readInputLock(lockFilePath);
	const resolvedSourceDir = await resolveSourceDir(options.sourceDir, targetDir);
	const licenseFilePath = await resolveLicenseFile(
		resolvedSourceDir,
		targetDir,
		options.licenseFile
	);
	const [targetBoundary, versionBoundary, workerBoundary, lockBoundary, licenseBoundary] =
		await Promise.all(
			[targetDir, versionModulePath, workerSourcePath, lockFilePath, licenseFilePath].map(
				resolveBoundaryPath
			)
		);
	if (pathsOverlap(targetBoundary, versionBoundary)) {
		throw new Error('wasm-bqn runtime target and version module must not overlap');
	}
	for (const [candidateBoundary, label] of [
		[workerBoundary, 'worker source'],
		[lockBoundary, 'input lock']
	]) {
		if (pathsOverlap(targetBoundary, candidateBoundary)) {
			throw new Error(`wasm-bqn runtime target and ${label} must not overlap`);
		}
		if (pathsOverlap(versionBoundary, candidateBoundary)) {
			throw new Error(`wasm-bqn version module and ${label} must not overlap`);
		}
	}
	if (resolvedSourceDir) {
		const sourceBoundary = await resolveBoundaryPath(resolvedSourceDir);
		if (pathsOverlap(targetBoundary, sourceBoundary)) {
			throw new Error('wasm-bqn source directory and runtime target must not overlap');
		}
		if (pathsOverlap(versionBoundary, sourceBoundary)) {
			throw new Error('wasm-bqn source directory and version module must not overlap');
		}
		if (pathsOverlap(targetBoundary, licenseBoundary)) {
			throw new Error('wasm-bqn license source and runtime target must not overlap');
		}
	}
	if (pathsOverlap(versionBoundary, licenseBoundary)) {
		throw new Error('wasm-bqn license source and version module must not overlap');
	}

	const sourceBase = resolvedSourceDir || targetDir;
	const sourceModulePath = path.join(sourceBase, 'BQN.js');
	const sourceWasmPath = path.join(sourceBase, 'BQN.wasm');
	const sourceGzipPath = `${sourceWasmPath}.gz`;
	if (!(await isRegularFile(sourceModulePath))) {
		throw new Error(`CBQN runtime module must be a regular file: ${sourceModulePath}`);
	}
	const hasRawWasm = await isRegularFile(sourceWasmPath);
	if (!hasRawWasm && !(await isRegularFile(sourceGzipPath))) {
		throw new Error(`CBQN runtime Wasm must be a regular file: ${sourceWasmPath}`);
	}
	const [moduleBytes, storedWasmBytes, workerBytes, licenseBytes] = await Promise.all([
		readFile(sourceModulePath),
		readFile(hasRawWasm ? sourceWasmPath : sourceGzipPath),
		readFile(workerSourcePath),
		readFile(licenseFilePath)
	]);
	let wasmBytes;
	try {
		wasmBytes = hasRawWasm ? storedWasmBytes : gunzipSync(storedWasmBytes);
	} catch {
		throw new Error('CBQN runtime Wasm gzip source is invalid');
	}
	let moduleSource;
	try {
		moduleSource = new TextDecoder('utf-8', { fatal: true }).decode(moduleBytes);
	} catch {
		throw new Error('BQN.js is not valid UTF-8 JavaScript');
	}
	if (
		!moduleSource.includes('export default Module') ||
		!moduleSource.includes('cbqn_runLine') ||
		!moduleSource.includes('FS.init')
	) {
		throw new Error(
			'BQN.js does not look like the expected CBQN Emscripten ESM runtime with filesystem support.'
		);
	}
	if (
		wasmBytes.byteLength < 8 ||
		wasmBytes[0] !== 0x00 ||
		wasmBytes[1] !== 0x61 ||
		wasmBytes[2] !== 0x73 ||
		wasmBytes[3] !== 0x6d
	) {
		throw new Error('BQN.wasm does not have a WebAssembly module header');
	}
	for (const assetPath of LOGICAL_ASSET_PATHS) {
		const bytes = assetPath === 'BQN.js' ? moduleBytes : wasmBytes;
		const receipt = lock.receipts.get(assetPath);
		if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
			throw new Error(`CBQN runtime source ${assetPath} does not match the input lock`);
		}
	}
	if (
		licenseBytes.byteLength !== lock.license.bytes ||
		sha256(licenseBytes) !== lock.license.sha256
	) {
		throw new Error('CBQN runtime license does not match the input lock');
	}

	const compressedWasmBytes = gzipSync(wasmBytes, { level: 9 });
	/** @type {BqnLogicalAsset[]} */
	const assets = [
		{
			path: 'BQN.js',
			mediaType: 'text/javascript',
			size: moduleBytes.byteLength,
			sha256: sha256(moduleBytes)
		},
		{
			path: 'BQN.wasm',
			mediaType: 'application/wasm',
			size: wasmBytes.byteLength,
			sha256: sha256(wasmBytes)
		}
	];
	/** @type {BqnStorageAsset[]} */
	const storage = [
		{
			path: 'BQN.js',
			logicalPath: 'BQN.js',
			encoding: 'identity',
			size: moduleBytes.byteLength,
			sha256: sha256(moduleBytes)
		},
		{
			path: 'BQN.wasm.gz',
			logicalPath: 'BQN.wasm',
			encoding: 'gzip',
			size: compressedWasmBytes.byteLength,
			sha256: sha256(compressedWasmBytes)
		}
	];
	const license = {
		path: lock.license.path,
		spdx: lock.license.spdx,
		size: licenseBytes.byteLength,
		sha256: sha256(licenseBytes)
	};
	const fingerprint = computeBqnRuntimeFingerprint({
		profileId: lock.profileId,
		source: lock.source,
		build: lock.build,
		license,
		assets,
		storage
	});
	const workerReceipt = Object.freeze({
		bytes: workerBytes.byteLength,
		sha256: sha256(workerBytes)
	});
	const manifest = {
		format: BQN_MANIFEST_FORMAT,
		runtime: 'dzaima-cbqn',
		profileId: lock.profileId,
		fingerprint,
		source: lock.source,
		build: lock.build,
		license,
		assets,
		storage
	};
	const legacyManifest = {
		format: 'wasm-bqn-runtime-manifest-v1',
		runtime: 'dzaima-cbqn',
		build: lock.build,
		fingerprint: fingerprint.slice(0, 16),
		files: ['BQN.js', 'BQN.wasm.gz', LICENSE_FILE]
	};
	const versionModuleSource = `export const WASM_BQN_ASSET_VERSION =\n\t'${fingerprint}';\nexport const WASM_BQN_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;

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
			writeFile(path.join(temporaryTarget, 'BQN.js'), moduleBytes),
			writeFile(path.join(temporaryTarget, 'BQN.wasm.gz'), compressedWasmBytes),
			writeFile(path.join(temporaryTarget, LICENSE_FILE), licenseBytes),
			writeFile(path.join(temporaryTarget, 'runner-worker.js'), workerBytes),
			writeFile(
				path.join(temporaryTarget, LEGACY_MANIFEST_FILE),
				`${JSON.stringify(legacyManifest, null, 2)}\n`,
				'utf8'
			),
			writeFile(
				path.join(temporaryTarget, MANIFEST_FILE),
				`${JSON.stringify(manifest, null, 2)}\n`,
				'utf8'
			),
			writeFile(temporaryVersion, versionModuleSource, 'utf8')
		]);
		const [
			installedModule,
			installedWasmGzip,
			installedLicense,
			installedWorker,
			installedManifest
		] = await Promise.all([
			readFile(path.join(temporaryTarget, 'BQN.js')),
			readFile(path.join(temporaryTarget, 'BQN.wasm.gz')),
			readFile(path.join(temporaryTarget, LICENSE_FILE)),
			readFile(path.join(temporaryTarget, 'runner-worker.js')),
			readFile(path.join(temporaryTarget, MANIFEST_FILE), 'utf8')
		]);
		if (
			sha256(installedModule) !== assets[0].sha256 ||
			sha256(installedWasmGzip) !== storage[1].sha256 ||
			sha256(gunzipSync(installedWasmGzip)) !== assets[1].sha256 ||
			sha256(installedLicense) !== license.sha256 ||
			sha256(installedWorker) !== workerReceipt.sha256 ||
			JSON.stringify(JSON.parse(installedManifest)) !== JSON.stringify(manifest)
		) {
			throw new Error('wasm-bqn temporary installation failed receipt verification');
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
					'wasm-bqn publication failed and rollback was incomplete'
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
	const { sourceDir, targetDir } = await syncWasmBqnAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-bqn from ${sourceDir} to ${targetDir}`);
}
