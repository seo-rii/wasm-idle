import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-lisp', 'dist');
const DEFAULT_COMPILER_INPUT_PATH = path.resolve(
	REPO_ROOT,
	'runtimes',
	'wasm-lisp',
	'vendor',
	'puppy-scheme',
	'puppyc.wasm'
);
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-lisp');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmLispVersion.ts'
);
const DEFAULT_LSP_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'lsp',
	'src',
	'bundledLispRuntime.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-lisp-assets.lock.json');

export const LISP_MANIFEST_FORMAT = 'wasm-lisp-runtime-manifest-v2';
export const LISP_FINGERPRINT_DOMAIN = 'wasm-idle:lisp-runtime-manifest:v2';
const RUNTIME = 'puppy-scheme';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const BUILD_METADATA_FILE = 'runtime-build.json';
const LICENSE_FILE = 'LICENSE';
const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md';
const DECLARATION_FILE = 'index.d.ts';
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const LOGICAL_ASSET_CONTRACT = Object.freeze({
	'index.js': Object.freeze({ mediaType: 'text/javascript', role: 'runtime' }),
	'puppyc.core.wasm': Object.freeze({ mediaType: 'application/wasm', role: 'runtime' }),
	'puppyc.core2.wasm': Object.freeze({ mediaType: 'application/wasm', role: 'runtime' }),
	'puppyc.js': Object.freeze({ mediaType: 'text/javascript', role: 'runtime' })
});
const LOGICAL_ASSETS = Object.freeze(Object.keys(LOGICAL_ASSET_CONTRACT).sort());
const COMPRESSED_ASSETS = new Set(['index.js', 'puppyc.core2.wasm']);
const EXPECTED_LOCK_KEYS = Object.freeze(
	[
		'artifact',
		'assets',
		'components',
		'declaration',
		'legalInputs',
		'license',
		'licenseExpression',
		'metadata',
		'notices',
		'profileId',
		'provenanceLevel',
		'schemaVersion',
		'transformations'
	].sort()
);
const EXPECTED_ASSET_KEYS = Object.freeze(['bytes', 'mediaType', 'path', 'sha256'].sort());
const EXPECTED_RECEIPT_KEYS = Object.freeze(['bytes', 'path', 'sha256'].sort());
const EXPECTED_TYPED_RECEIPT_KEYS = Object.freeze(['bytes', 'mediaType', 'path', 'sha256'].sort());
const EXPECTED_LICENSE_KEYS = Object.freeze(['bytes', 'path', 'sha256', 'spdx'].sort());
const EXPECTED_ARTIFACT_KEYS = Object.freeze(
	[
		'asset',
		'assetUrl',
		'bytes',
		'evidence',
		'kind',
		'release',
		'repository',
		'revision',
		'sha256',
		'verifiedBuildInput'
	].sort()
);

/** @typedef {{ path: string; mediaType: string; role: 'runtime' | 'provenance'; size: number; sha256: string }} LispLogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'identity' | 'gzip'; size: number; sha256: string }} LispStorageAsset */
/** @typedef {{ target: string; temporary: string; previous: string; hadTarget: boolean; backedUp: boolean; published: boolean }} Publication */

/**
 * @typedef {object} SyncWasmLispOptions
 * @property {string} [sourceDir]
 * @property {string} [compilerInputPath]
 * @property {string} [targetDir]
 * @property {string} [versionModulePath]
 * @property {string} [lspVersionModulePath]
 * @property {string} [lockFilePath]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
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
	if (primitive === undefined)
		throw new Error('Scheme runtime metadata contains a non-JSON value');
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
function validateByteSize(value, label, maxBytes) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > maxBytes) {
		throw new Error(`${label} has an invalid byte size`);
	}
	return value;
}

/** @param {unknown} value @param {string} label */
function validateSha256(value, label) {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new Error(`${label} has an invalid SHA-256 receipt`);
	}
	return value;
}

/** @param {unknown} value @param {string} pathValue @param {number} maxBytes */
function validateReceipt(value, pathValue, maxBytes) {
	if (!hasExactKeys(value, EXPECTED_RECEIPT_KEYS) || value.path !== pathValue) {
		throw new Error(`wasm-lisp receipt for ${pathValue} is invalid`);
	}
	return Object.freeze({
		path: pathValue,
		bytes: validateByteSize(value.bytes, `wasm-lisp ${pathValue}`, maxBytes),
		sha256: validateSha256(value.sha256, `wasm-lisp ${pathValue}`)
	});
}

