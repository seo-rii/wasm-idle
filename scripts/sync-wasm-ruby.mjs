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
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { build as viteBuild } from 'vite';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_NODE_MODULES_DIR = path.resolve(REPO_ROOT, 'node_modules');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-ruby');
const DEFAULT_GENERATED_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'core',
	'src',
	'ruby-runtime.generated.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-ruby-assets.lock.json');
const DEFAULT_PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, 'package.json');
const DEFAULT_PNPM_LOCK_PATH = path.resolve(REPO_ROOT, 'pnpm-lock.yaml');

export const RUBY_MANIFEST_FORMAT = 'wasm-ruby-runtime-manifest-v2';
export const RUBY_FINGERPRINT_DOMAIN = 'wasm-idle:ruby-runtime-manifest:v2';
const RUNTIME = 'ruby-wasm-wasi';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const BUILD_METADATA_FILE = 'runtime-build.json';
const MAX_PACKAGE_BYTES = 160 * 1024 * 1024;
const MAX_ASSET_BYTES = 40 * 1024 * 1024;
const MAX_LOGICAL_BYTES = 40 * 1024 * 1024;
const MAX_DELIVERY_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_MODULE_BYTES = 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const WASM_ASSET_PATH = 'assets/ruby_stdlib-C40Yu-vu.wasm';
const RUNTIME_MODULE_PATH = 'runtime.mjs';
const WASM_STORAGE_PATH = `${WASM_ASSET_PATH}.gz.bin`;
const RUNTIME_MODULE_STORAGE_PATH = `${RUNTIME_MODULE_PATH}.bin`;
const LEGACY_WASM_STORAGE_PATH = `${WASM_ASSET_PATH}.gz`;
const PACKAGE_NAMES = Object.freeze([
	'@bjorn3/browser_wasi_shim',
	'@ruby/3.4-wasm-wasi',
	'@ruby/wasm-wasi'
]);
const OUTPUT_PATHS = Object.freeze([WASM_ASSET_PATH, RUNTIME_MODULE_PATH]);
const LEGAL_TARGET_PATHS = Object.freeze([
	'LICENSE',
	'NOTICE',
	'THIRD_PARTY_NOTICES.md',
	'licenses/browser-wasi-shim/LICENSE-APACHE',
	'licenses/browser-wasi-shim/LICENSE-MIT'
]);
const EXPECTED_LOCK_KEYS = Object.freeze(
	[
		'artifact',
		'components',
		'legalFiles',
		'licenseExpression',
		'outputs',
		'packages',
		'producer',
		'profileId',
		'provenanceLevel',
		'schemaVersion',
		'transformations'
	].sort()
);
const EXPECTED_ARTIFACT_KEYS = Object.freeze(
	[
		'evidence',
		'kind',
		'repository',
		'revision',
		'verifiedBuildInput',
		'workflow',
		'workflowRun'
	].sort()
);
const EXPECTED_COMPONENT_KEYS = Object.freeze(
	['evidence', 'repository', 'revision', 'verifiedBuildInput', 'version'].sort()
);
const EXPECTED_COMPONENT_NAMES = Object.freeze(['ruby', 'rubyWasm', 'wasiSdk'].sort());
const EXPECTED_PACKAGE_KEYS = Object.freeze(
	[
		'attestationUrl',
		'bytes',
		'files',
		'integrity',
		'license',
		'name',
		'repository',
		'requestedRange',
		'revision',
		'tarballBytes',
		'tarballSha256',
		'tarballUrl',
		'treeSha256',
		'version'
	].sort()
);
const EXPECTED_TOOL_KEYS = Object.freeze(
	[
		'bytes',
		'files',
		'integrity',
		'license',
		'name',
		'requestedRange',
		'tarballUrl',
		'treeSha256',
		'version'
	].sort()
);
const EXPECTED_ENTRY_KEYS = Object.freeze(['bytes', 'path', 'sha256'].sort());
const EXPECTED_OUTPUT_KEYS = Object.freeze(['bytes', 'mediaType', 'path', 'sha256'].sort());
const EXPECTED_LEGAL_KEYS = Object.freeze(
	['bytes', 'mediaType', 'sha256', 'sourcePath', 'spdx', 'targetPath'].sort()
);
const EXPECTED_MANIFEST_BODY_KEYS = Object.freeze(
	[
		'artifact',
		'assets',
		'components',
		'format',
		'legalFiles',
		'licenseExpression',
		'metadata',
		'packages',
		'producer',
		'profileId',
		'provenanceLevel',
		'runtime',
		'storage',
		'transformations'
	].sort()
);
const EXPECTED_MANIFEST_KEYS = Object.freeze(
	[...EXPECTED_MANIFEST_BODY_KEYS, 'fingerprint'].sort()
);
const EXPECTED_TRANSFORMATIONS = Object.freeze([
	Object.freeze({
		id: 'vite-8-es2022-single-module-bundle',
		input: 'scripts/runtime-modules/ruby.ts',
		output: RUNTIME_MODULE_PATH
	}),
	Object.freeze({
		id: 'node-zlib-gzip-level-9',
		input: WASM_ASSET_PATH,
		output: WASM_STORAGE_PATH
	})
]);

/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} LogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'gzip' | 'identity'; size: number; sha256: string }} StorageAsset */
/** @typedef {{ target: string; temporary: string; previous: string; hadTarget: boolean; backedUp: boolean; published: boolean }} Publication */
/**
 * @typedef {object} PackageDescriptor
 * @property {string} name
 * @property {string} version
 * @property {string} requestedRange
 * @property {string} tarballUrl
 * @property {string} integrity
 * @property {string} license
 * @property {number} files
 * @property {number} bytes
 * @property {string} treeSha256
 * @property {number} [tarballBytes]
 * @property {string} [tarballSha256]
 * @property {string | null} [attestationUrl]
 * @property {string} [repository]
 * @property {string} [revision]
 */

