import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-pascal', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-pascal');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-pascal-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmPascalVersion.ts'
);
const DEFAULT_LSP_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'lsp',
	'src',
	'bundledPascalRuntime.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-pascal-assets.lock.json');

export const PASCAL_MANIFEST_FORMAT = 'wasm-pascal-runtime-manifest-v2';
export const PASCAL_FINGERPRINT_DOMAIN = 'wasm-idle:pascal-runtime-manifest:v2';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const BUILD_METADATA_FILE = 'runtime-build.json';
const WORKER_FILE = 'runner-worker.js';
const EXPECTED_PROFILE_ID = 'pascal-pas2js-3.2.1-legacy-2c1edc2d';
const EXPECTED_LICENSE_EXPRESSION = 'LGPL-2.1-only WITH Independent-modules-exception';
const EXPECTED_ARTIFACT = Object.freeze({
	kind: 'opaque-vendored',
	repository: 'https://github.com/seo-rii/wasm-idle.git',
	revision: '2c1edc2d47a221498d6086f62431796012e2f3ca',
	path: 'static/wasm-pascal',
	provenance: 'legacy-import',
	verifiedBuildInput: false
});
const EXPECTED_COMPONENTS = Object.freeze({
	pas2js: Object.freeze({
		version: '3.2.1',
		repository: 'https://gitlab.com/freepascal.org/fpc/pas2js.git',
		revision: '9ac46614dc82',
		revisionKind: 'recorded-abbreviated',
		verifiedBuildInput: false,
		evidence: 'runtime-build.json; full upstream commit was not recorded'
	})
});
const EXPECTED_BUILD = Object.freeze({
	target: 'browser',
	compiler: 'native pas2js',
	entrypoint: 'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
	integrationSources: Object.freeze([
		'runtimes/wasm-pascal/src/system.pas',
		'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
		'runtimes/wasm-pascal/src/webfilecache.pp'
	]),
	transformations: Object.freeze([
		'strip trailing horizontal whitespace and normalize final newline',
		'gzip compiler.js with Node zlib level 9'
	]),
	verifiedBuildInput: false
});
const EXPECTED_LICENSE = Object.freeze({
	spdx: EXPECTED_LICENSE_EXPRESSION,
	sourceUrl: 'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/COPYING.txt',
	exceptionSourceUrl: 'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/LICENSE',
	verifiedBuildInput: false,
	evidence: 'upstream license URLs recorded; texts were not vendored with the legacy generation'
});
const LOGICAL_ASSETS = Object.freeze(['compiler.js', 'rtl.js', 'system.pas']);
const SOURCE_FILES = Object.freeze([...LOGICAL_ASSETS, BUILD_METADATA_FILE]);
/** @type {Readonly<Record<string, string>>} */
const MEDIA_TYPE_BY_ASSET = Object.freeze({
	'compiler.js': 'text/javascript',
	'rtl.js': 'text/javascript',
	'system.pas': 'text/plain'
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
const EXPECTED_ASSET_KEYS = Object.freeze(['bytes', 'path', 'sha256']);
const WORKER_IDENTITY_PLACEHOLDERS = new Map([
	['profileId', '__WASM_IDLE_PASCAL_PROFILE_ID__'],
	['artifactRevision', '__WASM_IDLE_PASCAL_ARTIFACT_REVISION__'],
	['pas2jsVersion', '__WASM_IDLE_PASCAL_VERSION__'],
	['pas2jsRevision', '__WASM_IDLE_PASCAL_REVISION__'],
	['manifestFingerprint', '__WASM_IDLE_PASCAL_MANIFEST_FINGERPRINT__']
]);

/** @typedef {{bytes: number; sha256: string}} Receipt */
/** @typedef {{path: string; mediaType: string; size: number; sha256: string}} LogicalAsset */
/** @typedef {{path: string; logicalPath: string; encoding: 'identity' | 'gzip'; size: number; sha256: string}} StorageAsset */
/** @typedef {{target: string; temporary: string; previous: string; hadTarget: boolean; backedUp: boolean; published: boolean}} Publication */

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
	if (primitive === undefined) throw new Error('Pascal manifest contains a non-JSON value');
	return primitive;
}

/** @param {string} source */
const normalizeText = (source) => source.replace(/[ \t]+$/gmu, '').replace(/\n+$/u, '\n');

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
		!hasExactKeys(value, EXPECTED_ASSET_KEYS) ||
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
		throw new Error(`wasm-pascal input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-pascal input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (!hasExactKeys(value, EXPECTED_LOCK_KEYS)) {
		throw new Error('wasm-pascal input lock has an invalid root shape');
	}
	if (
		value.schemaVersion !== 1 ||
		value.profileId !== EXPECTED_PROFILE_ID ||
		value.licenseExpression !== EXPECTED_LICENSE_EXPRESSION ||
		canonicalJson(value.artifact) !== canonicalJson(EXPECTED_ARTIFACT) ||
		canonicalJson(value.components) !== canonicalJson(EXPECTED_COMPONENTS) ||
		canonicalJson(value.build) !== canonicalJson(EXPECTED_BUILD) ||
		canonicalJson(value.license) !== canonicalJson(EXPECTED_LICENSE) ||
		!Array.isArray(value.assets) ||
		value.assets.length !== SOURCE_FILES.length
	) {
		throw new Error('wasm-pascal input lock has invalid provenance metadata');
	}
	const receipts = new Map();
	for (const candidate of value.assets) {
		if (
			!hasExactKeys(candidate, EXPECTED_ASSET_KEYS) ||
			!SOURCE_FILES.includes(candidate.path) ||
			receipts.has(candidate.path)
		) {
			throw new Error('wasm-pascal input lock has an invalid or duplicate asset path');
		}
		receipts.set(candidate.path, validateReceipt(candidate, `wasm-pascal ${candidate.path}`));
	}
	if (SOURCE_FILES.some((asset) => !receipts.has(asset))) {
		throw new Error('wasm-pascal input lock is missing a required asset');
	}
	return Object.freeze({
		profileId: value.profileId,
		licenseExpression: value.licenseExpression,
		artifact: EXPECTED_ARTIFACT,
		components: EXPECTED_COMPONENTS,
		build: EXPECTED_BUILD,
		license: EXPECTED_LICENSE,
		receipts
	});
}

/**
 * @param {{profileId: string; licenseExpression: string; artifact: Record<string, unknown>; components: Record<string, unknown>; build: Record<string, unknown>; license: Record<string, unknown>; metadata: {path: string; mediaType: string; size: number; sha256: string}; assets: LogicalAsset[]; storage: StorageAsset[]}} manifest
 */
export function computePascalRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${PASCAL_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${PASCAL_MANIFEST_FORMAT}\n`);
	hash.update('runtime\0pas2js\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(`licenseExpression\0${manifest.licenseExpression}\n`);
	hash.update(`artifact\0${canonicalJson(manifest.artifact)}\n`);
	hash.update(`components\0${canonicalJson(manifest.components)}\n`);
	hash.update(`build\0${canonicalJson(manifest.build)}\n`);
	hash.update(`license\0${canonicalJson(manifest.license)}\n`);
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

/** @param {string | undefined} sourceDir */
async function resolveSourceDir(sourceDir) {
	const resolved = path.resolve(sourceDir || DEFAULT_SOURCE_DIR);
	for (const fileName of SOURCE_FILES) {
		if (!(await isRegularFile(path.join(resolved, fileName)))) {
			throw new Error(`wasm-pascal asset ${fileName} was not found in ${resolved}.`);
		}
	}
	return resolved;
}

/** @param {unknown} value */
function serializeGeneratedObject(value) {
	return JSON.stringify(value, null, '\t')
		.replaceAll('"', "'")
		.replace(/^(\s*)'([A-Za-z_$][A-Za-z0-9_$]*)':/gmu, '$1$2:');
}

/**
 * @param {{sourceDir?: string; targetDir?: string; workerSourcePath?: string; versionModulePath?: string; lspVersionModulePath?: string; lockFilePath?: string; renamePath?: (sourcePath: string, targetPath: string) => Promise<void>}} [options]
 */
export async function syncWasmPascalAssets(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
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
	const sourceDir = await resolveSourceDir(options.sourceDir);
	const lock = await readInputLock(lockFilePath);

	/** @type {readonly [string, boolean, string][]} */
	const outputTargets = [
		[targetDir, true, 'runtime target'],
		[versionModulePath, false, 'application version module'],
		[lspVersionModulePath, false, 'LSP version module']
	];
	for (const [targetPath, directory, label] of outputTargets) {
		const stats = await lstat(targetPath).catch(() => null);
		if (stats && !(directory ? stats.isDirectory() : stats.isFile())) {
			throw new Error(`wasm-pascal ${label} has the wrong file type: ${targetPath}`);
		}
	}
	for (const [filePath, label] of [
		[workerSourcePath, 'worker source'],
		[lockFilePath, 'input lock']
	]) {
		if (!(await isRegularFile(filePath))) {
			throw new Error(`wasm-pascal ${label} must be a regular file: ${filePath}`);
		}
	}
	const outputs = [targetDir, versionModulePath, lspVersionModulePath];
	const inputs = [sourceDir, workerSourcePath, lockFilePath];
	const outputBoundaries = await Promise.all(outputs.map(resolveBoundaryPath));
	const inputBoundaries = await Promise.all(inputs.map(resolveBoundaryPath));
	for (let left = 0; left < outputBoundaries.length; left += 1) {
		for (let right = left + 1; right < outputBoundaries.length; right += 1) {
			if (pathsOverlap(outputBoundaries[left], outputBoundaries[right])) {
				throw new Error('wasm-pascal publication targets must not overlap');
			}
		}
		for (const inputBoundary of inputBoundaries) {
			if (pathsOverlap(outputBoundaries[left], inputBoundary)) {
				throw new Error('wasm-pascal publication targets must not overlap their inputs');
			}
		}
	}

	const logicalBytes = new Map();
	for (const fileName of SOURCE_FILES) {
		const bytes = Buffer.from(
			normalizeText(await readFile(path.join(sourceDir, fileName), 'utf8'))
		);
		const receipt = lock.receipts.get(fileName);
		if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
			throw new Error(`wasm-pascal ${fileName} does not match the input lock`);
		}
		logicalBytes.set(fileName, bytes);
	}
	const compilerBytes = logicalBytes.get('compiler.js');
	const rtlBytes = logicalBytes.get('rtl.js');
	const systemBytes = logicalBytes.get('system.pas');
	const metadataBytes = logicalBytes.get(BUILD_METADATA_FILE);
	if (!compilerBytes || !rtlBytes || !systemBytes || !metadataBytes) {
		throw new Error('wasm-pascal verified source graph is incomplete');
	}
	const compilerSource = new TextDecoder('utf-8', { fatal: true }).decode(compilerBytes);
	if (!compilerSource.includes('__wasmIdlePascalCompiler')) {
		throw new Error('wasm-pascal compiler.js does not expose __wasmIdlePascalCompiler.');
	}
	const systemSource = new TextDecoder('utf-8', { fatal: true }).decode(systemBytes);
	if (!/\bprocedure\s+ReadLn\b/iu.test(systemSource)) {
		throw new Error('wasm-pascal system.pas does not provide ReadLn stdin bindings.');
	}
	const buildInfo = JSON.parse(metadataBytes.toString('utf8'));
	if (
		canonicalJson(buildInfo) !==
		canonicalJson({
			format: 'wasm-pascal-runtime-build-v1',
			runtime: 'pas2js',
			pas2jsVersion: lock.components.pas2js.version,
			pas2jsCommit: lock.components.pas2js.revision
		})
	) {
		throw new Error('wasm-pascal runtime-build.json identity is invalid');
	}

	const compilerStorage = gzipSync(compilerBytes, { level: 9 });
	/** @type {LogicalAsset[]} */
	const assets = LOGICAL_ASSETS.map((assetPath) => {
		const bytes = logicalBytes.get(assetPath);
		if (!bytes) throw new Error(`wasm-pascal verified asset ${assetPath} is missing`);
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
			path: 'compiler.js.gz.bin',
			logicalPath: 'compiler.js',
			encoding: 'gzip',
			size: compilerStorage.byteLength,
			sha256: sha256(compilerStorage)
		},
		{
			path: 'rtl.js.bin',
			logicalPath: 'rtl.js',
			encoding: 'identity',
			size: rtlBytes.byteLength,
			sha256: sha256(rtlBytes)
		},
		{
			path: 'system.pas.bin',
			logicalPath: 'system.pas',
			encoding: 'identity',
			size: systemBytes.byteLength,
			sha256: sha256(systemBytes)
		}
	];
	const metadata = {
		path: BUILD_METADATA_FILE,
		mediaType: 'application/json',
		size: metadataBytes.byteLength,
		sha256: sha256(metadataBytes)
	};
	const manifestWithoutFingerprint = {
		profileId: lock.profileId,
		licenseExpression: lock.licenseExpression,
		artifact: lock.artifact,
		components: lock.components,
		build: lock.build,
		license: lock.license,
		metadata,
		assets,
		storage
	};
	const fingerprint = computePascalRuntimeFingerprint(manifestWithoutFingerprint);
	const manifest = {
		format: PASCAL_MANIFEST_FORMAT,
		runtime: 'pas2js',
		profileId: lock.profileId,
		fingerprint,
		licenseExpression: lock.licenseExpression,
		artifact: lock.artifact,
		components: lock.components,
		build: lock.build,
		license: lock.license,
		metadata,
		assets,
		storage
	};
	const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	const manifestReceipt = Object.freeze({
		bytes: manifestBytes.byteLength,
		sha256: sha256(manifestBytes)
	});
	const workerIdentity = Object.freeze({
		profileId: lock.profileId,
		artifactRevision: lock.artifact.revision,
		pas2jsVersion: lock.components.pas2js.version,
		pas2jsRevision: lock.components.pas2js.revision,
		manifestFingerprint: fingerprint
	});
	let workerSource;
	try {
		workerSource = new TextDecoder('utf-8', { fatal: true }).decode(
			await readFile(workerSourcePath)
		);
	} catch {
		throw new Error('wasm-pascal runner worker is not valid UTF-8 JavaScript');
	}
	for (const [key, expectedValue] of Object.entries(workerIdentity)) {
		const placeholderValue = WORKER_IDENTITY_PLACEHOLDERS.get(key);
		if (!placeholderValue)
			throw new Error(`wasm-pascal runner identity key is unknown: ${key}`);
		const placeholder = `${key}: '${placeholderValue}'`;
		if (workerSource.split(placeholder).length !== 2) {
			throw new Error(
				`wasm-pascal runner must pin exactly one generated ${key} identity value`
			);
		}
		workerSource = workerSource.replace(placeholder, `${key}: '${expectedValue}'`);
	}
	if (workerSource.includes('__WASM_IDLE_PASCAL_')) {
		throw new Error('wasm-pascal runner contains an unresolved generated identity value');
	}
	const workerBytes = Buffer.from(workerSource, 'utf8');
	const workerReceipt = Object.freeze({
		bytes: workerBytes.byteLength,
		sha256: sha256(workerBytes)
	});
	const runtimeProfile = Object.freeze({
		...workerIdentity,
		manifestReceipt,
		compilerJavaScriptReceipt: Object.freeze({
			bytes: compilerStorage.byteLength,
			sha256: sha256(compilerStorage),
			uncompressedBytes: compilerBytes.byteLength,
			uncompressedSha256: sha256(compilerBytes)
		}),
		rtlJavaScriptReceipt: Object.freeze({
			bytes: rtlBytes.byteLength,
			sha256: sha256(rtlBytes)
		}),
		systemPascalReceipt: Object.freeze({
			bytes: systemBytes.byteLength,
			sha256: sha256(systemBytes)
		})
	});
	const serializedProfile = serializeGeneratedObject(runtimeProfile);
	const versionModuleSource = `export const WASM_PASCAL_RUNTIME_PROFILE = ${serializedProfile} as const;\nexport const WASM_PASCAL_RUNTIME_BUNDLE = Object.freeze({\n\tprofile: WASM_PASCAL_RUNTIME_PROFILE,\n\tworkerReceipt: {\n\t\tbytes: ${workerReceipt.bytes},\n\t\tsha256: '${workerReceipt.sha256}'\n\t}\n});\nexport const WASM_PASCAL_ASSET_VERSION = WASM_PASCAL_RUNTIME_PROFILE.manifestFingerprint;\nexport const WASM_PASCAL_RUNNER_RECEIPT = WASM_PASCAL_RUNTIME_BUNDLE.workerReceipt;\n`;
	const lspVersionModuleSource = `export const BUNDLED_PASCAL_RUNTIME_PROFILE = ${serializedProfile} as const;\nexport const BUNDLED_PASCAL_RUNTIME_BUNDLE = Object.freeze({\n\tprofile: BUNDLED_PASCAL_RUNTIME_PROFILE,\n\tworkerReceipt: {\n\t\tbytes: ${workerReceipt.bytes},\n\t\tsha256: '${workerReceipt.sha256}'\n\t}\n});\nexport const BUNDLED_PASCAL_MANIFEST_FINGERPRINT =\n\tBUNDLED_PASCAL_RUNTIME_PROFILE.manifestFingerprint;\nexport const BUNDLED_PASCAL_RUNNER_RECEIPT = BUNDLED_PASCAL_RUNTIME_BUNDLE.workerReceipt;\n`;
	const legacyManifest = {
		format: 'wasm-pascal-runtime-manifest-v1',
		runtime: 'pas2js',
		pas2jsVersion: lock.components.pas2js.version,
		pas2jsCommit: lock.components.pas2js.revision,
		fingerprint: fingerprint.slice(0, 16),
		files: SOURCE_FILES
	};
	const expectedFiles = [
		'compiler.js.gz',
		'compiler.js.gz.bin',
		'rtl.js',
		'rtl.js.bin',
		'system.pas',
		'system.pas.bin',
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
			`.${path.basename(target)}.next-${publicationId}`
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
			writeFile(path.join(publications[0].temporary, 'compiler.js.gz'), compilerStorage),
			writeFile(path.join(publications[0].temporary, 'compiler.js.gz.bin'), compilerStorage),
			writeFile(path.join(publications[0].temporary, 'rtl.js'), rtlBytes),
			writeFile(path.join(publications[0].temporary, 'rtl.js.bin'), rtlBytes),
			writeFile(path.join(publications[0].temporary, 'system.pas'), systemBytes),
			writeFile(path.join(publications[0].temporary, 'system.pas.bin'), systemBytes),
			writeFile(path.join(publications[0].temporary, BUILD_METADATA_FILE), metadataBytes),
			writeFile(path.join(publications[0].temporary, WORKER_FILE), workerBytes),
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
			throw new Error('wasm-pascal temporary installation has unexpected files');
		}
		const installedManifestBytes = await readFile(
			path.join(publications[0].temporary, MANIFEST_FILE)
		);
		const installedManifest = JSON.parse(installedManifestBytes.toString('utf8'));
		for (const [canonical, legacy] of [
			['compiler.js.gz.bin', 'compiler.js.gz'],
			['rtl.js.bin', 'rtl.js'],
			['system.pas.bin', 'system.pas']
		]) {
			const canonicalBytes = await readFile(path.join(publications[0].temporary, canonical));
			const legacyBytes = await readFile(path.join(publications[0].temporary, legacy));
			if (!canonicalBytes.equals(legacyBytes)) {
				throw new Error(`wasm-pascal legacy alias differs from ${canonical}`);
			}
		}
		if (
			installedManifestBytes.byteLength !== manifestReceipt.bytes ||
			sha256(installedManifestBytes) !== manifestReceipt.sha256 ||
			computePascalRuntimeFingerprint(installedManifest) !== fingerprint ||
			(await readFile(path.join(publications[0].temporary, WORKER_FILE))).byteLength !==
				workerReceipt.bytes ||
			sha256(await readFile(path.join(publications[0].temporary, WORKER_FILE))) !==
				workerReceipt.sha256 ||
			(await readFile(publications[1].temporary, 'utf8')) !== versionModuleSource ||
			(await readFile(publications[2].temporary, 'utf8')) !== lspVersionModuleSource
		) {
			throw new Error('wasm-pascal temporary installation failed receipt verification');
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
					'wasm-pascal publication failed and rollback was incomplete'
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
		sourceDir,
		targetDir,
		fingerprint,
		versionModulePath,
		lspVersionModulePath,
		runtimeProfile,
		runnerReceipt: workerReceipt
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmPascalAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-pascal from ${result.sourceDir} to ${result.targetDir}`);
}