/** @param {string} lockFilePath */
async function readInputLock(lockFilePath) {
	if (!(await isRegularFile(lockFilePath))) {
		throw new Error(`wasm-lisp input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-lisp input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!hasExactKeys(value, EXPECTED_LOCK_KEYS) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!/^puppy-scheme-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		value.provenanceLevel !== 'pinned-release-artifact-and-receipted-derived-output' ||
		value.licenseExpression !== 'BSD-3-Clause AND Apache-2.0 WITH LLVM-exception' ||
		!hasExactKeys(value.artifact, EXPECTED_ARTIFACT_KEYS) ||
		value.artifact.kind !== 'github-release-asset' ||
		value.artifact.repository !== 'https://github.com/matthewp/puppy-scheme' ||
		value.artifact.release !== 'v0.0.7' ||
		value.artifact.revision !== '315dcebacea3af8dbfa87285598210c71a4dca47' ||
		value.artifact.asset !== 'puppyc.wasm' ||
		value.artifact.assetUrl !==
			'https://github.com/matthewp/puppy-scheme/releases/download/v0.0.7/puppyc.wasm' ||
		value.artifact.verifiedBuildInput !== false ||
		typeof value.artifact.evidence !== 'string' ||
		value.artifact.evidence.length === 0 ||
		!isObject(value.components) ||
		!Array.isArray(value.transformations) ||
		!isObject(value.legalInputs) ||
		!Array.isArray(value.assets) ||
		value.assets.length !== LOGICAL_ASSETS.length
	) {
		throw new Error('wasm-lisp input lock has invalid provenance metadata');
	}
	if (
		!hasExactKeys(value.license, EXPECTED_LICENSE_KEYS) ||
		value.license.path !== LICENSE_FILE ||
		value.license.spdx !== 'BSD-3-Clause' ||
		!hasExactKeys(value.notices, EXPECTED_TYPED_RECEIPT_KEYS) ||
		value.notices.path !== NOTICES_FILE ||
		value.notices.mediaType !== 'text/markdown' ||
		!hasExactKeys(value.metadata, EXPECTED_TYPED_RECEIPT_KEYS) ||
		value.metadata.path !== BUILD_METADATA_FILE ||
		value.metadata.mediaType !== 'application/json' ||
		!hasExactKeys(value.declaration, EXPECTED_TYPED_RECEIPT_KEYS) ||
		value.declaration.path !== DECLARATION_FILE ||
		value.declaration.mediaType !== 'text/typescript'
	) {
		throw new Error('wasm-lisp input lock has invalid legal or metadata receipts');
	}
	const assets = new Map();
	for (const candidate of value.assets) {
		if (
			!hasExactKeys(candidate, EXPECTED_ASSET_KEYS) ||
			typeof candidate.path !== 'string' ||
			!Object.hasOwn(LOGICAL_ASSET_CONTRACT, candidate.path) ||
			assets.has(candidate.path)
		) {
			throw new Error('wasm-lisp input lock has an invalid or duplicate asset');
		}
		const contract =
			LOGICAL_ASSET_CONTRACT[
				/** @type {keyof typeof LOGICAL_ASSET_CONTRACT} */ (candidate.path)
			];
		if (candidate.mediaType !== contract.mediaType) {
			throw new Error(`wasm-lisp input lock contract drifted for ${candidate.path}`);
		}
		assets.set(
			candidate.path,
			Object.freeze({
				path: candidate.path,
				mediaType: candidate.mediaType,
				role: contract.role,
				bytes: validateByteSize(
					candidate.bytes,
					`wasm-lisp ${candidate.path}`,
					MAX_ASSET_BYTES
				),
				sha256: validateSha256(candidate.sha256, `wasm-lisp ${candidate.path}`)
			})
		);
	}
	if (LOGICAL_ASSETS.some((asset) => !assets.has(asset))) {
		throw new Error('wasm-lisp input lock is missing a required asset');
	}
	return Object.freeze({
		profileId: value.profileId,
		provenanceLevel: value.provenanceLevel,
		licenseExpression: value.licenseExpression,
		artifact: Object.freeze({
			...value.artifact,
			bytes: validateByteSize(
				value.artifact.bytes,
				'wasm-lisp compiler input',
				MAX_ASSET_BYTES
			),
			sha256: validateSha256(value.artifact.sha256, 'wasm-lisp compiler input')
		}),
		components: Object.freeze(value.components),
		transformations: Object.freeze(value.transformations),
		legalInputs: Object.freeze(value.legalInputs),
		license: Object.freeze({
			path: LICENSE_FILE,
			spdx: value.license.spdx,
			bytes: validateByteSize(value.license.bytes, 'wasm-lisp license', MAX_METADATA_BYTES),
			sha256: validateSha256(value.license.sha256, 'wasm-lisp license')
		}),
		notices: Object.freeze({
			path: NOTICES_FILE,
			mediaType: value.notices.mediaType,
			bytes: validateByteSize(value.notices.bytes, 'wasm-lisp notices', MAX_METADATA_BYTES),
			sha256: validateSha256(value.notices.sha256, 'wasm-lisp notices')
		}),
		metadata: Object.freeze({
			path: BUILD_METADATA_FILE,
			mediaType: value.metadata.mediaType,
			bytes: validateByteSize(value.metadata.bytes, 'wasm-lisp metadata', MAX_METADATA_BYTES),
			sha256: validateSha256(value.metadata.sha256, 'wasm-lisp metadata')
		}),
		declaration: Object.freeze({
			path: DECLARATION_FILE,
			mediaType: value.declaration.mediaType,
			bytes: validateByteSize(
				value.declaration.bytes,
				'wasm-lisp declaration',
				MAX_METADATA_BYTES
			),
			sha256: validateSha256(value.declaration.sha256, 'wasm-lisp declaration')
		}),
		assets
	});
}

/** @param {Record<string, unknown>} manifest */
function fingerprintPayload(manifest) {
	return {
		format: manifest.format,
		runtime: manifest.runtime,
		profileId: manifest.profileId,
		provenanceLevel: manifest.provenanceLevel,
		licenseExpression: manifest.licenseExpression,
		artifact: manifest.artifact,
		components: manifest.components,
		transformations: manifest.transformations,
		license: manifest.license,
		notices: manifest.notices,
		metadata: manifest.metadata,
		assets: manifest.assets,
		storage: manifest.storage
	};
}

/** @param {Record<string, unknown>} manifest */
export function computeLispRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${LISP_FINGERPRINT_DOMAIN}\n`);
	hash.update(canonicalJson(fingerprintPayload(manifest)));
	return hash.digest('hex');
}

/** @param {string} rootDir */
async function listFiles(rootDir) {
	const entries = await readdir(rootDir, { withFileTypes: true });
	/** @type {string[]} */
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(entryPath)));
			continue;
		}
		if (!entry.isFile()) {
			throw new Error(`wasm-lisp source contains a non-regular entry: ${entryPath}`);
		}
		files.push(entryPath);
	}
	return files.sort();
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

