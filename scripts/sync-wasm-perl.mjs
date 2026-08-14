import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_CACHE_DIR = path.resolve(REPO_ROOT, '.cache', 'wasm-perl');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-perl');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-perl-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmPerlVersion.ts'
);
const DEFAULT_LSP_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'lsp',
	'src',
	'bundledPerlRuntime.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-perl-assets.lock.json');

export const WEBPERL_VERSION = 'v0.09-beta';
export const WEBPERL_PACKAGE_FILE = 'webperl_prebuilt_v0.09-beta.zip';
export const WEBPERL_PACKAGE_URL =
	'https://zenodo.org/api/records/2582586/files/webperl_prebuilt_v0.09-beta.zip/content';
export const PERL_MANIFEST_FORMAT = 'wasm-perl-runtime-manifest-v2';
export const PERL_FINGERPRINT_DOMAIN = 'wasm-idle:perl-runtime-manifest:v2';

const ARCHIVE_ROOT = 'webperl_prebuilt_v0.09-beta';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const BUILD_METADATA_FILE = 'runtime-build.json';
const RUNNER_FILE = 'runner-worker.js';
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
const ARCHIVE_TIMEOUT_MS = 30_000;
const ARCHIVE_ENTRIES = [
	`${ARCHIVE_ROOT}/`,
	`${ARCHIVE_ROOT}/LICENSE_artistic.txt`,
	`${ARCHIVE_ROOT}/LICENSE_gpl.txt`,
	`${ARCHIVE_ROOT}/README.md`,
	`${ARCHIVE_ROOT}/cpanfile`,
	`${ARCHIVE_ROOT}/democode/`,
	`${ARCHIVE_ROOT}/democode/demo.html`,
	`${ARCHIVE_ROOT}/democode/perleditor.css`,
	`${ARCHIVE_ROOT}/democode/perleditor.html`,
	`${ARCHIVE_ROOT}/democode/perlrunner.html`,
	`${ARCHIVE_ROOT}/emperl.data`,
	`${ARCHIVE_ROOT}/emperl.js`,
	`${ARCHIVE_ROOT}/emperl.wasm`,
	`${ARCHIVE_ROOT}/mini_ide/`,
	`${ARCHIVE_ROOT}/mini_ide/emscr_ide.css`,
	`${ARCHIVE_ROOT}/mini_ide/emscr_ide.js`,
	`${ARCHIVE_ROOT}/mini_ide/webperl_mini_ide.html`,
	`${ARCHIVE_ROOT}/regex_tester.html`,
	`${ARCHIVE_ROOT}/runtests.html`,
	`${ARCHIVE_ROOT}/webperl.js`,
	`${ARCHIVE_ROOT}/webperl.psgi`,
	`${ARCHIVE_ROOT}/webperl_demo.html`
].sort();
const SOURCE_TO_LOGICAL = Object.freeze({
	[`${ARCHIVE_ROOT}/emperl.js`]: 'emperl.js',
	[`${ARCHIVE_ROOT}/emperl.wasm`]: 'emperl.wasm',
	[`${ARCHIVE_ROOT}/emperl.data`]: 'emperl.data'
});
const LOGICAL_ASSETS = Object.values(SOURCE_TO_LOGICAL);
const STORAGE_BY_LOGICAL = Object.freeze({
	'emperl.js': Object.freeze({ path: 'emperl.js.gz', encoding: 'gzip' }),
	'emperl.wasm': Object.freeze({ path: 'emperl.wasm.gz', encoding: 'gzip' }),
	'emperl.data': Object.freeze({ path: 'emperl.data.gz', encoding: 'gzip' })
});
const MEDIA_TYPE_BY_LOGICAL = Object.freeze({
	'emperl.js': 'text/javascript',
	'emperl.wasm': 'application/wasm',
	'emperl.data': 'application/octet-stream'
});
const EXPECTED_PROFILE_ID = 'webperl-v0.09-beta-perl-5.28.1-emscripten-1.38.28';
const EXPECTED_LICENSE_EXPRESSION = 'Artistic-1.0-Perl OR GPL-1.0-or-later';
const EXPECTED_ARTIFACT = Object.freeze({
	kind: 'opaque-prebuilt',
	repository: 'https://github.com/haukex/webperl.git',
	revision: '6f2173d29a2c2e3536e1de75ff5d291ae96ab348',
	tag: WEBPERL_VERSION,
	doi: '10.5281/zenodo.2582586',
	path: WEBPERL_PACKAGE_FILE,
	url: WEBPERL_PACKAGE_URL,
	size: 3936557,
	sha256: '5f441249217e90ab378c666f473d4206ab4f44907f6bb0aa8d70834bc38c40dc'
});
const EXPECTED_COMPONENTS = Object.freeze({
	webperl: Object.freeze({
		version: WEBPERL_VERSION,
		repository: 'https://github.com/haukex/webperl.git',
		revision: '6f2173d29a2c2e3536e1de75ff5d291ae96ab348',
		verifiedBuildInput: false,
		evidence: 'release tag and opaque prebuilt archive'
	}),
	perl: Object.freeze({
		version: '5.28.1',
		repository: 'https://github.com/haukex/emperl5.git',
		revision: 'e70d909feb796ec99d5e91de5d1635d4526ec131',
		verifiedBuildInput: false,
		evidence: 'embedded runtime version string and versioned WebPerl build configuration'
	}),
	emscripten: Object.freeze({
		version: '1.38.28',
		repository: 'https://github.com/emscripten-core/emscripten.git',
		revision: '69ab40586822209758165df170e9fc8b81e05608',
		verifiedBuildInput: false,
		evidence: 'versioned WebPerl build configuration'
	}),
	cpanExtensions: Object.freeze({
		modules: Object.freeze(['Cpanel::JSON::XS', 'Devel::StackTrace', 'Future']),
		verifiedBuildInput: false,
		evidence: 'versioned WebPerl build configuration without transitive artifact locks'
	})
});
const EXPECTED_LICENSES = Object.freeze({
	'webperl-perl-artistic': Object.freeze({
		path: 'licenses/LICENSE_artistic.txt',
		archiveEntry: `${ARCHIVE_ROOT}/LICENSE_artistic.txt`,
		sourceUrl:
			'https://raw.githubusercontent.com/haukex/webperl/6f2173d29a2c2e3536e1de75ff5d291ae96ab348/LICENSE_artistic.txt',
		spdx: 'Artistic-1.0-Perl'
	}),
	'webperl-perl-gpl': Object.freeze({
		path: 'licenses/LICENSE_gpl.txt',
		archiveEntry: `${ARCHIVE_ROOT}/LICENSE_gpl.txt`,
		sourceUrl:
			'https://raw.githubusercontent.com/haukex/webperl/6f2173d29a2c2e3536e1de75ff5d291ae96ab348/LICENSE_gpl.txt',
		spdx: 'GPL-1.0-or-later'
	})
});
const EXPECTED_LOCK_KEYS = Object.freeze(
	[
		'archiveEntries',
		'artifact',
		'components',
		'licenseExpression',
		'licenses',
		'profileId',
		'schemaVersion'
	].sort()
);
const EXPECTED_ARTIFACT_KEYS = Object.freeze(Object.keys(EXPECTED_ARTIFACT).sort());
const EXPECTED_ARCHIVE_ENTRY_KEYS = Object.freeze(['bytes', 'path', 'sha256']);
const EXPECTED_LICENSE_KEYS = Object.freeze([
	'archiveEntry',
	'bytes',
	'id',
	'path',
	'sha256',
	'sourceUrl',
	'spdx'
]);
const EXPECTED_ARCHIVE_ENTRY_PATHS = new Set([
	...Object.keys(SOURCE_TO_LOGICAL),
	...Object.values(EXPECTED_LICENSES).map((license) => license.archiveEntry)
]);

