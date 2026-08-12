import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'node_modules', 'swipl-wasm', 'dist', 'swipl');
const DEFAULT_PACKAGE_ROOT = path.resolve(REPO_ROOT, 'node_modules', 'swipl-wasm');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-prolog');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-prolog-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmPrologVersion.ts'
);
const DEFAULT_LSP_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'lsp',
	'src',
	'bundledPrologRuntime.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-prolog-assets.lock.json');

const LICENSE_FILE = 'LICENSE.txt';
const BUILD_METADATA_FILE = 'runtime-build.json';
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const RUNNER_FILE = 'runner-worker.js';
const LOGICAL_ASSETS = ['swipl-web.js', 'swipl-web.wasm', 'swipl-web.data'];
/** @type {Readonly<Record<string, Readonly<{ path: string; encoding: 'identity' | 'gzip' }>>>} */
const STORAGE_BY_LOGICAL = Object.freeze({
	'swipl-web.js': Object.freeze({ path: 'swipl-web.js', encoding: 'identity' }),
	'swipl-web.wasm': Object.freeze({ path: 'swipl-web.wasm.gz', encoding: 'gzip' }),
	'swipl-web.data': Object.freeze({ path: 'swipl-web.data.gz', encoding: 'gzip' })
});
/** @type {Readonly<Record<string, string>>} */
const MEDIA_TYPE_BY_LOGICAL = Object.freeze({
	'swipl-web.js': 'text/javascript',
	'swipl-web.wasm': 'application/wasm',
	'swipl-web.data': 'application/octet-stream'
});
const PUBLISHED_FILES = [
	LICENSE_FILE,
	BUILD_METADATA_FILE,
	MANIFEST_FILE,
	RUNNER_FILE,
	...Object.values(STORAGE_BY_LOGICAL).map((entry) => entry.path)
].sort();

export const PROLOG_MANIFEST_FORMAT = 'wasm-prolog-runtime-manifest-v2';
export const PROLOG_FINGERPRINT_DOMAIN = 'wasm-idle:prolog-runtime-manifest:v2';

/** @typedef {{ bytes: number; sha256: string }} InputReceipt */
/** @typedef {{ path: string; mediaType: string; size: number; sha256: string }} LogicalAsset */
/** @typedef {{ path: string; logicalPath: string; encoding: 'identity' | 'gzip'; size: number; sha256: string }} StorageAsset */
/** @typedef {{ name: string; version: string; repository: string; revision: string; tarball: string; integrity: string }} PrologPackage */
/** @typedef {{ swiplVersion: string; swiplRevision: string; emsdkVersion: string; emsdkRevision: string; zlibVersion: string; pcre2Version: string; pcre2Revision: string }} PrologToolchain */
/** @typedef {{ target: string; temporary: string; previous: string; kind: 'file' | 'directory'; hadTarget: boolean; backedUp: boolean; published: boolean }} Publication */