/**
 * @typedef {object} SyncWasmRubyOptions
 * @property {string} [repoRoot]
 * @property {string} [nodeModulesDir]
 * @property {string} [targetDir]
 * @property {string} [generatedModulePath]
 * @property {string} [lockFilePath]
 * @property {string} [packageJsonPath]
 * @property {string} [pnpmLockPath]
 * @property {(options: { entryPath: string; outDir: string; repoRoot: string }) => Promise<void>} [buildRuntime]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
 */

/** @param {Uint8Array | string} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {string} left @param {string} right */
const lexicalCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

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
	if (primitive === undefined) throw new Error('Ruby runtime metadata contains a non-JSON value');
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

/** @param {string} value @param {string} label */
function validateRelativePath(value, label) {
	if (
		typeof value !== 'string' ||
		!value ||
		path.isAbsolute(value) ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
	) {
		throw new Error(`${label} has an unsafe relative path`);
	}
	return value;
}

/** @param {unknown} value @param {string} label @param {number} maxBytes */
function validateByteSize(value, label, maxBytes) {
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

/** @param {string} rootDir @param {string} [currentDir] */
async function listRegularFiles(rootDir, currentDir = rootDir) {
	const entries = await readdir(currentDir, { withFileTypes: true });
	/** @type {string[]} */
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listRegularFiles(rootDir, entryPath)));
			continue;
		}
		if (!entry.isFile()) {
			throw new Error(
				`Ruby producer input or output contains a non-regular file: ${entryPath}`
			);
		}
		files.push(path.relative(rootDir, entryPath).split(path.sep).join('/'));
	}
	return files.sort();
}

/** @param {string} packageDir */
async function packageTreeReceipt(packageDir) {
	const files = await listRegularFiles(packageDir);
	let bytes = 0;
	const entries = [];
	for (const relativePath of files) {
		const contents = await readFile(path.join(packageDir, relativePath));
		bytes += contents.byteLength;
		entries.push({
			path: relativePath,
			bytes: contents.byteLength,
			sha256: sha256(contents)
		});
	}
	return { files: files.length, bytes, treeSha256: sha256(JSON.stringify(entries)) };
}

/** @param {string} lockText @param {string} name @param {string} version */
function pnpmPackageIntegrity(lockText, name, version) {
	const lines = lockText.split(/\r?\n/u);
	const key = `${name}@${version}`;
	const headers = new Set([`  '${key}':`, `  ${key}:`]);
	const start = lines.findIndex((line) => headers.has(line));
	if (start === -1) throw new Error(`pnpm lock is missing ${key}`);
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^ {2}(?:'[^']+'|[^ ].*):$/u.test(lines[index])) {
			end = index;
			break;
		}
	}
	const resolution = lines
		.slice(start + 1, end)
		.find((line) => line.startsWith('    resolution: {integrity: '));
	const match = resolution?.match(/^ {4}resolution: \{integrity: ([^},]+)\}$/u);
	if (!match) throw new Error(`pnpm lock is missing the integrity receipt for ${key}`);
	return match[1];
}

/** @param {unknown} candidate @param {string} expectedName @param {boolean} tool */
function validatePackageDescriptor(candidate, expectedName, tool) {
	const expectedKeys = tool ? EXPECTED_TOOL_KEYS : EXPECTED_PACKAGE_KEYS;
	if (!isObject(candidate)) {
		throw new Error(`wasm-ruby package descriptor is invalid for ${expectedName}`);
	}
	const value = /** @type {Partial<PackageDescriptor> & Record<string, unknown>} */ (candidate);
	if (
		!hasExactKeys(value, expectedKeys) ||
		value.name !== expectedName ||
		typeof value.version !== 'string' ||
		!/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u.test(value.version) ||
		typeof value.requestedRange !== 'string' ||
		!value.requestedRange ||
		typeof value.tarballUrl !== 'string' ||
		!value.tarballUrl.startsWith('https://registry.npmjs.org/') ||
		typeof value.integrity !== 'string' ||
		!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(value.integrity) ||
		typeof value.license !== 'string' ||
		!value.license ||
		!Number.isSafeInteger(value.files) ||
		/** @type {number} */ (value.files) <= 0 ||
		/** @type {number} */ (value.files) > 10_000
	) {
		throw new Error(`wasm-ruby package descriptor is invalid for ${expectedName}`);
	}
	validateByteSize(value.bytes, `wasm-ruby ${expectedName} package tree`, MAX_PACKAGE_BYTES);
	validateSha256(value.treeSha256, `wasm-ruby ${expectedName} package tree`);
	if (
		!tool &&
		(!Number.isSafeInteger(value.tarballBytes) ||
			/** @type {number} */ (value.tarballBytes) <= 0 ||
			/** @type {number} */ (value.tarballBytes) > MAX_PACKAGE_BYTES ||
			typeof value.tarballSha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(value.tarballSha256) ||
			typeof value.repository !== 'string' ||
			!value.repository.startsWith('https://github.com/') ||
			typeof value.revision !== 'string' ||
			!/^[a-f0-9]{40}$/u.test(value.revision) ||
			(value.attestationUrl !== null &&
				(typeof value.attestationUrl !== 'string' ||
					!value.attestationUrl.startsWith('https://registry.npmjs.org/'))))
	) {
		throw new Error(`wasm-ruby package provenance is invalid for ${expectedName}`);
	}
	return /** @type {PackageDescriptor} */ (value);
}

