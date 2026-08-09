import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, 'static', 'wasm-objectivec');
const DEFAULT_VERSION_MODULE_PATH = path.join(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmObjectiveCVersion.ts'
);

const ASSET_FILES = [
	'libobjc.a',
	'headers.json',
	'libgnustep-base.a',
	'libgnustep-base.o',
	'foundation-headers.json',
	'libffi.a'
];
const SOURCE_RECEIPT = 'producer-receipt.json';
const TARGET_RECEIPT = 'runtime-build.json';

/** @typedef {{ bytes: number; sha256: string }} ObjectiveCAssetReceipt */
/** @typedef {{ assets: Record<string, ObjectiveCAssetReceipt> }} ObjectiveCProducerReceipt */

/**
 * @typedef {{
 *   sourceDir?: string;
 *   targetDir?: string;
 *   versionModulePath?: string;
 *   copyAsset?: typeof cp;
 *   renamePath?: typeof rename;
 * }} SyncWasmObjectiveCOptions
 */

/** @param {unknown} value */
function isObject(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} filePath @param {string} filename */
async function readReceipt(filePath, filename) {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-objectivec ${filename} is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
}

/** @param {string} filePath */
async function sha256File(filePath) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest('hex');
}

/** @param {string} directory @param {string} receiptFilename */
async function validateAssetSet(directory, receiptFilename) {
	for (const filename of [...ASSET_FILES, receiptFilename]) {
		const filePath = path.join(directory, filename);
		const fileStats = await stat(filePath).catch(() => null);
		if (!fileStats?.isFile()) {
			throw new Error(
				`wasm-objectivec runtime asset ${filename} was not found in ${directory}. Provide a complete source directory before syncing.`
			);
		}
	}

	const receipt = await readReceipt(path.join(directory, receiptFilename), receiptFilename);
	if (!isObject(receipt) || !isObject(receipt.assets)) {
		throw new Error(`wasm-objectivec ${receiptFilename} is missing asset metadata`);
	}

	const receiptAssets = Object.keys(receipt.assets).sort();
	const expectedAssets = [...ASSET_FILES].sort();
	if (
		receiptAssets.length !== expectedAssets.length ||
		receiptAssets.some((filename, index) => filename !== expectedAssets[index])
	) {
		throw new Error(
			`wasm-objectivec ${receiptFilename} does not describe the complete runtime asset set`
		);
	}

	for (const filename of ASSET_FILES) {
		const metadata = receipt.assets[filename];
		if (
			!isObject(metadata) ||
			!Number.isSafeInteger(metadata.bytes) ||
			metadata.bytes <= 0 ||
			typeof metadata.sha256 !== 'string' ||
			!/^[0-9a-f]{64}$/.test(metadata.sha256)
		) {
			throw new Error(
				`wasm-objectivec ${receiptFilename} contains invalid metadata for ${filename}`
			);
		}

		const filePath = path.join(directory, filename);
		const fileStats = await stat(filePath);
		if (metadata.bytes !== fileStats.size || metadata.sha256 !== (await sha256File(filePath))) {
			throw new Error(
				`wasm-objectivec runtime asset ${filename} does not match ${receiptFilename}`
			);
		}
	}

	return /** @type {ObjectiveCProducerReceipt} */ (receipt);
}

