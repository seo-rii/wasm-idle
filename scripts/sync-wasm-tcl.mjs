import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_CACHE_DIR = path.resolve(REPO_ROOT, '.cache', 'wasm-tcl');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-tcl');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-tcl-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmTclVersion.ts'
);
const DEFAULT_LSP_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'lsp',
	'src',
	'bundledTclRuntime.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-tcl-assets.lock.json');
const DEFAULT_PROVENANCE_DIR = path.resolve(THIS_DIR, 'runtime-provenance', 'wasm-tcl');

export const WACL_VERSION = '2017-05-29';
export const WACL_PACKAGE_FILE = 'wacl.zip';
export const WACL_PACKAGE_URL =
	'https://raw.githubusercontent.com/ecky-l/ecky-l.github.io/045aa904c2073eeded1be803cf5416901f6ce8ee/wacl/releases/wacl.zip';
export const TCL_MANIFEST_FORMAT = 'wasm-tcl-runtime-manifest-v2';
export const TCL_FINGERPRINT_DOMAIN = 'wasm-idle:tcl-runtime-manifest:v2';

const MANIFEST_FILE = 'runtime-manifest.v2.json';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const BUILD_METADATA_FILE = 'runtime-build.json';
const RUNNER_FILE = 'runner-worker.js';
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
const ARCHIVE_TIMEOUT_MS = 30_000;
const ARCHIVE_ENTRIES = [
	'index.html',
	'js/',
	'js/.gitignore',
	'js/jquery-3.2.0.min.js',
	'js/main.js',
	'js/require.js',
	'js/tcl/',
	'js/tcl/wacl-custom.data',
	'js/tcl/wacl-library.data',
	'js/tcl/wacl.js',
	'js/tcl/wacl.wasm',
	'stylesheet.css'
].sort();
const SOURCE_TO_LOGICAL = Object.freeze({
	'js/require.js': 'require.js',
	'js/tcl/wacl-custom.data': 'tcl/wacl-custom.data',
	'js/tcl/wacl-library.data': 'tcl/wacl-library.data',
	'js/tcl/wacl.js': 'tcl/wacl.js',
	'js/tcl/wacl.wasm': 'tcl/wacl.wasm'
});
const LOGICAL_ASSETS = Object.values(SOURCE_TO_LOGICAL);
const STORAGE_BY_LOGICAL = Object.freeze({
	'require.js': Object.freeze({ path: 'require.js', encoding: 'identity' }),
	'tcl/wacl-custom.data': Object.freeze({
		path: 'tcl/wacl-custom.data',
		encoding: 'identity'
	}),
	'tcl/wacl-library.data': Object.freeze({
		path: 'tcl/wacl-library.data.gz',
		encoding: 'gzip'
	}),
	'tcl/wacl.js': Object.freeze({ path: 'tcl/wacl.js', encoding: 'identity' }),
	'tcl/wacl.wasm': Object.freeze({ path: 'tcl/wacl.wasm.gz', encoding: 'gzip' })
});
const MEDIA_TYPE_BY_LOGICAL = Object.freeze({
	'require.js': 'text/javascript',
	'tcl/wacl-custom.data': 'application/octet-stream',
	'tcl/wacl-library.data': 'application/octet-stream',
	'tcl/wacl.js': 'text/javascript',
	'tcl/wacl.wasm': 'application/wasm'
});
const VERIFIED_WASM_PATCH =
	'var _wasmbly=Promise.resolve(typeof self!=="undefined"&&self.Module&&self.Module["wasmBinary"]||(function(){throw new Error("Verified Wacl Wasm was not provided.")})());';