/** @typedef {{ bytes: number; sha256: string }} Receipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} LogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'gzip'; size: number; sha256: string }} StorageAsset */
/** @typedef {{ target: string; temporary: string; previous: string; kind: 'file' | 'directory'; hadTarget: boolean; backedUp: boolean; published: boolean }} Publication */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} value @param {readonly string[]} expectedKeys */
const hasExactKeys = (value, expectedKeys) =>
	isObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys);

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
	return Object.freeze({ bytes: /** @type {number} */ (value.bytes), sha256: value.sha256 });
}

/** @param {string} lockFilePath */
async function readInputLock(lockFilePath) {
	if (!(await isRegularFile(lockFilePath))) {
		throw new Error(`wasm-perl input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-perl input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!hasExactKeys(value, EXPECTED_LOCK_KEYS) ||
		value.schemaVersion !== 1 ||
		value.profileId !== EXPECTED_PROFILE_ID ||
		value.licenseExpression !== EXPECTED_LICENSE_EXPRESSION ||
		!hasExactKeys(value.artifact, EXPECTED_ARTIFACT_KEYS) ||
		canonicalJson(value.artifact) !== canonicalJson(EXPECTED_ARTIFACT) ||
		!isObject(value.components) ||
		canonicalJson(value.components) !== canonicalJson(EXPECTED_COMPONENTS) ||
		!Array.isArray(value.licenses) ||
		value.licenses.length !== Object.keys(EXPECTED_LICENSES).length ||
		!Array.isArray(value.archiveEntries) ||
		value.archiveEntries.length !== EXPECTED_ARCHIVE_ENTRY_PATHS.size
	) {
		throw new Error('wasm-perl input lock has invalid provenance metadata');
	}
	const artifactReceipt = validateReceipt(
		{ bytes: value.artifact.size, sha256: value.artifact.sha256 },
		'wasm-perl input archive'
	);
	if (artifactReceipt.bytes > MAX_ARCHIVE_BYTES) {
		throw new Error('wasm-perl input archive exceeds its byte limit');
	}
	const entryReceipts = new Map();
	for (const candidate of value.archiveEntries) {
		if (
			!hasExactKeys(candidate, EXPECTED_ARCHIVE_ENTRY_KEYS) ||
			!EXPECTED_ARCHIVE_ENTRY_PATHS.has(candidate.path) ||
			entryReceipts.has(candidate.path)
		) {
			throw new Error('wasm-perl input lock has an invalid or duplicate archive entry');
		}
		entryReceipts.set(
			candidate.path,
			validateReceipt(candidate, `wasm-perl input ${candidate.path}`)
		);
	}
	const licenses = [];
	const licensePaths = new Set();
	for (const candidate of value.licenses) {
		const expected = isObject(candidate) ? EXPECTED_LICENSES[candidate.id] : undefined;
		if (
			!hasExactKeys(candidate, EXPECTED_LICENSE_KEYS) ||
			!expected ||
			candidate.path !== expected.path ||
			candidate.archiveEntry !== expected.archiveEntry ||
			candidate.sourceUrl !== expected.sourceUrl ||
			candidate.spdx !== expected.spdx ||
			licensePaths.has(candidate.path) ||
			!entryReceipts.has(candidate.archiveEntry)
		) {
			throw new Error('wasm-perl input lock has invalid license metadata');
		}
		const receipt = validateReceipt(candidate, `wasm-perl license ${candidate.id}`);
		const archiveReceipt = entryReceipts.get(expected.archiveEntry);
		if (
			!archiveReceipt ||
			archiveReceipt.bytes !== receipt.bytes ||
			archiveReceipt.sha256 !== receipt.sha256
		) {
			throw new Error('wasm-perl license receipt does not match its archive entry');
		}
		licensePaths.add(candidate.path);
		licenses.push(
			Object.freeze({
				id: candidate.id,
				path: candidate.path,
				archiveEntry: candidate.archiveEntry,
				sourceUrl: candidate.sourceUrl,
				spdx: candidate.spdx,
				...receipt
			})
		);
	}
	for (const sourcePath of Object.keys(SOURCE_TO_LOGICAL)) {
		if (!entryReceipts.has(sourcePath)) {
			throw new Error('wasm-perl input lock is missing a runtime archive entry');
		}
	}
	return Object.freeze({
		profileId: value.profileId,
		licenseExpression: value.licenseExpression,
		artifact: Object.freeze({
			kind: value.artifact.kind,
			repository: value.artifact.repository,
			revision: value.artifact.revision,
			tag: value.artifact.tag,
			doi: value.artifact.doi,
			path: value.artifact.path,
			url: value.artifact.url,
			size: artifactReceipt.bytes,
			sha256: artifactReceipt.sha256
		}),
		components: EXPECTED_COMPONENTS,
		licenses: Object.freeze(licenses),
		entryReceipts
	});
}

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
	if (primitive === undefined) throw new Error('Perl manifest contains a non-JSON value');
	return primitive;
}

/**
 * @param {{
 *   profileId: string;
 *   licenseExpression: string;
 *   artifact: Record<string, unknown>;
 *   components: Record<string, unknown>;
 *   licenses: Array<{ path: string; spdx: string; size: number; sha256: string }>;
 *   metadata: { path: string; mediaType: string; size: number; sha256: string };
 *   assets: LogicalAsset[];
 *   storage: StorageAsset[];
 * }} manifest
 */
export function computePerlRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${PERL_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${PERL_MANIFEST_FORMAT}\n`);
	hash.update('runtime\0webperl\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(`licenseExpression\0${manifest.licenseExpression}\n`);
	hash.update(`artifact\0${canonicalJson(manifest.artifact)}\n`);
	hash.update(`components\0${canonicalJson(manifest.components)}\n`);
	for (const license of [...manifest.licenses].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		hash.update(
			`license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`
		);
	}
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

/** @param {Response} response @param {string} label @param {number} expectedBytes */
async function readBoundedResponse(response, label, expectedBytes) {
	try {
		if (!response.ok) throw new Error(`${label} request failed with status ${response.status}`);
		const contentLength = response.headers.get('content-length');
		if (contentLength !== null) {
			const normalized = contentLength.trim();
			const parsed = Number(normalized);
			if (
				!/^\d+$/u.test(normalized) ||
				!Number.isSafeInteger(parsed) ||
				parsed !== expectedBytes
			) {
				throw new Error(`${label} Content-Length does not match its receipt`);
			}
		}
		if (!response.body) throw new Error(`${label} response does not provide a byte stream`);
	} catch (error) {
		try {
			void Promise.resolve(response.body?.cancel(error)).catch(() => undefined);
		} catch {
			// Preserve the response-validation failure.
		}
		throw error;
	}
	const reader = response.body.getReader();
	const output = new Uint8Array(expectedBytes);
	let loaded = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array) || loaded + value.byteLength > expectedBytes) {
				throw new Error(`${label} exceeds its receipt size`);
			}
			output.set(value, loaded);
			loaded += value.byteLength;
		}
		if (loaded !== expectedBytes) throw new Error(`${label} is truncated`);
		return output;
	} catch (error) {
		try {
			void Promise.resolve(reader.cancel(error)).catch(() => undefined);
		} catch {
			// Preserve the bounded-read failure.
		}
		throw error;
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// Preserve the primary result.
		}
	}
}

