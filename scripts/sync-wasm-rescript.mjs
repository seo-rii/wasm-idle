import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-rescript');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	THIS_DIR,
	'runtime-workers',
	'wasm-rescript-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmReScriptVersion.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-rescript-assets.lock.json');
const LICENSE_FILE = 'LICENSE.txt';
const BUILD_METADATA_FILE = 'runtime-build.json';
const MANIFEST_FILE = 'runtime-manifest.v1.json';
const LOGICAL_ASSET = 'compiler.js';
const STORAGE_ASSET = 'compiler.js.gz.bin';
const WORKER_FILE = 'runner-worker.js';
const PUBLISHED_FILES = [
	BUILD_METADATA_FILE,
	LICENSE_FILE,
	STORAGE_ASSET,
	MANIFEST_FILE,
	WORKER_FILE
].sort();
const COMPILER_COMPONENT = 'compiler.js';
const CMIJ_COMPONENT = 'compiler-builtins/cmij.js';
const RUNTIME_COMPONENT = 'rescript-runtime-12.3.1.tgz';
const RUNTIME_MODULE_PREFIX = 'package/lib/js/';
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;

export const RESCRIPT_MANIFEST_FORMAT = 'wasm-rescript-runtime-manifest-v1';
export const RESCRIPT_BUILD_FORMAT = 'wasm-rescript-runtime-build-v1';
export const RESCRIPT_FINGERPRINT_DOMAIN = 'wasm-idle:rescript-runtime-manifest:v1';
export const RESCRIPT_RUNTIME_GLOBAL = '__wasmIdleReScriptRuntime';

/** @typedef {{ path: string; url: string; bytes: number; sha256: string; integrity?: string }} ComponentReceipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} LogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'gzip'; size: number; sha256: string }} StorageAsset */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {string} filePath */
async function isRegularFile(filePath) {
	return !!(await lstat(filePath).catch(() => null))?.isFile();
}

/** @param {unknown} value @param {string} label @returns {ComponentReceipt} */
function validateComponent(value, label) {
	if (
		!isObject(value) ||
		typeof value.path !== 'string' ||
		!value.path ||
		typeof value.url !== 'string' ||
		!/^https:\/\//u.test(value.url) ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`${label} has invalid path, URL, size, or SHA-256 metadata`);
	}
	return Object.freeze({
		path: value.path,
		url: value.url,
		bytes: value.bytes,
		sha256: value.sha256,
		...(typeof value.integrity === 'string' ? { integrity: value.integrity } : {})
	});
}

/** @param {string} lockFilePath */
export async function readReScriptInputLock(lockFilePath = DEFAULT_LOCK_FILE_PATH) {
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-rescript input lock is not readable JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!isObject(value) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!/^rescript-[A-Za-z0-9._+-]+$/u.test(value.profileId) ||
		!isObject(value.source) ||
		value.source.repository !== 'https://github.com/rescript-lang/rescript' ||
		value.source.revision !== 'v12.3.1' ||
		typeof value.source.commit !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.source.commit) ||
		!isObject(value.build) ||
		value.build.rescriptVersion !== '12.3.1' ||
		value.build.moduleSystem !== 'commonjs' ||
		typeof value.build.compilerBuild !== 'string' ||
		!isObject(value.license) ||
		value.license.path !== LICENSE_FILE ||
		value.license.spdx !== 'LGPL-3.0-or-later AND MIT' ||
		!Array.isArray(value.components) ||
		!Array.isArray(value.licenseSources)
	) {
		throw new Error('wasm-rescript input lock has invalid profile, source, build, or license');
	}
	const components = new Map(
		value.components.map((/** @type {unknown} */ entry, /** @type {number} */ index) => {
			const component = validateComponent(entry, `wasm-rescript component ${index}`);
			return [component.path, component];
		})
	);
	if (
		components.size !== 3 ||
		![COMPILER_COMPONENT, CMIJ_COMPONENT, RUNTIME_COMPONENT].every((name) =>
			components.has(name)
		)
	) {
		throw new Error('wasm-rescript input lock must pin compiler.js, cmij.js, and the runtime');
	}
	const licenseSources = value.licenseSources.map(
		(/** @type {unknown} */ entry, /** @type {number} */ index) =>
			validateComponent(entry, `wasm-rescript license source ${index}`)
	);
	if (!licenseSources.length) {
		throw new Error('wasm-rescript input lock must pin at least one upstream license text');
	}
	const bundle =
		value.bundle === undefined
			? null
			: (() => {
					if (
						!isObject(value.bundle) ||
						!Number.isSafeInteger(value.bundle.bytes) ||
						typeof value.bundle.sha256 !== 'string' ||
						!/^[a-f0-9]{64}$/u.test(value.bundle.sha256)
					) {
						throw new Error('wasm-rescript input lock has an invalid bundle receipt');
					}
					return Object.freeze({
						bytes: value.bundle.bytes,
						sha256: value.bundle.sha256
					});
				})();
	return Object.freeze({
		profileId: value.profileId,
		source: Object.freeze({
			repository: value.source.repository,
			revision: value.source.revision,
			commit: value.source.commit
		}),
		build: Object.freeze({
			rescriptVersion: value.build.rescriptVersion,
			compilerBuild: value.build.compilerBuild,
			moduleSystem: value.build.moduleSystem
		}),
		license: Object.freeze({ path: value.license.path, spdx: value.license.spdx }),
		components,
		licenseSources: Object.freeze(licenseSources),
		bundle
	});
}

