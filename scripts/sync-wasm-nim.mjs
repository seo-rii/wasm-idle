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
import { NIM_LLVM_PROFILE, validateNimLlvmProfile } from './llvm-contracts/nim.mjs';

const execFileAsync = promisify(execFile);
const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-nim');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-nim-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmNimVersion.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-nim-assets.lock.json');
const DEFAULT_NOTICE_SOURCE_PATH = path.resolve(THIS_DIR, 'wasm-nim-third-party-notices.md');

export const NIM_MANIFEST_FORMAT = 'wasm-nim-runtime-manifest-v2';
export const NIM_FINGERPRINT_DOMAIN = 'wasm-idle:nim-runtime-manifest:v2';
const RUNTIME = 'benagastov-nim-wasm-compiler';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const BUILD_METADATA_FILE = 'runtime-build.json';
const WORKER_FILE = 'runner-worker.js';
const LICENSE_FILE = 'LICENSE';
const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md';
const DOCUMENTATION_FILE = 'README.md';
const EXPECTED_PROFILE_ID = 'nim-2.2.4-benagastov-ca3471ae';
const EXPECTED_LICENSE_EXPRESSION =
	'MIT AND Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND LicenseRef-WASI-Sysroot-Third-Party';
const MAX_ARCHIVE_BYTES = 48 * 1024 * 1024;
const MAX_SOURCE_ASSET_BYTES = 40 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_WORKER_BYTES = 8 * 1024 * 1024;
const ARCHIVE_TIMEOUT_MS = 120_000;
const EXPECTED_ARTIFACT = Object.freeze({
	kind: 'content-locked-git-archive-prebuilt',
	repository: 'https://github.com/benagastov/Nim-WASM-Compiler.git',
	revision: 'ca3471ae124b40b51268da6e202753dfa061731c',
	archiveUrl:
		'https://codeload.github.com/benagastov/Nim-WASM-Compiler/tar.gz/ca3471ae124b40b51268da6e202753dfa061731c',
	archiveRoot: 'Nim-WASM-Compiler-ca3471ae124b40b51268da6e202753dfa061731c',
	verifiedBuildInput: false,
	bytes: 45_276_618,
	sha256: '699745b3784ed544988b1524f4d718c16b8eb85de4af4809b48d3c3b299df101'
});
const EXPECTED_COMPONENTS = Object.freeze({
	distribution: Object.freeze({
		version: 'ca3471ae124b40b51268da6e202753dfa061731c',
		repository: 'https://github.com/benagastov/Nim-WASM-Compiler.git',
		revision: 'ca3471ae124b40b51268da6e202753dfa061731c',
		verifiedBuildInput: false,
		evidence: 'content-locked repository archive containing opaque prebuilt compiler assets'
	}),
	nim: Object.freeze({
		version: '2.2.4',
		repository: 'https://github.com/nim-lang/Nim.git',
		revision: 'f7145dd26efeeeb6eeae6fff649db244d81b212d',
		verifiedBuildInput: false,
		evidence:
			'nimbase.h is byte-exact to the v2.2.4 tag; compiler JavaScript/Wasm binary-to-source attestation is unavailable'
	}),
	llvm: Object.freeze({
		version: '8.0.1',
		repository: 'https://github.com/binji/wasm-clang.git',
		revision: '8e78cdb9caa80f75ed86d6632cb4e9310b22748c',
		archiveUrl:
			'https://codeload.github.com/binji/wasm-clang/tar.gz/8e78cdb9caa80f75ed86d6632cb4e9310b22748c',
		archiveBytes: 19_376_593,
		archiveSha256: '37ab5be0c68d1459a7e3e70d6214300858f7e53628efcbc0058953421f394fca',
		verifiedBuildInput: false,
		evidence:
			'clang, lld, memfs, and sysroot blobs are byte-exact to the pinned wasm-clang commit; compiler build inputs remain unattested'
	}),
	memfs: Object.freeze({
		version: 'clang-9.0.0-custom-producers-section',
		repository: 'https://github.com/llvm/llvm-project.git',
		revision: '0399d5a9682b3cef71c653373e38890c63c4c365',
		verifiedBuildInput: false,
		evidence: 'embedded producers-section identity only; binary build recipe is unavailable'
	}),
	emscripten: Object.freeze({
		version: 'unrecorded',
		repository: 'https://github.com/emscripten-core/emscripten.git',
		revision: 'unrecorded',
		verifiedBuildInput: false,
		evidence: 'opaque prebuilt Nim compiler loader without a recorded Emscripten revision'
	})
});
const EXPECTED_ASSETS = Object.freeze({
	'nim/nim-bundle.js': Object.freeze({ mediaType: 'text/javascript' }),
	'nim/nim.wasm': Object.freeze({ mediaType: 'application/wasm' }),
	'nim/nimbase.h': Object.freeze({ mediaType: 'text/x-c-header' }),
	'clang/clang.js': Object.freeze({ mediaType: 'text/javascript' }),
	'clang/clang.wasm': Object.freeze({ mediaType: 'application/wasm' }),
	'clang/lld.wasm': Object.freeze({ mediaType: 'application/wasm' }),
	'clang/memfs.wasm': Object.freeze({ mediaType: 'application/wasm' }),
	'clang/sysroot.tar': Object.freeze({ mediaType: 'application/x-tar' })
});
const LOGICAL_ASSETS = Object.freeze(Object.keys(EXPECTED_ASSETS));
const COMPRESSED_ASSETS = new Set([
	'nim/nim-bundle.js',
	'nim/nim.wasm',
	'clang/clang.wasm',
	'clang/lld.wasm',
	'clang/memfs.wasm',
	'clang/sysroot.tar'
]);
const EXPECTED_LOCK_KEYS = Object.freeze(
	[
		'artifact',
		'assets',
		'components',
		'documentation',
		'license',
		'licenseExpression',
		'notices',
		'profileId',
		'schemaVersion'
	].sort()
);
const EXPECTED_ASSET_KEYS = Object.freeze(
	['bytes', 'mediaType', 'path', 'sha256', 'sourceBytes', 'sourceSha256'].sort()
);
const EXPECTED_LICENSE_KEYS = Object.freeze(
	['bytes', 'path', 'sha256', 'sourceBytes', 'sourceSha256', 'spdx'].sort()
);
const EXPECTED_NOTICES_KEYS = Object.freeze(['bytes', 'mediaType', 'path', 'sha256'].sort());
const EXPECTED_DOCUMENTATION_KEYS = Object.freeze(['bytes', 'mediaType', 'path', 'sha256'].sort());

