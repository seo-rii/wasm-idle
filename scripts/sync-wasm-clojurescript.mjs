import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-clojurescript');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-clojurescript-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmClojureScriptVersion.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-clojurescript-assets.lock.json');
const LICENSE_FILE = 'LICENSE.txt';
const BUILD_METADATA_FILE = 'runtime-build.json';
const LEGACY_MANIFEST_FILE = 'runtime-manifest.v1.json';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const LOGICAL_ASSET = 'compiler.js';
const LEGACY_STORAGE_ASSET = 'compiler.js.gz';
const STORAGE_ASSET = 'compiler.js.gz.bin';
const PUBLISHED_FILES = [
	LICENSE_FILE,
	LEGACY_STORAGE_ASSET,
	STORAGE_ASSET,
	'runner-worker.js',
	BUILD_METADATA_FILE,
	LEGACY_MANIFEST_FILE,
	MANIFEST_FILE
].sort();
export const CLOJURESCRIPT_MANIFEST_FORMAT = 'wasm-clojurescript-runtime-manifest-v2';
export const CLOJURESCRIPT_FINGERPRINT_DOMAIN = 'wasm-idle:clojurescript-runtime-manifest:v2';

/** @typedef {{ bytes: number; sha256: string }} InputReceipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} LogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'gzip'; size: number; sha256: string }} StorageAsset */
/** @typedef {{ clojureScriptVersion: string; clojureToolsVersion: string; jdkVersion: string; jdkArchiveSha256: string; clojureToolsArchiveSha256: string; target: string; optimizations: string }} ClojureScriptBuild */

/**
 * @typedef {object} SyncWasmClojureScriptOptions
 * @property {string} [sourceDir] Explicit raw producer snapshot; omitted uses the installed locked gzip.
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [lockFilePath]
 * @property {(sourcePath: string, targetPath: string) => Promise<void>} [renamePath]
 */

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
function validateInputReceipt(value, label) {
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
		throw new Error(`wasm-clojurescript input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-clojurescript input lock is not valid JSON: ${
				error instanceof Error ? error.message : error
			}`
		);
	}
	if (
		!isObject(value) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!/^clojurescript-[A-Za-z0-9._+-]+$/u.test(value.profileId) ||
		!isObject(value.source) ||
		value.source.repository !== 'https://github.com/clojure/clojurescript' ||
		value.source.revision !== 'r1.12.134' ||
		value.source.integrationRepository !== 'https://github.com/seo-rii/wasm-idle' ||
		typeof value.source.integrationRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.source.integrationRevision) ||
		!isObject(value.build) ||
		value.build.clojureScriptVersion !== '1.12.134' ||
		value.build.clojureToolsVersion !== '1.12.4.1618' ||
		value.build.jdkVersion !== '21.0.11+10' ||
		value.build.jdkArchiveSha256 !==
			'4b2220e232a97997b436ca6ab15cbf70171ecff52958a46159dfa5a8c44ca4de' ||
		value.build.clojureToolsArchiveSha256 !==
			'13769da6d63a98deb2024378ae1a64e4ee211ac1035340dfca7a6944c41cde21' ||
		value.build.target !== 'webworker' ||
		value.build.optimizations !== 'simple' ||
		!isObject(value.license) ||
		value.license.path !== LICENSE_FILE ||
		value.license.spdx !== 'EPL-1.0' ||
		!Array.isArray(value.assets) ||
		value.assets.length !== 2
	) {
		throw new Error(
			'wasm-clojurescript input lock has invalid profile, source, build, or license metadata'
		);
	}
	const licenseReceipt = validateInputReceipt(value.license, 'wasm-clojurescript input license');
	const receipts = new Map();
	for (const candidate of value.assets) {
		if (
			!isObject(candidate) ||
			typeof candidate.path !== 'string' ||
			![LOGICAL_ASSET, BUILD_METADATA_FILE].includes(candidate.path) ||
			receipts.has(candidate.path)
		) {
			throw new Error('wasm-clojurescript input lock has an invalid or duplicate asset path');
		}
		receipts.set(
			candidate.path,
			validateInputReceipt(candidate, `wasm-clojurescript input ${candidate.path}`)
		);
	}
	if ([LOGICAL_ASSET, BUILD_METADATA_FILE].some((assetPath) => !receipts.has(assetPath))) {
		throw new Error('wasm-clojurescript input lock is missing a required asset');
	}
	return Object.freeze({
		profileId: value.profileId,
		source: Object.freeze({
			repository: value.source.repository,
			revision: value.source.revision,
			integrationRepository: value.source.integrationRepository,
			integrationRevision: value.source.integrationRevision
		}),
		build: Object.freeze(
			/** @type {ClojureScriptBuild} */ ({
				clojureScriptVersion: value.build.clojureScriptVersion,
				clojureToolsVersion: value.build.clojureToolsVersion,
				jdkVersion: value.build.jdkVersion,
				jdkArchiveSha256: value.build.jdkArchiveSha256,
				clojureToolsArchiveSha256: value.build.clojureToolsArchiveSha256,
				target: value.build.target,
				optimizations: value.build.optimizations
			})
		),
		license: Object.freeze({
			path: value.license.path,
			spdx: value.license.spdx,
			...licenseReceipt
		}),
		receipts
	});
}

