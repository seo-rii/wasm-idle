import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const require = createRequire(import.meta.url);
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-forth');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-forth-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmForthVersion.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-forth-assets.lock.json');
const MANIFEST_FILE = 'runtime-manifest.v2.json';
const RUNTIME_FILES = /** @type {const} */ (['runner-worker.js', MANIFEST_FILE, 'waforth.js']);
export const FORTH_MANIFEST_FORMAT = 'wasm-forth-runtime-manifest-v2';
const FINGERPRINT_DOMAIN = 'wasm-idle:forth-runtime-manifest:v2';

/** @typedef {{ bytes: number; sha256: string }} ForthAssetReceipt */
/** @typedef {{ path: string; size: number; sha256: string }} ForthManifestReceipt */
/** @typedef {{ schemaVersion: 1; profileId: string; upstream: { packageName: 'waforth'; packageVersion: string; assetPath: 'dist/index.js'; bytes: number; sha256: string } }} ForthInputLock */

/**
 * @typedef {object} SyncWasmForthOptions
 * @property {string} [sourceFile]
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
async function pathExists(filePath) {
	return !!(await lstat(filePath).catch(() => null));
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

/** @param {string} filePath @param {string} label */
async function readJson(filePath, label) {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`${label} is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
}

/** @param {unknown} value @param {string} label */
function validateReceipt(value, label) {
	if (
		!isObject(value) ||
		typeof value.bytes !== 'number' ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new Error(`${label} has invalid size or SHA-256 metadata`);
	}
	return Object.freeze({ bytes: value.bytes, sha256: value.sha256 });
}

/** @param {string} lockFilePath */
async function readInputLock(lockFilePath) {
	if (!(await isRegularFile(lockFilePath))) {
		throw new Error(`wasm-forth input lock must be a regular file: ${lockFilePath}`);
	}
	const value = await readJson(lockFilePath, 'wasm-forth input lock');
	if (
		!isObject(value) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!/^waforth-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		!isObject(value.upstream) ||
		value.upstream.packageName !== 'waforth' ||
		typeof value.upstream.packageVersion !== 'string' ||
		!/^[A-Za-z0-9._-]+$/u.test(value.upstream.packageVersion) ||
		value.upstream.assetPath !== 'dist/index.js'
	) {
		throw new Error('wasm-forth input lock has invalid upstream metadata');
	}
	if (value.profileId !== `waforth-${value.upstream.packageVersion}`) {
		throw new Error('wasm-forth input lock profile does not match the package version');
	}
	const receipt = validateReceipt(value.upstream, 'wasm-forth upstream asset');
	return Object.freeze({
		schemaVersion: /** @type {const} */ (1),
		profileId: value.profileId,
		upstream: Object.freeze({
			packageName: /** @type {const} */ ('waforth'),
			packageVersion: value.upstream.packageVersion,
			assetPath: /** @type {const} */ ('dist/index.js'),
			...receipt
		})
	});
}

function resolveDefaultSourceFile() {
	const packageJsonPath = require.resolve('waforth/package.json');
	return path.join(path.dirname(packageJsonPath), 'dist', 'index.js');
}

/** @param {string} source */
function wrapWaforthBundle(source) {
	const normalized = source.replace(/[ \t]+$/gmu, '').replace(/\n+$/u, '\n');
	return [
		'var module = { exports: {} };',
		'var exports = module.exports;',
		normalized,
		'self.WAForthPackage = module.exports;',
		''
	].join('\n');
}

/** @param {ForthInputLock} lock @param {readonly ForthManifestReceipt[]} assets */
function computeFingerprint(lock, assets) {
	const hash = createHash('sha256');
	hash.update(`${FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${FORTH_MANIFEST_FORMAT}\n`);
	hash.update(`profileId\0${lock.profileId}\n`);
	hash.update(`waforthVersion\0${lock.upstream.packageVersion}\n`);
	for (const receipt of assets) {
		hash.update(receipt.path);
		hash.update('\0');
		hash.update(String(receipt.size));
		hash.update('\0');
		hash.update(receipt.sha256);
		hash.update('\n');
	}
	return hash.digest('hex');
}

/** @param {ForthInputLock} lock @param {readonly ForthManifestReceipt[]} assets */
function renderManifest(lock, assets) {
	return `${JSON.stringify(
		{
			format: FORTH_MANIFEST_FORMAT,
			runtime: 'waforth',
			profileId: lock.profileId,
			waforthVersion: lock.upstream.packageVersion,
			fingerprint: computeFingerprint(lock, assets),
			assets
		},
		null,
		'\t'
	)}\n`;
}

/** @param {string} fingerprint @param {Readonly<ForthAssetReceipt>} workerReceipt */
function renderVersionModule(fingerprint, workerReceipt) {
	return `export const WASM_FORTH_ASSET_VERSION =\n\t'${fingerprint}';\nexport const WASM_FORTH_RUNNER_RECEIPT = {\n\tbytes: ${workerReceipt.bytes},\n\tsha256: '${workerReceipt.sha256}'\n} as const;\n`;
}

/** @param {Uint8Array} bytes @param {Readonly<ForthAssetReceipt>} receipt @param {string} label */
function verifyBytes(bytes, receipt, label) {
	if (bytes.byteLength !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
		throw new Error(`${label} does not match its pinned receipt`);
	}
}

/**
 * @param {string} targetDir
 * @param {string} manifestSource
 * @param {Readonly<ForthAssetReceipt>} waforthReceipt
 * @param {Readonly<ForthAssetReceipt>} workerReceipt
 */
async function validateInstalledSnapshot(targetDir, manifestSource, waforthReceipt, workerReceipt) {
	const entries = (await readdir(targetDir)).sort();
	const expected = [...RUNTIME_FILES].sort();
	if (
		entries.length !== expected.length ||
		entries.some((entry, index) => entry !== expected[index])
	) {
		throw new Error('wasm-forth installed runtime has an unexpected asset set');
	}
	verifyBytes(
		await readFile(path.join(targetDir, 'waforth.js')),
		waforthReceipt,
		'installed waforth.js'
	);
	verifyBytes(
		await readFile(path.join(targetDir, 'runner-worker.js')),
		workerReceipt,
		'installed runner-worker.js'
	);
	if ((await readFile(path.join(targetDir, MANIFEST_FILE), 'utf8')) !== manifestSource) {
		throw new Error('wasm-forth installed runtime manifest drifted');
	}
}

/**
 * @param {readonly { current: string; next: string; previous: string }[]} swaps
 * @param {(sourcePath: string, targetPath: string) => Promise<void>} renamePath
 */
async function publishSwaps(swaps, renamePath) {
	/** @type {{ current: string; previous: string; hadCurrent: boolean }[]} */
	const published = [];
	try {
		for (const swap of swaps) {
			const hadCurrent = await pathExists(swap.current);
			if (hadCurrent) await renamePath(swap.current, swap.previous);
			try {
				await renamePath(swap.next, swap.current);
			} catch (error) {
				if (hadCurrent) {
					try {
						await renamePath(swap.previous, swap.current);
					} catch (restoreError) {
						throw new AggregateError(
							[error, restoreError],
							'wasm-forth failed to publish and restore an output'
						);
					}
				}
				throw error;
			}
			published.push({ current: swap.current, previous: swap.previous, hadCurrent });
		}
	} catch (error) {
		const rollbackErrors = [];
		for (const swap of published.reverse()) {
			try {
				await rm(swap.current, { recursive: true, force: true });
				if (swap.hadCurrent) await renamePath(swap.previous, swap.current);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (rollbackErrors.length > 0) {
			throw new AggregateError(
				[error, ...rollbackErrors],
				'wasm-forth publication failed and rollback was incomplete'
			);
		}
		throw error;
	}
	for (const swap of published) {
		if (swap.hadCurrent) await rm(swap.previous, { recursive: true, force: true });
	}
}

/** @param {SyncWasmForthOptions} [options] */
export async function syncWasmForthAssets(options = {}) {
	const sourceFile = path.resolve(options.sourceFile || resolveDefaultSourceFile());
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const workerSourcePath = path.resolve(options.workerSourcePath || DEFAULT_WORKER_SOURCE_PATH);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === path.resolve(DEFAULT_TARGET_DIR)
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const renamePath = options.renamePath || rename;

	if (!(await isRegularFile(sourceFile))) {
		throw new Error(`waforth bundle must be a regular file: ${sourceFile}`);
	}
	if (!(await isRegularFile(workerSourcePath))) {
		throw new Error(`wasm-forth worker source must be a regular file: ${workerSourcePath}`);
	}
	const [targetStats, versionStats] = await Promise.all([
		lstat(targetDir).catch(() => null),
		lstat(versionModulePath).catch(() => null)
	]);
	if (targetStats && !targetStats.isDirectory()) {
		throw new Error(`wasm-forth runtime target must be a directory: ${targetDir}`);
	}
	if (versionStats && !versionStats.isFile()) {
		throw new Error(`wasm-forth version module must be a regular file: ${versionModulePath}`);
	}

	const [sourceBoundary, workerBoundary, targetBoundary, versionBoundary, lockBoundary] =
		await Promise.all(
			[sourceFile, workerSourcePath, targetDir, versionModulePath, lockFilePath].map(
				resolveBoundaryPath
			)
		);
	for (const [left, right, message] of [
		[sourceBoundary, workerBoundary, 'source bundle and worker source must not overlap'],
		[sourceBoundary, targetBoundary, 'source bundle and runtime target must not overlap'],
		[sourceBoundary, versionBoundary, 'source bundle and version module must not overlap'],
		[workerBoundary, targetBoundary, 'worker source and runtime target must not overlap'],
		[workerBoundary, versionBoundary, 'worker source and version module must not overlap'],
		[targetBoundary, versionBoundary, 'version module must be outside the runtime target'],
		[targetBoundary, lockBoundary, 'input lock must be outside the runtime target'],
		[versionBoundary, lockBoundary, 'input lock and version module must not overlap']
	]) {
		if (pathsOverlap(left, right)) throw new Error(`wasm-forth ${message}`);
	}

	const lock = await readInputLock(lockFilePath);
	const sourceBytes = await readFile(sourceFile);
	verifyBytes(sourceBytes, lock.upstream, 'waforth source bundle');
	let bundleSource;
	try {
		bundleSource = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
	} catch {
		throw new Error('waforth source bundle is not valid UTF-8');
	}
	if (
		!bundleSource.includes('module.exports') ||
		!bundleSource.includes('WebAssembly.instantiate')
	) {
		throw new Error('waforth bundle does not look like the expected WebAssembly runtime');
	}
	const workerBytes = await readFile(workerSourcePath);
	let workerSource;
	try {
		workerSource = new TextDecoder('utf-8', { fatal: true }).decode(workerBytes);
		new Function(workerSource);
	} catch {
		throw new Error('wasm-forth worker source is not valid JavaScript');
	}
	if (!workerSource.includes('self.onmessage') || !workerSource.includes(FORTH_MANIFEST_FORMAT)) {
		throw new Error('wasm-forth worker source does not implement the pinned runtime protocol');
	}

	const waforthBytes = Buffer.from(wrapWaforthBundle(bundleSource), 'utf8');
	const waforthReceipt = Object.freeze({
		bytes: waforthBytes.byteLength,
		sha256: sha256(waforthBytes)
	});
	const workerReceipt = Object.freeze({
		bytes: workerBytes.byteLength,
		sha256: sha256(workerBytes)
	});
	const assets = Object.freeze([
		Object.freeze({
			path: 'waforth.js',
			size: waforthReceipt.bytes,
			sha256: waforthReceipt.sha256
		})
	]);
	const fingerprint = computeFingerprint(lock, assets);
	const manifestSource = renderManifest(lock, assets);
	const versionSource = renderVersionModule(fingerprint, workerReceipt);

	const suffix = `${process.pid}-${randomUUID()}`;
	const nextTargetDir = `${targetDir}.next-${suffix}`;
	const previousTargetDir = `${targetDir}.previous-${suffix}`;
	const nextVersionModulePath = `${versionModulePath}.next-${suffix}`;
	const previousVersionModulePath = `${versionModulePath}.previous-${suffix}`;
	await mkdir(path.dirname(targetDir), { recursive: true });
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	await rm(nextTargetDir, { recursive: true, force: true });
	await rm(nextVersionModulePath, { force: true });

	try {
		await mkdir(nextTargetDir, { recursive: true });
		await writeFile(path.join(nextTargetDir, 'waforth.js'), waforthBytes);
		await writeFile(path.join(nextTargetDir, 'runner-worker.js'), workerBytes);
		await writeFile(path.join(nextTargetDir, MANIFEST_FILE), manifestSource, 'utf8');
		await validateInstalledSnapshot(
			nextTargetDir,
			manifestSource,
			waforthReceipt,
			workerReceipt
		);
		await writeFile(nextVersionModulePath, versionSource, 'utf8');
		await publishSwaps(
			[
				{ current: targetDir, next: nextTargetDir, previous: previousTargetDir },
				{
					current: versionModulePath,
					next: nextVersionModulePath,
					previous: previousVersionModulePath
				}
			],
			renamePath
		);
	} finally {
		await rm(nextTargetDir, { recursive: true, force: true });
		await rm(nextVersionModulePath, { force: true });
	}

	return {
		sourceFile,
		targetDir,
		fingerprint,
		profileId: lock.profileId,
		assets,
		workerReceipt,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceFileArg, targetDirArg] = process.argv;
	const { sourceFile, targetDir } = await syncWasmForthAssets({
		...(sourceFileArg ? { sourceFile: sourceFileArg } : {}),
		...(targetDirArg ? { targetDir: targetDirArg } : {})
	});
	console.log(`Synced wasm-forth from ${sourceFile} to ${targetDir}`);
}
