import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
	lstat,
	mkdir,
	open,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	unlink
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-awk', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-awk');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-awk-runner-worker.js'
);
const DEFAULT_LEGACY_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-awk-runner-worker.v1.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmAwkVersion.ts'
);
const DEFAULT_LSP_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'lsp',
	'src',
	'bundledAwkRuntime.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-awk-assets.lock.json');
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const LEGACY_WASM_STORAGE_FILE = 'goawk.wasm.gz';
const VERIFIED_WASM_STORAGE_FILE = 'goawk.wasm.gz.bin';
const LEGACY_WORKER_FILE = 'runner-worker.js';
const VERIFIED_WORKER_FILE = 'runner-worker.v2.js';
const SOURCE_ASSET_PATHS = ['goawk.wasm', 'runtime-build.json', 'wasm_exec.js'];
const LEGACY_FINGERPRINT_FILES = [...SOURCE_ASSET_PATHS, LEGACY_WORKER_FILE].sort();
const PROFILE_ASSET_ROLES = ['worker', 'goShim', 'wasm'];
const STATIC_OUTPUT_FILES = [
	LEGACY_WASM_STORAGE_FILE,
	VERIFIED_WASM_STORAGE_FILE,
	LEGACY_WORKER_FILE,
	VERIFIED_WORKER_FILE,
	'runtime-build.json',
	LEGACY_MANIFEST_FILE,
	MANIFEST_FILE,
	'wasm_exec.js'
].sort();
const WORKER_TEMPLATE_TOKENS = Object.freeze({
	profileId: '__WASM_IDLE_AWK_PROFILE_ID__',
	goShimBytes: '__WASM_IDLE_AWK_GO_SHIM_BYTES__',
	goShimSha256: '__WASM_IDLE_AWK_GO_SHIM_SHA256__',
	logicalWasmBytes: '__WASM_IDLE_AWK_LOGICAL_WASM_BYTES__',
	logicalWasmSha256: '__WASM_IDLE_AWK_LOGICAL_WASM_SHA256__'
});
const SYNC_LOCK_FORMAT = 'wasm-awk-sync-lock-v1';
const SYNC_TRANSACTION_FORMAT = 'wasm-awk-sync-transaction-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const AWK_MANIFEST_FORMAT = 'wasm-awk-runtime-manifest-v2';
export const AWK_FINGERPRINT_DOMAIN = 'wasm-idle:awk-runtime-manifest:v2';

/** @typedef {{ readonly bytes: number; readonly sha256: string }} AwkAssetReceipt */
/**
 * @typedef {object} SyncWasmAwkOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [legacyWorkerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [lspVersionModulePath]
 * @property {string} [lockFilePath]
 * @property {string} [syncLockPath]
 * @property {string} [transactionMarkerPath]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
 */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {Record<string, unknown>} value @param {readonly string[]} expected @param {string} label */
function assertExactKeys(value, expected, label) {
	const actual = Object.keys(value).sort();
	const canonical = [...expected].sort();
	if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
		throw new Error(`${label} has unexpected or missing fields`);
	}
}

/** @param {string} filePath @param {string} label */
async function readRegularFileOnce(filePath, label) {
	let handle;
	try {
		handle = await open(
			filePath,
			fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
		);
	} catch (error) {
		throw new Error(`${label} must be an existing non-symlink regular file: ${filePath}`, {
			cause: error
		});
	}
	try {
		const stats = await handle.stat();
		if (!stats.isFile()) {
			throw new Error(`${label} must be a regular file: ${filePath}`);
		}
		return await handle.readFile();
	} finally {
		await handle.close();
	}
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

/** @param {string} filePath Resolve existing ancestors so symlink spellings cannot bypass boundaries. */
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

/** @param {unknown} value @param {string} label @param {readonly string[]} allowedPaths */
function validateReceipt(value, label, allowedPaths) {
	if (!isObject(value)) throw new Error(`${label} must be an object`);
	assertExactKeys(value, ['bytes', 'path', 'sha256'], label);
	if (
		typeof value.path !== 'string' ||
		!allowedPaths.includes(value.path) ||
		!Number.isSafeInteger(value.bytes) ||
		/** @type {number} */ (value.bytes) <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`${label} has invalid path, size, or SHA-256 metadata`);
	}
	return Object.freeze({
		path: value.path,
		bytes: /** @type {number} */ (value.bytes),
		sha256: value.sha256
	});
}