/**
 * @param {{
 *   profileId: string;
 *   source: { repository: string; revision: string; integrationRepository: string; integrationRevision: string };
 *   build: ClojureScriptBuild;
 *   license: { path: string; spdx: string; size: number; sha256: string };
 *   metadata: { path: string; mediaType: string; size: number; sha256: string };
 *   assets: LogicalAsset[];
 *   storage: StorageAsset[];
 * }} manifest
 */
export function computeClojureScriptRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${CLOJURESCRIPT_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${CLOJURESCRIPT_MANIFEST_FORMAT}\n`);
	hash.update('runtime\0cljs.js\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	hash.update(
		`source\0${manifest.source.repository}\0${manifest.source.revision}\0${manifest.source.integrationRepository}\0${manifest.source.integrationRevision}\n`
	);
	for (const [name, value] of Object.entries(manifest.build).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	)) {
		hash.update(`build\0${name}\0${value}\n`);
	}
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

/** @param {Uint8Array} metadataBytes @param {Readonly<ClojureScriptBuild>} expectedBuild @param {InputReceipt} compilerReceipt */
function validateBuildMetadata(metadataBytes, expectedBuild, compilerReceipt) {
	let metadata;
	try {
		metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes));
	} catch {
		throw new Error('wasm-clojurescript runtime-build.json is not valid UTF-8 JSON');
	}
	if (
		!isObject(metadata) ||
		metadata.format !== 'wasm-clojurescript-runtime-build-v1' ||
		metadata.runtime !== 'cljs.js' ||
		metadata.clojureScriptVersion !== expectedBuild.clojureScriptVersion ||
		metadata.clojureToolsVersion !== expectedBuild.clojureToolsVersion ||
		metadata.jdkVersion !== expectedBuild.jdkVersion ||
		metadata.jdkArchiveSha256 !== expectedBuild.jdkArchiveSha256 ||
		metadata.clojureToolsArchiveSha256 !== expectedBuild.clojureToolsArchiveSha256 ||
		metadata.target !== expectedBuild.target ||
		metadata.optimizations !== expectedBuild.optimizations ||
		metadata.compilerSha256 !== compilerReceipt.sha256 ||
		metadata.compilerBytes !== compilerReceipt.bytes
	) {
		throw new Error('wasm-clojurescript runtime-build.json does not match the input lock');
	}
}

/** @param {string} directory */
async function assertExactPublishedFiles(directory) {
	const entries = (await readdir(directory)).sort();
	if (JSON.stringify(entries) !== JSON.stringify(PUBLISHED_FILES)) {
		throw new Error('wasm-clojurescript temporary installation has unexpected files');
	}
	for (const entry of entries) {
		if (!(await isRegularFile(path.join(directory, entry)))) {
			throw new Error(`wasm-clojurescript published asset must be a regular file: ${entry}`);
		}
	}
}

/** @param {SyncWasmClojureScriptOptions} [options] */
export async function syncWasmClojureScriptAssets(options = {}) {
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	// Deploy the checked-in snapshot by default. An ignored producer dist/ may come
	// from an older checkout; only an explicit source requests producer ingestion.
	const installedSource = options.sourceDir === undefined;
	const sourceDir = path.resolve(options.sourceDir ?? targetDir);
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === path.resolve(DEFAULT_TARGET_DIR)
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const renamePath = options.renamePath || rename;
	const [targetStats, versionStats] = await Promise.all([
		lstat(targetDir).catch(() => null),
		lstat(versionModulePath).catch(() => null)
	]);
	if (targetStats && !targetStats.isDirectory()) {
		throw new Error(`wasm-clojurescript runtime target must be a directory: ${targetDir}`);
	}
	if (versionStats && !versionStats.isFile()) {
		throw new Error(
			`wasm-clojurescript version module must be a regular file: ${versionModulePath}`
		);
	}
	for (const [filePath, label] of [
		[workerSourcePath, 'worker source'],
		[lockFilePath, 'input lock']
	]) {
		if (!(await isRegularFile(filePath))) {
			throw new Error(`wasm-clojurescript ${label} must be a regular file: ${filePath}`);
		}
	}

	const lock = await readInputLock(lockFilePath);
	const [targetBoundary, versionBoundary, sourceBoundary, workerBoundary, lockBoundary] =
		await Promise.all(
			[targetDir, versionModulePath, sourceDir, workerSourcePath, lockFilePath].map(
				resolveBoundaryPath
			)
		);
	if (pathsOverlap(targetBoundary, versionBoundary)) {
		throw new Error('wasm-clojurescript runtime target and version module must not overlap');
	}
	for (const [candidateBoundary, label] of [
		...(!installedSource ? [[sourceBoundary, 'source directory']] : []),
		[workerBoundary, 'worker source'],
		[lockBoundary, 'input lock']
	]) {
		if (pathsOverlap(targetBoundary, candidateBoundary)) {
			throw new Error(`wasm-clojurescript runtime target and ${label} must not overlap`);
		}
		if (pathsOverlap(versionBoundary, candidateBoundary)) {
			throw new Error(`wasm-clojurescript version module and ${label} must not overlap`);
		}
	}

	const compilerInputName = installedSource ? STORAGE_ASSET : LOGICAL_ASSET;
	const compilerPath = path.join(sourceDir, compilerInputName);
	const metadataPath = path.join(sourceDir, BUILD_METADATA_FILE);
	const licensePath = path.join(sourceDir, LICENSE_FILE);
	for (const [filePath, label] of [
		[compilerPath, compilerInputName],
		[metadataPath, BUILD_METADATA_FILE],
		[licensePath, LICENSE_FILE]
	]) {
		if (!(await isRegularFile(filePath))) {
			throw new Error(
				`wasm-clojurescript source ${label} must be a regular file: ${filePath}`
			);
		}
	}
	const [compilerInput, metadataBytes, licenseBytes, workerBytes] = await Promise.all([
		readFile(compilerPath),
		readFile(metadataPath),
		readFile(licensePath),
		readFile(workerSourcePath)
	]);
	const compilerReceipt = lock.receipts.get(LOGICAL_ASSET);
	let compilerBytes = compilerInput;
	if (installedSource) {
		try {
			compilerBytes = gunzipSync(compilerInput, { maxOutputLength: compilerReceipt.bytes });
		} catch {
			throw new Error(`wasm-clojurescript source ${STORAGE_ASSET} is not valid bounded gzip`);
		}
	}
	let compilerSource;
	try {
		compilerSource = new TextDecoder('utf-8', { fatal: true }).decode(compilerBytes);
	} catch {
		throw new Error('wasm-clojurescript compiler.js is not valid UTF-8 JavaScript');
	}
	if (!compilerSource.includes('wasm_idle.runner.execute')) {
		throw new Error('wasm-clojurescript compiler.js does not export wasm_idle.runner.execute');
	}
	if (compilerSource.includes('clojure.browser.repl')) {
		throw new Error('wasm-clojurescript compiler.js contains the browser REPL preload');
	}
	if (
		compilerBytes.byteLength !== compilerReceipt.bytes ||
		sha256(compilerBytes) !== compilerReceipt.sha256
	) {
		throw new Error(`wasm-clojurescript source ${LOGICAL_ASSET} does not match the input lock`);
	}
	const metadataReceipt = lock.receipts.get(BUILD_METADATA_FILE);
	if (
		metadataBytes.byteLength !== metadataReceipt.bytes ||
		sha256(metadataBytes) !== metadataReceipt.sha256
	) {
		throw new Error(
			`wasm-clojurescript source ${BUILD_METADATA_FILE} does not match the input lock`
		);
	}
	if (
		licenseBytes.byteLength !== lock.license.bytes ||
		sha256(licenseBytes) !== lock.license.sha256
	) {
		throw new Error('wasm-clojurescript source license does not match the input lock');
	}
	validateBuildMetadata(metadataBytes, lock.build, compilerReceipt);

	const compressedCompilerBytes = gzipSync(compilerBytes, { level: 9 });
	/** @type {LogicalAsset[]} */
	const assets = [
		{
			path: LOGICAL_ASSET,
			mediaType: 'text/javascript',
			size: compilerBytes.byteLength,
			sha256: sha256(compilerBytes)
		}
	];
	/** @type {StorageAsset[]} */
	const storage = [
		{
			path: STORAGE_ASSET,
			logicalPath: LOGICAL_ASSET,
			encoding: 'gzip',
			size: compressedCompilerBytes.byteLength,
			sha256: sha256(compressedCompilerBytes)
		}
	];
	const license = {
		path: lock.license.path,
		spdx: lock.license.spdx,
		size: licenseBytes.byteLength,
		sha256: sha256(licenseBytes)
	};
	const metadata = {
		path: BUILD_METADATA_FILE,
		mediaType: 'application/json',
		size: metadataBytes.byteLength,
		sha256: sha256(metadataBytes)
	};
	const fingerprint = computeClojureScriptRuntimeFingerprint({
		profileId: lock.profileId,
		source: lock.source,
		build: lock.build,
		license,
		metadata,
		assets,
		storage
	});
	const workerReceipt = Object.freeze({
		bytes: workerBytes.byteLength,
		sha256: sha256(workerBytes)
	});
	const manifest = {
		format: CLOJURESCRIPT_MANIFEST_FORMAT,
		runtime: 'cljs.js',
		profileId: lock.profileId,
		fingerprint,
		source: lock.source,
		build: lock.build,
		license,
		metadata,
		assets,
		storage
	};
	const legacyManifest = {
		format: 'wasm-clojurescript-runtime-manifest-v1',
		runtime: 'cljs.js',
		clojureScriptVersion: lock.build.clojureScriptVersion,
		compilerSha256: assets[0].sha256,
		fingerprint: fingerprint.slice(0, 16),
		files: [LICENSE_FILE, LEGACY_STORAGE_ASSET, 'runner-worker.js', BUILD_METADATA_FILE]
	};
	const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`;
	const manifestReceipt = Object.freeze({
		bytes: Buffer.byteLength(manifestSource),
		sha256: sha256(Buffer.from(manifestSource))
	});
	const versionModuleSource = `export const WASM_CLOJURESCRIPT_RUNTIME_PROFILE = {\n\tprofileId: '${lock.profileId}',\n\tsourceRevision: '${lock.source.revision}',\n\tintegrationRevision: '${lock.source.integrationRevision}',\n\tmanifestFingerprint: '${fingerprint}',\n\tmanifestReceipt: {\n\t\tbytes: ${manifestReceipt.bytes},\n\t\tsha256: '${manifestReceipt.sha256}'\n\t},\n\tcompilerReceipt: {\n\t\tbytes: ${storage[0].size},\n\t\tsha256: '${storage[0].sha256}',\n\t\tuncompressedBytes: ${assets[0].size},\n\t\tuncompressedSha256: '${assets[0].sha256}'\n\t}\n} as const;\nexport const WASM_CLOJURESCRIPT_ASSET_VERSION =\n\tWASM_CLOJURESCRIPT_RUNTIME_PROFILE.manifestFingerprint;\nexport const WASM_CLOJURESCRIPT_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;

	await mkdir(path.dirname(targetDir), { recursive: true });
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const publicationId = randomUUID();
	const temporaryTarget = path.join(
		path.dirname(targetDir),
		`.${path.basename(targetDir)}.staging-${publicationId}`
	);
	const previousTarget = path.join(
		path.dirname(targetDir),
		`.${path.basename(targetDir)}.previous-${publicationId}`
	);
	const temporaryVersion = path.join(
		path.dirname(versionModulePath),
		`.${path.basename(versionModulePath)}.staging-${publicationId}`
	);
	const previousVersion = path.join(
		path.dirname(versionModulePath),
		`.${path.basename(versionModulePath)}.previous-${publicationId}`
	);
	await rm(temporaryTarget, { recursive: true, force: true });
	await mkdir(temporaryTarget, { recursive: true });
	try {
		await Promise.all([
			writeFile(path.join(temporaryTarget, LEGACY_STORAGE_ASSET), compressedCompilerBytes),
			writeFile(path.join(temporaryTarget, STORAGE_ASSET), compressedCompilerBytes),
			writeFile(path.join(temporaryTarget, LICENSE_FILE), licenseBytes),
			writeFile(path.join(temporaryTarget, BUILD_METADATA_FILE), metadataBytes),
			writeFile(path.join(temporaryTarget, 'runner-worker.js'), workerBytes),
			writeFile(
				path.join(temporaryTarget, LEGACY_MANIFEST_FILE),
				`${JSON.stringify(legacyManifest, null, 2)}\n`,
				'utf8'
			),
			writeFile(path.join(temporaryTarget, MANIFEST_FILE), manifestSource, 'utf8'),
			writeFile(temporaryVersion, versionModuleSource, 'utf8')
		]);
		await assertExactPublishedFiles(temporaryTarget);
		const [
			installedLegacyGzip,
			installedGzip,
			installedLicense,
			installedMetadata,
			installedWorker,
			installedManifest
		] = await Promise.all([
			readFile(path.join(temporaryTarget, LEGACY_STORAGE_ASSET)),
			readFile(path.join(temporaryTarget, STORAGE_ASSET)),
			readFile(path.join(temporaryTarget, LICENSE_FILE)),
			readFile(path.join(temporaryTarget, BUILD_METADATA_FILE)),
			readFile(path.join(temporaryTarget, 'runner-worker.js')),
			readFile(path.join(temporaryTarget, MANIFEST_FILE), 'utf8')
		]);
		if (
			!installedLegacyGzip.equals(installedGzip) ||
			sha256(installedGzip) !== storage[0].sha256 ||
			sha256(gunzipSync(installedGzip)) !== assets[0].sha256 ||
			sha256(installedLicense) !== license.sha256 ||
			sha256(installedMetadata) !== metadata.sha256 ||
			sha256(installedWorker) !== workerReceipt.sha256 ||
			JSON.stringify(JSON.parse(installedManifest)) !== JSON.stringify(manifest)
		) {
			throw new Error(
				'wasm-clojurescript temporary installation failed receipt verification'
			);
		}

		const hadTarget = !!(await lstat(targetDir).catch(() => null));
		const hadVersion = !!(await lstat(versionModulePath).catch(() => null));
		let targetPublished = false;
		let versionPublished = false;
		try {
			if (hadTarget) await renamePath(targetDir, previousTarget);
			await renamePath(temporaryTarget, targetDir);
			targetPublished = true;
			if (hadVersion) await renamePath(versionModulePath, previousVersion);
			await renamePath(temporaryVersion, versionModulePath);
			versionPublished = true;
		} catch (error) {
			const rollbackErrors = [];
			if (versionPublished) {
				try {
					await rm(versionModulePath, { force: true });
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (hadVersion && (await lstat(previousVersion).catch(() => null))) {
				try {
					await rename(previousVersion, versionModulePath);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (targetPublished) {
				try {
					await rm(targetDir, { recursive: true, force: true });
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (hadTarget && (await lstat(previousTarget).catch(() => null))) {
				try {
					await rename(previousTarget, targetDir);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (rollbackErrors.length) {
				throw new AggregateError(
					[error, ...rollbackErrors],
					'wasm-clojurescript publication failed and rollback was incomplete'
				);
			}
			throw error;
		}
		if (hadTarget) await rm(previousTarget, { recursive: true, force: true });
		if (hadVersion) await rm(previousVersion, { force: true });
	} finally {
		await rm(temporaryTarget, { recursive: true, force: true });
		await rm(temporaryVersion, { force: true });
	}

	return {
		sourceDir,
		targetDir,
		fingerprint,
		versionModulePath,
		manifestReceipt,
		workerReceipt
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmClojureScriptAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-clojurescript from ${result.sourceDir} to ${result.targetDir}`);
}
