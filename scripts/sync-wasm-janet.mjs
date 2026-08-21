import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, '..', 'janet-wasm', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-janet');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-janet-runner-worker.js'
);
const DEFAULT_RUNNER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-build',
	'wasm-janet-runner.c'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmJanetVersion.ts'
);
const DEFAULT_LSP_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'lsp',
	'src',
	'bundledJanetRuntime.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-janet-assets.lock.json');

export const JANET_MANIFEST_FORMAT = 'wasm-janet-runtime-manifest-v2';
export const JANET_FINGERPRINT_DOMAIN = 'wasm-idle:janet-runtime-manifest:v2';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const BUILD_METADATA_FILE = 'runtime-build.json';
const WORKER_FILE = 'runner-worker.js';
const LICENSE_FILE = 'LICENSE.txt';
const WORKER_IDENTITY_PLACEHOLDERS = new Map([
	['profileId', '__WASM_IDLE_JANET_PROFILE_ID__'],
	['artifactRevision', '__WASM_IDLE_JANET_ARTIFACT_REVISION__'],
	['janetVersion', '__WASM_IDLE_JANET_VERSION__'],
	['emscriptenVersion', '__WASM_IDLE_JANET_EMSCRIPTEN_VERSION__'],
	['manifestFingerprint', '__WASM_IDLE_JANET_MANIFEST_FINGERPRINT__']
]);
/** @type {readonly ('janet.js' | 'janet.wasm')[]} */
const LOGICAL_ASSETS = ['janet.js', 'janet.wasm'];
const BUILD_OPTIONS = [
	'ENVIRONMENT=worker',
	'MODULARIZE=1',
	'EXPORT_ES6=1',
	'FORCE_FILESYSTEM=1',
	'INVOKE_RUN=0',
	'EXIT_RUNTIME=1',
	'JANET_REDUCED_OS'
];
const EXPECTED_PROFILE_ID = 'janet-1.41.3-dev-emscripten-3.1.8-wasm-idle-d647850c';
const EXPECTED_LICENSE_EXPRESSION = 'MIT';
const EXPECTED_ARTIFACT = Object.freeze({
	kind: 'opaque-vendored',
	repository: 'https://github.com/seo-rii/wasm-idle.git',
	revision: 'd647850cd6448b457f778d01c304358aefa5244b',
	path: 'static/wasm-janet',
	provenance: 'legacy-import-unrecorded',
	verifiedBuildInput: false
});
const EXPECTED_COMPONENTS = Object.freeze({
	janet: Object.freeze({
		version: '1.41.3-dev',
		repository: 'https://github.com/janet-lang/janet.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence: 'embedded runtime version string'
	}),
	emscripten: Object.freeze({
		version: '3.1.8',
		repository: 'https://github.com/emscripten-core/emscripten.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence: 'unverified metadata copied from the initial vendored runtime manifest'
	})
});
const EXPECTED_LOCK_KEYS = Object.freeze(
	[
		'artifact',
		'assets',
		'build',
		'components',
		'license',
		'licenseExpression',
		'profileId',
		'schemaVersion'
	].sort()
);
const EXPECTED_BUILD_KEYS = Object.freeze(['options', 'runner']);
const EXPECTED_RUNNER_KEYS = Object.freeze(['bytes', 'path', 'sha256', 'verifiedBuildInput']);
const EXPECTED_LICENSE_KEYS = Object.freeze(['bytes', 'path', 'sha256', 'spdx']);
const EXPECTED_ASSET_KEYS = Object.freeze(['bytes', 'path', 'sha256']);
const MEDIA_TYPE_BY_ASSET = Object.freeze({
	'janet.js': 'text/javascript',
	'janet.wasm': 'application/wasm'
});
/** @typedef {{ bytes: number; sha256: string }} Receipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} LogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'identity' | 'gzip'; size: number; sha256: string }} StorageAsset */
/** @typedef {{ target: string; temporary: string; previous: string; hadTarget: boolean; backedUp: boolean; published: boolean }} Publication */

