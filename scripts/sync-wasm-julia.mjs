import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	lstat,
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-julia');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-julia-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmJuliaVersion.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-julia-assets.lock.json');

export const JULIA_MANIFEST_FORMAT = 'wasm-julia-runtime-manifest-v2';
export const JULIA_FINGERPRINT_DOMAIN = 'wasm-idle:julia-runtime-manifest:v2';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const BUILD_METADATA_FILE = 'runtime-build.json';
const WORKER_FILE = 'runner-worker.js';
const LICENSE_FILE = 'LICENSE.md';
const DOCUMENTATION_FILE = 'readme.md';
/** @type {readonly ('julia.js' | 'julia.wasm' | 'julia.data')[]} */
const LOGICAL_ASSETS = ['julia.js', 'julia.wasm', 'julia.data'];
const EXPECTED_PROFILE_ID = 'julia-1.3.0-dev.560-chriskoch-npm-1.0.4-22a55e0d';
const EXPECTED_LICENSE_EXPRESSION = 'MIT AND LicenseRef-Julia-Third-Party';
const MAX_SOURCE_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_WORKER_BYTES = 8 * 1024 * 1024;
const MAX_TARBALL_BYTES = 16 * 1024 * 1024;
const TARBALL_TIMEOUT_MS = 60_000;
const EXPECTED_ARTIFACT = Object.freeze({
	kind: 'opaque-npm-prebuilt',
	packageName: '@chriskoch/julia-wasm',
	packageVersion: '1.0.4',
	packageSpec: '@chriskoch/julia-wasm@1.0.4',
	registryUrl: 'https://registry.npmjs.org/',
	tarballUrl: 'https://registry.npmjs.org/@chriskoch/julia-wasm/-/julia-wasm-1.0.4.tgz',
	publishedAt: '2020-12-05T19:33:59.354Z',
	repository: 'https://github.com/chris-koch-penn/polylang.git',
	sourceRevision: 'unrecorded',
	importedByCommit: 'c9529ad7b7ecfaea8a55c0fe5693c4d07cd0ae26',
	npmGitHead: 'unrecorded',
	verifiedBuildInput: false,
	bytes: 12_406_918,
	sha256: '03d0e93196dbeec55946bbe447d4c9b2d244dba15fdd882c750fb33598bf640f',
	sha512: '86b957b1b800430c76542eae9959c528f540ad94fbaa34c9edaecc245497216b9cbc353f56aac392db4ddba81aa78a354383a3a11924688b0df40307ce146fc4',
	npmIntegrity:
		'sha512-hrlXsbgAQwx2VC6umVnFKPVArZT7qjTJ7a7MJFSXIWucvDU/VqrDkttN26gap4o1Q4OjoRkkaIsN9AMHzhRvxA==',
	npmShasum: '22a55e0d10ad50f2999d059b325abe4d95cf17b3'
});
const EXPECTED_COMPONENTS = Object.freeze({
	distribution: Object.freeze({
		version: '1.0.4',
		repository: 'https://github.com/chris-koch-penn/polylang.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence:
			'content-locked npm package; source revision and build recipe are not published in package metadata'
	}),
	julia: Object.freeze({
		version: '1.3.0-DEV.560',
		repository: 'https://github.com/JuliaLang/julia.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence:
			'exact VERSION observed in the real Chromium runtime; the binary embeds the matching 1.3.0-DEV family string; binary-to-source attestation is unavailable'
	}),
	emscripten: Object.freeze({
		version: 'unrecorded',
		repository: 'https://github.com/emscripten-core/emscripten.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence: 'opaque prebuilt Emscripten loader without recorded toolchain revision'
	})
});
const EXPECTED_MEDIA_TYPES = Object.freeze({
	'julia.js': 'text/javascript',
	'julia.wasm': 'application/wasm',
	'julia.data': 'application/octet-stream'
});
const EXPECTED_LOCK_KEYS = Object.freeze(
	[
		'artifact',
		'assets',
		'components',
		'documentation',
		'license',
		'licenseExpression',
		'packageJson',
		'profileId',
		'schemaVersion'
	].sort()
);
const EXPECTED_ASSET_KEYS = Object.freeze(['bytes', 'mediaType', 'path', 'sha256']);
const EXPECTED_PACKAGE_KEYS = Object.freeze(['bytes', 'path', 'sha256']);
const EXPECTED_LICENSE_KEYS = Object.freeze(['bytes', 'path', 'sha256', 'spdx']);
const EXPECTED_DOCUMENTATION_KEYS = Object.freeze(['bytes', 'mediaType', 'path', 'sha256']);
const EXPECTED_TARBALL_ENTRIES = Object.freeze(
	[
		'package/LICENSE.md',
		'package/julia.data',
		'package/julia.js',
		'package/julia.wasm',
		'package/package.json',
		'package/readme.md'
	].sort()
);