/**
 * @typedef {object} SyncWasmPrologOptions
 * @property {string} [sourceDir]
 * @property {string} [packageRoot]
 * @property {string} [targetDir]
 * @property {string} [workerSourcePath]
 * @property {string} [versionModulePath]
 * @property {string} [lspVersionModulePath]
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
		throw new Error(`wasm-prolog input lock must be a regular file: ${lockFilePath}`);
	}
	let value;
	try {
		value = JSON.parse(await readFile(lockFilePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-prolog input lock is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
	if (
		!isObject(value) ||
		value.schemaVersion !== 1 ||
		value.profileId !== 'swipl-wasm-8.0.1-swipl-10.1.9' ||
		!isObject(value.package) ||
		value.package.name !== 'swipl-wasm' ||
		value.package.version !== '8.0.1' ||
		value.package.repository !== 'https://github.com/SWI-Prolog/npm-swipl-wasm.git' ||
		value.package.revision !== '18fa003833dd4fb2531195063291687255038372' ||
		value.package.tarball !== 'https://registry.npmjs.org/swipl-wasm/-/swipl-wasm-8.0.1.tgz' ||
		value.package.integrity !==
			'sha512-tP3bSRaMboFRWGD5cfBAGIzu2HH80yqRG+i/YL8BEgQ7xasvJAycwgx0DW16vqqRhUHyFOOPbzX4aXuy9s+b1g==' ||
		!isObject(value.toolchain) ||
		value.toolchain.swiplVersion !== '10.1.9' ||
		value.toolchain.swiplRevision !== '6be143dbd030cc9ea621cde719a37f8385575453' ||
		value.toolchain.emsdkVersion !== '6.0.0' ||
		value.toolchain.emsdkRevision !== 'd223ae73c6998296e3ab27cf81dc2c2c9fd383de' ||
		value.toolchain.zlibVersion !== '1.3.2' ||
		value.toolchain.pcre2Version !== '10.47' ||
		value.toolchain.pcre2Revision !== 'f454e231fe5006dd7ff8f4693fd2b8eb94333429' ||
		!isObject(value.license) ||
		value.license.path !== LICENSE_FILE ||
		value.license.spdx !== 'BSD-2-Clause' ||
		!Array.isArray(value.assets) ||
		value.assets.length !== LOGICAL_ASSETS.length
	) {
		throw new Error(
			'wasm-prolog input lock has invalid package, toolchain, or license metadata'
		);
	}
	const licenseReceipt = validateInputReceipt(value.license, 'wasm-prolog input license');
	const receipts = new Map();
	for (const candidate of value.assets) {
		if (
			!isObject(candidate) ||
			typeof candidate.path !== 'string' ||
			!LOGICAL_ASSETS.includes(candidate.path) ||
			receipts.has(candidate.path)
		) {
			throw new Error('wasm-prolog input lock has an invalid or duplicate asset path');
		}
		receipts.set(
			candidate.path,
			validateInputReceipt(candidate, `wasm-prolog input ${candidate.path}`)
		);
	}
	if (LOGICAL_ASSETS.some((assetPath) => !receipts.has(assetPath))) {
		throw new Error('wasm-prolog input lock is missing a required asset');
	}
	return Object.freeze({
		profileId: value.profileId,
		package: Object.freeze(/** @type {PrologPackage} */ ({ ...value.package })),
		toolchain: Object.freeze(/** @type {PrologToolchain} */ ({ ...value.toolchain })),
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
 *   package: PrologPackage;
 *   toolchain: PrologToolchain;
 *   license: { path: string; spdx: string; size: number; sha256: string };
 *   metadata: { path: string; mediaType: string; size: number; sha256: string };
 *   assets: LogicalAsset[];
 *   storage: StorageAsset[];
 * }} manifest
 */
