import { createHash, randomUUID } from 'node:crypto';
import {
	cp,
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, 'static', 'wasm-fortran');
const DEFAULT_VERSION_MODULE_PATH = path.join(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmFortranExecutionAssets.ts'
);
const SOURCE_RECEIPT_FILE = 'producer-receipt.json';
const TARGET_RECEIPT_FILE = 'runtime-build.json';

export const WASM_FORTRAN_EXECUTION_ASSET_FILES = /** @type {const} */ ([
	'f2c.wasm',
	'libf2c.a',
	'f2c.h'
]);

/** @typedef {{ bytes: number; sha256: string }} FortranAssetReceipt */
/** @typedef {{ schemaVersion: 1; profileId: string; assets: Record<string, FortranAssetReceipt> }} FortranProducerReceipt */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {string} filePath */
async function isRegularFile(filePath) {
	return !!(await lstat(filePath).catch(() => null))?.isFile();
}

/** @param {string} filePath */
async function readJson(filePath) {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-fortran ${path.basename(filePath)} is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
}

/** @param {unknown} value */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** @param {string} parent @param {string} candidate */
function containsPath(parent, candidate) {
	const relative = path.relative(parent, candidate);
	return (
		relative === '' ||
		(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
	);
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
			const errorCode =
				error && typeof error === 'object' && 'code' in error ? error.code : undefined;
			if (errorCode !== 'ENOENT') throw error;
			const parent = path.dirname(cursor);
			if (parent === cursor) return path.resolve(filePath);
			unresolved.push(path.basename(cursor));
			cursor = parent;
		}
	}
}

/** @param {string} directory @param {string} receiptFile */
async function validateAssetSet(directory, receiptFile) {
	for (const asset of WASM_FORTRAN_EXECUTION_ASSET_FILES) {
		if (!(await isRegularFile(path.join(directory, asset)))) {
			throw new Error(`wasm-fortran execution asset must be a regular file: ${asset}`);
		}
	}
	if (!(await isRegularFile(path.join(directory, receiptFile)))) {
		throw new Error(`wasm-fortran receipt must be a regular file: ${receiptFile}`);
	}
	const receipt = await readJson(path.join(directory, receiptFile));
	if (
		!isObject(receipt) ||
		receipt.schemaVersion !== 1 ||
		typeof receipt.profileId !== 'string' ||
		!receipt.profileId.trim() ||
		!isObject(receipt.assets)
	) {
		throw new Error(`wasm-fortran ${receiptFile} has invalid profile metadata`);
	}
	const receivedAssets = Object.keys(receipt.assets).sort();
	const expectedAssets = [...WASM_FORTRAN_EXECUTION_ASSET_FILES].sort();
	if (
		receivedAssets.length !== expectedAssets.length ||
		receivedAssets.some((asset, index) => asset !== expectedAssets[index])
	) {
		throw new Error(`wasm-fortran ${receiptFile} does not describe exactly three assets`);
	}

	/** @type {Record<string, Readonly<FortranAssetReceipt>>} */
	const normalizedAssets = {};
	for (const asset of WASM_FORTRAN_EXECUTION_ASSET_FILES) {
		const metadata = receipt.assets[asset];
		if (
			!isObject(metadata) ||
			!Number.isSafeInteger(metadata.bytes) ||
			metadata.bytes <= 0 ||
			typeof metadata.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(metadata.sha256)
		) {
			throw new Error(`wasm-fortran ${receiptFile} has invalid metadata for ${asset}`);
		}
		const bytes = await readFile(path.join(directory, asset));
		if (bytes.byteLength !== metadata.bytes || sha256(bytes) !== metadata.sha256) {
			throw new Error(`wasm-fortran execution asset ${asset} does not match ${receiptFile}`);
		}
		normalizedAssets[asset] = Object.freeze({
			bytes: metadata.bytes,
			sha256: metadata.sha256
		});
	}
	return Object.freeze({
		profileId: receipt.profileId.trim(),
		assets: Object.freeze(normalizedAssets)
	});
}