/** @typedef {{ bytes: number; sha256: string }} Receipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} LogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'gzip'; size: number; sha256: string }} StorageAsset */
/** @typedef {{ target: string; temporary: string; previous: string; hadTarget: boolean; backedUp: boolean; published: boolean }} Publication */

/**
 * @typedef {object} SyncWasmJuliaOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [lockFilePath]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
 * @property {(input: string, init?: RequestInit) => Promise<Response>} [fetchImpl]
 */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {Uint8Array} bytes */
const sha512 = (bytes) => createHash('sha512').update(bytes).digest('hex');
/** @param {Uint8Array} bytes */
const sha1 = (bytes) => createHash('sha1').update(bytes).digest('hex');

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
	if (primitive === undefined) throw new Error('Julia manifest contains a non-JSON value');
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

/** @param {unknown} value @param {string} label @param {number} maxBytes */
function validateReceipt(value, label, maxBytes) {
	if (
		!isObject(value) ||
		!Number.isSafeInteger(value.bytes) ||
		/** @type {number} */ (value.bytes) <= 0 ||
		/** @type {number} */ (value.bytes) > maxBytes ||
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
		throw new Error(`wasm-julia input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-julia input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
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
		!hasExactKeys(value.packageJson, EXPECTED_PACKAGE_KEYS) ||
		value.packageJson.path !== 'package.json' ||
		!hasExactKeys(value.license, EXPECTED_LICENSE_KEYS) ||
		value.license.path !== LICENSE_FILE ||
		value.license.spdx !== EXPECTED_LICENSE_EXPRESSION ||
		!hasExactKeys(value.documentation, EXPECTED_DOCUMENTATION_KEYS) ||
		value.documentation.path !== DOCUMENTATION_FILE ||
		value.documentation.mediaType !== 'text/markdown' ||
		!Array.isArray(value.assets) ||
		value.assets.length !== LOGICAL_ASSETS.length
	) {
		throw new Error('wasm-julia input lock has invalid provenance metadata');
	}
	const packageJson = validateReceipt(
		value.packageJson,
		'wasm-julia package.json',
		MAX_METADATA_BYTES
	);
	const license = validateReceipt(value.license, 'wasm-julia license', MAX_METADATA_BYTES);
	const documentation = validateReceipt(
		value.documentation,
		'wasm-julia documentation',
		MAX_METADATA_BYTES
	);
	const receipts = new Map();
	for (const candidate of value.assets) {
		if (
			!hasExactKeys(candidate, EXPECTED_ASSET_KEYS) ||
			typeof candidate.path !== 'string' ||
			!LOGICAL_ASSETS.includes(candidate.path) ||
			receipts.has(candidate.path)
		) {
			throw new Error('wasm-julia input lock has an invalid or duplicate asset path');
		}
		const assetPath = /** @type {'julia.js' | 'julia.wasm' | 'julia.data'} */ (candidate.path);
		if (candidate.mediaType !== EXPECTED_MEDIA_TYPES[assetPath]) {
			throw new Error('wasm-julia input lock has an invalid asset media type');
		}
		receipts.set(assetPath, {
			...validateReceipt(candidate, `wasm-julia ${candidate.path}`, MAX_SOURCE_ASSET_BYTES),
			mediaType: candidate.mediaType
		});
	}
	if (LOGICAL_ASSETS.some((asset) => !receipts.has(asset))) {
		throw new Error('wasm-julia input lock is missing a required asset');
	}
	const integrityHex = Buffer.from(
		EXPECTED_ARTIFACT.npmIntegrity.slice('sha512-'.length),
		'base64'
	)
		.toString('hex')
		.toLowerCase();
	if (
		integrityHex !== EXPECTED_ARTIFACT.sha512 ||
		EXPECTED_ARTIFACT.bytes <= 0 ||
		EXPECTED_ARTIFACT.bytes > MAX_TARBALL_BYTES
	) {
		throw new Error('wasm-julia artifact receipt is internally inconsistent');
	}
	return Object.freeze({
		profileId: EXPECTED_PROFILE_ID,
		licenseExpression: EXPECTED_LICENSE_EXPRESSION,
		artifact: EXPECTED_ARTIFACT,
		components: EXPECTED_COMPONENTS,
		packageJson: Object.freeze({ path: 'package.json', ...packageJson }),
		license: Object.freeze({
			path: LICENSE_FILE,
			spdx: EXPECTED_LICENSE_EXPRESSION,
			...license
		}),
		documentation: Object.freeze({
			path: DOCUMENTATION_FILE,
			mediaType: 'text/markdown',
			...documentation
		}),
		receipts
	});
}

/**
 * @param {{ profileId: string; licenseExpression: string; artifact: Record<string, unknown>; components: Record<string, unknown>; license: { path: string; spdx: string; size: number; sha256: string }; documentation: { path: string; mediaType: string; size: number; sha256: string }; metadata: { path: string; mediaType: string; size: number; sha256: string }; assets: LogicalAsset[]; storage: StorageAsset[] }} manifest
 */
export function computeJuliaRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${JULIA_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${JULIA_MANIFEST_FORMAT}\n`);
	hash.update('runtime\0chriskoch-julia-wasm\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(`licenseExpression\0${manifest.licenseExpression}\n`);
	hash.update(`artifact\0${canonicalJson(manifest.artifact)}\n`);
	hash.update(`components\0${canonicalJson(manifest.components)}\n`);
	hash.update(
		`license\0${manifest.license.path}\0${manifest.license.spdx}\0${manifest.license.size}\0${manifest.license.sha256}\n`
	);
	hash.update(
		`documentation\0${manifest.documentation.path}\0${manifest.documentation.mediaType}\0${manifest.documentation.size}\0${manifest.documentation.sha256}\n`
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

/** @param {Response} response @param {unknown} reason */
function cancelResponse(response, reason) {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the download failure that caused cancellation.
	}
}

/**
 * @param {typeof EXPECTED_ARTIFACT} artifact
 * @param {(input: string, init?: RequestInit) => Promise<Response>} fetchImpl
 */
async function downloadTarball(artifact, fetchImpl) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TARBALL_TIMEOUT_MS);
	let response;
	try {
		response = await fetchImpl(artifact.tarballUrl, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: controller.signal
		});
	} catch (error) {
		clearTimeout(timeout);
		throw new Error(
			`Julia npm tarball download failed: ${controller.signal.aborted ? 'timeout' : error}`
		);
	}
	try {
		if (!response.url || response.url !== artifact.tarballUrl) {
			throw new Error('Julia npm tarball response URL does not match the pinned URL');
		}
		if (!response.ok) {
			throw new Error(`Julia npm tarball request failed with status ${response.status}`);
		}
		const contentLength = response.headers.get('content-length');
		if (contentLength !== null) {
			const normalized = contentLength.trim();
			const parsed = Number(normalized);
			if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(parsed)) {
				throw new Error('Julia npm tarball has an invalid Content-Length');
			}
			if (parsed !== artifact.bytes) {
				throw new Error('Julia npm tarball Content-Length does not match the input lock');
			}
		}
	} catch (error) {
		clearTimeout(timeout);
		cancelResponse(response, error);
		throw error;
	}
	if (!response.body) {
		const error = new Error('Julia npm tarball response does not provide a byte stream');
		clearTimeout(timeout);
		cancelResponse(response, error);
		throw error;
	}
	let reader;
	try {
		reader = response.body.getReader();
	} catch (error) {
		clearTimeout(timeout);
		cancelResponse(response, error);
		throw error;
	}
	const bytes = new Uint8Array(artifact.bytes);
	let loaded = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array)) {
				throw new Error('Julia npm tarball returned an invalid byte stream');
			}
			const nextLoaded = loaded + value.byteLength;
			if (!Number.isSafeInteger(nextLoaded) || nextLoaded > artifact.bytes) {
				throw new Error('Julia npm tarball exceeds the input lock size');
			}
			bytes.set(value, loaded);
			loaded = nextLoaded;
		}
		if (loaded !== artifact.bytes) throw new Error('Julia npm tarball is truncated');
	} catch (error) {
		try {
			void Promise.resolve(reader.cancel(error)).catch(() => undefined);
		} catch {
			// Preserve the bounded-read failure.
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		try {
			reader.releaseLock();
		} catch {
			// Preserve the primary download result.
		}
	}
	if (
		sha256(bytes) !== artifact.sha256 ||
		sha512(bytes) !== artifact.sha512 ||
		sha1(bytes) !== artifact.npmShasum
	) {
		throw new Error('Julia npm tarball does not match the input lock');
	}
	return bytes;
}