/** @param {string} cacheDir @param {Awaited<ReturnType<typeof readInputLock>>} lock */
async function loadDefaultArchive(cacheDir, lock) {
	const archivePath = path.join(cacheDir, WEBPERL_PACKAGE_FILE);
	if (await isRegularFile(archivePath)) {
		const bytes = await readFile(archivePath);
		if (bytes.byteLength !== lock.artifact.size || sha256(bytes) !== lock.artifact.sha256) {
			throw new Error('cached WebPerl archive does not match the input lock');
		}
		return { archivePath, bytes };
	}
	const requestedUrl = new URL(lock.artifact.url);
	const response = await fetch(requestedUrl.href, {
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer',
		signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS)
	});
	try {
		if (!response.url || new URL(response.url).href !== requestedUrl.href) {
			throw new Error('WebPerl archive response URL does not match the input lock');
		}
	} catch (error) {
		try {
			void Promise.resolve(response.body?.cancel(error)).catch(() => undefined);
		} catch {
			// Preserve the final-URL failure.
		}
		throw error;
	}
	const bytes = await readBoundedResponse(response, 'WebPerl archive', lock.artifact.size);
	if (sha256(bytes) !== lock.artifact.sha256) {
		throw new Error('WebPerl archive failed SHA-256 verification');
	}
	await mkdir(cacheDir, { recursive: true });
	const temporary = `${archivePath}.staging-${randomUUID()}`;
	try {
		await writeFile(temporary, bytes);
		await rename(temporary, archivePath);
	} finally {
		await rm(temporary, { force: true });
	}
	return { archivePath, bytes };
}