const PATCH_DEFINITIONS = Object.freeze([
	Object.freeze({
		id: 'inject-verified-wasm',
		search: 'var _wasmbly=(function(url){return new Promise((function(resolve,reject){var wasmXHR=new XMLHttpRequest;wasmXHR.open("GET",url,true);wasmXHR.responseType="arraybuffer";wasmXHR.onload=(function(){resolve(wasmXHR.response)});wasmXHR.onerror=(function(){reject("error "+wasmXHR.status)});wasmXHR.send(null)}))})(_currPath+"wacl.wasm");',
		replacement: VERIFIED_WASM_PATCH
	}),
	Object.freeze({
		id: 'inject-host-module',
		search: 'var Module;if(typeof Module==="undefined")Module=eval("(function() { try { return Module || {} } catch(e) { return {} } })()");',
		replacement:
			'var Module;if(typeof Module==="undefined")Module=(typeof self!=="undefined"&&self.Module)||eval("(function() { try { return Module || {} } catch(e) { return {} } })()");'
	}),
	Object.freeze({
		id: 'preserve-host-output',
		search: 'Module["print"]=(function(txt){console.log("wacl stdout: "+txt)});',
		replacement:
			'Module["print"]=Module["print"]||(function(txt){console.log("wacl stdout: "+txt)});'
	}),
	Object.freeze({
		id: 'preserve-host-error-output',
		search: 'Module["printErr"]=(function(txt){console.error("wacl stderr: "+txt)});',
		replacement:
			'Module["printErr"]=Module["printErr"]||(function(txt){console.error("wacl stderr: "+txt)});'
	}),
	Object.freeze({
		id: 'guard-window-cleanup',
		search: 'delete window.Module;',
		replacement: 'if(typeof window!=="undefined")delete window.Module;'
	})
]);