/** @typedef {{ bytes: number; sha256: string }} Receipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} LogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'gzip' | 'identity'; size: number; sha256: string }} StorageAsset */
/** @typedef {{ target: string; temporary: string; previous: string; hadTarget: boolean; backedUp: boolean; published: boolean }} Publication */

/**
 * @typedef {object} SyncWasmNimOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [lockFilePath]
 * @property {string} [noticeSourcePath]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
 * @property {(input: string, init?: RequestInit) => Promise<Response>} [fetchImpl]
 */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} value @param {readonly string[]} expectedKeys @returns {value is Record<string, unknown>} */
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
	if (primitive === undefined) throw new Error('Nim manifest contains a non-JSON value');
	return primitive;
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
async function isRegularFile(filePath) {
	return !!(await lstat(filePath).catch(() => null))?.isFile();
}

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
		!Number.isSafeInteger(value) ||
		/** @type {number} */ (value) <= 0 ||
		/** @type {number} */ (value) > maxBytes
	) {
		throw new Error(`${label} has an invalid byte size`);
	}
	return /** @type {number} */ (value);
}

/** @param {unknown} value @param {string} label */
function validateSha256(value, label) {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new Error(`${label} has an invalid SHA-256 receipt`);
	}
	return value;
}

/** @param {string} lockFilePath */
async function readInputLock(lockFilePath) {
	if (!(await isRegularFile(lockFilePath))) {
		throw new Error(`wasm-nim input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-nim input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!hasExactKeys(value, EXPECTED_LOCK_KEYS) ||
		value.schemaVersion !== 1 ||
		value.profileId !== EXPECTED_PROFILE_ID ||
		value.licenseExpression !== EXPECTED_LICENSE_EXPRESSION ||
		!isObject(value.artifact) ||
		canonicalJson(value.artifact) !== canonicalJson(EXPECTED_ARTIFACT) ||
		canonicalJson(value.components) !== canonicalJson(EXPECTED_COMPONENTS) ||
		!hasExactKeys(value.license, EXPECTED_LICENSE_KEYS) ||
		value.license.path !== LICENSE_FILE ||
		value.license.spdx !== EXPECTED_LICENSE_EXPRESSION ||
		!hasExactKeys(value.notices, EXPECTED_NOTICES_KEYS) ||
		value.notices.path !== NOTICES_FILE ||
		value.notices.mediaType !== 'text/markdown' ||
		!hasExactKeys(value.documentation, EXPECTED_DOCUMENTATION_KEYS) ||
		value.documentation.path !== DOCUMENTATION_FILE ||
		value.documentation.mediaType !== 'text/markdown' ||
		!Array.isArray(value.assets) ||
		value.assets.length !== LOGICAL_ASSETS.length
	) {
		throw new Error('wasm-nim input lock has invalid provenance metadata');
	}
	const receipts = new Map();
	for (const candidate of value.assets) {
		if (
			!hasExactKeys(candidate, EXPECTED_ASSET_KEYS) ||
			typeof candidate.path !== 'string' ||
			!Object.hasOwn(EXPECTED_ASSETS, candidate.path) ||
			receipts.has(candidate.path)
		) {
			throw new Error('wasm-nim input lock has an invalid or duplicate asset');
		}
		const expectedAsset =
			EXPECTED_ASSETS[/** @type {keyof typeof EXPECTED_ASSETS} */ (candidate.path)];
		if (candidate.mediaType !== expectedAsset.mediaType) {
			throw new Error('wasm-nim input lock has an invalid or duplicate asset');
		}
		receipts.set(
			candidate.path,
			Object.freeze({
				path: candidate.path,
				mediaType: candidate.mediaType,
				sourceBytes: validateReceipt(
					candidate.sourceBytes,
					`wasm-nim ${candidate.path} source`,
					MAX_SOURCE_ASSET_BYTES
				),
				sourceSha256: validateSha256(
					candidate.sourceSha256,
					`wasm-nim ${candidate.path} source`
				),
				bytes: validateReceipt(
					candidate.bytes,
					`wasm-nim ${candidate.path}`,
					MAX_SOURCE_ASSET_BYTES
				),
				sha256: validateSha256(candidate.sha256, `wasm-nim ${candidate.path}`)
			})
		);
	}
	if (LOGICAL_ASSETS.some((asset) => !receipts.has(asset))) {
		throw new Error('wasm-nim input lock is missing a required asset');
	}
	if (
		EXPECTED_ARTIFACT.bytes <= 0 ||
		EXPECTED_ARTIFACT.bytes > MAX_ARCHIVE_BYTES ||
		value.artifact.bytes !== EXPECTED_ARTIFACT.bytes
	) {
		throw new Error('wasm-nim archive receipt is internally inconsistent');
	}
	return Object.freeze({
		profileId: EXPECTED_PROFILE_ID,
		licenseExpression: EXPECTED_LICENSE_EXPRESSION,
		artifact: EXPECTED_ARTIFACT,
		components: EXPECTED_COMPONENTS,
		license: Object.freeze({
			path: LICENSE_FILE,
			spdx: EXPECTED_LICENSE_EXPRESSION,
			sourceBytes: validateReceipt(
				value.license.sourceBytes,
				'wasm-nim source license',
				MAX_METADATA_BYTES
			),
			sourceSha256: validateSha256(value.license.sourceSha256, 'wasm-nim source license'),
			bytes: validateReceipt(value.license.bytes, 'wasm-nim license', MAX_METADATA_BYTES),
			sha256: validateSha256(value.license.sha256, 'wasm-nim license')
		}),
		notices: Object.freeze({
			path: NOTICES_FILE,
			mediaType: 'text/markdown',
			bytes: validateReceipt(value.notices.bytes, 'wasm-nim notices', MAX_METADATA_BYTES),
			sha256: validateSha256(value.notices.sha256, 'wasm-nim notices')
		}),
		documentation: Object.freeze({
			path: DOCUMENTATION_FILE,
			mediaType: 'text/markdown',
			bytes: validateReceipt(
				value.documentation.bytes,
				'wasm-nim documentation',
				MAX_METADATA_BYTES
			),
			sha256: validateSha256(value.documentation.sha256, 'wasm-nim documentation')
		}),
		receipts
	});
}

/**
 * @param {{ profileId: string; licenseExpression: string; artifact: Record<string, unknown>; components: Record<string, unknown>; license: { path: string; spdx: string; size: number; sha256: string }; notices: { path: string; mediaType: string; size: number; sha256: string }; documentation: { path: string; mediaType: string; size: number; sha256: string }; metadata: { path: string; mediaType: string; size: number; sha256: string }; assets: LogicalAsset[]; storage: StorageAsset[] }} manifest
 */
export function computeNimRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${NIM_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${NIM_MANIFEST_FORMAT}\n`);
	hash.update(`runtime\0${RUNTIME}\n`);
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(`licenseExpression\0${manifest.licenseExpression}\n`);
	hash.update(`artifact\0${canonicalJson(manifest.artifact)}\n`);
	hash.update(`components\0${canonicalJson(manifest.components)}\n`);
	hash.update(
		`license\0${manifest.license.path}\0${manifest.license.spdx}\0${manifest.license.size}\0${manifest.license.sha256}\n`
	);
	hash.update(
		`notices\0${manifest.notices.path}\0${manifest.notices.mediaType}\0${manifest.notices.size}\0${manifest.notices.sha256}\n`
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
		// Preserve the boundary failure that caused cancellation.
	}
}

/**
 * @param {typeof EXPECTED_ARTIFACT} artifact
 * @param {(input: string, init?: RequestInit) => Promise<Response>} fetchImpl
 */
async function downloadRepositorySource(artifact, fetchImpl) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), ARCHIVE_TIMEOUT_MS);
	let response;
	try {
		response = await fetchImpl(artifact.archiveUrl, {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: controller.signal
		});
	} catch (error) {
		clearTimeout(timeout);
		throw new Error(
			`Nim source archive download failed: ${controller.signal.aborted ? 'timeout' : error}`
		);
	}
	try {
		if (!response.url || response.url !== artifact.archiveUrl) {
			throw new Error('Nim source archive response URL does not match the pinned URL');
		}
		if (!response.ok) {
			throw new Error(`Nim source archive request failed with status ${response.status}`);
		}
		const contentLength = response.headers.get('content-length');
		if (contentLength !== null) {
			const normalized = contentLength.trim();
			const parsed = Number(normalized);
			if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(parsed)) {
				throw new Error('Nim source archive has an invalid Content-Length');
			}
			if (parsed !== artifact.bytes) {
				throw new Error('Nim source archive Content-Length does not match the input lock');
			}
		}
	} catch (error) {
		clearTimeout(timeout);
		cancelResponse(response, error);
		throw error;
	}
	if (!response.body) {
		const error = new Error('Nim source archive response does not provide a byte stream');
		clearTimeout(timeout);
		cancelResponse(response, error);
		throw error;
	}
	const reader = response.body.getReader();
	const bytes = new Uint8Array(artifact.bytes);
	let loaded = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array)) {
				throw new Error('Nim source archive returned an invalid byte stream');
			}
			const nextLoaded = loaded + value.byteLength;
			if (!Number.isSafeInteger(nextLoaded) || nextLoaded > artifact.bytes) {
				throw new Error('Nim source archive exceeds the input lock size');
			}
			bytes.set(value, loaded);
			loaded = nextLoaded;
		}
		if (loaded !== artifact.bytes) throw new Error('Nim source archive is truncated');
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
	if (sha256(bytes) !== artifact.sha256) {
		throw new Error('Nim source archive does not match the input lock');
	}

	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'wasm-idle-nim-'));
	try {
		const archivePath = path.join(temporaryRoot, 'source.tar.gz');
		await writeFile(archivePath, bytes);
		const { stdout } = await execFileAsync('tar', ['-tzf', archivePath], {
			maxBuffer: 1024 * 1024
		});
		const entries = stdout.split(/\r?\n/u).filter(Boolean);
		if (
			entries.length === 0 ||
			entries.some(
				(entry) =>
					!entry.startsWith(`${artifact.archiveRoot}/`) ||
					entry.includes('/../') ||
					entry.includes('\\')
			)
		) {
			throw new Error('Nim source archive has an invalid entry path');
		}
		await execFileAsync('tar', ['-xzf', archivePath, '-C', temporaryRoot], {
			maxBuffer: 1024 * 1024
		});
		const sourceRoot = path.join(temporaryRoot, artifact.archiveRoot);
		return {
			sourceDir: path.join(sourceRoot, 'demo', 'static'),
			sourceRoot,
			mode: 'source',
			temporaryRoot
		};
	} catch (error) {
		await rm(temporaryRoot, { recursive: true, force: true });
		throw error;
	}
}