/**
 * @param {typeof EXPECTED_ARTIFACT} artifact
 * @param {(input: string, init?: RequestInit) => Promise<Response>} fetchImpl
 */
async function downloadPackageSource(artifact, fetchImpl) {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'wasm-idle-julia-'));
	try {
		const tarballPath = path.join(temporaryRoot, 'julia-wasm.tgz');
		await writeFile(tarballPath, await downloadTarball(artifact, fetchImpl));
		const { stdout } = await execFileAsync('tar', ['-tzf', tarballPath], {
			maxBuffer: 1024 * 1024
		});
		const entries = stdout
			.split(/\r?\n/u)
			.map((entry) => entry.trim())
			.filter(Boolean)
			.sort();
		if (JSON.stringify(entries) !== JSON.stringify(EXPECTED_TARBALL_ENTRIES)) {
			throw new Error('Julia npm tarball has an unexpected entry set');
		}
		await execFileAsync('tar', ['-xzf', tarballPath, '-C', temporaryRoot], {
			maxBuffer: 1024 * 1024
		});
		return { sourceDir: path.join(temporaryRoot, 'package'), temporaryRoot };
	} catch (error) {
		await rm(temporaryRoot, { recursive: true, force: true });
		throw error;
	}
}

/** @param {string} targetDir */
async function targetLooksUsable(targetDir) {
	for (const asset of LOGICAL_ASSETS) {
		if (
			!(await isRegularFile(path.join(targetDir, asset))) &&
			!(await isRegularFile(path.join(targetDir, `${asset}.gz`)))
		) {
			return false;
		}
	}
	return (
		(await isRegularFile(path.join(targetDir, LICENSE_FILE))) &&
		(await isRegularFile(path.join(targetDir, DOCUMENTATION_FILE)))
	);
}