/** @typedef {{ bytes: number; sha256: string }} Receipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} LogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'identity' | 'gzip'; size: number; sha256: string }} StorageAsset */
/** @typedef {{ target: string; temporary: string; previous: string; kind: 'file' | 'directory'; hadTarget: boolean; backedUp: boolean; published: boolean }} Publication */

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
		throw new Error(`wasm-tcl input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-tcl input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!isObject(value) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!/^wacl-[A-Za-z0-9._+-]+$/u.test(value.profileId) ||
		!isObject(value.artifact) ||
		value.artifact.kind !== 'opaque-prebuilt' ||
		typeof value.artifact.repository !== 'string' ||
		typeof value.artifact.revision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.artifact.revision) ||
		typeof value.artifact.path !== 'string' ||
		typeof value.artifact.url !== 'string' ||
		!isObject(value.components) ||
		!Object.keys(value.components).length ||
		!Array.isArray(value.patches) ||
		!Array.isArray(value.licenses) ||
		value.licenses.length < 2 ||
		!Array.isArray(value.archiveEntries) ||
		value.archiveEntries.length !== LOGICAL_ASSETS.length
	) {
		throw new Error('wasm-tcl input lock has invalid provenance metadata');
	}
	let artifactUrl;
	try {
		artifactUrl = new URL(value.artifact.url);
	} catch {
		throw new Error('wasm-tcl input lock has an invalid artifact URL');
	}
	if (
		!['http:', 'https:'].includes(artifactUrl.protocol) ||
		artifactUrl.username ||
		artifactUrl.password ||
		artifactUrl.hash
	) {
		throw new Error('wasm-tcl input lock artifact URL must be credential-free HTTP(S)');
	}
	const artifactReceipt = validateReceipt(
		{ bytes: value.artifact.size, sha256: value.artifact.sha256 },
		'wasm-tcl input archive'
	);
	if (artifactReceipt.bytes > MAX_ARCHIVE_BYTES) {
		throw new Error('wasm-tcl input archive exceeds its byte limit');
	}
	const entryReceipts = new Map();
	for (const candidate of value.archiveEntries) {
		if (
			!isObject(candidate) ||
			typeof candidate.path !== 'string' ||
			!Object.hasOwn(SOURCE_TO_LOGICAL, candidate.path) ||
			entryReceipts.has(candidate.path)
		) {
			throw new Error('wasm-tcl input lock has an invalid or duplicate archive entry');
		}
		entryReceipts.set(
			candidate.path,
			validateReceipt(candidate, `wasm-tcl input ${candidate.path}`)
		);
	}
	if (Object.keys(SOURCE_TO_LOGICAL).some((entry) => !entryReceipts.has(entry))) {
		throw new Error('wasm-tcl input lock is missing an archive entry');
	}
	const licenses = [];
	const licensePaths = new Set();
	for (const candidate of value.licenses) {
		if (
			!isObject(candidate) ||
			typeof candidate.id !== 'string' ||
			typeof candidate.path !== 'string' ||
			!/^licenses\/[A-Za-z0-9._-]+$/u.test(candidate.path) ||
			licensePaths.has(candidate.path) ||
			typeof candidate.spdx !== 'string' ||
			!candidate.spdx ||
			typeof candidate.sourceUrl !== 'string'
		) {
			throw new Error('wasm-tcl input lock has invalid license metadata');
		}
		licensePaths.add(candidate.path);
		licenses.push(
			Object.freeze({
				id: candidate.id,
				path: candidate.path,
				spdx: candidate.spdx,
				sourceUrl: candidate.sourceUrl,
				...validateReceipt(candidate, `wasm-tcl license ${candidate.id}`)
			})
		);
	}
	const patchIds = [...new Set(value.patches)];
	if (
		patchIds.length !== value.patches.length ||
		patchIds.length !== PATCH_DEFINITIONS.length ||
		patchIds.some((id) => typeof id !== 'string') ||
		PATCH_DEFINITIONS.some((patch) => !patchIds.includes(patch.id))
	) {
		throw new Error('wasm-tcl input lock does not declare the complete glue patch set');
	}
	return Object.freeze({
		profileId: value.profileId,
		artifact: Object.freeze({
			kind: value.artifact.kind,
			path: value.artifact.path,
			repository: value.artifact.repository,
			revision: value.artifact.revision,
			sha256: artifactReceipt.sha256,
			size: artifactReceipt.bytes,
			url: artifactUrl.href
		}),
		components: Object.freeze(value.components),
		patches: Object.freeze(PATCH_DEFINITIONS.map(({ id }) => Object.freeze({ id }))),
		licenses: Object.freeze(licenses),
		entryReceipts
	});
}

/** @param {string} kind @param {unknown} value */
function canonicalValue(kind, value) {
	if (Array.isArray(value)) {
		return [...value]
			.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
			.map((entry) => `${kind}\0${JSON.stringify(entry)}\n`)
			.join('');
	}
	return Object.entries(/** @type {Record<string, unknown>} */ (value))
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([name, entry]) => `${kind}\0${name}\0${JSON.stringify(entry)}\n`)
		.join('');
}

/**
 * @param {{
 *   profileId: string;
 *   artifact: Record<string, unknown>;
 *   components: Record<string, unknown>;
 *   patches: ReadonlyArray<Readonly<Record<string, unknown>>>;
 *   licenses: Array<{ path: string; spdx: string; size: number; sha256: string }>;
 *   metadata: { path: string; mediaType: string; size: number; sha256: string };
 *   assets: LogicalAsset[];
 *   storage: StorageAsset[];
 * }} manifest
 */
export function computeTclRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${TCL_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${TCL_MANIFEST_FORMAT}\n`);
	hash.update('runtime\0wacl\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(canonicalValue('artifact', manifest.artifact));
	hash.update(canonicalValue('component', manifest.components));
	hash.update(canonicalValue('patch', manifest.patches));
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

/** @param {string} source @param {string} search @param {string} replacement @param {string} id */
function replaceExactlyOnce(source, search, replacement, id) {
	const first = source.indexOf(search);
	if (first < 0 || source.indexOf(search, first + search.length) >= 0) {
		throw new Error(`Wacl glue patch ${id} must match exactly once`);
	}
	return source.slice(0, first) + replacement + source.slice(first + search.length);
}

/** @param {Uint8Array} bytes */
function patchWaclGlue(bytes) {
	let source;
	try {
		source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new Error('Wacl glue must be valid UTF-8');
	}
	for (const patch of PATCH_DEFINITIONS) {
		source = replaceExactlyOnce(source, patch.search, patch.replacement, patch.id);
	}
	return Buffer.from(`${source.replace(/\n+$/u, '')}\n`, 'utf8');
}

/** @param {Response} response @param {string} label @param {number} expectedBytes */
async function readBoundedResponse(response, label, expectedBytes) {
	try {
		if (!response.ok) throw new Error(`${label} request failed with status ${response.status}`);
		const contentLength = response.headers.get('content-length');
		if (contentLength !== null) {
			const parsed = Number(contentLength);
			if (
				!/^\d+$/u.test(contentLength.trim()) ||
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
			// Preserve the primary bounded-read failure.
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

/** @param {string} cacheDir @param {ReturnType<typeof readInputLock> extends Promise<infer T> ? T : never} lock */
async function loadDefaultArchive(cacheDir, lock) {
	const archivePath = path.join(cacheDir, WACL_PACKAGE_FILE);
	if (await isRegularFile(archivePath)) {
		const bytes = await readFile(archivePath);
		if (bytes.byteLength !== lock.artifact.size || sha256(bytes) !== lock.artifact.sha256) {
			throw new Error('cached Wacl archive does not match the input lock');
		}
		return { archivePath, bytes };
	}
	const requestedUrl = new URL(lock.artifact.url);
	const signal = AbortSignal.timeout(ARCHIVE_TIMEOUT_MS);
	const response = await fetch(requestedUrl.href, {
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer',
		signal
	});
	try {
		if (!response.url || new URL(response.url).href !== requestedUrl.href) {
			throw new Error('Wacl archive response URL does not match the input lock');
		}
	} catch (error) {
		try {
			void Promise.resolve(response.body?.cancel(error)).catch(() => undefined);
		} catch {
			// Preserve the final-URL failure.
		}
		throw error;
	}
	const bytes = await readBoundedResponse(response, 'Wacl archive', lock.artifact.size);
	if (sha256(bytes) !== lock.artifact.sha256) {
		throw new Error('Wacl archive failed SHA-256 verification');
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
			`failed to inspect Wacl archive: ${result.stderr || result.stdout || result.status}`
		);
	}
	const entries = result.stdout.split(/\r?\n/u).filter(Boolean).sort();
	if (JSON.stringify(entries) !== JSON.stringify(ARCHIVE_ENTRIES)) {
		throw new Error('Wacl archive contains an unexpected entry set');
	}
}

/** @param {string} archivePath @param {string} entry */
function readArchiveEntry(archivePath, entry) {
	const result = spawnSync('unzip', ['-p', archivePath, entry], {
		encoding: null,
		stdio: 'pipe',
		maxBuffer: 8 * 1024 * 1024
	});
	if (result.status !== 0) {
		throw new Error(`failed to read Wacl archive entry ${entry}`);
	}
	return Buffer.from(result.stdout);
}

/** @param {string} directory @param {string[]} expectedFiles */
async function assertExactPublishedFiles(directory, expectedFiles) {
	/** @type {string[]} */
	const found = [];
	/** @param {string} relativeDirectory */
	async function visit(relativeDirectory) {
		const absoluteDirectory = path.join(directory, relativeDirectory);
		for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
			const relative = path.posix.join(
				relativeDirectory.split(path.sep).join('/'),
				entry.name
			);
			if (entry.isDirectory()) await visit(relative);
			else if (entry.isFile()) found.push(relative);
			else throw new Error(`wasm-tcl published asset must be a regular file: ${relative}`);
		}
	}
	await visit('');
	if (JSON.stringify(found.sort()) !== JSON.stringify([...expectedFiles].sort())) {
		throw new Error('wasm-tcl temporary installation has unexpected files');
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
 *  provenanceDir?: string;
 *  renamePath?: (sourcePath: string, targetPath: string) => Promise<void>;
 * }} [options]
 */
export async function syncWasmTclAssets(options = {}) {
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
	const provenanceDir = path.resolve(options.provenanceDir || DEFAULT_PROVENANCE_DIR);
	const renamePath = options.renamePath || rename;
	const lock = await readInputLock(lockFilePath);

	for (const [targetPath, kind, label] of [
		[targetDir, 'directory', 'runtime target'],
		[versionModulePath, 'file', 'application version module'],
		[lspVersionModulePath, 'file', 'LSP version module']
	]) {
		const stats = await lstat(targetPath).catch(() => null);
		if (stats && !(kind === 'directory' ? stats.isDirectory() : stats.isFile())) {
			throw new Error(`wasm-tcl ${label} has the wrong file type: ${targetPath}`);
		}
	}
	for (const [filePath, label] of [
		[workerSourcePath, 'worker source'],
		[lockFilePath, 'input lock']
	]) {
		if (!(await isRegularFile(filePath))) {
			throw new Error(`wasm-tcl ${label} must be a regular file: ${filePath}`);
		}
	}
	for (const license of lock.licenses) {
		const sourcePath = path.join(provenanceDir, path.basename(license.path));
		if (!(await isRegularFile(sourcePath))) {
			throw new Error(`wasm-tcl license must be a regular file: ${sourcePath}`);
		}
	}

	const outputPaths = [targetDir, versionModulePath, lspVersionModulePath];
	const inputPaths = [workerSourcePath, lockFilePath, provenanceDir, sourceDir || cacheDir];
	const outputBoundaries = await Promise.all(outputPaths.map(resolveBoundaryPath));
	const inputBoundaries = await Promise.all(inputPaths.map(resolveBoundaryPath));
	for (let left = 0; left < outputBoundaries.length; left += 1) {
		for (let right = left + 1; right < outputBoundaries.length; right += 1) {
			if (pathsOverlap(outputBoundaries[left], outputBoundaries[right])) {
				throw new Error('wasm-tcl publication targets must not overlap');
			}
		}
		for (const inputBoundary of inputBoundaries) {
			if (pathsOverlap(outputBoundaries[left], inputBoundary)) {
				throw new Error('wasm-tcl publication targets must not overlap their inputs');
			}
		}
	}

	const sourceBytes = new Map();
	let resolvedSource = sourceDir;
	if (sourceDir) {
		for (const sourcePath of Object.keys(SOURCE_TO_LOGICAL)) {
			const absolutePath = path.join(sourceDir, sourcePath);
			if (!(await isRegularFile(absolutePath))) {
				throw new Error(
					`Wacl Tcl asset ${sourcePath} must be a regular file in ${sourceDir}`
				);
			}
			sourceBytes.set(sourcePath, await readFile(absolutePath));
		}
	} else {
		const archive = await loadDefaultArchive(cacheDir, lock);
		validateArchiveListing(archive.archivePath);
		resolvedSource = archive.archivePath;
		for (const sourcePath of Object.keys(SOURCE_TO_LOGICAL)) {
			sourceBytes.set(sourcePath, readArchiveEntry(archive.archivePath, sourcePath));
		}
	}
	for (const [sourcePath, bytes] of sourceBytes) {
		const receipt = lock.entryReceipts.get(sourcePath);
		if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
			throw new Error(`Wacl Tcl source ${sourcePath} does not match the input lock`);
		}
	}

	const logicalBytes = new Map();
	for (const [sourcePath, logicalPath] of Object.entries(SOURCE_TO_LOGICAL)) {
		const bytes = sourceBytes.get(sourcePath);
		logicalBytes.set(
			logicalPath,
			logicalPath === 'tcl/wacl.js' ? patchWaclGlue(bytes) : Buffer.from(bytes)
		);
	}
	const workerBytes = await readFile(workerSourcePath);
	const workerReceipt = Object.freeze({
		bytes: workerBytes.byteLength,
		sha256: sha256(workerBytes)
	});
	const licenseBytes = new Map();
	const licenses = [];
	for (const license of lock.licenses) {
		const bytes = await readFile(path.join(provenanceDir, path.basename(license.path)));
		if (bytes.byteLength !== license.bytes || sha256(bytes) !== license.sha256) {
			throw new Error(`wasm-tcl ${license.id} license does not match the input lock`);
		}
		licenseBytes.set(license.path, bytes);
		licenses.push({
			path: license.path,
			spdx: license.spdx,
			size: bytes.byteLength,
			sha256: sha256(bytes)
		});
	}
	const runtimeBuild = Object.freeze({
		format: 'wasm-tcl-runtime-build-v1',
		runtime: 'wacl',
		profileId: lock.profileId,
		provenanceLevel: 'opaque-prebuilt',
		artifact: lock.artifact,
		components: lock.components,
		patches: lock.patches
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
		const bytes =
			mapping.encoding === 'gzip'
				? gzipSync(logicalBytes.get(logicalPath), { level: 9 })
				: logicalBytes.get(logicalPath);
		storedBytes.set(mapping.path, bytes);
		return {
			path: mapping.path,
			logicalPath,
			encoding: mapping.encoding,
			size: bytes.byteLength,
			sha256: sha256(bytes)
		};
	});
	const fingerprint = computeTclRuntimeFingerprint({
		profileId: lock.profileId,
		artifact: lock.artifact,
		components: lock.components,
		patches: lock.patches,
		licenses,
		metadata,
		assets,
		storage
	});
	const manifest = {
		format: TCL_MANIFEST_FORMAT,
		runtime: 'wacl',
		profileId: lock.profileId,
		fingerprint,
		artifact: lock.artifact,
		components: lock.components,
		patches: lock.patches,
		licenses,
		metadata,
		assets,
		storage
	};
	const legacyManifest = {
		format: 'wasm-tcl-runtime-manifest-v1',
		version: WACL_VERSION,
		package: WACL_PACKAGE_FILE,
		packageUrl: lock.artifact.url,
		fingerprint,
		files: LOGICAL_ASSETS
	};
	const versionModuleSource = `export const WASM_TCL_ASSET_VERSION =\n\t'${fingerprint}';\nexport const WASM_TCL_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;
	const lspVersionModuleSource = `export const BUNDLED_TCL_MANIFEST_FINGERPRINT =\n\t'${fingerprint}';\nexport const BUNDLED_TCL_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;
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
		for (const [relativePath, bytes] of storedBytes) {
			const targetPath = path.join(publications[0].temporary, relativePath);
			await mkdir(path.dirname(targetPath), { recursive: true });
			await writeFile(targetPath, bytes);
		}
		for (const [relativePath, bytes] of licenseBytes) {
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
			computeTclRuntimeFingerprint(installedManifest) !== fingerprint ||
			sha256(await readFile(path.join(publications[0].temporary, RUNNER_FILE))) !==
				workerReceipt.sha256
		) {
			throw new Error('wasm-tcl temporary installation failed receipt verification');
		}
		for (const logicalPath of LOGICAL_ASSETS) {
			const mapping = STORAGE_BY_LOGICAL[logicalPath];
			const stored = await readFile(path.join(publications[0].temporary, mapping.path));
			const logical = mapping.encoding === 'gzip' ? gunzipSync(stored) : stored;
			if (sha256(logical) !== assets.find((asset) => asset.path === logicalPath)?.sha256) {
				throw new Error(
					'wasm-tcl temporary installation failed logical receipt verification'
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
					'wasm-tcl publication failed and rollback was incomplete'
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
	const result = await syncWasmTclAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-tcl from ${result.sourceDir} to ${result.targetDir}`);
}