/** @param {SyncWasmObjectiveCOptions} [options] */
export async function syncWasmObjectiveCAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath,
	copyAsset = cp,
	renamePath = rename
} = {}) {
	if (!sourceDir) {
		throw new Error('wasm-objectivec sync requires an explicit source directory.');
	}

	const resolvedSourceDir = path.resolve(sourceDir);
	const resolvedTargetDir = path.resolve(targetDir);
	const resolvedVersionModulePath = versionModulePath
		? path.resolve(versionModulePath)
		: resolvedTargetDir === path.resolve(DEFAULT_TARGET_DIR)
			? DEFAULT_VERSION_MODULE_PATH
			: undefined;
	await validateAssetSet(resolvedSourceDir, SOURCE_RECEIPT);

	await mkdir(path.dirname(resolvedTargetDir), { recursive: true });
	const suffix = `${process.pid}-${randomUUID()}`;
	const nextTarget = `${resolvedTargetDir}.next-${suffix}`;
	const previousTarget = `${resolvedTargetDir}.previous-${suffix}`;
	const nextVersionModule = resolvedVersionModulePath
		? `${resolvedVersionModulePath}.next-${suffix}`
		: undefined;
	const previousVersionModule = resolvedVersionModulePath
		? `${resolvedVersionModulePath}.previous-${suffix}`
		: undefined;
	await mkdir(nextTarget, { recursive: true });

	let hadPrevious = false;
	let installedNext = false;
	let hadPreviousVersion = false;
	let installedVersion = false;
	let completed = false;
	let fingerprint = '';
	/** @type {Readonly<Record<string, Readonly<ObjectiveCAssetReceipt>>> | undefined} */
	let browserReceipt;
	try {
		for (const filename of ASSET_FILES) {
			await copyAsset(
				path.join(resolvedSourceDir, filename),
				path.join(nextTarget, filename)
			);
		}
		await copyAsset(
			path.join(resolvedSourceDir, SOURCE_RECEIPT),
			path.join(nextTarget, TARGET_RECEIPT)
		);
		const installedReceipt = await validateAssetSet(nextTarget, TARGET_RECEIPT);
		fingerprint = (await sha256File(path.join(nextTarget, TARGET_RECEIPT))).slice(0, 16);
		const installedBrowserReceipt = Object.freeze(
			Object.fromEntries(
				ASSET_FILES.map((filename) => [
					filename,
					Object.freeze({
						bytes: installedReceipt.assets[filename].bytes,
						sha256: installedReceipt.assets[filename].sha256
					})
				])
			)
		);
		browserReceipt = installedBrowserReceipt;
		if (nextVersionModule && resolvedVersionModulePath) {
			const receiptSource = ASSET_FILES.map(
				(filename) => `\t'${filename}': Object.freeze({
\t\tbytes: ${installedBrowserReceipt[filename].bytes},
\t\tsha256: '${installedBrowserReceipt[filename].sha256}'
\t})`
			).join(',\n');
			const versionSource = `export const WASM_OBJECTIVEC_ASSET_VERSION = '${fingerprint}';

export const WASM_OBJECTIVEC_ASSET_RECEIPTS = Object.freeze({
${receiptSource}
});
`;
			await mkdir(path.dirname(resolvedVersionModulePath), { recursive: true });
			await writeFile(nextVersionModule, versionSource, 'utf8');
		}

		if (await stat(resolvedTargetDir).catch(() => null)) {
			await renamePath(resolvedTargetDir, previousTarget);
			hadPrevious = true;
		}
		if (
			resolvedVersionModulePath &&
			previousVersionModule &&
			(await stat(resolvedVersionModulePath).catch(() => null))
		) {
			await renamePath(resolvedVersionModulePath, previousVersionModule);
			hadPreviousVersion = true;
		}
		await renamePath(nextTarget, resolvedTargetDir);
		installedNext = true;
		if (nextVersionModule && resolvedVersionModulePath) {
			await renamePath(nextVersionModule, resolvedVersionModulePath);
			installedVersion = true;
		}
		completed = true;
	} catch (error) {
		/** @type {unknown[]} */
		const rollbackErrors = [];
		if (installedVersion && resolvedVersionModulePath) {
			try {
				await rm(resolvedVersionModulePath, { force: true });
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (hadPreviousVersion && previousVersionModule && resolvedVersionModulePath) {
			try {
				await renamePath(previousVersionModule, resolvedVersionModulePath);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (installedNext) {
			try {
				await rm(resolvedTargetDir, { recursive: true, force: true });
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (hadPrevious) {
			try {
				await renamePath(previousTarget, resolvedTargetDir);
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (rollbackErrors.length) {
			throw new AggregateError(
				[error, ...rollbackErrors],
				'wasm-objectivec sync failed and rollback could not restore the previous installation'
			);
		}
		throw error;
	} finally {
		await rm(nextTarget, { recursive: true, force: true });
		if (nextVersionModule) await rm(nextVersionModule, { force: true });
		if (completed && hadPrevious) {
			await rm(previousTarget, { recursive: true, force: true }).catch(() => {});
		}
		if (completed && hadPreviousVersion && previousVersionModule) {
			await rm(previousVersionModule, { force: true }).catch(() => {});
		}
	}

	return {
		sourceDir: resolvedSourceDir,
		targetDir: resolvedTargetDir,
		versionModulePath: resolvedVersionModulePath,
		fingerprint,
		receipt: browserReceipt
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [sourceDirArg, targetDirArg, extraArg] = process.argv
		.slice(2)
		.filter((arg) => arg !== '--');
	if (extraArg) {
		throw new Error('wasm-objectivec sync accepts at most sourceDir and targetDir arguments');
	}
	const result = await syncWasmObjectiveCAssets({
		sourceDir: sourceDirArg,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-objectivec from ${result.sourceDir} to ${result.targetDir}`);
}