/** @param {Uint8Array} lockBytes */
function parseInputLock(lockBytes) {
	let value;
	try {
		const source = new TextDecoder('utf-8', { fatal: true }).decode(lockBytes);
		value = JSON.parse(source);
	} catch (error) {
		throw new Error(
			`wasm-awk input lock is not valid UTF-8 JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (!isObject(value)) throw new Error('wasm-awk input lock must have an object root');
	assertExactKeys(
		value,
		['assets', 'format', 'legacyWorker', 'profileId', 'source'],
		'wasm-awk input lock'
	);
	if (
		value.format !== 'wasm-awk-assets-lock-v1' ||
		typeof value.profileId !== 'string' ||
		!/^goawk-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		!isObject(value.source) ||
		!isObject(value.legacyWorker) ||
		!Array.isArray(value.assets) ||
		value.assets.length !== SOURCE_ASSET_PATHS.length
	) {
		throw new Error('wasm-awk input lock has invalid format, profile, source, or assets');
	}
	assertExactKeys(
		value.source,
		['buildArguments', 'goVersion', 'goawkModule', 'goawkVersion', 'repository'],
		'wasm-awk input lock source'
	);
	const expectedBuildArguments = [
		'build',
		'-buildvcs=false',
		'-trimpath',
		'-ldflags=-s -w -buildid=',
		'GOOS=js',
		'GOARCH=wasm'
	];
	if (
		value.source.repository !== 'https://github.com/benhoyt/goawk' ||
		value.source.goawkModule !== 'github.com/benhoyt/goawk' ||
		typeof value.source.goVersion !== 'string' ||
		!/^go\d+\.\d+\.\d+$/u.test(value.source.goVersion) ||
		typeof value.source.goawkVersion !== 'string' ||
		!/^v\d+\.\d+\.\d+$/u.test(value.source.goawkVersion) ||
		!Array.isArray(value.source.buildArguments) ||
		JSON.stringify(value.source.buildArguments) !== JSON.stringify(expectedBuildArguments)
	) {
		throw new Error('wasm-awk input lock has invalid pinned source metadata');
	}
	const receipts = new Map();
	for (const candidate of value.assets) {
		const receipt = validateReceipt(candidate, 'wasm-awk input asset', SOURCE_ASSET_PATHS);
		if (receipts.has(receipt.path)) {
			throw new Error(`wasm-awk input lock repeats asset ${receipt.path}`);
		}
		receipts.set(receipt.path, receipt);
	}
	if (SOURCE_ASSET_PATHS.some((assetPath) => !receipts.has(assetPath))) {
		throw new Error('wasm-awk input lock is missing a required asset');
	}
	const legacyWorkerReceipt = validateReceipt(value.legacyWorker, 'wasm-awk legacy worker', [
		LEGACY_WORKER_FILE
	]);
	return Object.freeze({
		profileId: value.profileId,
		source: Object.freeze({
			repository: value.source.repository,
			goVersion: value.source.goVersion,
			goawkModule: value.source.goawkModule,
			goawkVersion: value.source.goawkVersion,
			buildArguments: Object.freeze([...value.source.buildArguments])
		}),
		receipts,
		legacyWorkerReceipt
	});
}

/**
 * Compute the v2 profile fingerprint over the exact executable asset graph.
 *
 * @param {{ profileId: string; goVersion: string; goawkVersion: string; assets: Record<string, { path: string; bytes: number; sha256: string; uncompressedBytes?: number; uncompressedSha256?: string }> }} manifest
 */
export function computeAwkRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${AWK_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${AWK_MANIFEST_FORMAT}\n`);
	hash.update('runtime\0GoAWK\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(`goVersion\0${manifest.goVersion}\n`);
	hash.update(`goawkVersion\0${manifest.goawkVersion}\n`);
	for (const role of PROFILE_ASSET_ROLES) {
		const asset = manifest.assets[role];
		if (!asset) throw new Error(`wasm-awk fingerprint is missing ${role}`);
		const logicalSuffix =
			role === 'wasm' ? `\0${asset.uncompressedBytes}\0${asset.uncompressedSha256}` : '';
		hash.update(
			`asset\0${role}\0${asset.path}\0${asset.bytes}\0${asset.sha256}${logicalSuffix}\n`
		);
	}
	return hash.digest('hex');
}

/** @param {Record<string, Uint8Array>} files */
export function computeLegacyAwkRuntimeFingerprint(files) {
	if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(LEGACY_FINGERPRINT_FILES)) {
		throw new Error('wasm-awk legacy fingerprint requires the exact v1 executable graph');
	}
	const hash = createHash('sha256');
	for (const fileName of LEGACY_FINGERPRINT_FILES) {
		hash.update(fileName);
		hash.update('\0');
		hash.update(files[fileName]);
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

/** @param {string} source @param {string} token @param {string} replacement */
function replaceWorkerToken(source, token, replacement) {
	const first = source.indexOf(token);
	if (first < 0 || first !== source.lastIndexOf(token)) {
		throw new Error(`wasm-awk v2 worker template must contain exactly one ${token} token`);
	}
	return `${source.slice(0, first)}${replacement}${source.slice(first + token.length)}`;
}

/**
 * @param {Uint8Array} templateBytes
 * @param {{ profileId: string; goShimReceipt: AwkAssetReceipt; logicalWasmReceipt: AwkAssetReceipt }} profile
 */
export function renderAwkRunnerWorker(templateBytes, profile) {
	let source;
	try {
		source = new TextDecoder('utf-8', { fatal: true }).decode(templateBytes);
	} catch {
		throw new Error('wasm-awk v2 worker template is not valid UTF-8 JavaScript');
	}
	for (const [token, replacement] of [
		[WORKER_TEMPLATE_TOKENS.profileId, profile.profileId],
		[WORKER_TEMPLATE_TOKENS.goShimBytes, String(profile.goShimReceipt.bytes)],
		[WORKER_TEMPLATE_TOKENS.goShimSha256, profile.goShimReceipt.sha256],
		[WORKER_TEMPLATE_TOKENS.logicalWasmBytes, String(profile.logicalWasmReceipt.bytes)],
		[WORKER_TEMPLATE_TOKENS.logicalWasmSha256, profile.logicalWasmReceipt.sha256]
	]) {
		source = replaceWorkerToken(source, token, replacement);
	}
	if (Object.values(WORKER_TEMPLATE_TOKENS).some((token) => source.includes(token))) {
		throw new Error('wasm-awk v2 worker template rendering left an unresolved token');
	}
	return Buffer.from(source, 'utf8');
}

/** @param {string} sourceDir */
async function validateSourceDirectory(sourceDir) {
	const sourceStats = await lstat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(`wasm-awk source must be a directory: ${sourceDir}`);
	}
}

async function buildDefaultSourceDir() {
	const buildModule = await import(
		new URL('../runtimes/wasm-awk/scripts/build.mjs', import.meta.url).href
	);
	await buildModule.buildWasmAwkRuntime();
	return DEFAULT_SOURCE_DIR;
}

/** @param {Buffer} wasmBytes */
function assertWasmBytes(wasmBytes) {
	if (
		wasmBytes.byteLength < 8 ||
		wasmBytes[0] !== 0x00 ||
		wasmBytes[1] !== 0x61 ||
		wasmBytes[2] !== 0x73 ||
		wasmBytes[3] !== 0x6d
	) {
		throw new Error('wasm-awk source goawk.wasm does not have a WebAssembly module header');
	}
}

/** @param {Buffer} runtimeBuildBytes */
function parseRuntimeBuild(runtimeBuildBytes) {
	let value;
	try {
		value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(runtimeBuildBytes));
	} catch (error) {
		throw new Error(
			`wasm-awk runtime-build.json is not valid UTF-8 JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (!isObject(value)) throw new Error('wasm-awk runtime-build.json must have an object root');
	assertExactKeys(value, ['goVersion', 'goawkVersion'], 'wasm-awk runtime-build.json');
	if (typeof value.goVersion !== 'string' || typeof value.goawkVersion !== 'string') {
		throw new Error('wasm-awk runtime-build.json has invalid version metadata');
	}
	return Object.freeze({ goVersion: value.goVersion, goawkVersion: value.goawkVersion });
}

/** @param {string} prefix @param {any} profile */
function createGeneratedProfileModule(prefix, profile) {
	return `// Generated by scripts/sync-wasm-awk.mjs. Do not edit.
export const ${prefix}_RUNTIME_PROFILE = Object.freeze({
	profileId: '${profile.profileId}',
	goVersion: '${profile.goVersion}',
	goawkVersion: '${profile.goawkVersion}',
	manifestFingerprint: '${profile.manifestFingerprint}',
	manifestReceipt: Object.freeze({
		bytes: ${profile.manifestReceipt.bytes},
		sha256: '${profile.manifestReceipt.sha256}'
	}),
	workerReceipt: Object.freeze({
		bytes: ${profile.workerReceipt.bytes},
		sha256: '${profile.workerReceipt.sha256}'
	}),
	goShimReceipt: Object.freeze({
		bytes: ${profile.goShimReceipt.bytes},
		sha256: '${profile.goShimReceipt.sha256}'
	}),
	wasmReceipt: Object.freeze({
		bytes: ${profile.wasmReceipt.bytes},
		sha256: '${profile.wasmReceipt.sha256}',
		uncompressedBytes: ${profile.wasmReceipt.uncompressedBytes},
		uncompressedSha256: '${profile.wasmReceipt.uncompressedSha256}'
	})
});
export const ${prefix}_RUNTIME_BUNDLE = Object.freeze({
	profile: ${prefix}_RUNTIME_PROFILE,
	workerReceipt: ${prefix}_RUNTIME_PROFILE.workerReceipt
});
`;
}

/** @param {any} profile */
function createAppVersionModule(profile) {
	return `${createGeneratedProfileModule('WASM_AWK', profile)}export const WASM_AWK_ASSET_VERSION = WASM_AWK_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_AWK_RUNNER_RECEIPT = WASM_AWK_RUNTIME_PROFILE.workerReceipt;
`;
}

/** @param {any} profile */
function createLspVersionModule(profile) {
	return `${createGeneratedProfileModule('BUNDLED_AWK', profile)}export const BUNDLED_AWK_MANIFEST_FINGERPRINT = BUNDLED_AWK_RUNTIME_PROFILE.manifestFingerprint;
export const BUNDLED_AWK_RUNNER_RECEIPT = BUNDLED_AWK_RUNTIME_PROFILE.workerReceipt;
`;
}

/** @param {string} label @param {Buffer} actual @param {AwkAssetReceipt} expected */
function verifyReceipt(label, actual, expected) {
	if (actual.byteLength !== expected.bytes || sha256(actual) !== expected.sha256) {
		throw new Error(`wasm-awk source ${label} does not match the input lock`);
	}
}

/** @param {string[]} outputBoundaries @param {Array<[string, string]>} inputs */
function assertPublicationBoundaries(outputBoundaries, inputs) {
	for (let index = 0; index < outputBoundaries.length; index += 1) {
		for (let other = index + 1; other < outputBoundaries.length; other += 1) {
			if (pathsOverlap(outputBoundaries[index], outputBoundaries[other])) {
				throw new Error('wasm-awk publication outputs must not overlap');
			}
		}
		for (const [inputBoundary, label] of inputs) {
			if (pathsOverlap(outputBoundaries[index], inputBoundary)) {
				throw new Error(`wasm-awk publication output and ${label} must not overlap`);
			}
		}
	}
}

/** @param {string} target @param {'directory' | 'file'} kind */
async function validateInstalledOutput(target, kind) {
	const stats = await lstat(target).catch(() => null);
	if (!stats) return;
	if (kind === 'directory' ? !stats.isDirectory() : !stats.isFile()) {
		throw new Error(`wasm-awk publication target has an unsafe type: ${target}`);
	}
}

/** @param {string} targetDir */
export function getAwkSyncControlPaths(targetDir) {
	const resolvedTarget = path.resolve(targetDir);
	const parent = path.dirname(resolvedTarget);
	const name = path.basename(resolvedTarget);
	return Object.freeze({
		syncLockPath: path.join(parent, `.${name}.sync.lock`),
		transactionMarkerPath: path.join(parent, `.${name}.sync-transaction.json`)
	});
}

/** @param {string} directoryPath */
async function syncDirectory(directoryPath) {
	const handle = await open(directoryPath, fsConstants.O_RDONLY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** @param {string} filePath @param {string | Uint8Array} contents */
async function writeDurableExclusiveFile(filePath, contents) {
	const handle = await open(filePath, 'wx');
	try {
		await handle.writeFile(contents);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** @param {string} lockPath @param {Uint8Array} bytes */
function parseSyncLock(lockPath, bytes) {
	let value;
	try {
		value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (error) {
		throw new Error(`wasm-awk sync lock is invalid: ${lockPath}`, { cause: error });
	}
	if (!isObject(value)) throw new Error(`wasm-awk sync lock is invalid: ${lockPath}`);
	assertExactKeys(value, ['createdAt', 'format', 'pid', 'token'], 'wasm-awk sync lock');
	if (
		value.format !== SYNC_LOCK_FORMAT ||
		!Number.isSafeInteger(value.pid) ||
		/** @type {number} */ (value.pid) <= 0 ||
		typeof value.token !== 'string' ||
		!UUID_PATTERN.test(value.token) ||
		typeof value.createdAt !== 'string' ||
		Number.isNaN(Date.parse(value.createdAt))
	) {
		throw new Error(`wasm-awk sync lock is invalid: ${lockPath}`);
	}
	return value;
}

/** @param {string} lockPath */
async function acquireSyncLock(lockPath) {
	const token = randomUUID();
	const source = `${JSON.stringify(
		{ format: SYNC_LOCK_FORMAT, pid: process.pid, token, createdAt: new Date().toISOString() },
		null,
		2
	)}\n`;
	let handle;
	try {
		handle = await open(lockPath, 'wx', 0o600);
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
		if (code !== 'EEXIST') throw error;
		const existing = parseSyncLock(
			lockPath,
			await readRegularFileOnce(lockPath, 'wasm-awk sync lock')
		);
		let processAlive;
		try {
			process.kill(/** @type {number} */ (existing.pid), 0);
			processAlive = true;
		} catch (processError) {
			const processCode =
				processError && typeof processError === 'object' && 'code' in processError
					? processError.code
					: '';
			processAlive = processCode !== 'ESRCH';
		}
		if (processAlive) {
			throw new Error(`wasm-awk sync is already running under PID ${existing.pid}`);
		}
		throw new Error(
			`wasm-awk sync lock belongs to inactive PID ${existing.pid}; remove the verified stale lock manually: ${lockPath}`
		);
	}
	try {
		await handle.writeFile(source, 'utf8');
		await handle.sync();
		await syncDirectory(path.dirname(lockPath));
		return { handle, lockPath, token, stats: await handle.stat() };
	} catch (error) {
		const ownedStats = await handle.stat().catch(() => null);
		await handle.close().catch(() => undefined);
		const currentStats = await lstat(lockPath).catch(() => null);
		if (
			ownedStats &&
			currentStats &&
			ownedStats.dev === currentStats.dev &&
			ownedStats.ino === currentStats.ino
		) {
			await unlink(lockPath);
			await syncDirectory(path.dirname(lockPath));
		}
		throw error;
	}
}

/** @param {{ handle: import('node:fs/promises').FileHandle; lockPath: string; token: string; stats: import('node:fs').Stats }} lock */
async function releaseSyncLock(lock) {
	try {
		const currentStats = await lstat(lock.lockPath).catch(() => null);
		if (!currentStats) {
			throw new Error('wasm-awk sync lock disappeared during publication');
		}
		if (currentStats.dev !== lock.stats.dev || currentStats.ino !== lock.stats.ino) {
			throw new Error('wasm-awk sync lock ownership changed during publication');
		}
		const value = parseSyncLock(
			lock.lockPath,
			await readRegularFileOnce(lock.lockPath, 'wasm-awk sync lock')
		);
		if (value.pid !== process.pid || value.token !== lock.token) {
			throw new Error('wasm-awk sync lock ownership changed during publication');
		}
		const finalStats = await lstat(lock.lockPath).catch(() => null);
		if (!finalStats || finalStats.dev !== lock.stats.dev || finalStats.ino !== lock.stats.ino) {
			throw new Error('wasm-awk sync lock ownership changed during publication');
		}
		await unlink(lock.lockPath);
		await syncDirectory(path.dirname(lock.lockPath));
	} finally {
		await lock.handle.close();
	}
}

/** @param {string} target @param {string} transactionId @param {'staging' | 'previous'} role */
function transactionSiblingPath(target, transactionId, role) {
	return path.join(path.dirname(target), `.${path.basename(target)}.${role}-${transactionId}`);
}

/**
 * @param {Array<{ target: string; kind: 'directory' | 'file' }>} basePublications
 * @param {string} transactionId
 */
function createPublications(basePublications, transactionId) {
	return basePublications.map((publication) => ({
		...publication,
		staging: transactionSiblingPath(publication.target, transactionId, 'staging'),
		previous: transactionSiblingPath(publication.target, transactionId, 'previous'),
		hadTarget: false
	}));
}

/** @param {string} markerPath @param {unknown} marker */
async function writeTransactionMarker(markerPath, marker) {
	const transactionId = /** @type {{ transactionId: string }} */ (marker).transactionId;
	const temporaryPath = `${markerPath}.next`;
	try {
		await writeDurableExclusiveFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`);
		await rename(temporaryPath, markerPath);
		await syncDirectory(path.dirname(markerPath));
	} finally {
		if (await lstat(temporaryPath).catch(() => null)) {
			await unlink(temporaryPath);
			await syncDirectory(path.dirname(temporaryPath));
		}
	}
}

/** @param {string} markerPath */
async function discardTransactionMarkerTemporary(markerPath) {
	const temporaryPath = `${markerPath}.next`;
	const stats = await lstat(temporaryPath).catch(() => null);
	if (!stats) return;
	if (!stats.isFile()) {
		throw new Error(`wasm-awk transaction temporary path has an unsafe type: ${temporaryPath}`);
	}
	await unlink(temporaryPath);
	await syncDirectory(path.dirname(temporaryPath));
}

/**
 * @param {string} markerPath
 * @param {Array<{ target: string; kind: 'directory' | 'file' }>} basePublications
 */
async function readTransactionMarker(markerPath, basePublications) {
	let value;
	try {
		value = JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(
				await readRegularFileOnce(markerPath, 'wasm-awk transaction marker')
			)
		);
	} catch (error) {
		throw new Error(`wasm-awk transaction marker is invalid: ${markerPath}`, {
			cause: error
		});
	}
	if (!isObject(value)) throw new Error('wasm-awk transaction marker must be an object');
	assertExactKeys(
		value,
		['format', 'phase', 'publications', 'transactionId'],
		'wasm-awk transaction marker'
	);
	if (
		value.format !== SYNC_TRANSACTION_FORMAT ||
		typeof value.transactionId !== 'string' ||
		!UUID_PATTERN.test(value.transactionId) ||
		!['preparing', 'prepared', 'committed'].includes(/** @type {string} */ (value.phase)) ||
		!Array.isArray(value.publications) ||
		value.publications.length !== basePublications.length
	) {
		throw new Error('wasm-awk transaction marker has invalid metadata');
	}
	const expected = createPublications(basePublications, value.transactionId);
	for (let index = 0; index < expected.length; index += 1) {
		const candidate = value.publications[index];
		const publication = expected[index];
		if (!isObject(candidate)) {
			throw new Error('wasm-awk transaction marker has an invalid publication');
		}
		assertExactKeys(
			candidate,
			['hadTarget', 'kind', 'previous', 'staging', 'target'],
			'wasm-awk transaction publication'
		);
		if (
			candidate.target !== publication.target ||
			candidate.kind !== publication.kind ||
			candidate.staging !== publication.staging ||
			candidate.previous !== publication.previous ||
			typeof candidate.hadTarget !== 'boolean'
		) {
			throw new Error('wasm-awk transaction marker publication does not match this sync');
		}
		publication.hadTarget = candidate.hadTarget;
	}
	return {
		format: SYNC_TRANSACTION_FORMAT,
		transactionId: value.transactionId,
		phase: value.phase,
		publications: expected
	};
}