/** @param {Uint8Array} bytes @param {ComponentReceipt} receipt */
function verifyComponent(bytes, receipt) {
	if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
		throw new Error(`wasm-rescript ${receipt.path} does not match its pinned size/SHA-256`);
	}
	if (receipt.integrity?.startsWith('sha512-')) {
		const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
		if (actual !== receipt.integrity) {
			throw new Error(`wasm-rescript ${receipt.path} does not match its npm integrity`);
		}
	}
}

/**
 * Reads regular files from an uncompressed ustar archive.
 * @param {Uint8Array} tarBytes
 */
export function readTarFiles(tarBytes) {
	/** @type {Map<string, Uint8Array>} */
	const files = new Map();
	const decoder = new TextDecoder();
	const field = (/** @type {number} */ offset, /** @type {number} */ length) => {
		const raw = tarBytes.subarray(offset, offset + length);
		const end = raw.indexOf(0);
		return decoder.decode(end === -1 ? raw : raw.subarray(0, end));
	};
	let offset = 0;
	let pendingLongName = '';
	while (offset + 512 <= tarBytes.byteLength) {
		const header = tarBytes.subarray(offset, offset + 512);
		if (header.every((value) => value === 0)) break;
		const name = field(offset, 100);
		const size = Number.parseInt(field(offset + 124, 12).trim() || '0', 8);
		const type = String.fromCharCode(header[156] || 48);
		const prefix = field(offset + 345, 155);
		if (!Number.isSafeInteger(size) || size < 0) {
			throw new Error('wasm-rescript runtime archive has an invalid tar entry size');
		}
		const dataStart = offset + 512;
		const data = tarBytes.subarray(dataStart, dataStart + size);
		if (data.byteLength !== size) {
			throw new Error('wasm-rescript runtime archive is truncated');
		}
		if (type === 'L') {
			pendingLongName = decoder.decode(data).replace(/\0+$/u, '');
		} else if (type === '0' || type === '\0') {
			const fullName = pendingLongName || (prefix ? `${prefix}/${name}` : name);
			pendingLongName = '';
			files.set(fullName, data);
		} else {
			pendingLongName = '';
		}
		offset = dataStart + Math.ceil(size / 512) * 512;
	}
	return files;
}

/**
 * Concatenates the pinned upstream playground compiler, its stdlib cmij bundle, and the
 * upstream CommonJS runtime modules into one verified worker script.
 * @param {{ compiler: Uint8Array; cmij: Uint8Array; runtimeTarball: Uint8Array; version: string }} input
 */