/** @param {string} lockFilePath */
async function readInputLock(lockFilePath) {
	const lockStats = await lstat(lockFilePath).catch(() => null);
	if (!lockStats?.isFile()) {
		throw new Error(`wasm-ruby input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-ruby input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!hasExactKeys(value, EXPECTED_LOCK_KEYS) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!/^ruby-[0-9A-Za-z][0-9A-Za-z._-]+$/u.test(value.profileId) ||
		value.provenanceLevel !== 'npm-attested-source-and-receipted-derived-output' ||
		typeof value.licenseExpression !== 'string' ||
		!value.licenseExpression ||
		!hasExactKeys(value.artifact, EXPECTED_ARTIFACT_KEYS) ||
		value.artifact.kind !== 'npm-provenance-attested-package-set' ||
		value.artifact.repository !== 'https://github.com/ruby/ruby.wasm' ||
		typeof value.artifact.revision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.artifact.revision) ||
		typeof value.artifact.workflow !== 'string' ||
		typeof value.artifact.workflowRun !== 'string' ||
		!value.artifact.workflowRun.startsWith('https://github.com/ruby/ruby.wasm/actions/runs/') ||
		value.artifact.verifiedBuildInput !== false ||
		typeof value.artifact.evidence !== 'string' ||
		!hasExactKeys(value.components, EXPECTED_COMPONENT_NAMES) ||
		!Array.isArray(value.transformations) ||
		!Array.isArray(value.packages) ||
		value.packages.length !== PACKAGE_NAMES.length ||
		!hasExactKeys(value.producer, ['entry', 'script', 'tool']) ||
		!hasExactKeys(value.producer.entry, EXPECTED_ENTRY_KEYS) ||
		!hasExactKeys(value.producer.script, EXPECTED_ENTRY_KEYS) ||
		!Array.isArray(value.outputs) ||
		value.outputs.length !== OUTPUT_PATHS.length ||
		!Array.isArray(value.legalFiles) ||
		value.legalFiles.length !== LEGAL_TARGET_PATHS.length
	) {
		throw new Error('wasm-ruby input lock has invalid provenance metadata');
	}
	const components = value.components;
	for (const [name, repository, revision] of [
		['ruby', 'https://github.com/ruby/ruby', 'sha'],
		['rubyWasm', 'https://github.com/ruby/ruby.wasm', value.artifact.revision],
		['wasiSdk', 'https://github.com/WebAssembly/wasi-sdk', 'unrecorded']
	]) {
		const component = components[name];
		if (
			!hasExactKeys(component, EXPECTED_COMPONENT_KEYS) ||
			typeof component.version !== 'string' ||
			!/^[0-9A-Za-z][0-9A-Za-z._+-]*$/u.test(component.version) ||
			component.repository !== repository ||
			(revision === 'sha'
				? typeof component.revision !== 'string' ||
					!/^[a-f0-9]{40}$/u.test(component.revision)
				: component.revision !== revision) ||
			component.verifiedBuildInput !== false ||
			typeof component.evidence !== 'string' ||
			!component.evidence
		) {
			throw new Error(`wasm-ruby input lock has invalid ${name} provenance`);
		}
	}
	if (
		value.profileId !==
			`ruby-${components.ruby.version}-ruby-wasm-${components.rubyWasm.version}` ||
		canonicalJson(value.transformations) !== canonicalJson(EXPECTED_TRANSFORMATIONS)
	) {
		throw new Error('wasm-ruby input lock has an invalid profile or transformation graph');
	}

	const packages = new Map();
	for (const candidate of value.packages) {
		if (
			!isObject(candidate) ||
			typeof candidate.name !== 'string' ||
			packages.has(candidate.name)
		) {
			throw new Error('wasm-ruby input lock has an invalid or duplicate package');
		}
		packages.set(candidate.name, validatePackageDescriptor(candidate, candidate.name, false));
	}
	if (PACKAGE_NAMES.some((name) => !packages.has(name))) {
		throw new Error('wasm-ruby input lock is missing a required package');
	}
	for (const name of ['@ruby/3.4-wasm-wasi', '@ruby/wasm-wasi']) {
		const descriptor = packages.get(name);
		if (
			descriptor.version !== components.rubyWasm.version ||
			descriptor.revision !== value.artifact.revision
		) {
			throw new Error(`wasm-ruby ${name} identity does not match the runtime profile`);
		}
	}

	const entry = {
		path: validateRelativePath(value.producer.entry.path, 'wasm-ruby producer entry'),
		bytes: validateByteSize(
			value.producer.entry.bytes,
			'wasm-ruby producer entry',
			MAX_METADATA_BYTES
		),
		sha256: validateSha256(value.producer.entry.sha256, 'wasm-ruby producer entry')
	};
	if (entry.path !== 'scripts/runtime-modules/ruby.ts') {
		throw new Error('wasm-ruby producer entry path is invalid');
	}
	const script = {
		path: validateRelativePath(value.producer.script.path, 'wasm-ruby producer script'),
		bytes: validateByteSize(
			value.producer.script.bytes,
			'wasm-ruby producer script',
			MAX_METADATA_BYTES
		),
		sha256: validateSha256(value.producer.script.sha256, 'wasm-ruby producer script')
	};
	if (script.path !== 'scripts/sync-wasm-ruby.mjs') {
		throw new Error('wasm-ruby producer script path is invalid');
	}
	const tool = validatePackageDescriptor(value.producer.tool, 'vite', true);

	const outputs = new Map();
	for (const candidate of value.outputs) {
		if (
			!hasExactKeys(candidate, EXPECTED_OUTPUT_KEYS) ||
			typeof candidate.path !== 'string' ||
			outputs.has(candidate.path) ||
			!OUTPUT_PATHS.includes(candidate.path) ||
			candidate.mediaType !==
				(candidate.path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
		) {
			throw new Error('wasm-ruby input lock has an invalid or duplicate output');
		}
		outputs.set(candidate.path, {
			path: validateRelativePath(candidate.path, 'wasm-ruby output'),
			mediaType: candidate.mediaType,
			bytes: validateByteSize(
				candidate.bytes,
				`wasm-ruby ${candidate.path}`,
				MAX_ASSET_BYTES
			),
			sha256: validateSha256(candidate.sha256, `wasm-ruby ${candidate.path}`)
		});
	}
	if (OUTPUT_PATHS.some((assetPath) => !outputs.has(assetPath))) {
		throw new Error('wasm-ruby input lock is missing a required output');
	}

	const legalFiles = new Map();
	for (const candidate of value.legalFiles) {
		if (
			!hasExactKeys(candidate, EXPECTED_LEGAL_KEYS) ||
			typeof candidate.targetPath !== 'string' ||
			legalFiles.has(candidate.targetPath) ||
			!LEGAL_TARGET_PATHS.includes(candidate.targetPath) ||
			typeof candidate.mediaType !== 'string' ||
			!candidate.mediaType.startsWith('text/') ||
			typeof candidate.spdx !== 'string' ||
			!candidate.spdx
		) {
			throw new Error('wasm-ruby input lock has an invalid or duplicate legal file');
		}
		legalFiles.set(candidate.targetPath, {
			sourcePath: validateRelativePath(candidate.sourcePath, 'wasm-ruby legal source'),
			targetPath: validateRelativePath(candidate.targetPath, 'wasm-ruby legal target'),
			mediaType: candidate.mediaType,
			spdx: candidate.spdx,
			bytes: validateByteSize(
				candidate.bytes,
				`wasm-ruby ${candidate.targetPath}`,
				MAX_METADATA_BYTES
			),
			sha256: validateSha256(candidate.sha256, `wasm-ruby ${candidate.targetPath}`)
		});
	}
	if (LEGAL_TARGET_PATHS.some((targetPath) => !legalFiles.has(targetPath))) {
		throw new Error('wasm-ruby input lock is missing a required legal file');
	}

	return {
		profileId: value.profileId,
		provenanceLevel: value.provenanceLevel,
		licenseExpression: value.licenseExpression,
		artifact: value.artifact,
		components: value.components,
		packages,
		producer: { entry, script, tool },
		transformations: value.transformations,
		outputs,
		legalFiles
	};
}

/**
 * @param {{ format: string; runtime: string; profileId: string; provenanceLevel: string; licenseExpression: string; artifact: Record<string, unknown>; components: Record<string, unknown>; packages: unknown[]; producer: Record<string, unknown>; transformations: unknown[]; legalFiles: Array<{ targetPath: string; mediaType: string; spdx: string; size: number; sha256: string }>; metadata: { path: string; mediaType: string; size: number; sha256: string }; assets: LogicalAsset[]; storage: StorageAsset[]; fingerprint?: string }} manifest
 */
export function computeRubyRuntimeFingerprint(manifest) {
	if (
		!hasExactKeys(manifest, EXPECTED_MANIFEST_BODY_KEYS) &&
		!hasExactKeys(manifest, EXPECTED_MANIFEST_KEYS)
	) {
		throw new Error('Ruby runtime manifest does not match the exact v2 schema');
	}
	if (manifest.format !== RUBY_MANIFEST_FORMAT || manifest.runtime !== RUNTIME) {
		throw new Error('Ruby runtime manifest format or runtime is invalid');
	}
	const hash = createHash('sha256');
	hash.update(`${RUBY_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${manifest.format}\n`);
	hash.update(`runtime\0${manifest.runtime}\n`);
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(`provenanceLevel\0${manifest.provenanceLevel}\n`);
	hash.update(`licenseExpression\0${manifest.licenseExpression}\n`);
	hash.update(`artifact\0${canonicalJson(manifest.artifact)}\n`);
	hash.update(`components\0${canonicalJson(manifest.components)}\n`);
	hash.update(`packages\0${canonicalJson(manifest.packages)}\n`);
	hash.update(`producer\0${canonicalJson(manifest.producer)}\n`);
	hash.update(`transformations\0${canonicalJson(manifest.transformations)}\n`);
	for (const legal of [...manifest.legalFiles].sort((left, right) =>
		lexicalCompare(left.targetPath, right.targetPath)
	)) {
		hash.update(
			`legal\0${legal.targetPath}\0${legal.mediaType}\0${legal.spdx}\0${legal.size}\0${legal.sha256}\n`
		);
	}
	hash.update(
		`metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`
	);
	for (const asset of [...manifest.assets].sort((left, right) =>
		lexicalCompare(left.path, right.path)
	)) {
		hash.update(`asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`);
	}
	for (const asset of [...manifest.storage].sort((left, right) =>
		lexicalCompare(left.path, right.path)
	)) {
		hash.update(
			`storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`
		);
	}
	return hash.digest('hex');
}

/**
 * @param {{ repoRoot: string; nodeModulesDir: string; packageJsonPath: string; pnpmLockPath: string; lock: Awaited<ReturnType<typeof readInputLock>> }} options
 */
async function validateInstalledInputs(options) {
	const packageJsonBytes = await readFile(options.packageJsonPath);
	const pnpmLockBytes = await readFile(options.pnpmLockPath);
	let packageJson;
	try {
		packageJson = JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(packageJsonBytes)
		);
	} catch {
		throw new Error('wasm-ruby producer package.json is not valid UTF-8 JSON');
	}
	const pnpmLockText = new TextDecoder('utf-8', { fatal: true }).decode(pnpmLockBytes);
	const descriptors = [...options.lock.packages.values(), options.lock.producer.tool];
	/** @type {Array<Record<string, unknown>>} */
	const installedPackages = [];
	/** @type {Map<string, string>} */
	const installedPackageDirs = new Map();
	for (const descriptor of descriptors) {
		const declared =
			packageJson.dependencies?.[descriptor.name] ??
			packageJson.devDependencies?.[descriptor.name];
		if (declared !== descriptor.requestedRange) {
			throw new Error(`package.json does not pin the expected ${descriptor.name} range`);
		}
		const packageLink = path.join(options.nodeModulesDir, ...descriptor.name.split('/'));
		const packageDir = await realpath(packageLink).catch(() => null);
		if (!packageDir || !(await lstat(packageDir).catch(() => null))?.isDirectory()) {
			throw new Error(`wasm-ruby installed package is missing: ${descriptor.name}`);
		}
		const packageMetadata = JSON.parse(
			await readFile(path.join(packageDir, 'package.json'), 'utf8')
		);
		if (
			packageMetadata.name !== descriptor.name ||
			packageMetadata.version !== descriptor.version ||
			packageMetadata.license !== descriptor.license
		) {
			throw new Error(`wasm-ruby installed package identity is invalid: ${descriptor.name}`);
		}
		const tree = await packageTreeReceipt(packageDir);
		if (
			tree.files !== descriptor.files ||
			tree.bytes !== descriptor.bytes ||
			tree.treeSha256 !== descriptor.treeSha256
		) {
			throw new Error(
				`wasm-ruby installed package tree does not match the input lock: ${descriptor.name}`
			);
		}
		if (
			pnpmPackageIntegrity(pnpmLockText, descriptor.name, descriptor.version) !==
			descriptor.integrity
		) {
			throw new Error(
				`wasm-ruby pnpm integrity does not match the input lock: ${descriptor.name}`
			);
		}
		installedPackages.push({
			name: descriptor.name,
			version: descriptor.version,
			files: tree.files,
			bytes: tree.bytes,
			treeSha256: tree.treeSha256,
			integrity: descriptor.integrity
		});
		installedPackageDirs.set(descriptor.name, packageDir);
	}
	const rubyPackageDir = installedPackageDirs.get('@ruby/3.4-wasm-wasi');
	if (!rubyPackageDir) throw new Error('wasm-ruby source package was not verified');
	const sourceWasmPath = path.join(rubyPackageDir, 'dist', 'ruby+stdlib.wasm');
	const sourceWasmBytes = await readFile(sourceWasmPath);
	const expectedWasm = options.lock.outputs.get(WASM_ASSET_PATH);
	if (
		sourceWasmBytes.byteLength !== expectedWasm.bytes ||
		sha256(sourceWasmBytes) !== expectedWasm.sha256
	) {
		throw new Error('wasm-ruby source Wasm does not match the locked derived output');
	}

	const entryPath = path.resolve(options.repoRoot, options.lock.producer.entry.path);
	const entryBytes = await readFile(entryPath);
	if (
		entryBytes.byteLength !== options.lock.producer.entry.bytes ||
		sha256(entryBytes) !== options.lock.producer.entry.sha256
	) {
		throw new Error('wasm-ruby producer entry does not match the input lock');
	}
	const producerScriptPath = path.resolve(options.repoRoot, options.lock.producer.script.path);
	const producerScriptBytes = await readFile(producerScriptPath);
	if (
		producerScriptBytes.byteLength !== options.lock.producer.script.bytes ||
		sha256(producerScriptBytes) !== options.lock.producer.script.sha256
	) {
		throw new Error('wasm-ruby producer script does not match the input lock');
	}
	/** @type {Map<string, Uint8Array>} */
	const legalBytes = new Map();
	for (const legal of options.lock.legalFiles.values()) {
		const sourcePath = path.resolve(options.repoRoot, legal.sourcePath);
		if (!containsPath(options.repoRoot, sourcePath)) {
			throw new Error(`wasm-ruby legal source escapes the repository: ${legal.sourcePath}`);
		}
		const bytes = await readFile(sourcePath);
		if (bytes.byteLength !== legal.bytes || sha256(bytes) !== legal.sha256) {
			throw new Error(
				`wasm-ruby legal file does not match the input lock: ${legal.sourcePath}`
			);
		}
		legalBytes.set(legal.targetPath, bytes);
	}
	return {
		packageJsonSha256: sha256(packageJsonBytes),
		pnpmLockSha256: sha256(pnpmLockBytes),
		entryPath,
		entrySha256: sha256(entryBytes),
		producerScriptSha256: sha256(producerScriptBytes),
		sourceWasmSha256: sha256(sourceWasmBytes),
		installedPackages,
		legalBytes
	};
}

/** @param {{ entryPath: string; outDir: string; repoRoot: string }} options */
async function buildRubyRuntime(options) {
	await viteBuild({
		root: options.repoRoot,
		configFile: false,
		publicDir: false,
		logLevel: 'warn',
		base: './',
		assetsInclude: ['**/*.wasm'],
		build: {
			target: 'es2022',
			outDir: options.outDir,
			emptyOutDir: true,
			assetsInlineLimit: 0,
			modulePreload: false,
			minify: 'esbuild',
			rollupOptions: {
				preserveEntrySignatures: 'strict',
				input: options.entryPath,
				output: {
					format: 'es',
					entryFileNames: 'runtime.mjs',
					chunkFileNames: 'chunks/[name]-[hash].mjs',
					assetFileNames: 'assets/[name]-[hash][extname]'
				}
			}
		}
	});
}

/** @param {SyncWasmRubyOptions} [options] */
export async function syncWasmRubyAssets(options = {}) {
	const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
	const nodeModulesDir = path.resolve(
		options.nodeModulesDir || path.join(repoRoot, 'node_modules')
	);
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const generatedModulePath = path.resolve(
		options.generatedModulePath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_GENERATED_MODULE_PATH
				: `${targetDir}.ruby-runtime.generated.ts`)
	);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const packageJsonPath = path.resolve(
		options.packageJsonPath || path.join(repoRoot, 'package.json')
	);
	const pnpmLockPath = path.resolve(
		options.pnpmLockPath || path.join(repoRoot, 'pnpm-lock.yaml')
	);
	const renamePath = options.renamePath || rename;
	const buildRuntime = options.buildRuntime || buildRubyRuntime;
	const lock = await readInputLock(lockFilePath);

	for (const [targetPath, kind, label] of [
		[targetDir, 'directory', 'runtime target'],
		[generatedModulePath, 'file', 'generated Core module']
	]) {
		const stats = await lstat(targetPath).catch(() => null);
		if (stats && !(kind === 'directory' ? stats.isDirectory() : stats.isFile())) {
			throw new Error(`wasm-ruby ${label} has the wrong file type: ${targetPath}`);
		}
	}
	for (const [inputPath, label] of [
		[nodeModulesDir, 'node_modules directory'],
		[packageJsonPath, 'package.json'],
		[pnpmLockPath, 'pnpm lock']
	]) {
		const stats = await lstat(inputPath).catch(() => null);
		if (!stats || (label.endsWith('directory') ? !stats.isDirectory() : !stats.isFile())) {
			throw new Error(`wasm-ruby ${label} is missing or invalid: ${inputPath}`);
		}
	}
	const outputPaths = [targetDir, generatedModulePath];
	const inputPaths = [nodeModulesDir, packageJsonPath, pnpmLockPath, lockFilePath];
	const outputBoundaries = await Promise.all(outputPaths.map(resolveBoundaryPath));
	const inputBoundaries = await Promise.all(inputPaths.map(resolveBoundaryPath));
	for (let left = 0; left < outputBoundaries.length; left += 1) {
		for (let right = left + 1; right < outputBoundaries.length; right += 1) {
			if (pathsOverlap(outputBoundaries[left], outputBoundaries[right])) {
				throw new Error('wasm-ruby publication targets must not overlap');
			}
		}
		for (const inputBoundary of inputBoundaries) {
			if (pathsOverlap(outputBoundaries[left], inputBoundary)) {
				throw new Error('wasm-ruby publication targets must not overlap their inputs');
			}
		}
	}

	const inputSnapshot = await validateInstalledInputs({
		repoRoot,
		nodeModulesDir,
		packageJsonPath,
		pnpmLockPath,
		lock
	});
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'wasm-idle-ruby-'));
	const buildDir = path.join(temporaryRoot, 'build');
	await mkdir(buildDir, { recursive: true });
	try {
		await buildRuntime({ entryPath: inputSnapshot.entryPath, outDir: buildDir, repoRoot });
		const builtFiles = await listRegularFiles(buildDir);
		if (JSON.stringify(builtFiles) !== JSON.stringify([...OUTPUT_PATHS].sort())) {
			throw new Error(
				`wasm-ruby build has an unexpected output graph: ${builtFiles.join(', ')}`
			);
		}
		/** @type {Map<string, Uint8Array>} */
		const logicalBytes = new Map();
		for (const assetPath of OUTPUT_PATHS) {
			const bytes = await readFile(path.join(buildDir, assetPath));
			const expected = lock.outputs.get(assetPath);
			if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) {
				throw new Error(
					`wasm-ruby derived output does not match the input lock: ${assetPath}`
				);
			}
			logicalBytes.set(assetPath, bytes);
		}
		const wasmPath = WASM_ASSET_PATH;
		const modulePath = RUNTIME_MODULE_PATH;
		const wasmBytes = logicalBytes.get(wasmPath);
		if (!wasmBytes) throw new Error('wasm-ruby build omitted the locked Wasm output');
		if (
			wasmBytes.byteLength < 8 ||
			wasmBytes[0] !== 0 ||
			wasmBytes[1] !== 97 ||
			wasmBytes[2] !== 115 ||
			wasmBytes[3] !== 109
		) {
			throw new Error('wasm-ruby derived Wasm output has an invalid header');
		}
		const moduleBytes = logicalBytes.get(modulePath);
		if (!moduleBytes) throw new Error('wasm-ruby build omitted the locked module output');
		const moduleSource = new TextDecoder('utf-8', { fatal: true }).decode(moduleBytes);
		const assetExpression = `new URL(${JSON.stringify(wasmPath)},import.meta.url)`;
		if (moduleSource.split(assetExpression).length !== 2) {
			throw new Error(
				'wasm-ruby runtime module does not contain exactly one locked Wasm URL'
			);
		}

		const verifiedAgain = await validateInstalledInputs({
			repoRoot,
			nodeModulesDir,
			packageJsonPath,
			pnpmLockPath,
			lock
		});
		if (
			verifiedAgain.packageJsonSha256 !== inputSnapshot.packageJsonSha256 ||
			verifiedAgain.pnpmLockSha256 !== inputSnapshot.pnpmLockSha256 ||
			verifiedAgain.entrySha256 !== inputSnapshot.entrySha256 ||
			verifiedAgain.producerScriptSha256 !== inputSnapshot.producerScriptSha256 ||
			verifiedAgain.sourceWasmSha256 !== inputSnapshot.sourceWasmSha256 ||
			canonicalJson(verifiedAgain.installedPackages) !==
				canonicalJson(inputSnapshot.installedPackages)
		) {
			throw new Error('wasm-ruby producer inputs changed during the build');
		}

		/** @type {LogicalAsset[]} */
		const assets = OUTPUT_PATHS.map((assetPath) => {
			const receipt = lock.outputs.get(assetPath);
			return {
				path: assetPath,
				mediaType: receipt.mediaType,
				size: receipt.bytes,
				sha256: receipt.sha256
			};
		});
		/** @type {Map<string, Uint8Array>} */
		const storageBytes = new Map();
		/** @type {Map<string, Uint8Array>} */
		const legacyStorageBytes = new Map();
		/** @type {StorageAsset[]} */
		const storage = assets.map((asset) => {
			const logical = logicalBytes.get(asset.path);
			if (!logical) throw new Error(`wasm-ruby build omitted ${asset.path}`);
			const encoding = asset.path.endsWith('.wasm') ? 'gzip' : 'identity';
			const stored = encoding === 'gzip' ? gzipSync(logical, { level: 9 }) : logical;
			const storagePath =
				encoding === 'gzip' ? WASM_STORAGE_PATH : RUNTIME_MODULE_STORAGE_PATH;
			const legacyPath = encoding === 'gzip' ? LEGACY_WASM_STORAGE_PATH : RUNTIME_MODULE_PATH;
			storageBytes.set(storagePath, stored);
			legacyStorageBytes.set(legacyPath, stored);
			return {
				path: storagePath,
				logicalPath: asset.path,
				encoding,
				size: stored.byteLength,
				sha256: sha256(stored)
			};
		});
		const logicalBytesTotal = assets.reduce((total, asset) => total + asset.size, 0);
		const deliveryBytesTotal = storage.reduce((total, asset) => total + asset.size, 0);
		const moduleAsset = assets.find((asset) => asset.path === RUNTIME_MODULE_PATH);
		if (!moduleAsset || moduleAsset.size > MAX_MODULE_BYTES) {
			throw new Error(`wasm-ruby runtime module exceeds ${MAX_MODULE_BYTES} bytes`);
		}
		if (logicalBytesTotal > MAX_LOGICAL_BYTES) {
			throw new Error(`wasm-ruby logical graph exceeds ${MAX_LOGICAL_BYTES} bytes`);
		}
		if (deliveryBytesTotal > MAX_DELIVERY_BYTES) {
			throw new Error(`wasm-ruby delivery graph exceeds ${MAX_DELIVERY_BYTES} bytes`);
		}
		const packages = [...lock.packages.values()].sort((left, right) =>
			lexicalCompare(left.name, right.name)
		);
		const legalFiles = [...lock.legalFiles.values()].map((legal) => ({
			targetPath: legal.targetPath,
			mediaType: legal.mediaType,
			spdx: legal.spdx,
			size: legal.bytes,
			sha256: legal.sha256
		}));
		const buildMetadata = {
			format: 'wasm-ruby-runtime-build-v2',
			runtime: RUNTIME,
			profileId: lock.profileId,
			provenanceLevel: lock.provenanceLevel,
			licenseExpression: lock.licenseExpression,
			artifact: lock.artifact,
			components: lock.components,
			packages,
			producer: {
				entry: lock.producer.entry,
				script: lock.producer.script,
				tool: lock.producer.tool,
				packageTreeReceiptFormat: 'sha256-json-sorted-path-bytes-sha256-v1'
			},
			transformations: lock.transformations,
			legalFiles,
			sourceAssets: [
				lock.producer.entry,
				lock.producer.script,
				{
					path: 'node_modules/@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm',
					bytes: lock.outputs.get(wasmPath).bytes,
					sha256: lock.outputs.get(wasmPath).sha256
				}
			],
			derivedOutputs: assets
		};
		const buildMetadataBytes = Buffer.from(`${JSON.stringify(buildMetadata, null, 2)}\n`);
		const metadata = {
			path: BUILD_METADATA_FILE,
			mediaType: 'application/json',
			size: buildMetadataBytes.byteLength,
			sha256: sha256(buildMetadataBytes)
		};
		const manifestBody = {
			format: RUBY_MANIFEST_FORMAT,
			runtime: RUNTIME,
			profileId: lock.profileId,
			provenanceLevel: lock.provenanceLevel,
			licenseExpression: lock.licenseExpression,
			artifact: lock.artifact,
			components: lock.components,
			packages,
			producer: buildMetadata.producer,
			transformations: lock.transformations,
			legalFiles,
			metadata,
			assets,
			storage
		};
		const fingerprint = computeRubyRuntimeFingerprint(manifestBody);
		const manifest = { ...manifestBody, fingerprint };
		const legacyManifest = {
			formatVersion: 1,
			runtimeModule: modulePath,
			packages: Object.fromEntries(
				packages.map((candidate) => [candidate.name, candidate.version])
			),
			files: assets.map((asset) => ({
				path: asset.path,
				bytes: asset.size,
				sha256: asset.sha256
			}))
		};
		const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
		if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
			throw new Error(`wasm-ruby manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
		}
		if (deliveryBytesTotal + manifestBytes.byteLength > MAX_DELIVERY_BYTES) {
			throw new Error(
				`wasm-ruby manifest and delivery graph exceed ${MAX_DELIVERY_BYTES} bytes`
			);
		}
		const moduleStorage = storage.find(
			(candidate) => candidate.logicalPath === RUNTIME_MODULE_PATH
		);
		const wasmStorage = storage.find((candidate) => candidate.logicalPath === WASM_ASSET_PATH);
		const wasmAsset = assets.find((candidate) => candidate.path === WASM_ASSET_PATH);
		if (!moduleStorage || !wasmStorage || !wasmAsset) {
			throw new Error('wasm-ruby profile graph is incomplete');
		}
		const manifestReceipt = {
			bytes: manifestBytes.byteLength,
			sha256: sha256(manifestBytes)
		};
		const generatedModuleSource = [
			'// Generated by scripts/sync-wasm-ruby.mjs. Do not edit.',
			'export const RUBY_RUNTIME_GENERATED_PROFILE = Object.freeze({',
			`\tprofileId: '${lock.profileId}' as const,`,
			`\tartifactRevision: '${lock.artifact.revision}' as const,`,
			`\trubyVersion: '${lock.components.ruby.version}' as const,`,
			`\trubyRevision: '${lock.components.ruby.revision}' as const,`,
			`\trubyWasmVersion: '${lock.components.rubyWasm.version}' as const,`,
			`\trubyWasmRevision: '${lock.components.rubyWasm.revision}' as const,`,
			`\twasiSdkVersion: '${lock.components.wasiSdk.version}' as const,`,
			'\tmanifestFingerprint:',
			`\t\t'${fingerprint}' as const,`,
			'\tmanifestReceipt: Object.freeze({',
			`\t\tbytes: ${manifestReceipt.bytes},`,
			`\t\tsha256: '${manifestReceipt.sha256}' as const`,
			'\t}),',
			'\tmoduleJavaScriptReceipt: Object.freeze({',
			`\t\tbytes: ${moduleStorage.size},`,
			`\t\tsha256: '${moduleStorage.sha256}' as const`,
			'\t}),',
			'\twasmReceipt: Object.freeze({',
			`\t\tbytes: ${wasmStorage.size},`,
			`\t\tsha256: '${wasmStorage.sha256}' as const,`,
			`\t\tuncompressedBytes: ${wasmAsset.size},`,
			'\t\tuncompressedSha256:',
			`\t\t\t'${wasmAsset.sha256}' as const`,
			'\t})',
			'});',
			'export const RUBY_RUNTIME_GENERATED_BUNDLE = Object.freeze({',
			'\tprofile: RUBY_RUNTIME_GENERATED_PROFILE',
			'});',
			`export const RUBY_RUNTIME_GENERATED_ASSET_PATH = '${wasmPath}' as const;`,
			'export const RUBY_RUNTIME_GENERATED_ASSET_VERSION =',
			'\tRUBY_RUNTIME_GENERATED_PROFILE.manifestFingerprint;',
			'export const RUBY_RUNTIME_GENERATED_ASSET_RECEIPTS = Object.freeze({',
			`\t'${modulePath}': RUBY_RUNTIME_GENERATED_PROFILE.moduleJavaScriptReceipt,`,
			'\t[RUBY_RUNTIME_GENERATED_ASSET_PATH]: Object.freeze({',
			'\t\tbytes: RUBY_RUNTIME_GENERATED_PROFILE.wasmReceipt.uncompressedBytes,',
			'\t\tsha256: RUBY_RUNTIME_GENERATED_PROFILE.wasmReceipt.uncompressedSha256',
			'\t})',
			'});',
			''
		].join('\n');
		const staticFileBytes = new Map([
			...storageBytes,
			...legacyStorageBytes,
			...verifiedAgain.legalBytes,
			[BUILD_METADATA_FILE, buildMetadataBytes],
			[LEGACY_MANIFEST_FILE, Buffer.from(`${JSON.stringify(legacyManifest, null, 2)}\n`)],
			[MANIFEST_FILE, manifestBytes]
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
				const destination = path.join(publications[0].temporary, relativePath);
				await mkdir(path.dirname(destination), { recursive: true });
				await writeFile(destination, bytes);
			}
			await writeFile(publications[1].temporary, generatedModuleSource, 'utf8');
			const installedFiles = await listRegularFiles(publications[0].temporary);
			if (
				JSON.stringify(installedFiles) !==
				JSON.stringify([...staticFileBytes.keys()].sort())
			) {
				throw new Error('wasm-ruby temporary installation has unexpected files');
			}
			for (const asset of assets) {
				const stored = storage.find((candidate) => candidate.logicalPath === asset.path);
				if (!stored) throw new Error(`wasm-ruby storage graph omitted ${asset.path}`);
				const installed = await readFile(path.join(publications[0].temporary, stored.path));
				if (installed.byteLength !== stored.size || sha256(installed) !== stored.sha256) {
					throw new Error(
						`wasm-ruby temporary storage receipt failed for ${stored.path}`
					);
				}
				const logical = stored.encoding === 'gzip' ? gunzipSync(installed) : installed;
				if (logical.byteLength !== asset.size || sha256(logical) !== asset.sha256) {
					throw new Error(`wasm-ruby temporary logical receipt failed for ${asset.path}`);
				}
			}
			for (const [canonicalPath, legacyPath] of [
				[RUNTIME_MODULE_STORAGE_PATH, RUNTIME_MODULE_PATH],
				[WASM_STORAGE_PATH, LEGACY_WASM_STORAGE_PATH]
			]) {
				const canonical = await readFile(
					path.join(publications[0].temporary, canonicalPath)
				);
				const legacy = await readFile(path.join(publications[0].temporary, legacyPath));
				if (!canonical.equals(legacy)) {
					throw new Error(`wasm-ruby legacy storage alias differs from ${canonicalPath}`);
				}
			}
			const installedManifest = JSON.parse(
				await readFile(path.join(publications[0].temporary, MANIFEST_FILE), 'utf8')
			);
			if (
				canonicalJson(installedManifest) !== canonicalJson(manifest) ||
				computeRubyRuntimeFingerprint(installedManifest) !== fingerprint ||
				(await readFile(publications[1].temporary, 'utf8')) !== generatedModuleSource
			) {
				throw new Error('wasm-ruby temporary installation failed manifest verification');
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
						'wasm-ruby publication failed and rollback was incomplete'
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
			sourceDir: nodeModulesDir,
			targetDir,
			generatedModulePath,
			fingerprint
		};
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , nodeModulesDirArg, targetDirArg] = process.argv;
	const result = await syncWasmRubyAssets({
		nodeModulesDir: nodeModulesDirArg
			? path.resolve(nodeModulesDirArg)
			: DEFAULT_NODE_MODULES_DIR,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR,
		packageJsonPath: DEFAULT_PACKAGE_JSON_PATH,
		pnpmLockPath: DEFAULT_PNPM_LOCK_PATH
	});
	console.log(
		`Synced wasm-ruby ${result.fingerprint} from ${result.sourceDir} to ${result.targetDir}`
	);
}