/** @param {string} source @param {string} needle */
const countText = (source, needle) => source.split(needle).length - 1;

/** @param {Map<string, Uint8Array>} logicalBytes */
function validateModuleGraph(logicalBytes) {
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const sources = new Map();
	for (const assetPath of LOGICAL_ASSETS.filter((asset) => asset.endsWith('.js'))) {
		let source;
		try {
			source = decoder.decode(logicalBytes.get(assetPath));
		} catch {
			throw new Error(`${assetPath} is not valid UTF-8 JavaScript`);
		}
		sources.set(assetPath, source);
	}
	const root = sources.get('index.js') || '';
	if (
		/(?:^|[;\n])\s*import(?!\s*\()/u.test(root) ||
		/\bexport\s+(?:\*|\{[^}]*\})\s+from\s*['"]/u.test(root)
	) {
		throw new Error('index.js must be a self-contained browser bundle');
	}
	for (const forbidden of [
		'@bytecodealliance/',
		'node:fs/promises',
		'fetchCompile',
		'./js-component-bindgen-component.core.wasm',
		'./js-component-bindgen-component.core2.wasm'
	]) {
		if (root.includes(forbidden)) {
			throw new Error(`index.js contains forbidden external dependency ${forbidden}`);
		}
	}
	for (const [needle, count] of /** @type {Array<[string, number]>} */ ([
		['compilerCoreModules', 2],
		['compilerModule', 2],
		['as createLispCompiler', 1],
		['as executeBrowserLispArtifact', 1]
	])) {
		if (countText(root, needle) !== count) {
			throw new Error(`index.js does not match the verified ${needle} contract`);
		}
	}
	const puppy = sources.get('puppyc.js') || '';
	if (
		countText(puppy, 'new URL(`./${name}`, import.meta.url)') !== 1 ||
		countText(puppy, 'export function instantiate(') !== 1
	) {
		throw new Error('puppyc.js does not match the expected injectable component seam');
	}
}

/** @param {SyncWasmLispOptions} [options] */
export async function syncWasmLispDist(options = {}) {
	const sourceDir = path.resolve(options.sourceDir || DEFAULT_SOURCE_DIR);
	const compilerInputPath = path.resolve(
		options.compilerInputPath || DEFAULT_COMPILER_INPUT_PATH
	);
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
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

	if (!(await lstat(sourceDir).catch(() => null))?.isDirectory()) {
		throw new Error(
			`wasm-lisp dist directory was not found at ${sourceDir}. Build wasm-lisp first with "pnpm --dir runtimes/wasm-lisp build".`
		);
	}
	if (!(await lstat(compilerInputPath).catch(() => null))?.isFile()) {
		throw new Error(`wasm-lisp compiler input must be a regular file: ${compilerInputPath}`);
	}
	for (const [targetPath, kind, label] of [
		[targetDir, 'directory', 'runtime target'],
		[versionModulePath, 'file', 'application version module'],
		[lspVersionModulePath, 'file', 'LSP version module']
	]) {
		const stats = await lstat(targetPath).catch(() => null);
		if (stats && !(kind === 'directory' ? stats.isDirectory() : stats.isFile())) {
			throw new Error(`wasm-lisp ${label} has the wrong file type: ${targetPath}`);
		}
	}
	const outputPaths = [targetDir, versionModulePath, lspVersionModulePath];
	const inputPaths = [sourceDir, compilerInputPath, lockFilePath];
	const outputBoundaries = await Promise.all(outputPaths.map(resolveBoundaryPath));
	const inputBoundaries = await Promise.all(inputPaths.map(resolveBoundaryPath));
	for (let left = 0; left < outputBoundaries.length; left += 1) {
		for (let right = left + 1; right < outputBoundaries.length; right += 1) {
			if (pathsOverlap(outputBoundaries[left], outputBoundaries[right])) {
				throw new Error('wasm-lisp publication targets must not overlap');
			}
		}
		for (const inputBoundary of inputBoundaries) {
			if (pathsOverlap(outputBoundaries[left], inputBoundary)) {
				throw new Error('wasm-lisp publication targets must not overlap their inputs');
			}
		}
	}

	const expectedSourceFiles = [
		...LOGICAL_ASSETS,
		LICENSE_FILE,
		NOTICES_FILE,
		BUILD_METADATA_FILE,
		DECLARATION_FILE
	].sort();
	const sourceFiles = (await listFiles(sourceDir)).map((filePath) =>
		path.relative(sourceDir, filePath).split(path.sep).join('/')
	);
	if (JSON.stringify(sourceFiles) !== JSON.stringify(expectedSourceFiles)) {
		throw new Error(`wasm-lisp dist has an unexpected file set: ${sourceFiles.join(', ')}`);
	}

	/** @type {Map<string, Uint8Array>} */
	const sourceBytes = new Map();
	for (const relativePath of expectedSourceFiles) {
		const bytes = await readFile(path.join(sourceDir, relativePath));
		const receipt =
			lock.assets.get(relativePath) ||
			(relativePath === LICENSE_FILE
				? lock.license
				: relativePath === NOTICES_FILE
					? lock.notices
					: relativePath === BUILD_METADATA_FILE
						? lock.metadata
						: lock.declaration);
		if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
			throw new Error(`wasm-lisp dist ${relativePath} does not match the input lock`);
		}
		sourceBytes.set(relativePath, bytes);
	}
	const compilerInput = await readFile(compilerInputPath);
	if (
		compilerInput.byteLength !== lock.artifact.bytes ||
		sha256(compilerInput) !== lock.artifact.sha256
	) {
		throw new Error('wasm-lisp compiler input does not match the pinned release receipt');
	}
	requireWasm(compilerInput, 'puppyc.wasm compiler input');
	for (const assetPath of LOGICAL_ASSETS.filter((asset) => asset.endsWith('.wasm'))) {
		const bytes = sourceBytes.get(assetPath);
		if (!bytes) throw new Error(`wasm-lisp dist ${assetPath} is missing`);
		requireWasm(bytes, assetPath);
	}
	validateModuleGraph(sourceBytes);

	const buildMetadataBytes = sourceBytes.get(BUILD_METADATA_FILE);
	if (!buildMetadataBytes) {
		throw new Error(`wasm-lisp dist ${BUILD_METADATA_FILE} is missing`);
	}
	let buildMetadata;
	try {
		buildMetadata = JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(buildMetadataBytes)
		);
	} catch {
		throw new Error('wasm-lisp runtime-build.json is not valid UTF-8 JSON');
	}
	const expectedBuildMetadata = {
		format: 'wasm-lisp-runtime-build-v2',
		runtime: RUNTIME,
		profileId: lock.profileId,
		provenanceLevel: lock.provenanceLevel,
		licenseExpression: lock.licenseExpression,
		artifact: lock.artifact,
		components: lock.components,
		transformations: lock.transformations,
		legalInputs: lock.legalInputs
	};
	if (canonicalJson(buildMetadata) !== canonicalJson(expectedBuildMetadata)) {
		throw new Error('wasm-lisp build metadata does not match the input lock');
	}

	/** @type {LispLogicalAsset[]} */
	const assets = LOGICAL_ASSETS.map((assetPath) => {
		const receipt = lock.assets.get(assetPath);
		return {
			path: assetPath,
			mediaType: receipt.mediaType,
			role: receipt.role,
			size: receipt.bytes,
			sha256: receipt.sha256
		};
	});
	/** @type {Map<string, Uint8Array>} */
	const storageBytes = new Map();
	/** @type {LispStorageAsset[]} */
	const storage = assets.map((asset) => {
		const logical = sourceBytes.get(asset.path);
		if (!logical) throw new Error(`wasm-lisp dist ${asset.path} is missing`);
		const encoding = COMPRESSED_ASSETS.has(asset.path) ? 'gzip' : 'identity';
		const stored = encoding === 'gzip' ? gzipSync(logical, { level: 9 }) : logical;
		const storagePath = encoding === 'gzip' ? `${asset.path}.gz` : asset.path;
		storageBytes.set(storagePath, stored);
		return {
			path: storagePath,
			logicalPath: asset.path,
			encoding,
			size: stored.byteLength,
			sha256: sha256(stored)
		};
	});
	const license = {
		path: LICENSE_FILE,
		spdx: lock.license.spdx,
		size: lock.license.bytes,
		sha256: lock.license.sha256
	};
	const notices = {
		path: NOTICES_FILE,
		mediaType: lock.notices.mediaType,
		size: lock.notices.bytes,
		sha256: lock.notices.sha256
	};
	const metadata = {
		path: BUILD_METADATA_FILE,
		mediaType: lock.metadata.mediaType,
		size: lock.metadata.bytes,
		sha256: lock.metadata.sha256
	};
	const manifestBody = {
		format: LISP_MANIFEST_FORMAT,
		runtime: RUNTIME,
		profileId: lock.profileId,
		provenanceLevel: lock.provenanceLevel,
		licenseExpression: lock.licenseExpression,
		artifact: lock.artifact,
		components: lock.components,
		transformations: lock.transformations,
		license,
		notices,
		metadata,
		assets,
		storage
	};
	const fingerprint = computeLispRuntimeFingerprint(manifestBody);
	const manifest = { ...manifestBody, fingerprint };
	const legacyManifest = {
		format: 'wasm-lisp-runtime-manifest-v1',
		runtime: RUNTIME,
		profileId: lock.profileId,
		fingerprint: fingerprint.slice(0, 16),
		files: [
			LICENSE_FILE,
			NOTICES_FILE,
			BUILD_METADATA_FILE,
			...storage.map((asset) => asset.path)
		].sort()
	};
	const versionModuleSource = `export const WASM_LISP_ASSET_VERSION =\n\t'${fingerprint}';\n`;
	const lspVersionModuleSource = `export const BUNDLED_LISP_MANIFEST_FINGERPRINT =\n\t'${fingerprint}';\n`;
	const licenseBytes = sourceBytes.get(LICENSE_FILE);
	const noticesBytes = sourceBytes.get(NOTICES_FILE);
	if (!licenseBytes || !noticesBytes) {
		throw new Error('wasm-lisp dist is missing required legal files');
	}
	/** @type {Map<string, Uint8Array>} */
	const staticFileBytes = new Map([
		...storageBytes,
		[LICENSE_FILE, licenseBytes],
		[NOTICES_FILE, noticesBytes],
		[BUILD_METADATA_FILE, buildMetadataBytes],
		[LEGACY_MANIFEST_FILE, Buffer.from(`${JSON.stringify(legacyManifest, null, 2)}\n`)],
		[MANIFEST_FILE, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)]
	]);

	await Promise.all(
		outputPaths.map((output) => mkdir(path.dirname(output), { recursive: true }))
	);
	const publicationId = randomUUID();
	/** @type {Publication[]} */
	const publications = outputPaths.map((target) => ({
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
		for (const [relativePath, bytes] of staticFileBytes) {
			const targetPath = path.join(publications[0].temporary, relativePath);
			await mkdir(path.dirname(targetPath), { recursive: true });
			await writeFile(targetPath, bytes);
		}
		await Promise.all([
			writeFile(publications[1].temporary, versionModuleSource, 'utf8'),
			writeFile(publications[2].temporary, lspVersionModuleSource, 'utf8')
		]);

		const installedFiles = (await listFiles(publications[0].temporary)).map((filePath) =>
			path.relative(publications[0].temporary, filePath).split(path.sep).join('/')
		);
		if (JSON.stringify(installedFiles) !== JSON.stringify([...staticFileBytes.keys()].sort())) {
			throw new Error('wasm-lisp temporary installation has unexpected files');
		}
		for (const asset of assets) {
			const stored = storage.find((candidate) => candidate.logicalPath === asset.path);
			if (!stored) throw new Error(`wasm-lisp storage for ${asset.path} is missing`);
			const installed = await readFile(path.join(publications[0].temporary, stored.path));
			if (installed.byteLength !== stored.size || sha256(installed) !== stored.sha256) {
				throw new Error(`wasm-lisp temporary storage receipt failed for ${stored.path}`);
			}
			const logical = stored.encoding === 'gzip' ? gunzipSync(installed) : installed;
			if (logical.byteLength !== asset.size || sha256(logical) !== asset.sha256) {
				throw new Error(`wasm-lisp temporary logical receipt failed for ${asset.path}`);
			}
		}
		const installedManifest = JSON.parse(
			await readFile(path.join(publications[0].temporary, MANIFEST_FILE), 'utf8')
		);
		if (
			canonicalJson(installedManifest) !== canonicalJson(manifest) ||
			computeLispRuntimeFingerprint(installedManifest) !== fingerprint ||
			(await readFile(publications[1].temporary, 'utf8')) !== versionModuleSource ||
			(await readFile(publications[2].temporary, 'utf8')) !== lspVersionModuleSource
		) {
			throw new Error('wasm-lisp temporary installation failed manifest verification');
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
					'wasm-lisp publication failed and rollback was incomplete'
				);
			}
			throw error;
		}
		for (const publication of publications) {
			if (publication.backedUp) {
				await rm(publication.previous, { recursive: true, force: true });
			}
		}
	} finally {
		for (const publication of publications) {
			await rm(publication.temporary, { recursive: true, force: true });
		}
	}

	return {
		sourceDir,
		targetDir,
		fingerprint,
		versionModulePath,
		lspVersionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir, fingerprint } = await syncWasmLispDist({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-lisp ${fingerprint} from ${sourceDir} to ${targetDir}`);
}