export function buildReScriptRuntimeBundle(input) {
	const tarFiles = readTarFiles(gunzipSync(input.runtimeTarball));
	const runtimeModules = [...tarFiles.entries()]
		.filter(
			([name]) =>
				name.startsWith(RUNTIME_MODULE_PREFIX) &&
				name.endsWith('.js') &&
				!name.slice(RUNTIME_MODULE_PREFIX.length).includes('/')
		)
		.map(([name, bytes]) => [name.slice(RUNTIME_MODULE_PREFIX.length), bytes])
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	if (!runtimeModules.some(([name]) => name === 'Stdlib_Int.js')) {
		throw new Error('wasm-rescript runtime archive does not contain CommonJS stdlib modules');
	}
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const compilerSource = decoder.decode(input.compiler);
	const cmijSource = decoder.decode(input.cmij);
	if (!compilerSource.includes('rescript_compiler')) {
		throw new Error('wasm-rescript compiler.js does not export rescript_compiler');
	}
	let modules = '';
	for (const [name, bytes] of runtimeModules) {
		const source = decoder.decode(/** @type {Uint8Array} */ (bytes));
		modules += `modules[${JSON.stringify(name)}] = function (exports, require, module) {\n${source}\n};\n`;
	}
	const bundle =
		`/* wasm-idle ReScript ${input.version} browser bundle: upstream playground compiler.js, ` +
		`compiler-builtins/cmij.js, and @rescript/runtime lib/js modules (unmodified). */\n` +
		`${compilerSource}\n;\n${cmijSource}\n;\n` +
		`(function () {\n'use strict';\nvar modules = Object.create(null);\n${modules}` +
		`globalThis.${RESCRIPT_RUNTIME_GLOBAL} = Object.freeze({ version: ${JSON.stringify(input.version)}, modules: Object.freeze(modules) });\n` +
		`})();\n`;
	const bytes = new TextEncoder().encode(bundle);
	if (bytes.byteLength > MAX_BUNDLE_BYTES) {
		throw new Error('wasm-rescript runtime bundle exceeds the 16 MiB asset limit');
	}
	return { bytes, moduleCount: runtimeModules.length };
}

/**
 * @param {{
 *   profileId: string;
 *   source: { repository: string; revision: string; commit: string };
 *   build: Record<string, string>;
 *   license: { path: string; spdx: string; size: number; sha256: string };
 *   metadata: { path: string; mediaType: string; size: number; sha256: string };
 *   assets: LogicalAsset[];
 *   storage: StorageAsset[];
 * }} manifest
 */
export function computeReScriptRuntimeFingerprint(manifest) {
	let canonical = `${RESCRIPT_FINGERPRINT_DOMAIN}\nformat\0${RESCRIPT_MANIFEST_FORMAT}\nruntime\0rescript-playground\nprofileId\0${manifest.profileId}\n`;
	canonical += `source\0${manifest.source.repository}\0${manifest.source.revision}\0${manifest.source.commit}\n`;
	for (const [name, value] of Object.entries(manifest.build).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	)) {
		canonical += `build\0${name}\0${value}\n`;
	}
	canonical += `license\0${manifest.license.path}\0${manifest.license.spdx}\0${manifest.license.size}\0${manifest.license.sha256}\n`;
	canonical += `metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`;
	for (const asset of manifest.assets) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of manifest.storage) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return sha256(new TextEncoder().encode(canonical));
}

/**
 * Downloads the pinned upstream inputs into `sourceDir` and verifies each receipt.
 * @param {string} sourceDir
 * @param {{ lockFilePath?: string; fetch?: typeof fetch }} [options]
 */