/**
 * @param {string | undefined} sourceDir
 * @param {string} targetDir
 * @param {typeof EXPECTED_ARTIFACT} artifact
 * @param {(input: string, init?: RequestInit) => Promise<Response>} fetchImpl
 */
async function resolveSource(sourceDir, targetDir, artifact, fetchImpl) {
	if (sourceDir !== undefined) {
		return { sourceDir: path.resolve(sourceDir), mode: 'external', temporaryRoot: null };
	}
	if (process.env.WASM_JULIA_SOURCE_DIR !== undefined) {
		return {
			sourceDir: path.resolve(process.env.WASM_JULIA_SOURCE_DIR),
			mode: 'external',
			temporaryRoot: null
		};
	}
	if (await targetLooksUsable(targetDir)) {
		return { sourceDir: targetDir, mode: 'installed', temporaryRoot: null };
	}
	const downloaded = await downloadPackageSource(artifact, fetchImpl);
	return { ...downloaded, mode: 'downloaded' };
}

/**
 * @param {string} sourceDir
 * @param {'external' | 'installed' | 'downloaded'} mode
 * @param {'julia.js' | 'julia.wasm' | 'julia.data'} assetPath
 * @param {Readonly<Receipt>} receipt
 */
async function readLogicalAsset(sourceDir, mode, assetPath, receipt) {
	const rawPath = path.join(sourceDir, assetPath);
	const gzipPath = `${rawPath}.gz`;
	const hasRaw = await isRegularFile(rawPath);
	if (!hasRaw && mode !== 'installed') {
		throw new Error(`Julia package source is missing ${assetPath}`);
	}
	const inputPath = hasRaw ? rawPath : gzipPath;
	if (!(await isRegularFile(inputPath))) {
		throw new Error(`Julia runtime input is missing ${assetPath}`);
	}
	const stats = await lstat(inputPath);
	if (
		stats.size <= 0 ||
		stats.size > MAX_SOURCE_ASSET_BYTES ||
		(hasRaw && stats.size !== receipt.bytes)
	) {
		throw new Error(`Julia runtime input ${assetPath} has an invalid size`);
	}
	const storedBytes = await readFile(inputPath);
	let bytes;
	try {
		bytes = hasRaw ? storedBytes : gunzipSync(storedBytes, { maxOutputLength: receipt.bytes });
	} catch {
		throw new Error(`Julia runtime input ${assetPath} has invalid gzip storage`);
	}
	if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
		throw new Error(`Julia runtime input ${assetPath} does not match the input lock`);
	}
	return bytes;
}