/** @param {string} profileId @param {Readonly<Record<string, Readonly<FortranAssetReceipt>>>} receipts */
function fingerprintReceipts(profileId, receipts) {
	const hash = createHash('sha256');
	hash.update('wasm-fortran-f2c-logical-asset-receipts-v1\0');
	hash.update(profileId);
	hash.update('\0');
	for (const asset of WASM_FORTRAN_EXECUTION_ASSET_FILES) {
		const receipt = receipts[asset];
		hash.update(asset);
		hash.update('\0');
		hash.update(String(receipt.bytes));
		hash.update('\0');
		hash.update(receipt.sha256);
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

/** @param {string} fingerprint @param {Readonly<Record<string, Readonly<FortranAssetReceipt>>>} receipts */
function renderVersionModule(fingerprint, receipts) {
	const receiptSource = WASM_FORTRAN_EXECUTION_ASSET_FILES.map(
		(asset) => `\t'${asset}': Object.freeze({
\t\tbytes: ${receipts[asset].bytes},
\t\tsha256: '${receipts[asset].sha256}'
\t})`
	).join(',\n');
	return `export const WASM_FORTRAN_EXECUTION_ASSET_VERSION = '${fingerprint}';

export const WASM_FORTRAN_EXECUTION_ASSET_RECEIPTS = Object.freeze({
${receiptSource}
});
`;
}

/**
 * @param {{ sourceDir?: string; targetDir?: string; versionModulePath?: string; copyAsset?: typeof cp; renamePath?: typeof rename }} [options]
 */
export async function syncWasmFortranAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath,
	copyAsset = cp,
	renamePath = rename
} = {}) {
	if (!sourceDir) {
		throw new Error('wasm-fortran sync requires an explicit source directory');
	}
	const resolvedSourceDir = path.resolve(sourceDir);
	const resolvedTargetDir = path.resolve(targetDir);
	if (!versionModulePath && resolvedTargetDir !== path.resolve(DEFAULT_TARGET_DIR)) {
		throw new Error('wasm-fortran custom targets require an explicit versionModulePath');
	}
	const resolvedVersionModulePath = path.resolve(
		versionModulePath || DEFAULT_VERSION_MODULE_PATH
	);
	const targetStats = await stat(resolvedTargetDir).catch(() => null);
	if (!targetStats?.isDirectory()) {
		throw new Error(
			'wasm-fortran target directory must already contain the analyzer/runtime installation'
		);
	}
	const [sourceBoundary, targetBoundary, versionBoundary] = await Promise.all([
		resolveBoundaryPath(resolvedSourceDir),
		resolveBoundaryPath(resolvedTargetDir),
		resolveBoundaryPath(resolvedVersionModulePath)
	]);
	if (
		containsPath(sourceBoundary, targetBoundary) ||
		containsPath(targetBoundary, sourceBoundary)
	) {
		throw new Error('wasm-fortran source and target directories must not overlap');
	}
	if (containsPath(sourceBoundary, versionBoundary)) {
		throw new Error(
			'wasm-fortran version module must be outside the producer source directory'
		);
	}
	if (containsPath(targetBoundary, versionBoundary)) {
		throw new Error('wasm-fortran version module must be outside the runtime target directory');
	}
	const sourceReceipt = await validateAssetSet(resolvedSourceDir, SOURCE_RECEIPT_FILE);

	const suffix = `${process.pid}-${randomUUID()}`;
	const nextTargetDir = `${resolvedTargetDir}.next-${suffix}`;
	const previousTargetDir = `${resolvedTargetDir}.previous-${suffix}`;
	const nextVersionModulePath = `${resolvedVersionModulePath}.next-${suffix}`;
	const previousVersionModulePath = `${resolvedVersionModulePath}.previous-${suffix}`;
	await mkdir(path.dirname(resolvedTargetDir), { recursive: true });
	await mkdir(path.dirname(resolvedVersionModulePath), { recursive: true });

	const swaps = [
		{
			current: resolvedTargetDir,
			next: nextTargetDir,
			previous: previousTargetDir,
			recursive: true
		},
		{
			current: resolvedVersionModulePath,
			next: nextVersionModulePath,
			previous: previousVersionModulePath,
			recursive: false
		}
	].map((entry) => ({ ...entry, hadPrevious: false, installed: false }));

	let completed = false;
	let fingerprint = '';
	try {
		await copyAsset(resolvedTargetDir, nextTargetDir, { recursive: true });
		for (const asset of WASM_FORTRAN_EXECUTION_ASSET_FILES) {
			await rm(path.join(nextTargetDir, asset), { force: true });
			await rm(path.join(nextTargetDir, `${asset}.gz`), { force: true });
			await copyAsset(path.join(resolvedSourceDir, asset), path.join(nextTargetDir, asset));
		}
		await writeFile(
			path.join(nextTargetDir, SOURCE_RECEIPT_FILE),
			`${JSON.stringify(
				{
					schemaVersion: 1,
					profileId: sourceReceipt.profileId,
					assets: sourceReceipt.assets
				},
				null,
				2
			)}\n`,
			'utf8'
		);
		const installedReceipt = await validateAssetSet(nextTargetDir, SOURCE_RECEIPT_FILE);
		fingerprint = fingerprintReceipts(installedReceipt.profileId, installedReceipt.assets);
		await rm(path.join(nextTargetDir, SOURCE_RECEIPT_FILE), { force: true });
		await writeFile(
			path.join(nextTargetDir, TARGET_RECEIPT_FILE),
			`${JSON.stringify(
				{
					schemaVersion: 1,
					profileId: installedReceipt.profileId,
					fingerprint,
					assets: installedReceipt.assets
				},
				null,
				2
			)}\n`,
			'utf8'
		);
		await writeFile(
			nextVersionModulePath,
			renderVersionModule(fingerprint, installedReceipt.assets),
			'utf8'
		);

		for (const swap of swaps) {
			if (await stat(swap.current).catch(() => null)) {
				await renamePath(swap.current, swap.previous);
				swap.hadPrevious = true;
			}
			await renamePath(swap.next, swap.current);
			swap.installed = true;
		}
		completed = true;
	} catch (error) {
		/** @type {unknown[]} */
		const rollbackErrors = [];
		for (const swap of [...swaps].reverse()) {
			if (swap.installed) {
				try {
					await rm(swap.current, { recursive: swap.recursive, force: true });
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (swap.hadPrevious) {
				try {
					await renamePath(swap.previous, swap.current);
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
		}
		if (rollbackErrors.length) {
			throw new AggregateError(
				[error, ...rollbackErrors],
				'wasm-fortran sync failed and rollback could not restore the previous installation'
			);
		}
		throw error;
	} finally {
		for (const swap of swaps) {
			await rm(swap.next, { recursive: swap.recursive, force: true });
			if (completed && swap.hadPrevious) {
				await rm(swap.previous, { recursive: swap.recursive, force: true }).catch(() => {});
			}
		}
	}

	return Object.freeze({
		fingerprint,
		sourceDir: resolvedSourceDir,
		targetDir: resolvedTargetDir,
		versionModulePath: resolvedVersionModulePath
	});
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg, versionModulePathArg] = process.argv;
	const result = await syncWasmFortranAssets({
		sourceDir: sourceDirArg,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR,
		versionModulePath: versionModulePathArg
	});
	console.log(`Synced wasm-fortran ${result.fingerprint} into ${result.targetDir}`);
}