/** @param {string} candidate */
async function resolveExternalSource(candidate) {
	const resolved = path.resolve(candidate);
	for (const staticDir of [
		resolved,
		path.join(resolved, 'static'),
		path.join(resolved, 'demo', 'static')
	]) {
		if (await isRegularFile(path.join(staticDir, 'nim', 'nim-bundle.js'))) {
			let sourceRoot = staticDir;
			for (let depth = 0; depth < 4; depth += 1) {
				if (
					(await isRegularFile(path.join(sourceRoot, LICENSE_FILE))) &&
					(await isRegularFile(path.join(sourceRoot, DOCUMENTATION_FILE)))
				) {
					return {
						sourceDir: staticDir,
						sourceRoot,
						mode: 'source',
						temporaryRoot: null
					};
				}
				const parent = path.dirname(sourceRoot);
				if (parent === sourceRoot) break;
				sourceRoot = parent;
			}
		}
	}
	throw new Error(`Nim WASM source assets were not found under ${resolved}`);
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
		(await isRegularFile(path.join(targetDir, NOTICES_FILE))) &&
		(await isRegularFile(path.join(targetDir, DOCUMENTATION_FILE)))
	);
}

const CLANG_MODIFICATION_NOTICE = `/*
 * wasm-idle modification notice:
 * This file was modified to consume an exact host-verified compiler asset map,
 * remove embedded-worker network fetches, and return the linked Wasm artifact
 * without executing it in the compiler worker. See THIRD_PARTY_NOTICES.md.
 */
`;