/** @param {Uint8Array} bytes @param {Readonly<Receipt>} receipt @param {string} label */
function verifyBytes(bytes, receipt, label) {
	if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
		throw new Error(`${label} does not match the input lock`);
	}
}

/**
 * @param {string} sourceDir
 * @param {{ path: string; bytes: number; sha256: string }} receipt
 * @param {string} label
 */
async function readReceiptFile(sourceDir, receipt, label) {
	const filePath = path.join(sourceDir, receipt.path);
	const stats = await lstat(filePath).catch(() => null);
	if (!stats?.isFile() || stats.size !== receipt.bytes) {
		throw new Error(`${label} has an invalid size`);
	}
	const bytes = await readFile(filePath);
	verifyBytes(bytes, receipt, label);
	return bytes;
}

/** @param {string} source */
function validatePackageJson(source) {
	let value;
	try {
		value = JSON.parse(source);
	} catch {
		throw new Error('Julia npm package.json is not valid JSON');
	}
	if (
		!isObject(value) ||
		value.name !== '@chriskoch/julia-wasm' ||
		value.version !== '1.0.4' ||
		value.license !== 'MIT' ||
		value.main !== 'julia.js' ||
		value.repository !== 'chris-koch-penn/polylang'
	) {
		throw new Error('Julia npm package.json identity does not match the pinned package');
	}
}