/** @param {string} candidate @param {'directory' | 'file'} kind */
async function requirePublicationPathType(candidate, kind) {
	const stats = await lstat(candidate).catch(() => null);
	if (!stats) return null;
	if (kind === 'directory' ? !stats.isDirectory() : !stats.isFile()) {
		throw new Error(`wasm-awk transaction path has an unsafe type: ${candidate}`);
	}
	return stats;
}

/** @param {string} candidate @param {'directory' | 'file'} kind */
async function removePublicationPath(candidate, kind) {
	if (!(await requirePublicationPathType(candidate, kind))) return;
	await rm(candidate, { recursive: kind === 'directory', force: false });
	await syncDirectory(path.dirname(candidate));
}

/**
 * @param {string} markerPath
 * @param {Array<{ target: string; kind: 'directory' | 'file' }>} basePublications
 */
async function recoverTransaction(markerPath, basePublications) {
	if (!(await lstat(markerPath).catch(() => null))) return false;
	const marker = await readTransactionMarker(markerPath, basePublications);
	if (marker.phase === 'committed') {
		for (const publication of marker.publications) {
			if (!(await requirePublicationPathType(publication.target, publication.kind))) {
				throw new Error(`wasm-awk committed publication is missing: ${publication.target}`);
			}
			await removePublicationPath(publication.previous, publication.kind);
			await removePublicationPath(publication.staging, publication.kind);
		}
	} else {
		for (const publication of [...marker.publications].reverse()) {
			const previous = await requirePublicationPathType(
				publication.previous,
				publication.kind
			);
			const staging = await requirePublicationPathType(publication.staging, publication.kind);
			const target = await requirePublicationPathType(publication.target, publication.kind);
			if (previous) {
				if (target) await removePublicationPath(publication.target, publication.kind);
				await rename(publication.previous, publication.target);
				await syncDirectory(path.dirname(publication.target));
			} else if (publication.hadTarget && !target) {
				throw new Error(
					`wasm-awk cannot recover missing prior publication: ${publication.target}`
				);
			} else if (!publication.hadTarget && target && !staging) {
				await removePublicationPath(publication.target, publication.kind);
			}
			await removePublicationPath(publication.staging, publication.kind);
		}
	}
	await unlink(markerPath);
	await syncDirectory(path.dirname(markerPath));
	return true;
}