/** @param {string} source */
export function patchNimLicense(source) {
	const projectNeedle = 'binji/clang.js project';
	const urlNeedle = 'https://github.com/binji/clang.js';
	if (
		source.split(projectNeedle).length !== 2 ||
		source.split(urlNeedle).length !== 2 ||
		source.includes(NOTICES_FILE)
	) {
		throw new Error('Nim source license did not match the expected legacy notice');
	}
	return `${source
		.replace(projectNeedle, 'binji/wasm-clang project')
		.replace(urlNeedle, 'https://github.com/binji/wasm-clang')
		.trimEnd()}\n\nFull upstream license texts and the wasm-idle modification notice are provided in\n${NOTICES_FILE}.\n`;
}

/** @param {string} source */
export function patchClangJs(source) {
	const match = source.match(/a="([A-Za-z0-9+/=]+)"/);
	if (!match) throw new Error('clang.js did not contain the embedded worker payload');
	let workerSource = Buffer.from(match[1], 'base64').toString('utf8');
	const fetchNeedle =
		'readBuffer:async t=>(await fetch(`${a}/${t}`)).arrayBuffer(),async compileStreaming(t){const e=await fetch(`${a}/${t}`,{cache:"no-store"});return WebAssembly.compile(await e.arrayBuffer())}';
	const fetchReplacement =
		'readBuffer:async t=>readAsset(a,t),async compileStreaming(t){return WebAssembly.compile(readAsset(a,t))}';
	if (!workerSource.includes(fetchNeedle)) {
		throw new Error('clang.js embedded worker fetch path did not match the expected source');
	}
	workerSource = workerSource.replace(fetchNeedle, fetchReplacement);
	const helperNeedle = 'let s,i;let r=null;const n=async t=>{';
	const helper =
		'function validateAssets(a){const e=["clang.wasm","lld.wasm","memfs.wasm","sysroot.tar"];if(!a||typeof a!=="object"||JSON.stringify(Object.keys(a).sort())!==JSON.stringify(e))throw new Error("invalid compiler asset map");for(const t of e)if(!(a[t] instanceof ArrayBuffer))throw new Error(`invalid compiler asset: ${t}`);return a}function readAsset(a,t){if(!Object.prototype.hasOwnProperty.call(a,t))throw new Error(`undeclared compiler asset: ${t}`);return a[t]}';
	if (!workerSource.includes(helperNeedle)) {
		throw new Error('clang.js embedded worker init block did not match the expected source');
	}
	workerSource = workerSource.replace(helperNeedle, `${helper}${helperNeedle}`);
	const constructorNeedle = 'a=h.path,{readBuffer:';
	if (!workerSource.includes(constructorNeedle)) {
		throw new Error('clang.js embedded worker constructor did not match the expected source');
	}
	workerSource = workerSource.replace(
		constructorNeedle,
		'a=validateAssets(h.assets),{readBuffer:'
	);
	const compileEachNeedle = 'case"compile-each-link":{const files=h.files;';
	if (!workerSource.includes(compileEachNeedle)) {
		throw new Error('clang.js embedded worker compile-each-link case did not match');
	}
	workerSource = workerSource.replace(
		compileEachNeedle,
		'case"compile-each-link":{try{const files=h.files;'
	);
	const runNeedle =
		'const o=s.memfs.getFileContents(h.out);const inst=await s.hostLogAsync(`Compiling ${h.out}`,WebAssembly.compile(o));const finalResult=await s.run(inst,h.out);i.postMessage({id:"compile-each-link-done",data:finalResult?{ok:true}:{ok:false}});';
	if (!workerSource.includes(runNeedle)) {
		throw new Error('clang.js embedded worker compile-each-link block did not match');
	}
	workerSource = workerSource.replace(
		runNeedle,
		'i.postMessage({id:"compile-each-link-done",data:{ok:true}});}catch(err){i.postMessage({id:"compile-each-link-done",data:{ok:false,error:String(err&&err.message||err)}});}'
	);
	let patched = source.replace(match[1], Buffer.from(workerSource, 'utf8').toString('base64'));
	const outerConstructorNeedle =
		'this.worker.postMessage({id:"constructor",payload:{port:c,path:l}},[c])';
	const outerConstructorReplacement =
		'const v=Object.values(l);this.worker.postMessage({id:"constructor",payload:{port:c,assets:l}},[c,...v])';
	if (!patched.includes(outerConstructorNeedle)) {
		throw new Error('clang.js outer worker constructor did not match the expected source');
	}
	patched = patched.replace(outerConstructorNeedle, outerConstructorReplacement);
	const outerInitNeedle =
		'async function p({path:l}){m||(y=new o(l||location.origin),await y.onReady,m=!0)}';
	const outerInitReplacement =
		'async function p({assets:l}){m||(y=new o(l),await y.onReady,m=!0)}';
	if (!patched.includes(outerInitNeedle)) {
		throw new Error('clang.js outer init did not match the expected source');
	}
	return `${CLANG_MODIFICATION_NOTICE}${patched.replace(outerInitNeedle, outerInitReplacement)}`;
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @param {number} expectedBytes
 * @param {string} expectedSha256
 * @param {string} label
 */
async function readReceiptFile(root, relativePath, expectedBytes, expectedSha256, label) {
	const rootBoundary = await realpath(root);
	const filePath = path.join(root, relativePath);
	const stats = await lstat(filePath).catch(() => null);
	if (!stats?.isFile() || stats.size !== expectedBytes) {
		throw new Error(`${label} has an invalid size`);
	}
	const fileBoundary = await realpath(filePath);
	if (!containsPath(rootBoundary, fileBoundary)) {
		throw new Error(`${label} escapes its source root`);
	}
	const bytes = await readFile(fileBoundary);
	if (sha256(bytes) !== expectedSha256) throw new Error(`${label} does not match its receipt`);
	return bytes;
}

/** @param {Uint8Array} bytes @param {string} label */
function requireWasm(bytes, label) {
	if (
		bytes.byteLength < 8 ||
		bytes[0] !== 0x00 ||
		bytes[1] !== 0x61 ||
		bytes[2] !== 0x73 ||
		bytes[3] !== 0x6d
	) {
		throw new Error(`${label} does not have a WebAssembly module header`);
	}
}

/** @param {SyncWasmNimOptions} [options] */
export async function syncWasmNimAssets(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const noticeSourcePath = path.resolve(options.noticeSourcePath || DEFAULT_NOTICE_SOURCE_PATH);
	const renamePath = options.renamePath || rename;
	const fetchImpl = options.fetchImpl || globalThis.fetch;
	if (typeof fetchImpl !== 'function') throw new Error('Nim source download requires fetch');
	const lock = await readInputLock(lockFilePath);
	let source;
	if (options.sourceDir !== undefined) {
		source = await resolveExternalSource(options.sourceDir);
	} else if (process.env.WASM_NIM_SOURCE_DIR !== undefined) {
		source = await resolveExternalSource(process.env.WASM_NIM_SOURCE_DIR);
	} else if (await targetLooksUsable(targetDir)) {
		source = {
			sourceDir: targetDir,
			sourceRoot: targetDir,
			mode: 'installed',
			temporaryRoot: null
		};
	} else {
		source = await downloadRepositorySource(lock.artifact, fetchImpl);
	}

	try {
		for (const [targetPath, kind, label] of [
			[targetDir, 'directory', 'runtime target'],
			[versionModulePath, 'file', 'version module']
		]) {
			const stats = await lstat(targetPath).catch(() => null);
			if (stats && !(kind === 'directory' ? stats.isDirectory() : stats.isFile())) {
				throw new Error(`wasm-nim ${label} has the wrong file type: ${targetPath}`);
			}
		}
		for (const [filePath, label] of [
			[workerSourcePath, 'worker source'],
			[lockFilePath, 'input lock'],
			[noticeSourcePath, 'third-party notice source']
		]) {
			if (!(await isRegularFile(filePath))) {
				throw new Error(`wasm-nim ${label} must be a regular file: ${filePath}`);
			}
		}
		if (!(await lstat(source.sourceDir).catch(() => null))?.isDirectory()) {
			throw new Error(`wasm-nim source must be a directory: ${source.sourceDir}`);
		}
		await validateNimLlvmProfile(source.sourceDir);

		const outputBoundaries = await Promise.all(
			[targetDir, versionModulePath].map(resolveBoundaryPath)
		);
		const inputPaths = [workerSourcePath, lockFilePath, noticeSourcePath];
		if (source.mode !== 'installed') inputPaths.push(source.sourceRoot);
		const inputBoundaries = await Promise.all(inputPaths.map(resolveBoundaryPath));
		if (pathsOverlap(outputBoundaries[0], outputBoundaries[1])) {
			throw new Error('wasm-nim publication targets must not overlap');
		}
		for (const outputBoundary of outputBoundaries) {
			for (const inputBoundary of inputBoundaries) {
				if (pathsOverlap(outputBoundary, inputBoundary)) {
					throw new Error('wasm-nim publication targets must not overlap their inputs');
				}
			}
		}

		/** @type {Map<string, Uint8Array>} */
		const logicalBytes = new Map();
		for (const assetPath of LOGICAL_ASSETS) {
			const receipt = lock.receipts.get(assetPath);
			if (!receipt) throw new Error(`Nim receipt for ${assetPath} is missing`);
			let bytes;
			if (source.mode === 'installed') {
				const rawPath = path.join(source.sourceDir, assetPath);
				const rawStats = await lstat(rawPath).catch(() => null);
				if (rawStats?.isFile()) {
					bytes = await readReceiptFile(
						source.sourceDir,
						assetPath,
						receipt.bytes,
						receipt.sha256,
						`Nim installed ${assetPath}`
					);
				} else {
					const compressedPath = `${assetPath}.gz`;
					const compressedStats = await lstat(
						path.join(source.sourceDir, compressedPath)
					).catch(() => null);
					if (
						!compressedStats?.isFile() ||
						compressedStats.size <= 0 ||
						compressedStats.size > MAX_SOURCE_ASSET_BYTES
					) {
						throw new Error(`Nim installed ${assetPath} is missing or oversized`);
					}
					const compressed = await readFile(path.join(source.sourceDir, compressedPath));
					try {
						bytes = gunzipSync(compressed, { maxOutputLength: receipt.bytes });
					} catch {
						throw new Error(`Nim installed ${assetPath} is not a bounded gzip asset`);
					}
					if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
						throw new Error(`Nim installed ${assetPath} does not match its receipt`);
					}
				}
			} else {
				const sourceBytes = await readReceiptFile(
					source.sourceDir,
					assetPath,
					receipt.sourceBytes,
					receipt.sourceSha256,
					`Nim source ${assetPath}`
				);
				bytes = sourceBytes;
				if (assetPath === 'clang/clang.js') {
					let sourceText;
					try {
						sourceText = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
					} catch {
						throw new Error('Nim source clang/clang.js is not valid UTF-8');
					}
					bytes = Buffer.from(patchClangJs(sourceText), 'utf8');
				}
				if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
					throw new Error(`Nim derived ${assetPath} does not match its receipt`);
				}
			}
			logicalBytes.set(assetPath, bytes);
		}

		const workerStats = await lstat(workerSourcePath);
		if (workerStats.size <= 0 || workerStats.size > MAX_WORKER_BYTES) {
			throw new Error('Nim worker source exceeds the producer limit');
		}
		let licenseBytes;
		if (source.mode === 'installed') {
			licenseBytes = await readReceiptFile(
				source.sourceRoot,
				lock.license.path,
				lock.license.bytes,
				lock.license.sha256,
				'Nim installed license'
			);
		} else {
			const sourceLicenseBytes = await readReceiptFile(
				source.sourceRoot,
				lock.license.path,
				lock.license.sourceBytes,
				lock.license.sourceSha256,
				'Nim source license'
			);
			let sourceLicense;
			try {
				sourceLicense = new TextDecoder('utf-8', { fatal: true }).decode(
					sourceLicenseBytes
				);
			} catch {
				throw new Error('Nim source license is not valid UTF-8');
			}
			licenseBytes = Buffer.from(patchNimLicense(sourceLicense), 'utf8');
			if (
				licenseBytes.byteLength !== lock.license.bytes ||
				sha256(licenseBytes) !== lock.license.sha256
			) {
				throw new Error('Nim derived license does not match its receipt');
			}
		}
		const noticeStats = await lstat(noticeSourcePath);
		if (noticeStats.size !== lock.notices.bytes) {
			throw new Error('Nim third-party notice source has an invalid size');
		}
		const [documentationBytes, noticeBytes, workerBytes] = await Promise.all([
			readReceiptFile(
				source.sourceRoot,
				lock.documentation.path,
				lock.documentation.bytes,
				lock.documentation.sha256,
				'Nim documentation'
			),
			readFile(noticeSourcePath),
			readFile(workerSourcePath)
		]);
		if (sha256(noticeBytes) !== lock.notices.sha256) {
			throw new Error('Nim third-party notice source does not match its receipt');
		}

		let nimBundleSource;
		let clangSource;
		let nimbaseSource;
		let licenseSource;
		let noticeSource;
		let documentationSource;
		let workerSource;
		try {
			const decoder = new TextDecoder('utf-8', { fatal: true });
			nimBundleSource = decoder.decode(logicalBytes.get('nim/nim-bundle.js'));
			clangSource = decoder.decode(logicalBytes.get('clang/clang.js'));
			nimbaseSource = decoder.decode(logicalBytes.get('nim/nimbase.h'));
			licenseSource = decoder.decode(licenseBytes);
			noticeSource = decoder.decode(noticeBytes);
			documentationSource = decoder.decode(documentationBytes);
			workerSource = decoder.decode(workerBytes);
			new Function(workerSource);
		} catch {
			throw new Error('Nim runtime source contains invalid UTF-8 or JavaScript');
		}
		if (
			!nimBundleSource.includes('__NIM_USER_CODE__') ||
			!nimBundleSource.includes('callMain') ||
			!clangSource.includes('payload:{port:c,assets:l}') ||
			!clangSource.includes('async function p({assets:l})') ||
			!clangSource.includes('compile-each-link-done') ||
			!nimbaseSource.includes('NIM_INTBITS') ||
			!licenseSource.includes('Permission is hereby granted') ||
			!licenseSource.includes('binji/wasm-clang') ||
			licenseSource.includes('binji/clang.js') ||
			!licenseSource.includes(NOTICES_FILE) ||
			!noticeSource.includes(EXPECTED_ARTIFACT.revision) ||
			!noticeSource.includes(EXPECTED_COMPONENTS.llvm.revision) ||
			!noticeSource.includes(EXPECTED_COMPONENTS.nim.revision) ||
			!noticeSource.includes('wasm-idle modification notice') ||
			!noticeSource.includes('Apache License') ||
			!noticeSource.includes('LLVM Exceptions') ||
			!noticeSource.includes('Copyright (C) 2006-2025 Andreas Rumpf') ||
			!noticeSource.includes('LicenseRef-WASI-Sysroot-Third-Party') ||
			!documentationSource.includes('Compile and run **Nim 2.2.4**') ||
			!workerSource.includes(NIM_MANIFEST_FORMAT) ||
			!workerSource.includes(EXPECTED_PROFILE_ID) ||
			!workerSource.includes('self.onmessage')
		) {
			throw new Error('Nim runtime source does not expose the pinned runtime contract');
		}
		for (const assetPath of [
			'nim/nim.wasm',
			'clang/clang.wasm',
			'clang/lld.wasm',
			'clang/memfs.wasm'
		]) {
			const bytes = logicalBytes.get(assetPath);
			if (!bytes) throw new Error(`Nim runtime ${assetPath} is missing`);
			requireWasm(bytes, assetPath);
		}
		const sysroot = logicalBytes.get('clang/sysroot.tar');
		if (
			!sysroot ||
			sysroot.byteLength < 512 ||
			new TextDecoder().decode(sysroot.subarray(257, 262)) !== 'ustar'
		) {
			throw new Error('clang/sysroot.tar does not have a ustar header');
		}

		/** @type {LogicalAsset[]} */
		const assets = LOGICAL_ASSETS.map((assetPath) => {
			const bytes = logicalBytes.get(assetPath);
			if (!bytes) throw new Error(`Nim runtime ${assetPath} is missing`);
			return {
				path: assetPath,
				mediaType:
					EXPECTED_ASSETS[/** @type {keyof typeof EXPECTED_ASSETS} */ (assetPath)].mediaType,
				size: bytes.byteLength,
				sha256: sha256(bytes)
			};
		});
		/** @type {Map<string, Uint8Array>} */
		const storageBytes = new Map();
		/** @type {StorageAsset[]} */
		const storage = assets.map((asset) => {
			const logical = logicalBytes.get(asset.path);
			if (!logical) throw new Error(`Nim runtime ${asset.path} is missing`);
			const compressed = COMPRESSED_ASSETS.has(asset.path);
			const stored = compressed ? gzipSync(logical, { level: 9 }) : logical;
			const storagePath = compressed ? `${asset.path}.gz` : asset.path;
			storageBytes.set(storagePath, stored);
			return {
				path: storagePath,
				logicalPath: asset.path,
				encoding: compressed ? 'gzip' : 'identity',
				size: stored.byteLength,
				sha256: sha256(stored)
			};
		});
		const license = {
			path: lock.license.path,
			spdx: lock.license.spdx,
			size: licenseBytes.byteLength,
			sha256: sha256(licenseBytes)
		};
		const notices = {
			path: lock.notices.path,
			mediaType: lock.notices.mediaType,
			size: noticeBytes.byteLength,
			sha256: sha256(noticeBytes)
		};
		const documentation = {
			path: lock.documentation.path,
			mediaType: lock.documentation.mediaType,
			size: documentationBytes.byteLength,
			sha256: sha256(documentationBytes)
		};
		const runtimeBuild = Object.freeze({
			format: 'wasm-nim-runtime-build-v2',
			runtime: RUNTIME,
			profileId: lock.profileId,
			provenanceLevel: 'content-locked-opaque-prebuilt',
			licenseExpression: lock.licenseExpression,
			artifact: lock.artifact,
			components: lock.components,
			llvmProfile: {
				id: NIM_LLVM_PROFILE.id,
				profileVersion: NIM_LLVM_PROFILE.version,
				nimVersion: NIM_LLVM_PROFILE.nimVersion,
				llvmVersion: NIM_LLVM_PROFILE.llvmVersion
			},
			transformations: [
				{
					id: 'wasm-idle-clang-js-asset-map-and-compile-each-link-v2',
					path: 'clang/clang.js',
					modificationNotice: NOTICES_FILE
				},
				{
					id: 'correct-wasm-clang-license-reference-and-link-notices-v1',
					path: LICENSE_FILE
				},
				{ id: 'node-zlib-gzip-level-9', paths: [...COMPRESSED_ASSETS].sort() }
			],
			legalFiles: [license, notices],
			sourceAssets: LOGICAL_ASSETS.map((assetPath) => {
				const receipt = lock.receipts.get(assetPath);
				return {
					path: assetPath,
					size: receipt.sourceBytes,
					sha256: receipt.sourceSha256
				};
			})
		});
		const metadataBytes = Buffer.from(`${JSON.stringify(runtimeBuild, null, 2)}\n`, 'utf8');
		const metadata = {
			path: BUILD_METADATA_FILE,
			mediaType: 'application/json',
			size: metadataBytes.byteLength,
			sha256: sha256(metadataBytes)
		};
		const fingerprint = computeNimRuntimeFingerprint({
			profileId: lock.profileId,
			licenseExpression: lock.licenseExpression,
			artifact: lock.artifact,
			components: lock.components,
			license,
			notices,
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
			format: NIM_MANIFEST_FORMAT,
			runtime: RUNTIME,
			profileId: lock.profileId,
			fingerprint,
			licenseExpression: lock.licenseExpression,
			artifact: lock.artifact,
			components: lock.components,
			license,
			notices,
			documentation,
			metadata,
			assets,
			storage
		};
		const legacyManifest = {
			format: 'wasm-nim-runtime-manifest-v1',
			runtime: RUNTIME,
			repository: lock.artifact.repository,
			repositoryCommit: lock.artifact.revision,
			llvmProfile: {
				id: NIM_LLVM_PROFILE.id,
				profileVersion: NIM_LLVM_PROFILE.version,
				nimVersion: NIM_LLVM_PROFILE.nimVersion,
				llvmVersion: NIM_LLVM_PROFILE.llvmVersion
			},
			fingerprint: fingerprint.slice(0, 16),
			files: [
				LICENSE_FILE,
				NOTICES_FILE,
				DOCUMENTATION_FILE,
				...storage.map((asset) => asset.path)
			].sort()
		};
		const versionModuleSource = `export const WASM_NIM_ASSET_VERSION =\n\t'${fingerprint}';\nexport const WASM_NIM_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;
		const expectedFiles = [
			LICENSE_FILE,
			NOTICES_FILE,
			DOCUMENTATION_FILE,
			BUILD_METADATA_FILE,
			LEGACY_MANIFEST_FILE,
			MANIFEST_FILE,
			WORKER_FILE,
			...storage.map((asset) => asset.path)
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
			for (const filePath of expectedFiles) {
				await mkdir(path.dirname(path.join(publications[0].temporary, filePath)), {
					recursive: true
				});
			}
			await Promise.all([
				...storage.map((asset) => {
					const bytes = storageBytes.get(asset.path);
					if (!bytes) throw new Error(`Nim runtime storage ${asset.path} is missing`);
					return writeFile(path.join(publications[0].temporary, asset.path), bytes);
				}),
				writeFile(path.join(publications[0].temporary, LICENSE_FILE), licenseBytes),
				writeFile(path.join(publications[0].temporary, NOTICES_FILE), noticeBytes),
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

			const installedFiles = [];
			const pendingDirectories = [publications[0].temporary];
			while (pendingDirectories.length) {
				const directory = pendingDirectories.pop();
				if (!directory) throw new Error('wasm-nim temporary directory queue is empty');
				for (const entry of await readdir(directory, { withFileTypes: true })) {
					const entryPath = path.join(directory, entry.name);
					if (entry.isDirectory()) pendingDirectories.push(entryPath);
					else if (entry.isFile()) {
						installedFiles.push(
							path
								.relative(publications[0].temporary, entryPath)
								.split(path.sep)
								.join('/')
						);
					} else {
						throw new Error('wasm-nim temporary installation contains a special file');
					}
				}
			}
			if (JSON.stringify(installedFiles.sort()) !== JSON.stringify(expectedFiles)) {
				throw new Error('wasm-nim temporary installation has unexpected files');
			}
			await validateNimLlvmProfile(publications[0].temporary);
			const installedManifest = JSON.parse(
				await readFile(path.join(publications[0].temporary, MANIFEST_FILE), 'utf8')
			);
			if (
				JSON.stringify(installedManifest) !== JSON.stringify(manifest) ||
				computeNimRuntimeFingerprint(installedManifest) !== fingerprint ||
				(await readFile(publications[1].temporary, 'utf8')) !== versionModuleSource
			) {
				throw new Error('wasm-nim temporary installation failed manifest verification');
			}
			for (const asset of assets) {
				const storageReceipt = storage.find(
					(candidate) => candidate.logicalPath === asset.path
				);
				if (!storageReceipt) {
					throw new Error(
						`wasm-nim temporary storage receipt is missing for ${asset.path}`
					);
				}
				const storedPath = storageReceipt.path;
				const stored = await readFile(path.join(publications[0].temporary, storedPath));
				if (
					stored.byteLength !== storageReceipt.size ||
					sha256(stored) !== storageReceipt.sha256
				) {
					throw new Error(
						`wasm-nim temporary storage verification failed for ${storedPath}`
					);
				}
				const logical =
					storageReceipt.encoding === 'gzip'
						? gunzipSync(stored, { maxOutputLength: asset.size })
						: stored;
				if (logical.byteLength !== asset.size || sha256(logical) !== asset.sha256) {
					throw new Error(
						`wasm-nim temporary logical verification failed for ${asset.path}`
					);
				}
			}
			for (const receiptFile of [
				{ path: LICENSE_FILE, bytes: licenseBytes, receipt: license },
				{ path: NOTICES_FILE, bytes: noticeBytes, receipt: notices },
				{ path: DOCUMENTATION_FILE, bytes: documentationBytes, receipt: documentation },
				{ path: BUILD_METADATA_FILE, bytes: metadataBytes, receipt: metadata },
				{ path: WORKER_FILE, bytes: workerBytes, receipt: workerReceipt }
			]) {
				const installed = await readFile(
					path.join(publications[0].temporary, receiptFile.path)
				);
				const expectedSize =
					'size' in receiptFile.receipt
						? receiptFile.receipt.size
						: receiptFile.receipt.bytes;
				if (
					!installed.equals(receiptFile.bytes) ||
					installed.byteLength !== expectedSize ||
					sha256(installed) !== receiptFile.receipt.sha256
				) {
					throw new Error(
						`wasm-nim temporary receipt verification failed for ${receiptFile.path}`
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
						'wasm-nim publication failed and rollback was incomplete'
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
	const result = await syncWasmNimAssets({
		...(sourceDirArg ? { sourceDir: path.resolve(sourceDirArg) } : {}),
		...(targetDirArg ? { targetDir: path.resolve(targetDirArg) } : {})
	});
	console.log(`Synced wasm-nim from ${result.sourceDir} to ${result.targetDir}`);
}