/** @param {string} fingerprint @param {Readonly<Receipt>} workerReceipt */
function renderVersionModule(fingerprint, workerReceipt) {
	return `export const WASM_JULIA_ASSET_VERSION =\n\t'${fingerprint}';\nexport const WASM_JULIA_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;
}

/** @param {SyncWasmJuliaOptions} [options] */
export async function syncWasmJuliaAssets(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const renamePath = options.renamePath || rename;
	const fetchImpl = options.fetchImpl || globalThis.fetch;
	if (typeof fetchImpl !== 'function') {
		throw new Error('Julia npm package download requires fetch');
	}
	const lock = await readInputLock(lockFilePath);
	const source = await resolveSource(options.sourceDir, targetDir, lock.artifact, fetchImpl);
	try {
		for (const [targetPath, kind, label] of [
			[targetDir, 'directory', 'runtime target'],
			[versionModulePath, 'file', 'version module']
		]) {
			const stats = await lstat(targetPath).catch(() => null);
			if (stats && !(kind === 'directory' ? stats.isDirectory() : stats.isFile())) {
				throw new Error(`wasm-julia ${label} has the wrong file type: ${targetPath}`);
			}
		}
		for (const [filePath, label] of [
			[workerSourcePath, 'worker source'],
			[lockFilePath, 'input lock']
		]) {
			if (!(await isRegularFile(filePath))) {
				throw new Error(`wasm-julia ${label} must be a regular file: ${filePath}`);
			}
		}
		const sourceStats = await lstat(source.sourceDir).catch(() => null);
		if (!sourceStats?.isDirectory()) {
			throw new Error(`wasm-julia source must be a directory: ${source.sourceDir}`);
		}

		const outputPaths = [targetDir, versionModulePath];
		const inputPaths = [workerSourcePath, lockFilePath];
		if (source.mode !== 'installed') inputPaths.push(source.sourceDir);
		const outputBoundaries = await Promise.all(outputPaths.map(resolveBoundaryPath));
		const inputBoundaries = await Promise.all(inputPaths.map(resolveBoundaryPath));
		if (pathsOverlap(outputBoundaries[0], outputBoundaries[1])) {
			throw new Error('wasm-julia publication targets must not overlap');
		}
		for (const outputBoundary of outputBoundaries) {
			for (const inputBoundary of inputBoundaries) {
				if (pathsOverlap(outputBoundary, inputBoundary)) {
					throw new Error('wasm-julia publication targets must not overlap their inputs');
				}
			}
		}

		const logicalBytes = new Map();
		for (const assetPath of LOGICAL_ASSETS) {
			logicalBytes.set(
				assetPath,
				await readLogicalAsset(
					source.sourceDir,
					/** @type {'external' | 'installed' | 'downloaded'} */ (source.mode),
					assetPath,
					lock.receipts.get(assetPath)
				)
			);
		}
		const workerStats = await lstat(workerSourcePath);
		if (workerStats.size <= 0 || workerStats.size > MAX_WORKER_BYTES) {
			throw new Error('Julia worker source exceeds the producer limit');
		}
		const [licenseBytes, documentationBytes, workerBytes] = await Promise.all([
			readReceiptFile(source.sourceDir, lock.license, 'Julia license'),
			readReceiptFile(source.sourceDir, lock.documentation, 'Julia documentation'),
			readFile(workerSourcePath)
		]);
		if (source.mode !== 'installed') {
			const packageJsonBytes = await readReceiptFile(
				source.sourceDir,
				lock.packageJson,
				'Julia package.json'
			);
			let packageJsonSource;
			try {
				packageJsonSource = new TextDecoder('utf-8', { fatal: true }).decode(
					packageJsonBytes
				);
			} catch {
				throw new Error('Julia npm package.json is not valid UTF-8');
			}
			validatePackageJson(packageJsonSource);
		}

		let moduleSource;
		let licenseSource;
		let documentationSource;
		let workerSource;
		try {
			moduleSource = new TextDecoder('utf-8', { fatal: true }).decode(
				logicalBytes.get('julia.js')
			);
			licenseSource = new TextDecoder('utf-8', { fatal: true }).decode(licenseBytes);
			documentationSource = new TextDecoder('utf-8', { fatal: true }).decode(
				documentationBytes
			);
			workerSource = new TextDecoder('utf-8', { fatal: true }).decode(workerBytes);
			new Function(workerSource);
		} catch {
			throw new Error('Julia runtime source contains invalid UTF-8 or JavaScript');
		}
		if (
			!moduleSource.includes('_jl_eval_string') ||
			!moduleSource.includes('WebAssembly.instantiate') ||
			!moduleSource.includes('getPreloadedPackage') ||
			!moduleSource.includes('julia-wasm/julia.wasm') ||
			!moduleSource.includes('/npm/@chriskoch/julia-wasm/julia.data')
		) {
			throw new Error('julia.js does not expose the expected Emscripten runtime contract');
		}
		const wasmBytes = logicalBytes.get('julia.wasm');
		if (
			!wasmBytes ||
			wasmBytes.byteLength < 8 ||
			wasmBytes[0] !== 0x00 ||
			wasmBytes[1] !== 0x61 ||
			wasmBytes[2] !== 0x73 ||
			wasmBytes[3] !== 0x6d
		) {
			throw new Error('julia.wasm does not have a WebAssembly module header');
		}
		if (
			!licenseSource.includes('Julia includes code from the following projects') ||
			!licenseSource.includes('Permission is hereby granted') ||
			!documentationSource.includes('WASM compiled version of the Julia 1.04 compiler')
		) {
			throw new Error('Julia package notices do not match the pinned distribution');
		}
		if (
			!workerSource.includes('self.onmessage') ||
			!workerSource.includes(JULIA_MANIFEST_FORMAT) ||
			!workerSource.includes(EXPECTED_PROFILE_ID)
		) {
			throw new Error('Julia worker source does not implement the pinned runtime protocol');
		}

		/** @type {LogicalAsset[]} */
		const assets = LOGICAL_ASSETS.map((assetPath) => {
			const bytes = logicalBytes.get(assetPath);
			if (!bytes) throw new Error(`Julia runtime source ${assetPath} is missing`);
			return {
				path: assetPath,
				mediaType: EXPECTED_MEDIA_TYPES[assetPath],
				size: bytes.byteLength,
				sha256: sha256(bytes)
			};
		});
		/** @type {Map<string, Uint8Array>} */
		const storageBytes = new Map();
		/** @type {StorageAsset[]} */
		const storage = assets.map((asset) => {
			const logical = logicalBytes.get(asset.path);
			if (!logical) throw new Error(`Julia runtime source ${asset.path} is missing`);
			const compressed = gzipSync(logical, { level: 9 });
			const storagePath = `${asset.path}.gz`;
			storageBytes.set(storagePath, compressed);
			return {
				path: storagePath,
				logicalPath: asset.path,
				encoding: 'gzip',
				size: compressed.byteLength,
				sha256: sha256(compressed)
			};
		});
		const license = {
			path: lock.license.path,
			spdx: lock.license.spdx,
			size: licenseBytes.byteLength,
			sha256: sha256(licenseBytes)
		};
		const documentation = {
			path: lock.documentation.path,
			mediaType: lock.documentation.mediaType,
			size: documentationBytes.byteLength,
			sha256: sha256(documentationBytes)
		};
		const runtimeBuild = Object.freeze({
			format: 'wasm-julia-runtime-build-v1',
			runtime: 'chriskoch-julia-wasm',
			profileId: lock.profileId,
			provenanceLevel: 'opaque-npm-prebuilt',
			licenseExpression: lock.licenseExpression,
			artifact: lock.artifact,
			components: lock.components,
			packageJson: {
				path: lock.packageJson.path,
				size: lock.packageJson.bytes,
				sha256: lock.packageJson.sha256
			}
		});
		const metadataBytes = Buffer.from(`${JSON.stringify(runtimeBuild, null, 2)}\n`, 'utf8');
		const metadata = {
			path: BUILD_METADATA_FILE,
			mediaType: 'application/json',
			size: metadataBytes.byteLength,
			sha256: sha256(metadataBytes)
		};
		const fingerprint = computeJuliaRuntimeFingerprint({
			profileId: lock.profileId,
			licenseExpression: lock.licenseExpression,
			artifact: lock.artifact,
			components: lock.components,
			license,
			documentation,
			metadata,
			assets,
			storage
		});
		const workerReceipt = Object.freeze({
			bytes: workerBytes.byteLength,
			sha256: sha256(workerBytes)
		});
		const manifest = {
			format: JULIA_MANIFEST_FORMAT,
			runtime: 'chriskoch-julia-wasm',
			profileId: lock.profileId,
			fingerprint,
			licenseExpression: lock.licenseExpression,
			artifact: lock.artifact,
			components: lock.components,
			license,
			documentation,
			metadata,
			assets,
			storage
		};
		const legacyManifest = {
			format: 'wasm-julia-runtime-manifest-v1',
			runtime: 'chriskoch-julia-wasm',
			package: lock.artifact.packageSpec,
			fingerprint: fingerprint.slice(0, 16),
			files: [LICENSE_FILE, DOCUMENTATION_FILE, ...storage.map((asset) => asset.path)].sort()
		};
		const versionModuleSource = renderVersionModule(fingerprint, workerReceipt);
		const expectedFiles = [
			LICENSE_FILE,
			DOCUMENTATION_FILE,
			...storage.map((asset) => asset.path),
			BUILD_METADATA_FILE,
			LEGACY_MANIFEST_FILE,
			MANIFEST_FILE,
			WORKER_FILE
		].sort();

		await Promise.all([
			mkdir(path.dirname(targetDir), { recursive: true }),
			mkdir(path.dirname(versionModulePath), { recursive: true })
		]);
		const publicationId = randomUUID();
		/** @type {Publication[]} */
		const publications = [targetDir, versionModulePath].map((target) => ({
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
				...storage.map((asset) => {
					const bytes = storageBytes.get(asset.path);
					if (!bytes) throw new Error(`Julia storage ${asset.path} is missing`);
					return writeFile(path.join(publications[0].temporary, asset.path), bytes);
				}),
				writeFile(path.join(publications[0].temporary, LICENSE_FILE), licenseBytes),
				writeFile(
					path.join(publications[0].temporary, DOCUMENTATION_FILE),
					documentationBytes
				),
				writeFile(path.join(publications[0].temporary, WORKER_FILE), workerBytes),
				writeFile(path.join(publications[0].temporary, BUILD_METADATA_FILE), metadataBytes),
				writeFile(
					path.join(publications[0].temporary, LEGACY_MANIFEST_FILE),
					`${JSON.stringify(legacyManifest, null, 2)}\n`,
					'utf8'
				),
				writeFile(
					path.join(publications[0].temporary, MANIFEST_FILE),
					`${JSON.stringify(manifest, null, 2)}\n`,
					'utf8'
				),
				writeFile(publications[1].temporary, versionModuleSource, 'utf8')
			]);
			const installedEntries = await readdir(publications[0].temporary, {
				withFileTypes: true
			});
			if (
				installedEntries.some((entry) => !entry.isFile()) ||
				JSON.stringify(installedEntries.map((entry) => entry.name).sort()) !==
					JSON.stringify(expectedFiles)
			) {
				throw new Error('wasm-julia temporary installation has unexpected files');
			}
			const installedManifest = JSON.parse(
				await readFile(path.join(publications[0].temporary, MANIFEST_FILE), 'utf8')
			);
			if (
				JSON.stringify(installedManifest) !== JSON.stringify(manifest) ||
				computeJuliaRuntimeFingerprint(installedManifest) !== fingerprint ||
				(await readFile(publications[1].temporary, 'utf8')) !== versionModuleSource
			) {
				throw new Error('wasm-julia temporary installation failed manifest verification');
			}
			for (const asset of storage) {
				const stored = await readFile(path.join(publications[0].temporary, asset.path));
				if (stored.byteLength !== asset.size || sha256(stored) !== asset.sha256) {
					throw new Error(
						`wasm-julia temporary storage verification failed for ${asset.path}`
					);
				}
				const logical = gunzipSync(stored, {
					maxOutputLength: lock.receipts.get(asset.logicalPath).bytes
				});
				const receipt = assets.find((candidate) => candidate.path === asset.logicalPath);
				if (
					!receipt ||
					logical.byteLength !== receipt.size ||
					sha256(logical) !== receipt.sha256
				) {
					throw new Error(
						`wasm-julia temporary logical verification failed for ${asset.path}`
					);
				}
			}
			const receiptFiles = [
				{
					fileName: LICENSE_FILE,
					bytes: licenseBytes,
					expectedBytes: license.size,
					expectedSha256: license.sha256
				},
				{
					fileName: DOCUMENTATION_FILE,
					bytes: documentationBytes,
					expectedBytes: documentation.size,
					expectedSha256: documentation.sha256
				},
				{
					fileName: BUILD_METADATA_FILE,
					bytes: metadataBytes,
					expectedBytes: metadata.size,
					expectedSha256: metadata.sha256
				},
				{
					fileName: WORKER_FILE,
					bytes: workerBytes,
					expectedBytes: workerReceipt.bytes,
					expectedSha256: workerReceipt.sha256
				}
			];
			for (const receiptFile of receiptFiles) {
				const installed = await readFile(
					path.join(publications[0].temporary, receiptFile.fileName)
				);
				if (
					!installed.equals(receiptFile.bytes) ||
					installed.byteLength !== receiptFile.expectedBytes ||
					sha256(installed) !== receiptFile.expectedSha256
				) {
					throw new Error(
						`wasm-julia temporary receipt verification failed for ${receiptFile.fileName}`
					);
				}
			}
			const installedLegacyManifest = JSON.parse(
				await readFile(path.join(publications[0].temporary, LEGACY_MANIFEST_FILE), 'utf8')
			);
			if (
				JSON.stringify(installedLegacyManifest) !== JSON.stringify(legacyManifest) ||
				JSON.stringify(JSON.parse(metadataBytes.toString('utf8'))) !==
					JSON.stringify(runtimeBuild)
			) {
				throw new Error('wasm-julia temporary metadata verification failed');
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
					if (
						publication.backedUp &&
						(await lstat(publication.previous).catch(() => null))
					) {
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
						'wasm-julia publication failed and rollback was incomplete'
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
			sourceDir: source.sourceDir,
			targetDir,
			fingerprint,
			profileId: lock.profileId,
			versionModulePath,
			workerReceipt
		};
	} finally {
		if (source.temporaryRoot) {
			await rm(source.temporaryRoot, { recursive: true, force: true });
		}
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmJuliaAssets({
		...(sourceDirArg ? { sourceDir: path.resolve(sourceDirArg) } : {}),
		...(targetDirArg ? { targetDir: path.resolve(targetDirArg) } : {})
	});
	console.log(`Synced wasm-julia from ${result.sourceDir} to ${result.targetDir}`);
}