/** @param {string} directoryPath */
async function assertExactStaticInventory(directoryPath) {
	const entries = await readdir(directoryPath, { withFileTypes: true });
	if (
		JSON.stringify(entries.map((entry) => entry.name).sort()) !==
		JSON.stringify(STATIC_OUTPUT_FILES)
	) {
		throw new Error('wasm-awk staged runtime has an unexpected output inventory');
	}
	if (entries.some((entry) => !entry.isFile())) {
		throw new Error('wasm-awk staged runtime output must contain only regular files');
	}
}

/** @param {SyncWasmAwkOptions} [options] */
export async function syncWasmAwkAssets(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
	const legacyWorkerSourcePath = path.resolve(
		options.legacyWorkerSourcePath || DEFAULT_LEGACY_WORKER_SOURCE_PATH
	);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const lspVersionModulePath = path.resolve(
		options.lspVersionModulePath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_LSP_VERSION_MODULE_PATH
				: `${targetDir}.lsp-version.ts`)
	);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const defaultControlPaths = getAwkSyncControlPaths(targetDir);
	const syncLockPath = path.resolve(options.syncLockPath || defaultControlPaths.syncLockPath);
	const transactionMarkerPath = path.resolve(
		options.transactionMarkerPath || defaultControlPaths.transactionMarkerPath
	);
	const transactionMarkerTemporaryPath = `${transactionMarkerPath}.next`;
	const renamePath = options.renamePath || rename;
	if (targetDir === path.parse(targetDir).root) {
		throw new Error('wasm-awk runtime target must not be a filesystem root');
	}
	if (
		path.dirname(syncLockPath) !== path.dirname(targetDir) ||
		path.dirname(transactionMarkerPath) !== path.dirname(targetDir) ||
		pathsOverlap(syncLockPath, transactionMarkerPath) ||
		pathsOverlap(syncLockPath, transactionMarkerTemporaryPath)
	) {
		throw new Error('wasm-awk sync controls must be distinct siblings of the runtime target');
	}
	const resolvedSourceDir = path.resolve(options.sourceDir || DEFAULT_SOURCE_DIR);
	const [
		targetBoundary,
		versionBoundary,
		lspVersionBoundary,
		sourceBoundary,
		workerBoundary,
		legacyWorkerBoundary,
		lockBoundary,
		syncLockBoundary,
		transactionMarkerBoundary,
		transactionMarkerTemporaryBoundary
	] = await Promise.all(
		[
			targetDir,
			versionModulePath,
			lspVersionModulePath,
			resolvedSourceDir,
			workerSourcePath,
			legacyWorkerSourcePath,
			lockFilePath,
			syncLockPath,
			transactionMarkerPath,
			transactionMarkerTemporaryPath
		].map(resolveBoundaryPath)
	);
	assertPublicationBoundaries(
		[targetBoundary, versionBoundary, lspVersionBoundary],
		[
			[sourceBoundary, 'source directory'],
			[workerBoundary, 'v2 worker template'],
			[legacyWorkerBoundary, 'legacy worker source'],
			[lockBoundary, 'input lock'],
			[syncLockBoundary, 'sync lock'],
			[transactionMarkerBoundary, 'transaction marker'],
			[transactionMarkerTemporaryBoundary, 'transaction marker temporary']
		]
	);
	/** @type {Array<[string, string]>} */
	const controlBoundaries = [
		[syncLockBoundary, 'sync lock'],
		[transactionMarkerBoundary, 'transaction marker'],
		[transactionMarkerTemporaryBoundary, 'transaction marker temporary']
	];
	/** @type {Array<[string, string]>} */
	const inputBoundaries = [
		[sourceBoundary, 'source directory'],
		[workerBoundary, 'v2 worker template'],
		[legacyWorkerBoundary, 'legacy worker source'],
		[lockBoundary, 'input lock']
	];
	for (let index = 0; index < controlBoundaries.length; index += 1) {
		for (let other = index + 1; other < controlBoundaries.length; other += 1) {
			if (pathsOverlap(controlBoundaries[index][0], controlBoundaries[other][0])) {
				throw new Error('wasm-awk sync control paths must not overlap');
			}
		}
		for (const [inputBoundary, inputLabel] of inputBoundaries) {
			if (pathsOverlap(controlBoundaries[index][0], inputBoundary)) {
				throw new Error(
					`wasm-awk ${controlBoundaries[index][1]} and ${inputLabel} must not overlap`
				);
			}
		}
	}
	await Promise.all([
		mkdir(path.dirname(targetDir), { recursive: true }),
		mkdir(path.dirname(versionModulePath), { recursive: true }),
		mkdir(path.dirname(lspVersionModulePath), { recursive: true }),
		mkdir(path.dirname(syncLockPath), { recursive: true })
	]);
	/** @type {Array<{ target: string; kind: 'directory' | 'file' }>} */
	const basePublications = [
		{ target: targetDir, kind: 'directory' },
		{ target: versionModulePath, kind: 'file' },
		{ target: lspVersionModulePath, kind: 'file' }
	];
	const syncLock = await acquireSyncLock(syncLockPath);
	/** @type {null | { sourceDir: string; targetDir: string; fingerprint: string; versionModulePath: string; lspVersionModulePath: string; profile: any }} */
	let result = null;
	/** @type {unknown} */
	let operationError;
	try {
		await discardTransactionMarkerTemporary(transactionMarkerPath);
		await recoverTransaction(transactionMarkerPath, basePublications);
		await Promise.all([
			validateInstalledOutput(targetDir, 'directory'),
			validateInstalledOutput(versionModulePath, 'file'),
			validateInstalledOutput(lspVersionModulePath, 'file')
		]);
		if (!options.sourceDir) await buildDefaultSourceDir();
		await validateSourceDirectory(resolvedSourceDir);
		const [
			lockBytes,
			workerTemplateBytes,
			legacyWorkerBytes,
			wasmBytes,
			runtimeBuildBytes,
			goShimBytes
		] = await Promise.all([
			readRegularFileOnce(lockFilePath, 'wasm-awk input lock'),
			readRegularFileOnce(workerSourcePath, 'wasm-awk v2 worker template'),
			readRegularFileOnce(legacyWorkerSourcePath, 'wasm-awk legacy worker source'),
			readRegularFileOnce(
				path.join(resolvedSourceDir, 'goawk.wasm'),
				'wasm-awk source goawk.wasm'
			),
			readRegularFileOnce(
				path.join(resolvedSourceDir, 'runtime-build.json'),
				'wasm-awk source runtime-build.json'
			),
			readRegularFileOnce(
				path.join(resolvedSourceDir, 'wasm_exec.js'),
				'wasm-awk source wasm_exec.js'
			)
		]);
		const lock = parseInputLock(lockBytes);
		verifyReceipt('legacy runner-worker.js', legacyWorkerBytes, lock.legacyWorkerReceipt);
		verifyReceipt('goawk.wasm', wasmBytes, lock.receipts.get('goawk.wasm'));
		verifyReceipt(
			'runtime-build.json',
			runtimeBuildBytes,
			lock.receipts.get('runtime-build.json')
		);
		verifyReceipt('wasm_exec.js', goShimBytes, lock.receipts.get('wasm_exec.js'));
		assertWasmBytes(wasmBytes);
		const runtimeBuild = parseRuntimeBuild(runtimeBuildBytes);
		if (
			runtimeBuild.goVersion !== lock.source.goVersion ||
			runtimeBuild.goawkVersion !== lock.source.goawkVersion
		) {
			throw new Error(
				'wasm-awk runtime-build.json does not match the pinned source versions'
			);
		}
		const goShimReceipt = Object.freeze({
			bytes: goShimBytes.byteLength,
			sha256: sha256(goShimBytes)
		});
		const logicalWasmReceipt = Object.freeze({
			bytes: wasmBytes.byteLength,
			sha256: sha256(wasmBytes)
		});
		const workerBytes = renderAwkRunnerWorker(workerTemplateBytes, {
			profileId: lock.profileId,
			goShimReceipt,
			logicalWasmReceipt
		});
		const compressedWasmBytes = gzipSync(wasmBytes, { level: 9 });
		if (!gunzipSync(compressedWasmBytes).equals(wasmBytes)) {
			throw new Error('wasm-awk deterministic Wasm compression did not round-trip');
		}
		const assets = Object.freeze({
			worker: Object.freeze({
				path: VERIFIED_WORKER_FILE,
				bytes: workerBytes.byteLength,
				sha256: sha256(workerBytes)
			}),
			goShim: Object.freeze({ path: 'wasm_exec.js', ...goShimReceipt }),
			wasm: Object.freeze({
				path: VERIFIED_WASM_STORAGE_FILE,
				bytes: compressedWasmBytes.byteLength,
				sha256: sha256(compressedWasmBytes),
				uncompressedBytes: logicalWasmReceipt.bytes,
				uncompressedSha256: logicalWasmReceipt.sha256
			})
		});
		const manifestBody = {
			format: AWK_MANIFEST_FORMAT,
			runtime: 'GoAWK',
			profileId: lock.profileId,
			goVersion: runtimeBuild.goVersion,
			goawkVersion: runtimeBuild.goawkVersion,
			assets
		};
		const fingerprint = computeAwkRuntimeFingerprint(manifestBody);
		const manifestSource = `${JSON.stringify({ ...manifestBody, fingerprint }, null, 2)}\n`;
		const manifestBytes = Buffer.from(manifestSource, 'utf8');
		const profile = Object.freeze({
			profileId: lock.profileId,
			goVersion: runtimeBuild.goVersion,
			goawkVersion: runtimeBuild.goawkVersion,
			manifestFingerprint: fingerprint,
			manifestReceipt: Object.freeze({
				bytes: manifestBytes.byteLength,
				sha256: sha256(manifestBytes)
			}),
			workerReceipt: assets.worker,
			goShimReceipt: assets.goShim,
			wasmReceipt: assets.wasm
		});
		const legacyFingerprint = computeLegacyAwkRuntimeFingerprint({
			'goawk.wasm': wasmBytes,
			[LEGACY_WORKER_FILE]: legacyWorkerBytes,
			'runtime-build.json': runtimeBuildBytes,
			'wasm_exec.js': goShimBytes
		});
		const legacyManifestSource = `${JSON.stringify(
			{
				format: 'wasm-awk-runtime-manifest-v1',
				runtime: 'GoAWK',
				goVersion: runtimeBuild.goVersion,
				goawkVersion: runtimeBuild.goawkVersion,
				fingerprint: legacyFingerprint,
				files: SOURCE_ASSET_PATHS
			},
			null,
			2
		)}\n`;
		const versionModuleSource = createAppVersionModule(profile);
		const lspVersionModuleSource = createLspVersionModule(profile);
		const staticOutputs = new Map([
			[LEGACY_WASM_STORAGE_FILE, compressedWasmBytes],
			[VERIFIED_WASM_STORAGE_FILE, compressedWasmBytes],
			[LEGACY_WORKER_FILE, legacyWorkerBytes],
			[VERIFIED_WORKER_FILE, workerBytes],
			['runtime-build.json', runtimeBuildBytes],
			[LEGACY_MANIFEST_FILE, Buffer.from(legacyManifestSource, 'utf8')],
			[MANIFEST_FILE, manifestBytes],
			['wasm_exec.js', goShimBytes]
		]);

		const transactionId = randomUUID();
		const publications = createPublications(basePublications, transactionId);
		for (const publication of publications) {
			publication.hadTarget = !!(await lstat(publication.target).catch(() => null));
			if (
				(await lstat(publication.staging).catch(() => null)) ||
				(await lstat(publication.previous).catch(() => null))
			) {
				throw new Error('wasm-awk transaction sibling already exists');
			}
		}
		const marker = {
			format: SYNC_TRANSACTION_FORMAT,
			transactionId,
			phase: 'preparing',
			publications
		};
		await writeTransactionMarker(transactionMarkerPath, marker);
		const [targetPublication, versionPublication, lspVersionPublication] = publications;
		try {
			await mkdir(targetPublication.staging);
			await Promise.all([
				...Array.from(staticOutputs, ([fileName, bytes]) =>
					writeDurableExclusiveFile(path.join(targetPublication.staging, fileName), bytes)
				),
				writeDurableExclusiveFile(versionPublication.staging, versionModuleSource),
				writeDurableExclusiveFile(lspVersionPublication.staging, lspVersionModuleSource)
			]);
			await Promise.all([
				syncDirectory(targetPublication.staging),
				syncDirectory(path.dirname(targetPublication.staging)),
				syncDirectory(path.dirname(versionPublication.staging)),
				syncDirectory(path.dirname(lspVersionPublication.staging))
			]);
			await assertExactStaticInventory(targetPublication.staging);
			for (const [fileName, expectedBytes] of staticOutputs) {
				const installedBytes = await readFile(
					path.join(targetPublication.staging, fileName)
				);
				if (!installedBytes.equals(expectedBytes)) {
					throw new Error(
						`wasm-awk temporary installation failed verification for ${fileName}`
					);
				}
			}
			if (
				(await readFile(versionPublication.staging, 'utf8')) !== versionModuleSource ||
				(await readFile(lspVersionPublication.staging, 'utf8')) !== lspVersionModuleSource
			) {
				throw new Error('wasm-awk temporary generated profiles failed verification');
			}
			marker.phase = 'prepared';
			await writeTransactionMarker(transactionMarkerPath, marker);
			for (const publication of publications) {
				if (publication.hadTarget) {
					await renamePath(publication.target, publication.previous);
					await syncDirectory(path.dirname(publication.target));
				}
				await renamePath(publication.staging, publication.target);
				await syncDirectory(path.dirname(publication.target));
			}
			marker.phase = 'committed';
			await writeTransactionMarker(transactionMarkerPath, marker);
			await recoverTransaction(transactionMarkerPath, basePublications);
		} catch (error) {
			try {
				await recoverTransaction(transactionMarkerPath, basePublications);
			} catch (recoveryError) {
				throw new AggregateError(
					[error, recoveryError],
					'wasm-awk publication failed and transaction recovery was incomplete'
				);
			}
			throw error;
		}
		result = {
			sourceDir: resolvedSourceDir,
			targetDir,
			fingerprint,
			versionModulePath,
			lspVersionModulePath,
			profile
		};
	} catch (error) {
		operationError = error;
	}
	try {
		await releaseSyncLock(syncLock);
	} catch (lockError) {
		operationError =
			operationError === undefined
				? lockError
				: new AggregateError(
						[operationError, lockError],
						'wasm-awk sync failed and its exclusive lock could not be released'
					);
	}
	if (operationError !== undefined) throw operationError;
	if (!result) throw new Error('wasm-awk sync did not produce a publication result');
	return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmAwkAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-awk from ${sourceDir} to ${targetDir}`);
}