export async function fetchWasmReScriptSources(sourceDir, options = {}) {
	const lock = await readReScriptInputLock(options.lockFilePath);
	const fetchImpl = options.fetch || fetch;
	for (const receipt of [...lock.components.values(), ...lock.licenseSources]) {
		const response = await fetchImpl(receipt.url);
		if (!response.ok) {
			throw new Error(`wasm-rescript download failed (${response.status}): ${receipt.url}`);
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		verifyComponent(bytes, receipt);
		const targetPath = path.join(sourceDir, receipt.path);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await writeFile(targetPath, bytes);
	}
	return sourceDir;
}

/**
 * @typedef {object} SyncWasmReScriptOptions
 * @property {string} [sourceDir] Upstream download directory; omitted re-verifies the checked-in gzip.
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [lockFilePath]
 */

/** @param {SyncWasmReScriptOptions} [options] */
export async function syncWasmReScriptAssets(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === DEFAULT_TARGET_DIR
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const lock = await readReScriptInputLock(lockFilePath);
	const workerBytes = await readFile(workerSourcePath);

	/** @type {Uint8Array} */
	let bundleBytes;
	/** @type {Uint8Array} */
	let storageBytes;
	/** @type {Uint8Array} */
	let licenseBytes;
	let moduleCount;
	if (options.sourceDir !== undefined) {
		const sourceDir = path.resolve(options.sourceDir);
		const read = async (/** @type {ComponentReceipt} */ receipt) => {
			const filePath = path.join(sourceDir, receipt.path);
			if (!(await isRegularFile(filePath))) {
				throw new Error(`wasm-rescript source ${receipt.path} must be a regular file`);
			}
			const bytes = new Uint8Array(await readFile(filePath));
			verifyComponent(bytes, receipt);
			return bytes;
		};
		const built = buildReScriptRuntimeBundle({
			compiler: await read(
				/** @type {ComponentReceipt} */ (lock.components.get(COMPILER_COMPONENT))
			),
			cmij: await read(/** @type {ComponentReceipt} */ (lock.components.get(CMIJ_COMPONENT))),
			runtimeTarball: await read(
				/** @type {ComponentReceipt} */ (lock.components.get(RUNTIME_COMPONENT))
			),
			version: lock.build.rescriptVersion
		});
		bundleBytes = built.bytes;
		moduleCount = built.moduleCount;
		if (
			lock.bundle &&
			(bundleBytes.byteLength !== lock.bundle.bytes ||
				sha256(bundleBytes) !== lock.bundle.sha256)
		) {
			throw new Error(
				'wasm-rescript rebuilt bundle does not match the pinned bundle receipt'
			);
		}
		const licenseParts = [];
		for (const receipt of lock.licenseSources) {
			const text = new TextDecoder('utf-8', { fatal: true }).decode(await read(receipt));
			licenseParts.push(`==== ${receipt.path} (${receipt.url}) ====\n\n${text.trimEnd()}\n`);
		}
		licenseBytes = new TextEncoder().encode(
			`ReScript ${lock.build.rescriptVersion} (${lock.source.repository}, ${lock.source.revision}).\n` +
				'The bundled compiler is LGPL-3.0-or-later (compiler/syntax and @rescript/runtime are MIT).\n\n' +
				licenseParts.join('\n')
		);
		storageBytes = gzipSync(bundleBytes, { level: 9 });
	} else {
		if (!lock.bundle) {
			throw new Error('wasm-rescript installed sync requires a pinned bundle receipt');
		}
		storageBytes = new Uint8Array(await readFile(path.join(targetDir, STORAGE_ASSET)));
		try {
			bundleBytes = gunzipSync(storageBytes, { maxOutputLength: lock.bundle.bytes });
		} catch {
			throw new Error(`wasm-rescript ${STORAGE_ASSET} is not valid bounded gzip`);
		}
		if (
			bundleBytes.byteLength !== lock.bundle.bytes ||
			sha256(bundleBytes) !== lock.bundle.sha256
		) {
			throw new Error(
				'wasm-rescript installed bundle does not match the pinned bundle receipt'
			);
		}
		licenseBytes = new Uint8Array(await readFile(path.join(targetDir, LICENSE_FILE)));
		const previousMetadata = JSON.parse(
			await readFile(path.join(targetDir, BUILD_METADATA_FILE), 'utf8')
		);
		moduleCount = previousMetadata.runtimeModuleCount;
	}

	const metadata = {
		format: RESCRIPT_BUILD_FORMAT,
		runtime: 'rescript-playground',
		rescriptVersion: lock.build.rescriptVersion,
		source: lock.source,
		compilerBuild: lock.build.compilerBuild,
		moduleSystem: lock.build.moduleSystem,
		components: [...lock.components.values()],
		runtimeModuleCount: moduleCount,
		bundle: { bytes: bundleBytes.byteLength, sha256: sha256(bundleBytes) }
	};
	const metadataBytes = new TextEncoder().encode(`${JSON.stringify(metadata, null, 2)}\n`);
	/** @type {LogicalAsset[]} */
	const assets = [
		{
			path: LOGICAL_ASSET,
			mediaType: 'text/javascript',
			size: bundleBytes.byteLength,
			sha256: sha256(bundleBytes)
		}
	];
	/** @type {StorageAsset[]} */
	const storage = [
		{
			path: STORAGE_ASSET,
			logicalPath: LOGICAL_ASSET,
			encoding: 'gzip',
			size: storageBytes.byteLength,
			sha256: sha256(storageBytes)
		}
	];
	const license = {
		path: lock.license.path,
		spdx: lock.license.spdx,
		size: licenseBytes.byteLength,
		sha256: sha256(licenseBytes)
	};
	const metadataReceipt = {
		path: BUILD_METADATA_FILE,
		mediaType: 'application/json',
		size: metadataBytes.byteLength,
		sha256: sha256(metadataBytes)
	};
	const build = { ...lock.build };
	const fingerprint = computeReScriptRuntimeFingerprint({
		profileId: lock.profileId,
		source: lock.source,
		build,
		license,
		metadata: metadataReceipt,
		assets,
		storage
	});
	const manifest = {
		format: RESCRIPT_MANIFEST_FORMAT,
		runtime: 'rescript-playground',
		profileId: lock.profileId,
		fingerprint,
		source: lock.source,
		build,
		license,
		metadata: metadataReceipt,
		assets,
		storage
	};
	const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
	const workerReceipt = { bytes: workerBytes.byteLength, sha256: sha256(workerBytes) };
	const versionModuleSource = `export const WASM_RESCRIPT_RUNTIME_PROFILE = {
\tprofileId: '${lock.profileId}',
\tsourceRevision: '${lock.source.revision}',
\tmanifestFingerprint: '${fingerprint}',
\tmanifestReceipt: {
\t\tbytes: ${manifestBytes.byteLength},
\t\tsha256: '${sha256(manifestBytes)}'
\t},
\tcompilerReceipt: {
\t\tbytes: ${storage[0].size},
\t\tsha256: '${storage[0].sha256}',
\t\tuncompressedBytes: ${assets[0].size},
\t\tuncompressedSha256: '${assets[0].sha256}'
\t}
} as const;
export const WASM_RESCRIPT_ASSET_VERSION = WASM_RESCRIPT_RUNTIME_PROFILE.manifestFingerprint;
export const WASM_RESCRIPT_RUNNER_RECEIPT = {
\tbytes: ${workerReceipt.bytes},
\tsha256: '${workerReceipt.sha256}'
} as const;
`;

	const publicationId = randomUUID();
	const stagingDir = path.join(
		path.dirname(targetDir),
		`.${path.basename(targetDir)}.staging-${publicationId}`
	);
	const previousDir = path.join(
		path.dirname(targetDir),
		`.${path.basename(targetDir)}.previous-${publicationId}`
	);
	await mkdir(stagingDir, { recursive: true });
	try {
		await Promise.all([
			writeFile(path.join(stagingDir, STORAGE_ASSET), storageBytes),
			writeFile(path.join(stagingDir, LICENSE_FILE), licenseBytes),
			writeFile(path.join(stagingDir, BUILD_METADATA_FILE), metadataBytes),
			writeFile(path.join(stagingDir, MANIFEST_FILE), manifestBytes),
			writeFile(path.join(stagingDir, WORKER_FILE), workerBytes)
		]);
		if (
			JSON.stringify((await readdir(stagingDir)).sort()) !== JSON.stringify(PUBLISHED_FILES)
		) {
			throw new Error('wasm-rescript staging directory has unexpected files');
		}
		const hadTarget = !!(await lstat(targetDir).catch(() => null));
		if (hadTarget) await rename(targetDir, previousDir);
		try {
			await rename(stagingDir, targetDir);
		} catch (error) {
			if (hadTarget) await rename(previousDir, targetDir);
			throw error;
		}
		if (hadTarget) await rm(previousDir, { recursive: true, force: true });
		await mkdir(path.dirname(versionModulePath), { recursive: true });
		await writeFile(versionModulePath, versionModuleSource, 'utf8');
	} finally {
		await rm(stagingDir, { recursive: true, force: true });
	}
	return {
		targetDir,
		versionModulePath,
		fingerprint,
		bundle: { bytes: bundleBytes.byteLength, sha256: sha256(bundleBytes) },
		storage: { bytes: storageBytes.byteLength, sha256: sha256(storageBytes) },
		workerReceipt
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const args = process.argv.slice(2);
	if (args[0] === '--fetch') {
		const sourceDir = path.resolve(args[1] || path.join(REPO_ROOT, '.cache', 'wasm-rescript'));
		await fetchWasmReScriptSources(sourceDir);
		const result = await syncWasmReScriptAssets({ sourceDir });
		console.log(
			`Synced wasm-rescript from upstream downloads in ${sourceDir}: bundle ${result.bundle.sha256} (${result.bundle.bytes} bytes)`
		);
	} else {
		const [sourceDirArg, targetDirArg] = args;
		const result = await syncWasmReScriptAssets({
			sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
			targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
		});
		console.log(`Synced wasm-rescript to ${result.targetDir} (${result.fingerprint})`);
	}
}