/** @param {string} archivePath */
function validateArchiveListing(archivePath) {
	const result = spawnSync('unzip', ['-Z1', archivePath], {
		encoding: 'utf8',
		stdio: 'pipe',
		maxBuffer: 1024 * 1024
	});
	if (result.status !== 0) {
		throw new Error(
			`failed to inspect WebPerl archive: ${result.stderr || result.stdout || result.status}`
		);
	}
	const entries = result.stdout.split(/\r?\n/u).filter(Boolean).sort();
	if (JSON.stringify(entries) !== JSON.stringify(ARCHIVE_ENTRIES)) {
		throw new Error('WebPerl archive contains an unexpected entry set');
	}
}

/** @param {string} archivePath @param {string} entry */
function readArchiveEntry(archivePath, entry) {
	const result = spawnSync('unzip', ['-p', archivePath, entry], {
		encoding: null,
		stdio: 'pipe',
		maxBuffer: 16 * 1024 * 1024
	});
	if (result.status !== 0) throw new Error(`failed to read WebPerl archive entry ${entry}`);
	return Buffer.from(result.stdout);
}

/** @param {string} directory @param {string[]} expectedFiles */
async function assertExactPublishedFiles(directory, expectedFiles) {
	/** @type {string[]} */
	const found = [];
	/** @param {string} relativeDirectory */
	async function visit(relativeDirectory) {
		for (const entry of await readdir(path.join(directory, relativeDirectory), {
			withFileTypes: true
		})) {
			const relative = path.posix.join(
				relativeDirectory.split(path.sep).join('/'),
				entry.name
			);
			if (entry.isDirectory()) await visit(relative);
			else if (entry.isFile()) found.push(relative);
			else throw new Error(`wasm-perl published asset must be a regular file: ${relative}`);
		}
	}
	await visit('');
	if (JSON.stringify(found.sort()) !== JSON.stringify([...expectedFiles].sort())) {
		throw new Error('wasm-perl temporary installation has unexpected files');
	}
}