/**
 * @typedef {object} SyncWasmJanetOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [runnerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [lspVersionModulePath]
 * @property {string} [licenseFile]
 * @property {string} [lockFilePath]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
 */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} value @param {readonly string[]} expectedKeys */
const hasExactKeys = (value, expectedKeys) =>
	isObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys);

/** @param {unknown} value @returns {string} */
function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (isObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	const primitive = JSON.stringify(value);
	if (primitive === undefined) throw new Error('Janet manifest contains a non-JSON value');
	return primitive;
}

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

/** @param {string} filePath */
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
		throw new Error(`wasm-janet input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-janet input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!hasExactKeys(value, EXPECTED_LOCK_KEYS) ||
		value.schemaVersion !== 1 ||
		value.profileId !== EXPECTED_PROFILE_ID ||
		value.licenseExpression !== EXPECTED_LICENSE_EXPRESSION ||
		!isObject(value.artifact) ||
		canonicalJson(value.artifact) !== canonicalJson(EXPECTED_ARTIFACT) ||
		!isObject(value.components) ||
		canonicalJson(value.components) !== canonicalJson(EXPECTED_COMPONENTS) ||
		!hasExactKeys(value.build, EXPECTED_BUILD_KEYS) ||
		!Array.isArray(value.build.options) ||
		JSON.stringify(value.build.options) !== JSON.stringify(BUILD_OPTIONS) ||
		!hasExactKeys(value.build.runner, EXPECTED_RUNNER_KEYS) ||
		value.build.runner.path !== 'scripts/runtime-build/wasm-janet-runner.c' ||
		value.build.runner.verifiedBuildInput !== false ||
		!hasExactKeys(value.license, EXPECTED_LICENSE_KEYS) ||
		value.license.path !== LICENSE_FILE ||
		value.license.spdx !== 'MIT' ||
		!Array.isArray(value.assets) ||
		value.assets.length !== LOGICAL_ASSETS.length
	) {
		throw new Error('wasm-janet input lock has invalid provenance metadata');
	}
	const runnerReceipt = validateReceipt(value.build.runner, 'wasm-janet runner source');
	const licenseReceipt = validateReceipt(value.license, 'wasm-janet license');
	const receipts = new Map();
	for (const candidate of value.assets) {
		if (
			!hasExactKeys(candidate, EXPECTED_ASSET_KEYS) ||
			!LOGICAL_ASSETS.includes(candidate.path) ||
			receipts.has(candidate.path)
		) {
			throw new Error('wasm-janet input lock has an invalid or duplicate asset path');
		}
		receipts.set(candidate.path, validateReceipt(candidate, `wasm-janet ${candidate.path}`));
	}
	if (LOGICAL_ASSETS.some((asset) => !receipts.has(asset))) {
		throw new Error('wasm-janet input lock is missing a required asset');
	}
	return Object.freeze({
		profileId: value.profileId,
		licenseExpression: value.licenseExpression,
		artifact: EXPECTED_ARTIFACT,
		components: EXPECTED_COMPONENTS,
		build: Object.freeze({
			options: Object.freeze([...value.build.options]),
			runner: Object.freeze({
				path: value.build.runner.path,
				verifiedBuildInput: false,
				...runnerReceipt
			})
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
 * @param {{ profileId: string; licenseExpression: string; artifact: Record<string, unknown>; components: Record<string, unknown>; build: Record<string, unknown>; license: { path: string; spdx: string; size: number; sha256: string }; metadata: { path: string; mediaType: string; size: number; sha256: string }; assets: LogicalAsset[]; storage: StorageAsset[] }} manifest
 */
export function computeJanetRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${JANET_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${JANET_MANIFEST_FORMAT}\n`);
	hash.update('runtime\0janet-lang-janet\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(`licenseExpression\0${manifest.licenseExpression}\n`);
	hash.update(`artifact\0${canonicalJson(manifest.artifact)}\n`);
	hash.update(`components\0${canonicalJson(manifest.components)}\n`);
	hash.update(`build\0${canonicalJson(manifest.build)}\n`);
	hash.update(
		`license\0${manifest.license.path}\0${manifest.license.spdx}\0${manifest.license.size}\0${manifest.license.sha256}\n`
	);
	hash.update(
		`metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`
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
	if (process.env.WASM_JANET_SOURCE_DIR) {
		return path.resolve(process.env.WASM_JANET_SOURCE_DIR);
	}
	const configuredSourceDir = DEFAULT_SOURCE_DIR;
	if (
		(await isRegularFile(path.join(configuredSourceDir, 'janet.js'))) &&
		(await isRegularFile(path.join(configuredSourceDir, 'janet.wasm')))
	) {
		return configuredSourceDir;
	}
	if (
		(await isRegularFile(path.join(targetDir, 'janet.js'))) &&
		((await isRegularFile(path.join(targetDir, 'janet.wasm'))) ||
			(await isRegularFile(path.join(targetDir, 'janet.wasm.gz.bin'))) ||
			(await isRegularFile(path.join(targetDir, 'janet.wasm.gz'))))
	) {
		return null;
	}
	throw new Error(
		'Janet runtime assets were not found. Set WASM_JANET_SOURCE_DIR or pass a source dir containing janet.js and janet.wasm.'
	);
}

/** @param {string | null} sourceDir @param {string} targetDir @param {string | undefined} licenseFile */
async function resolveLicenseFile(sourceDir, targetDir, licenseFile) {
	if (licenseFile) return path.resolve(licenseFile);
	if (process.env.WASM_JANET_LICENSE_FILE) {
		return path.resolve(process.env.WASM_JANET_LICENSE_FILE);
	}
	const candidates = sourceDir
		? [
				path.join(sourceDir, LICENSE_FILE),
				path.join(sourceDir, 'LICENSE'),
				path.join(sourceDir, '..', 'LICENSE')
			]
		: [path.join(targetDir, LICENSE_FILE)];
	for (const candidate of candidates) {
		const resolved = path.resolve(String(candidate));
		if (await isRegularFile(resolved)) return resolved;
	}
	throw new Error('Janet MIT license file was not found or is not a regular file.');
}

/** @param {SyncWasmJanetOptions} [options] */
export async function syncWasmJanetAssets(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
	const runnerSourcePath = path.resolve(options.runnerSourcePath || DEFAULT_RUNNER_SOURCE_PATH);
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
	const renamePath = options.renamePath || rename;
	const lock = await readInputLock(lockFilePath);
	const resolvedSourceDir = await resolveSourceDir(options.sourceDir, targetDir);
	const licenseFilePath = await resolveLicenseFile(
		resolvedSourceDir,
		targetDir,
		options.licenseFile
	);

	for (const [targetPath, kind, label] of [
		[targetDir, 'directory', 'runtime target'],
		[versionModulePath, 'file', 'application version module'],
		[lspVersionModulePath, 'file', 'LSP version module']
	]) {
		const stats = await lstat(targetPath).catch(() => null);
		if (stats && !(kind === 'directory' ? stats.isDirectory() : stats.isFile())) {
			throw new Error(`wasm-janet ${label} has the wrong file type: ${targetPath}`);
		}
	}
	for (const [filePath, label] of [
		[workerSourcePath, 'worker source'],
		[runnerSourcePath, 'runner source'],
		[lockFilePath, 'input lock'],
		[licenseFilePath, 'license source']
	]) {
		if (!(await isRegularFile(filePath))) {
			throw new Error(`wasm-janet ${label} must be a regular file: ${filePath}`);
		}
	}

	const outputPaths = [targetDir, versionModulePath, lspVersionModulePath];
	const inputPaths = [workerSourcePath, runnerSourcePath, lockFilePath];
	if (resolvedSourceDir) inputPaths.push(resolvedSourceDir, licenseFilePath);
	const outputBoundaries = await Promise.all(outputPaths.map(resolveBoundaryPath));
	const inputBoundaries = await Promise.all(inputPaths.map(resolveBoundaryPath));
	for (let left = 0; left < outputBoundaries.length; left += 1) {
		for (let right = left + 1; right < outputBoundaries.length; right += 1) {
			if (pathsOverlap(outputBoundaries[left], outputBoundaries[right])) {
				throw new Error('wasm-janet publication targets must not overlap');
			}
		}
		for (const inputBoundary of inputBoundaries) {
			if (pathsOverlap(outputBoundaries[left], inputBoundary)) {
				throw new Error('wasm-janet publication targets must not overlap their inputs');
			}
		}
	}

	const sourceBase = resolvedSourceDir || targetDir;
	const modulePath = path.join(sourceBase, 'janet.js');
	const rawWasmPath = path.join(sourceBase, 'janet.wasm');
	const canonicalGzipWasmPath = path.join(sourceBase, 'janet.wasm.gz.bin');
	const legacyGzipWasmPath = path.join(sourceBase, 'janet.wasm.gz');
	if (!(await isRegularFile(modulePath))) {
		throw new Error(`Janet runtime module must be a regular file: ${modulePath}`);
	}
	const hasRawWasm = await isRegularFile(rawWasmPath);
	const gzipWasmPath = (await isRegularFile(canonicalGzipWasmPath))
		? canonicalGzipWasmPath
		: legacyGzipWasmPath;
	if (!hasRawWasm && !(await isRegularFile(gzipWasmPath))) {
		throw new Error(`Janet runtime Wasm must be a regular file: ${rawWasmPath}`);
	}
	const moduleReceipt = lock.receipts.get('janet.js');
	const wasmReceipt = lock.receipts.get('janet.wasm');
	const [moduleStats, wasmStats, licenseStats, workerStats, runnerStats] = await Promise.all([
		lstat(modulePath),
		lstat(hasRawWasm ? rawWasmPath : gzipWasmPath),
		lstat(licenseFilePath),
		lstat(workerSourcePath),
		lstat(runnerSourcePath)
	]);
	if (
		moduleStats.size !== moduleReceipt.bytes ||
		(hasRawWasm
			? wasmStats.size !== wasmReceipt.bytes
			: wasmStats.size <= 0 || wasmStats.size > wasmReceipt.bytes) ||
		licenseStats.size !== lock.license.bytes ||
		runnerStats.size !== lock.build.runner.bytes ||
		workerStats.size <= 0 ||
		workerStats.size > 8 * 1024 * 1024
	) {
		throw new Error('Janet runtime input size does not match the input lock or producer limit');
	}
	const [moduleBytes, storedWasmBytes, licenseBytes, workerBytes, runnerBytes] =
		await Promise.all([
			readFile(modulePath),
			readFile(hasRawWasm ? rawWasmPath : gzipWasmPath),
			readFile(licenseFilePath),
			readFile(workerSourcePath),
			readFile(runnerSourcePath)
		]);
	let wasmBytes;
	try {
		wasmBytes = hasRawWasm
			? storedWasmBytes
			: gunzipSync(storedWasmBytes, { maxOutputLength: wasmReceipt.bytes });
	} catch {
		throw new Error('Janet runtime Wasm gzip source is invalid');
	}
	let moduleSource;
	try {
		moduleSource = new TextDecoder('utf-8', { fatal: true }).decode(moduleBytes);
	} catch {
		throw new Error('janet.js is not valid UTF-8 JavaScript');
	}
	if (
		!moduleSource.includes('export default Module') ||
		!moduleSource.includes('callMain') ||
		!moduleSource.includes('FS.init') ||
		!moduleSource.includes('Module["wasmBinary"]')
	) {
		throw new Error(
			'janet.js does not expose the expected verified Emscripten module contract.'
		);
	}
	if (
		wasmBytes.byteLength < 8 ||
		wasmBytes[0] !== 0x00 ||
		wasmBytes[1] !== 0x61 ||
		wasmBytes[2] !== 0x73 ||
		wasmBytes[3] !== 0x6d
	) {
		throw new Error('janet.wasm does not have a WebAssembly module header');
	}
	if (!wasmBytes.includes(Buffer.from('1.41.3-dev', 'utf8'))) {
		throw new Error('janet.wasm does not contain the locked Janet version evidence');
	}
	const logicalBytes = new Map([
		['janet.js', moduleBytes],
		['janet.wasm', wasmBytes]
	]);
	for (const [assetPath, bytes] of logicalBytes) {
		const receipt = lock.receipts.get(assetPath);
		if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
			throw new Error(`Janet runtime source ${assetPath} does not match the input lock`);
		}
	}
	if (
		licenseBytes.byteLength !== lock.license.bytes ||
		sha256(licenseBytes) !== lock.license.sha256
	) {
		throw new Error('Janet runtime license does not match the input lock');
	}
	if (
		runnerBytes.byteLength !== lock.build.runner.bytes ||
		sha256(runnerBytes) !== lock.build.runner.sha256
	) {
		throw new Error('Janet runner source does not match the input lock');
	}

	const storedWasm = gzipSync(wasmBytes, { level: 9 });
	/** @type {LogicalAsset[]} */
	const assets = LOGICAL_ASSETS.map((assetPath) => {
		const bytes = logicalBytes.get(assetPath);
		if (!bytes) {
			throw new Error(`Janet runtime source ${assetPath} is missing after verification`);
		}
		return {
			path: assetPath,
			mediaType: MEDIA_TYPE_BY_ASSET[assetPath],
			size: bytes.byteLength,
			sha256: sha256(bytes)
		};
	});
	/** @type {StorageAsset[]} */
	const storage = [
		{
			path: 'janet.js',
			logicalPath: 'janet.js',
			encoding: 'identity',
			size: moduleBytes.byteLength,
			sha256: sha256(moduleBytes)
		},
		{
			path: 'janet.wasm.gz.bin',
			logicalPath: 'janet.wasm',
			encoding: 'gzip',
			size: storedWasm.byteLength,
			sha256: sha256(storedWasm)
		}
	];
	const license = {
		path: lock.license.path,
		spdx: lock.license.spdx,
		size: licenseBytes.byteLength,
		sha256: sha256(licenseBytes)
	};
	const runtimeBuild = Object.freeze({
		format: 'wasm-janet-runtime-build-v1',
		runtime: 'janet-lang-janet',
		profileId: lock.profileId,
		provenanceLevel: 'opaque-vendored',
		artifact: lock.artifact,
		components: lock.components,
		build: lock.build
	});
	const metadataBytes = Buffer.from(`${JSON.stringify(runtimeBuild, null, 2)}\n`, 'utf8');
	const metadata = {
		path: BUILD_METADATA_FILE,
		mediaType: 'application/json',
		size: metadataBytes.byteLength,
		sha256: sha256(metadataBytes)
	};
	const fingerprint = computeJanetRuntimeFingerprint({
		profileId: lock.profileId,
		licenseExpression: lock.licenseExpression,
		artifact: lock.artifact,
		components: lock.components,
		build: lock.build,
		license,
		metadata,
		assets,
		storage
	});
	let publishedWorkerSource;
	try {
		publishedWorkerSource = new TextDecoder('utf-8', { fatal: true }).decode(workerBytes);
	} catch {
		throw new Error('wasm-janet runner worker is not valid UTF-8 JavaScript');
	}
	const workerIdentity = Object.freeze({
		profileId: lock.profileId,
		artifactRevision: lock.artifact.revision,
		janetVersion: lock.components.janet.version,
		emscriptenVersion: lock.components.emscripten.version,
		manifestFingerprint: fingerprint
	});
	for (const [key, expectedValue] of Object.entries(workerIdentity)) {
		const expected = `${key}: '${expectedValue}'`;
		const placeholderValue = WORKER_IDENTITY_PLACEHOLDERS.get(key);
		if (!placeholderValue) throw new Error(`wasm-janet runner identity key is unknown: ${key}`);
		const placeholder = `${key}: '${placeholderValue}'`;
		const expectedCount = publishedWorkerSource.split(expected).length - 1;
		const placeholderCount = publishedWorkerSource.split(placeholder).length - 1;
		if (expectedCount === 1 && placeholderCount === 0) continue;
		if (expectedCount !== 0 || placeholderCount !== 1) {
			throw new Error(
				`wasm-janet runner must pin exactly one generated ${key} identity value`
			);
		}
		publishedWorkerSource = publishedWorkerSource.replace(placeholder, expected);
	}
	const publishedWorkerBytes = Buffer.from(publishedWorkerSource, 'utf8');
	const workerReceipt = Object.freeze({
		bytes: publishedWorkerBytes.byteLength,
		sha256: sha256(publishedWorkerBytes)
	});
	const manifest = {
		format: JANET_MANIFEST_FORMAT,
		runtime: 'janet-lang-janet',
		profileId: lock.profileId,
		fingerprint,
		licenseExpression: lock.licenseExpression,
		artifact: lock.artifact,
		components: lock.components,
		build: lock.build,
		license,
		metadata,
		assets,
		storage
	};
	const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	const manifestReceipt = Object.freeze({
		bytes: manifestBytes.byteLength,
		sha256: sha256(manifestBytes)
	});
	const logicalReceiptByPath = new Map(assets.map((asset) => [asset.path, asset]));
	const storageReceiptByLogicalPath = new Map(storage.map((asset) => [asset.logicalPath, asset]));
	/** @param {string} logicalPath */
	const runtimeReceipt = (logicalPath) => {
		const logical = logicalReceiptByPath.get(logicalPath);
		const stored = storageReceiptByLogicalPath.get(logicalPath);
		if (!logical || !stored) {
			throw new Error(`wasm-janet runtime receipt is missing for ${logicalPath}`);
		}
		if (stored.encoding === 'identity') {
			return Object.freeze({
				bytes: stored.size,
				sha256: stored.sha256
			});
		}
		return Object.freeze({
			bytes: stored.size,
			sha256: stored.sha256,
			uncompressedBytes: logical.size,
			uncompressedSha256: logical.sha256
		});
	};
	const runtimeProfile = Object.freeze({
		...workerIdentity,
		manifestReceipt,
		javascriptReceipt: runtimeReceipt('janet.js'),
		wasmReceipt: runtimeReceipt('janet.wasm')
	});
	const legacyManifest = {
		format: 'wasm-janet-runtime-manifest-v1',
		runtime: 'janet-lang-janet',
		build: { emscripten: '3.1.8', options: BUILD_OPTIONS, runner: lock.build.runner.path },
		fingerprint: fingerprint.slice(0, 16),
		files: [LICENSE_FILE, 'janet.js', 'janet.wasm.gz']
	};
	const serializedRuntimeProfile = JSON.stringify(runtimeProfile, null, '\t')
		.replaceAll('"', "'")
		.replace(/^(\s*)'([A-Za-z_$][A-Za-z0-9_$]*)':/gmu, '$1$2:');
	const versionModuleSource = `export const WASM_JANET_RUNTIME_PROFILE = ${serializedRuntimeProfile} as const;\nexport const WASM_JANET_RUNTIME_BUNDLE = Object.freeze({\n\tprofile: WASM_JANET_RUNTIME_PROFILE,\n\tworkerReceipt: {\n\t\tbytes: ${workerReceipt.bytes},\n\t\tsha256: '${workerReceipt.sha256}'\n\t}\n});\nexport const WASM_JANET_ASSET_VERSION = WASM_JANET_RUNTIME_PROFILE.manifestFingerprint;\nexport const WASM_JANET_RUNNER_RECEIPT = WASM_JANET_RUNTIME_BUNDLE.workerReceipt;\n`;
	const lspVersionModuleSource = `export const BUNDLED_JANET_RUNTIME_PROFILE = ${serializedRuntimeProfile} as const;\nexport const BUNDLED_JANET_RUNTIME_BUNDLE = Object.freeze({\n\tprofile: BUNDLED_JANET_RUNTIME_PROFILE,\n\tworkerReceipt: {\n\t\tbytes: ${workerReceipt.bytes},\n\t\tsha256: '${workerReceipt.sha256}'\n\t}\n});\nexport const BUNDLED_JANET_MANIFEST_FINGERPRINT = BUNDLED_JANET_RUNTIME_PROFILE.manifestFingerprint;\nexport const BUNDLED_JANET_RUNNER_RECEIPT = BUNDLED_JANET_RUNTIME_BUNDLE.workerReceipt;\n`;
	const expectedFiles = [
		LICENSE_FILE,
		'janet.js',
		'janet.wasm.gz',
		'janet.wasm.gz.bin',
		BUILD_METADATA_FILE,
		LEGACY_MANIFEST_FILE,
		MANIFEST_FILE,
		WORKER_FILE
	].sort();

	await Promise.all([
		mkdir(path.dirname(targetDir), { recursive: true }),
		mkdir(path.dirname(versionModulePath), { recursive: true }),
		mkdir(path.dirname(lspVersionModulePath), { recursive: true })
	]);
	const publicationId = randomUUID();
	/** @type {Publication[]} */
	const publications = [targetDir, versionModulePath, lspVersionModulePath].map((target) => ({
		target,
		temporary: path.join(
			path.dirname(target),
			`.${path.basename(target)}.staging-${publicationId}`
		),
		previous: path.join(
			path.dirname(target),
			`.${path.basename(target)}.previous-${publicationId}`
		),
		hadTarget: false,
		backedUp: false,
		published: false
	}));
	for (const publication of publications) {
		await rm(publication.temporary, { recursive: true, force: true });
	}
	await mkdir(publications[0].temporary, { recursive: true });
	try {
		await Promise.all([
			writeFile(path.join(publications[0].temporary, 'janet.js'), moduleBytes),
			writeFile(path.join(publications[0].temporary, 'janet.wasm.gz'), storedWasm),
			writeFile(path.join(publications[0].temporary, 'janet.wasm.gz.bin'), storedWasm),
			writeFile(path.join(publications[0].temporary, LICENSE_FILE), licenseBytes),
			writeFile(path.join(publications[0].temporary, WORKER_FILE), publishedWorkerBytes),
			writeFile(path.join(publications[0].temporary, BUILD_METADATA_FILE), metadataBytes),
			writeFile(
				path.join(publications[0].temporary, LEGACY_MANIFEST_FILE),
				`${JSON.stringify(legacyManifest, null, 2)}\n`,
				'utf8'
			),
			writeFile(path.join(publications[0].temporary, MANIFEST_FILE), manifestBytes),
			writeFile(publications[1].temporary, versionModuleSource, 'utf8'),
			writeFile(publications[2].temporary, lspVersionModuleSource, 'utf8')
		]);
		const installedEntries = await readdir(publications[0].temporary, { withFileTypes: true });
		if (
			installedEntries.some((entry) => !entry.isFile()) ||
			JSON.stringify(installedEntries.map((entry) => entry.name).sort()) !==
				JSON.stringify(expectedFiles)
		) {
			throw new Error('wasm-janet temporary installation has unexpected files');
		}
		const installedManifest = JSON.parse(
			await readFile(path.join(publications[0].temporary, MANIFEST_FILE), 'utf8')
		);
		const installedWorkerBytes = await readFile(
			path.join(publications[0].temporary, WORKER_FILE)
		);
		const installedModuleBytes = await readFile(
			path.join(publications[0].temporary, 'janet.js')
		);
		const installedStoredWasmBytes = await readFile(
			path.join(publications[0].temporary, 'janet.wasm.gz.bin')
		);
		const installedLegacyStoredWasmBytes = await readFile(
			path.join(publications[0].temporary, 'janet.wasm.gz')
		);
		const installedLogicalWasmBytes = gunzipSync(installedStoredWasmBytes);
		const installedLicenseBytes = await readFile(
			path.join(publications[0].temporary, LICENSE_FILE)
		);
		const installedMetadataBytes = await readFile(
			path.join(publications[0].temporary, BUILD_METADATA_FILE)
		);
		const installedLegacyManifest = JSON.parse(
			await readFile(path.join(publications[0].temporary, LEGACY_MANIFEST_FILE), 'utf8')
		);
		const installedVersionModuleSource = await readFile(publications[1].temporary, 'utf8');
		const installedLspVersionModuleSource = await readFile(publications[2].temporary, 'utf8');
		if (
			JSON.stringify(installedManifest) !== JSON.stringify(manifest) ||
			computeJanetRuntimeFingerprint(installedManifest) !== fingerprint ||
			installedWorkerBytes.byteLength !== workerReceipt.bytes ||
			sha256(installedWorkerBytes) !== workerReceipt.sha256 ||
			installedModuleBytes.byteLength !== assets[0].size ||
			sha256(installedModuleBytes) !== assets[0].sha256 ||
			installedModuleBytes.byteLength !== storage[0].size ||
			sha256(installedModuleBytes) !== storage[0].sha256 ||
			installedStoredWasmBytes.byteLength !== storage[1].size ||
			sha256(installedStoredWasmBytes) !== storage[1].sha256 ||
			!installedLegacyStoredWasmBytes.equals(installedStoredWasmBytes) ||
			installedLogicalWasmBytes.byteLength !== assets[1].size ||
			sha256(installedLogicalWasmBytes) !== assets[1].sha256 ||
			installedLicenseBytes.byteLength !== license.size ||
			sha256(installedLicenseBytes) !== license.sha256 ||
			installedMetadataBytes.byteLength !== metadata.size ||
			sha256(installedMetadataBytes) !== metadata.sha256 ||
			JSON.stringify(JSON.parse(installedMetadataBytes.toString('utf8'))) !==
				JSON.stringify(runtimeBuild) ||
			JSON.stringify(installedLegacyManifest) !== JSON.stringify(legacyManifest) ||
			installedVersionModuleSource !== versionModuleSource ||
			installedLspVersionModuleSource !== lspVersionModuleSource
		) {
			throw new Error('wasm-janet temporary installation failed receipt verification');
		}

		for (const publication of publications) {
			publication.hadTarget = !!(await lstat(publication.target).catch(() => null));
		}
		try {
			for (const publication of publications) {
				if (publication.hadTarget) {
					await renamePath(publication.target, publication.previous);
					publication.backedUp = true;
				}
				await renamePath(publication.temporary, publication.target);
				publication.published = true;
			}
		} catch (error) {
			const rollbackErrors = [];
			for (const publication of [...publications].reverse()) {
				if (publication.published) {
					try {
						await rm(publication.target, { recursive: true, force: true });
					} catch (rollbackError) {
						rollbackErrors.push(rollbackError);
					}
				}
				if (publication.backedUp && (await lstat(publication.previous).catch(() => null))) {
					try {
						await rename(publication.previous, publication.target);
					} catch (rollbackError) {
						rollbackErrors.push(rollbackError);
					}
				}
			}
			if (rollbackErrors.length) {
				throw new AggregateError(
					[error, ...rollbackErrors],
					'wasm-janet publication failed and rollback was incomplete'
				);
			}
			throw error;
		}
		for (const publication of publications) {
			if (publication.hadTarget) {
				await rm(publication.previous, { recursive: true, force: true });
			}
		}
	} finally {
		for (const publication of publications) {
			await rm(publication.temporary, { recursive: true, force: true });
		}
	}

	return {
		sourceDir: resolvedSourceDir || targetDir,
		targetDir,
		fingerprint,
		versionModulePath,
		lspVersionModulePath,
		workerReceipt,
		runtimeProfile
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmJanetAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-janet from ${result.sourceDir} to ${result.targetDir}`);
}
