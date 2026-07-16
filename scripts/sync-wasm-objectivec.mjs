import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, 'static', 'wasm-objectivec');

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
			metadata.bytes < 0 ||
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

	return receipt;
}

/** @param {{ sourceDir?: string; targetDir?: string }} [options] */
export async function syncWasmObjectiveCAssets({ sourceDir, targetDir = DEFAULT_TARGET_DIR } = {}) {
	if (!sourceDir) {
		throw new Error('wasm-objectivec sync requires an explicit source directory.');
	}

	const resolvedSourceDir = path.resolve(sourceDir);
	const resolvedTargetDir = path.resolve(targetDir);
	await validateAssetSet(resolvedSourceDir, SOURCE_RECEIPT);

	await mkdir(path.dirname(resolvedTargetDir), { recursive: true });
	const suffix = `${process.pid}-${randomUUID()}`;
	const nextTarget = `${resolvedTargetDir}.next-${suffix}`;
	const previousTarget = `${resolvedTargetDir}.previous-${suffix}`;
	await mkdir(nextTarget, { recursive: true });

	let hadPrevious = false;
	let installedNext = false;
	try {
		for (const filename of ASSET_FILES) {
			await cp(path.join(resolvedSourceDir, filename), path.join(nextTarget, filename));
		}
		await cp(
			path.join(resolvedSourceDir, SOURCE_RECEIPT),
			path.join(nextTarget, TARGET_RECEIPT)
		);
		await validateAssetSet(nextTarget, TARGET_RECEIPT);

		if (await stat(resolvedTargetDir).catch(() => null)) {
			await rename(resolvedTargetDir, previousTarget);
			hadPrevious = true;
		}
		await rename(nextTarget, resolvedTargetDir);
		installedNext = true;
	} catch (error) {
		if (installedNext) {
			await rm(resolvedTargetDir, { recursive: true, force: true });
		}
		if (hadPrevious) {
			await rename(previousTarget, resolvedTargetDir).catch(() => {});
		}
		throw error;
	} finally {
		await rm(nextTarget, { recursive: true, force: true });
		if (installedNext) {
			await rm(previousTarget, { recursive: true, force: true }).catch(() => {});
		}
	}

	return { sourceDir: resolvedSourceDir, targetDir: resolvedTargetDir };
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