/** @param {string} targetPath @param {'file' | 'directory'} kind */
async function removePublishedPath(targetPath, kind) {
	await rm(targetPath, { recursive: kind === 'directory', force: true });
}

/**
 * @param {{
 *  sourceDir?: string;
 *  targetDir?: string;
 *  workerSourcePath?: string;
 *  versionModulePath?: string;
 *  lspVersionModulePath?: string;
 *  cacheDir?: string;
 *  lockFilePath?: string;
 *  renamePath?: (sourcePath: string, targetPath: string) => Promise<void>;
 * }} [options]
 */
export async function syncWasmPerlAssets(options = {}) {
	const sourceDir = options.sourceDir ? path.resolve(options.sourceDir) : '';
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === path.resolve(DEFAULT_TARGET_DIR)
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const lspVersionModulePath = path.resolve(
		options.lspVersionModulePath ||
			(targetDir === path.resolve(DEFAULT_TARGET_DIR)
				? DEFAULT_LSP_VERSION_MODULE_PATH
				: `${targetDir}.lsp-version.ts`)
	);
	const cacheDir = path.resolve(options.cacheDir || DEFAULT_CACHE_DIR);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const renamePath = options.renamePath || rename;
	const lock = await readInputLock(lockFilePath);

	for (const [targetPath, kind, label] of [
		[targetDir, 'directory', 'runtime target'],
		[versionModulePath, 'file', 'application version module'],
		[lspVersionModulePath, 'file', 'LSP version module']
	]) {
		const stats = await lstat(targetPath).catch(() => null);
		if (stats && !(kind === 'directory' ? stats.isDirectory() : stats.isFile())) {
			throw new Error(`wasm-perl ${label} has the wrong file type: ${targetPath}`);
		}
	}
	for (const [filePath, label] of [
		[workerSourcePath, 'worker source'],
		[lockFilePath, 'input lock']
	]) {
		if (!(await isRegularFile(filePath))) {
			throw new Error(`wasm-perl ${label} must be a regular file: ${filePath}`);
		}
	}

	const outputPaths = [targetDir, versionModulePath, lspVersionModulePath];
	const inputPaths = [workerSourcePath, lockFilePath, sourceDir || cacheDir];
	const outputBoundaries = await Promise.all(outputPaths.map(resolveBoundaryPath));
	const inputBoundaries = await Promise.all(inputPaths.map(resolveBoundaryPath));
	for (let left = 0; left < outputBoundaries.length; left += 1) {
		for (let right = left + 1; right < outputBoundaries.length; right += 1) {
			if (pathsOverlap(outputBoundaries[left], outputBoundaries[right])) {
				throw new Error('wasm-perl publication targets must not overlap');
			}
		}
		for (const inputBoundary of inputBoundaries) {
			if (pathsOverlap(outputBoundaries[left], inputBoundary)) {
				throw new Error('wasm-perl publication targets must not overlap their inputs');
			}
		}
	}

	const archiveEntries = new Map();
	let resolvedSource = sourceDir;
	if (sourceDir) {
		const sourceBoundary = path.resolve(sourceDir);
		for (const archiveEntry of lock.entryReceipts.keys()) {
			const relativePath = archiveEntry.slice(`${ARCHIVE_ROOT}/`.length);
			const sourcePath = path.resolve(sourceBoundary, relativePath);
			if (!relativePath || !containsPath(sourceBoundary, sourcePath)) {
				throw new Error(
					`WebPerl archive entry escapes its source directory: ${archiveEntry}`
				);
			}
			if (!(await isRegularFile(sourcePath))) {
				throw new Error(
					`WebPerl asset ${relativePath} must be a regular file in ${sourceDir}`
				);
			}
			archiveEntries.set(archiveEntry, await readFile(sourcePath));
		}
	} else {
		const archive = await loadDefaultArchive(cacheDir, lock);
		validateArchiveListing(archive.archivePath);
		resolvedSource = archive.archivePath;
		for (const archiveEntry of lock.entryReceipts.keys()) {
			archiveEntries.set(archiveEntry, readArchiveEntry(archive.archivePath, archiveEntry));
		}
	}
	for (const [archiveEntry, bytes] of archiveEntries) {
		const receipt = lock.entryReceipts.get(archiveEntry);
		if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
			throw new Error(`WebPerl source ${archiveEntry} does not match the input lock`);
		}
	}

	const logicalBytes = new Map();
	for (const [archiveEntry, logicalPath] of Object.entries(SOURCE_TO_LOGICAL)) {
		logicalBytes.set(logicalPath, Buffer.from(archiveEntries.get(archiveEntry)));
	}
	const javascriptSource = new TextDecoder('utf-8', { fatal: true }).decode(
		logicalBytes.get('emperl.js')
	);
	if (
		!javascriptSource.includes('Module["getPreloadedPackage"]') ||
		!javascriptSource.includes('Module["wasmBinary"]') ||
		!javascriptSource.includes('var Module=typeof Module!=="undefined"?Module:{}')
	) {
		throw new Error('WebPerl glue is missing the verified asset injection contract');
	}
	const workerBytes = await readFile(workerSourcePath);
	const workerReceipt = Object.freeze({
		bytes: workerBytes.byteLength,
		sha256: sha256(workerBytes)
	});
	const licenseBytes = new Map();
	const licenses = lock.licenses.map((license) => {
		const bytes = Buffer.from(archiveEntries.get(license.archiveEntry));
		licenseBytes.set(license.path, bytes);
		return {
			path: license.path,
			spdx: license.spdx,
			size: bytes.byteLength,
			sha256: sha256(bytes)
		};
	});
	const runtimeBuild = Object.freeze({
		format: 'wasm-perl-runtime-build-v1',
		runtime: 'webperl',
		profileId: lock.profileId,
		provenanceLevel: 'opaque-prebuilt',
		artifact: lock.artifact,
		components: lock.components
	});
	const metadataBytes = Buffer.from(`${JSON.stringify(runtimeBuild, null, 2)}\n`, 'utf8');
	const metadata = {
		path: BUILD_METADATA_FILE,
		mediaType: 'application/json',
		size: metadataBytes.byteLength,
		sha256: sha256(metadataBytes)
	};
	/** @type {LogicalAsset[]} */
	const assets = LOGICAL_ASSETS.map((logicalPath) => {
		const bytes = logicalBytes.get(logicalPath);
		return {
			path: logicalPath,
			mediaType: MEDIA_TYPE_BY_LOGICAL[logicalPath],
			size: bytes.byteLength,
			sha256: sha256(bytes)
		};
	});
	const storedBytes = new Map();
	/** @type {StorageAsset[]} */
	const storage = LOGICAL_ASSETS.map((logicalPath) => {
		const mapping = STORAGE_BY_LOGICAL[logicalPath];
		const bytes = gzipSync(logicalBytes.get(logicalPath), { level: 9 });
		storedBytes.set(mapping.path, bytes);
		return {
			path: mapping.path,
			logicalPath,
			encoding: mapping.encoding,
			size: bytes.byteLength,
			sha256: sha256(bytes)
		};
	});
	const fingerprint = computePerlRuntimeFingerprint({
		profileId: lock.profileId,
		licenseExpression: lock.licenseExpression,
		artifact: lock.artifact,
		components: lock.components,
		licenses,
		metadata,
		assets,
		storage
	});
	const manifest = {
		format: PERL_MANIFEST_FORMAT,
		runtime: 'webperl',
		profileId: lock.profileId,
		fingerprint,
		licenseExpression: lock.licenseExpression,
		artifact: lock.artifact,
		components: lock.components,
		licenses,
		metadata,
		assets,
		storage
	};
	const legacyManifest = {
		format: 'wasm-perl-runtime-manifest-v1',
		version: WEBPERL_VERSION,
		package: WEBPERL_PACKAGE_FILE,
		packageUrl: lock.artifact.url,
		fingerprint,
		files: LOGICAL_ASSETS
	};
	const versionModuleSource = `export const WASM_PERL_ASSET_VERSION =\n\t'${fingerprint}';\nexport const WASM_PERL_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;
	const lspVersionModuleSource = `export const BUNDLED_PERL_MANIFEST_FINGERPRINT =\n\t'${fingerprint}';\nexport const BUNDLED_PERL_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;
	const expectedFiles = [
		...storedBytes.keys(),
		...licenseBytes.keys(),
		BUILD_METADATA_FILE,
		LEGACY_MANIFEST_FILE,
		MANIFEST_FILE,
		RUNNER_FILE
	];

	await Promise.all([
		mkdir(path.dirname(targetDir), { recursive: true }),
		mkdir(path.dirname(versionModulePath), { recursive: true }),
		mkdir(path.dirname(lspVersionModulePath), { recursive: true })
	]);
	const publicationId = randomUUID();
	/** @type {Publication[]} */
	const publications = [
		{ target: targetDir, kind: 'directory' },
		{ target: versionModulePath, kind: 'file' },
		{ target: lspVersionModulePath, kind: 'file' }
	].map(({ target, kind }) => ({
		target,
		temporary: path.join(
			path.dirname(target),
			`.${path.basename(target)}.staging-${publicationId}`
		),
		previous: path.join(
			path.dirname(target),
			`.${path.basename(target)}.previous-${publicationId}`
		),
		kind: /** @type {'file' | 'directory'} */ (kind),
		hadTarget: false,
		backedUp: false,
		published: false
	}));
	for (const publication of publications) {
		await removePublishedPath(publication.temporary, publication.kind);
	}
	await mkdir(publications[0].temporary, { recursive: true });
	try {
		for (const [relativePath, bytes] of [...storedBytes, ...licenseBytes]) {
			const targetPath = path.join(publications[0].temporary, relativePath);
			await mkdir(path.dirname(targetPath), { recursive: true });
			await writeFile(targetPath, bytes);
		}
		await Promise.all([
			writeFile(path.join(publications[0].temporary, BUILD_METADATA_FILE), metadataBytes),
			writeFile(path.join(publications[0].temporary, RUNNER_FILE), workerBytes),
			writeFile(
				path.join(publications[0].temporary, MANIFEST_FILE),
				`${JSON.stringify(manifest, null, 2)}\n`,
				'utf8'
			),
			writeFile(
				path.join(publications[0].temporary, LEGACY_MANIFEST_FILE),
				`${JSON.stringify(legacyManifest, null, 2)}\n`,
				'utf8'
			),
			writeFile(publications[1].temporary, versionModuleSource, 'utf8'),
			writeFile(publications[2].temporary, lspVersionModuleSource, 'utf8')
		]);
		await assertExactPublishedFiles(publications[0].temporary, expectedFiles);
		const installedManifest = JSON.parse(
			await readFile(path.join(publications[0].temporary, MANIFEST_FILE), 'utf8')
		);
		if (
			JSON.stringify(installedManifest) !== JSON.stringify(manifest) ||
			computePerlRuntimeFingerprint(installedManifest) !== fingerprint ||
			sha256(await readFile(path.join(publications[0].temporary, RUNNER_FILE))) !==
				workerReceipt.sha256
		) {
			throw new Error('wasm-perl temporary installation failed receipt verification');
		}
		for (const logicalPath of LOGICAL_ASSETS) {
			const mapping = STORAGE_BY_LOGICAL[logicalPath];
			const logical = gunzipSync(
				await readFile(path.join(publications[0].temporary, mapping.path))
			);
			if (sha256(logical) !== assets.find((asset) => asset.path === logicalPath)?.sha256) {
				throw new Error(
					'wasm-perl temporary installation failed logical receipt verification'
				);
			}
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
						await removePublishedPath(publication.target, publication.kind);
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
					'wasm-perl publication failed and rollback was incomplete'
				);
			}
			throw error;
		}
		for (const publication of publications) {
			if (publication.hadTarget)
				await removePublishedPath(publication.previous, publication.kind);
		}
	} finally {
		for (const publication of publications) {
			await removePublishedPath(publication.temporary, publication.kind);
		}
	}

	return {
		sourceDir: resolvedSource,
		targetDir,
		fingerprint,
		versionModulePath,
		lspVersionModulePath,
		workerReceipt
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmPerlAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-perl from ${result.sourceDir} to ${result.targetDir}`);
}