export function computePrologRuntimeFingerprint(manifest) {
	const hash = createHash('sha256');
	hash.update(`${PROLOG_FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${PROLOG_MANIFEST_FORMAT}\n`);
	hash.update('runtime\0swipl-wasm\n');
	hash.update(`profileId\0${manifest.profileId}\n`);
	for (const [name, value] of Object.entries(manifest.package).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	)) {
		hash.update(`package\0${name}\0${value}\n`);
	}
	for (const [name, value] of Object.entries(manifest.toolchain).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	)) {
		hash.update(`toolchain\0${name}\0${value}\n`);
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

/** @param {string} directory */
async function assertExactPublishedFiles(directory) {
	const entries = (await readdir(directory)).sort();
	if (JSON.stringify(entries) !== JSON.stringify(PUBLISHED_FILES)) {
		throw new Error('wasm-prolog temporary installation has unexpected files');
	}
	for (const entry of entries) {
		if (!(await isRegularFile(path.join(directory, entry)))) {
			throw new Error(`wasm-prolog published asset must be a regular file: ${entry}`);
		}
	}
}

/** @param {unknown} value @param {Readonly<PrologPackage>} expected */
function validatePackageMetadata(value, expected) {
	if (
		!isObject(value) ||
		value.name !== expected.name ||
		value.version !== expected.version ||
		value.license !== 'BSD-2-Clause' ||
		!isObject(value.repository) ||
		value.repository.type !== 'git' ||
		value.repository.url !== expected.repository
	) {
		throw new Error('swipl-wasm package metadata does not match the input lock');
	}
}

/** @param {string} targetPath @param {'file' | 'directory'} kind */
async function removePublishedPath(targetPath, kind) {
	await rm(targetPath, { recursive: kind === 'directory', force: true });
}

/** @param {SyncWasmPrologOptions} [options] */
export async function syncWasmPrologAssets(options = {}) {
	const sourceDir = path.resolve(options.sourceDir || DEFAULT_SOURCE_DIR);
	const packageRoot = path.resolve(
		options.packageRoot ||
			(options.sourceDir ? path.join(sourceDir, '..', '..') : DEFAULT_PACKAGE_ROOT)
	);
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
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const renamePath = options.renamePath || rename;

	for (const [targetPath, kind, label] of [
		[targetDir, 'directory', 'runtime target'],
		[versionModulePath, 'file', 'application version module'],
		[lspVersionModulePath, 'file', 'LSP version module']
	]) {
		const stats = await lstat(targetPath).catch(() => null);
		if (stats && !(kind === 'directory' ? stats.isDirectory() : stats.isFile())) {
			throw new Error(`wasm-prolog ${label} has the wrong file type: ${targetPath}`);
		}
	}
	for (const [filePath, label] of [
		[workerSourcePath, 'worker source'],
		[lockFilePath, 'input lock'],
		[path.join(packageRoot, 'package.json'), 'package metadata'],
		[path.join(packageRoot, LICENSE_FILE), 'package license']
	]) {
		if (!(await isRegularFile(filePath))) {
			throw new Error(`wasm-prolog ${label} must be a regular file: ${filePath}`);
		}
	}

	const lock = await readInputLock(lockFilePath);
	const outputPaths = [targetDir, versionModulePath, lspVersionModulePath];
	const inputPaths = [sourceDir, packageRoot, workerSourcePath, lockFilePath];
	const outputBoundaries = await Promise.all(outputPaths.map(resolveBoundaryPath));
	const inputBoundaries = await Promise.all(inputPaths.map(resolveBoundaryPath));
	for (let left = 0; left < outputBoundaries.length; left += 1) {
		for (let right = left + 1; right < outputBoundaries.length; right += 1) {
			if (pathsOverlap(outputBoundaries[left], outputBoundaries[right])) {
				throw new Error('wasm-prolog publication targets must not overlap');
			}
		}
		for (const inputBoundary of inputBoundaries) {
			if (pathsOverlap(outputBoundaries[left], inputBoundary)) {
				throw new Error('wasm-prolog publication targets must not overlap their inputs');
			}
		}
	}

	for (const assetPath of LOGICAL_ASSETS) {
		if (!(await isRegularFile(path.join(sourceDir, assetPath)))) {
			throw new Error(
				`SWI-Prolog wasm asset ${assetPath} must be a regular file in ${sourceDir}`
			);
		}
	}
	let packageMetadata;
	try {
		packageMetadata = JSON.parse(
			await readFile(path.join(packageRoot, 'package.json'), 'utf8')
		);
	} catch {
		throw new Error('swipl-wasm package.json is not valid JSON');
	}
	validatePackageMetadata(packageMetadata, lock.package);

	const logicalBytes = new Map();
	for (const assetPath of LOGICAL_ASSETS) {
		const bytes = await readFile(path.join(sourceDir, assetPath));
		const receipt = lock.receipts.get(assetPath);
		if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
			throw new Error(`SWI-Prolog source ${assetPath} does not match the input lock`);
		}
		logicalBytes.set(assetPath, bytes);
	}
	const javascriptSource = new TextDecoder('utf-8', { fatal: true }).decode(
		logicalBytes.get('swipl-web.js')
	);
	if (
		!javascriptSource.includes('var SWIPL=') ||
		!javascriptSource.includes('getPreloadedPackage') ||
		!javascriptSource.includes('wasmBinary')
	) {
		throw new Error('swipl-web.js is missing the verified asset injection contract');
	}
	const sourceLicenseBytes = await readFile(path.join(packageRoot, LICENSE_FILE));
	if (
		sourceLicenseBytes.byteLength !== lock.license.bytes ||
		sha256(sourceLicenseBytes) !== lock.license.sha256
	) {
		throw new Error('swipl-wasm license does not match the input lock');
	}
	const licenseBytes = Buffer.from(
		`${new TextDecoder('utf-8', { fatal: true })
			.decode(sourceLicenseBytes)
			.replace(/(?:\r?\n)+$/u, '')}\n`,
		'utf8'
	);
	const workerBytes = await readFile(workerSourcePath);
	const workerReceipt = Object.freeze({
		bytes: workerBytes.byteLength,
		sha256: sha256(workerBytes)
	});
	const runtimeBuild = Object.freeze({
		format: 'wasm-prolog-runtime-build-v1',
		runtime: 'swipl-wasm',
		profileId: lock.profileId,
		package: lock.package,
		toolchain: lock.toolchain
	});
	const metadataBytes = Buffer.from(`${JSON.stringify(runtimeBuild, null, 2)}\n`, 'utf8');
	const metadata = {
		path: BUILD_METADATA_FILE,
		mediaType: 'application/json',
		size: metadataBytes.byteLength,
		sha256: sha256(metadataBytes)
	};
	/** @type {LogicalAsset[]} */
	const assets = LOGICAL_ASSETS.map((assetPath) => {
		const bytes = logicalBytes.get(assetPath);
		return {
			path: assetPath,
			mediaType: MEDIA_TYPE_BY_LOGICAL[assetPath],
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
	const license = {
		path: LICENSE_FILE,
		spdx: lock.license.spdx,
		size: licenseBytes.byteLength,
		sha256: sha256(licenseBytes)
	};
	const fingerprint = computePrologRuntimeFingerprint({
		profileId: lock.profileId,
		package: lock.package,
		toolchain: lock.toolchain,
		license,
		metadata,
		assets,
		storage
	});
	const manifest = {
		format: PROLOG_MANIFEST_FORMAT,
		runtime: 'swipl-wasm',
		profileId: lock.profileId,
		fingerprint,
		package: lock.package,
		toolchain: lock.toolchain,
		license,
		metadata,
		assets,
		storage
	};
	const versionModuleSource = `export const WASM_PROLOG_ASSET_VERSION =\n\t'${fingerprint}';\nexport const WASM_PROLOG_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;
	const lspVersionModuleSource = `export const BUNDLED_PROLOG_MANIFEST_FINGERPRINT =\n\t'${fingerprint}';\nexport const BUNDLED_PROLOG_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;

	await Promise.all([
		mkdir(path.dirname(targetDir), { recursive: true }),
		mkdir(path.dirname(versionModulePath), { recursive: true }),
		mkdir(path.dirname(lspVersionModulePath), { recursive: true })
	]);
	const publicationId = randomUUID();
	/** @type {Publication[]} */
	const publications = [
		{
			target: targetDir,
			temporary: path.join(
				path.dirname(targetDir),
				`.${path.basename(targetDir)}.staging-${publicationId}`
			),
			previous: path.join(
				path.dirname(targetDir),
				`.${path.basename(targetDir)}.previous-${publicationId}`
			),
			kind: 'directory',
			hadTarget: false,
			backedUp: false,
			published: false
		},
		{
			target: versionModulePath,
			temporary: path.join(
				path.dirname(versionModulePath),
				`.${path.basename(versionModulePath)}.staging-${publicationId}`
			),
			previous: path.join(
				path.dirname(versionModulePath),
				`.${path.basename(versionModulePath)}.previous-${publicationId}`
			),
			kind: 'file',
			hadTarget: false,
			backedUp: false,
			published: false
		},
		{
			target: lspVersionModulePath,
			temporary: path.join(
				path.dirname(lspVersionModulePath),
				`.${path.basename(lspVersionModulePath)}.staging-${publicationId}`
			),
			previous: path.join(
				path.dirname(lspVersionModulePath),
				`.${path.basename(lspVersionModulePath)}.previous-${publicationId}`
			),
			kind: 'file',
			hadTarget: false,
			backedUp: false,
			published: false
		}
	];
	for (const publication of publications) {
		await removePublishedPath(publication.temporary, publication.kind);
	}
	await mkdir(publications[0].temporary, { recursive: true });
	try {
		await Promise.all([
			...[...storedBytes].map(([fileName, bytes]) =>
				writeFile(path.join(publications[0].temporary, fileName), bytes)
			),
			writeFile(path.join(publications[0].temporary, LICENSE_FILE), licenseBytes),
			writeFile(path.join(publications[0].temporary, BUILD_METADATA_FILE), metadataBytes),
			writeFile(path.join(publications[0].temporary, RUNNER_FILE), workerBytes),
			writeFile(
				path.join(publications[0].temporary, MANIFEST_FILE),
				`${JSON.stringify(manifest, null, 2)}\n`,
				'utf8'
			),
			writeFile(publications[1].temporary, versionModuleSource, 'utf8'),
			writeFile(publications[2].temporary, lspVersionModuleSource, 'utf8')
		]);
		await assertExactPublishedFiles(publications[0].temporary);
		const installedManifest = JSON.parse(
			await readFile(path.join(publications[0].temporary, MANIFEST_FILE), 'utf8')
		);
		if (
			JSON.stringify(installedManifest) !== JSON.stringify(manifest) ||
			computePrologRuntimeFingerprint(installedManifest) !== fingerprint ||
			sha256(await readFile(path.join(publications[0].temporary, LICENSE_FILE))) !==
				license.sha256 ||
			sha256(await readFile(path.join(publications[0].temporary, BUILD_METADATA_FILE))) !==
				metadata.sha256 ||
			sha256(await readFile(path.join(publications[0].temporary, RUNNER_FILE))) !==
				workerReceipt.sha256
		) {
			throw new Error('wasm-prolog temporary installation failed receipt verification');
		}
		for (const logicalPath of LOGICAL_ASSETS) {
			const stored = await readFile(
				path.join(publications[0].temporary, STORAGE_BY_LOGICAL[logicalPath].path)
			);
			const logical =
				STORAGE_BY_LOGICAL[logicalPath].encoding === 'gzip' ? gunzipSync(stored) : stored;
			if (sha256(logical) !== lock.receipts.get(logicalPath).sha256) {
				throw new Error(
					'wasm-prolog temporary installation failed logical receipt verification'
				);
			}
		}

		for (const publication of publications) {
			publication.hadTarget = !!(await lstat(publication.target).catch(() => null));
			publication.backedUp = false;
			publication.published = false;
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
					'wasm-prolog publication failed and rollback was incomplete'
				);
			}
			throw error;
		}
		for (const publication of publications) {
			if (publication.hadTarget) {
				await removePublishedPath(publication.previous, publication.kind);
			}
		}
	} finally {
		for (const publication of publications) {
			await removePublishedPath(publication.temporary, publication.kind);
		}
	}

	return {
		sourceDir,
		packageRoot,
		targetDir,
		fingerprint,
		versionModulePath,
		lspVersionModulePath,
		workerReceipt
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmPrologAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-prolog from ${result.sourceDir} to ${result.targetDir}`);
}
