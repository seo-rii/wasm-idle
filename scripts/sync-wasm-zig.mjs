import { createHash, randomUUID } from 'node:crypto';
import {
	lstat,
	mkdir,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-zig', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-zig');
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmZigVersion.ts'
);
const DEFAULT_LOCK_FILE_PATH = path.resolve(THIS_DIR, 'wasm-zig-assets.lock.json');
const TARGET_RECEIPT_FILE = 'runtime-build.json';
const INPUT_ASSET_NAMES = /** @type {const} */ (['zig_small.wasm', 'std.zip']);
export const WASM_ZIG_EXECUTION_ASSET_FILES = /** @type {const} */ ([
	'zig_small.wasm',
	'std.tar.gz'
]);

/** @typedef {{ bytes: number; sha256: string; uncompressedBytes?: number; uncompressedSha256?: string }} ZigAssetReceipt */
/** @typedef {{ schemaVersion: 1; profileId: string; releaseBaseUrl: string; inputs: Record<string, ZigAssetReceipt> }} ZigInputLock */
/** @typedef {{ fileName: 'zig_small.wasm' | 'std.tar.gz'; data: Buffer; expandedData?: Buffer }} ZigBundleFile */

/**
 * @typedef {{
 *   sourceDir?: string;
 *   targetDir?: string;
 *   versionModulePath?: string;
 *   lockFilePath?: string;
 *   releaseBaseUrl?: string;
 *   fetchImpl?: typeof fetch;
 *   renamePath?: typeof rename;
 * }} SyncWasmZigOptions
 */

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
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
		throw new Error(`wasm-zig input lock must be a regular file: ${lockFilePath}`);
	}
	const value = await readJson(lockFilePath, 'wasm-zig input lock');
	if (
		!isObject(value) ||
		value.schemaVersion !== 1 ||
		typeof value.profileId !== 'string' ||
		!value.profileId.trim() ||
		typeof value.releaseBaseUrl !== 'string' ||
		!isObject(value.inputs)
	) {
		throw new Error('wasm-zig input lock has invalid profile metadata');
	}
	let releaseUrl;
	try {
		releaseUrl = new URL(value.releaseBaseUrl);
	} catch {
		throw new Error('wasm-zig input lock has an invalid release base URL');
	}
	if (
		releaseUrl.protocol !== 'https:' ||
		releaseUrl.username ||
		releaseUrl.password ||
		releaseUrl.search ||
		releaseUrl.hash
	) {
		throw new Error('wasm-zig input lock release base URL must be a credential-free HTTPS URL');
	}
	const receivedInputs = Object.keys(value.inputs).sort();
	const expectedInputs = [...INPUT_ASSET_NAMES].sort();
	if (
		receivedInputs.length !== expectedInputs.length ||
		receivedInputs.some((asset, index) => asset !== expectedInputs[index])
	) {
		throw new Error('wasm-zig input lock must describe exactly two source assets');
	}
	/** @type {Record<string, Readonly<ZigAssetReceipt>>} */
	const inputs = {};
	for (const asset of INPUT_ASSET_NAMES) {
		inputs[asset] = validateReceipt(value.inputs[asset], `wasm-zig input ${asset}`);
	}
	return Object.freeze({
		schemaVersion: /** @type {const} */ (1),
		profileId: value.profileId.trim(),
		releaseBaseUrl: releaseUrl.href.replace(/\/$/u, ''),
		inputs: Object.freeze(inputs)
	});
}

/** @param {Uint8Array} data @param {Readonly<ZigAssetReceipt>} receipt @param {string} label */
function verifyBytes(data, receipt, label) {
	if (data.byteLength !== receipt.bytes || sha256(data) !== receipt.sha256) {
		throw new Error(`${label} does not match the pinned wasm-zig input receipt`);
	}
}

/** @param {Response} response @param {Readonly<ZigAssetReceipt>} receipt @param {string} label */
async function readBoundedResponse(response, receipt, label) {
	if (!response.ok) {
		throw new Error(`failed to download ${label}: ${response.status}`);
	}
	const rawLength = response.headers.get('content-length');
	if (rawLength !== null) {
		const normalized = rawLength.trim();
		const declared = Number(normalized);
		if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(declared)) {
			throw new Error(`${label} download has an invalid Content-Length`);
		}
		if (declared !== receipt.bytes) {
			throw new Error(`${label} download size does not match the pinned receipt`);
		}
	}
	if (!response.body) {
		const data = Buffer.from(await response.arrayBuffer());
		verifyBytes(data, receipt, label);
		return data;
	}

	const output = Buffer.alloc(receipt.bytes);
	const reader = response.body.getReader();
	let offset = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextOffset = offset + value.byteLength;
			if (nextOffset > receipt.bytes) {
				void reader.cancel(`${label} exceeded its pinned byte size`).catch(() => undefined);
				throw new Error(`${label} download exceeds the pinned byte size`);
			}
			output.set(value, offset);
			offset = nextOffset;
		}
	} finally {
		reader.releaseLock();
	}
	if (offset !== receipt.bytes) {
		throw new Error(`${label} download is truncated`);
	}
	verifyBytes(output, receipt, label);
	return output;
}

/** @param {string} sourceDir */
async function validateLocalSource(sourceDir) {
	const entries = await readdir(sourceDir, { withFileTypes: true });
	const received = entries.map((entry) => entry.name).sort();
	const expected = [...INPUT_ASSET_NAMES].sort();
	if (
		received.length !== expected.length ||
		received.some((asset, index) => asset !== expected[index])
	) {
		throw new Error('wasm-zig source directory must contain exactly two pinned assets');
	}
	for (const asset of INPUT_ASSET_NAMES) {
		if (!(await isRegularFile(path.join(sourceDir, asset)))) {
			throw new Error(`wasm-zig source asset must be a regular file: ${asset}`);
		}
	}
}

/**
 * @param {{ sourceDir: string; useLocalSource: boolean; releaseBaseUrl: string; asset: string; receipt: Readonly<ZigAssetReceipt>; fetchImpl: typeof fetch }} options
 */
async function readInputAsset({
	sourceDir,
	useLocalSource,
	releaseBaseUrl,
	asset,
	receipt,
	fetchImpl
}) {
	if (useLocalSource) {
		const data = await readFile(path.join(sourceDir, asset));
		verifyBytes(data, receipt, `wasm-zig source asset ${asset}`);
		return data;
	}
	const response = await fetchImpl(`${releaseBaseUrl}/${asset}`, {
		credentials: 'omit',
		redirect: 'follow',
		referrerPolicy: 'no-referrer'
	});
	return await readBoundedResponse(response, receipt, `wasm-zig source asset ${asset}`);
}

/** @param {Buffer} compilerBytes */
function validateCompiler(compilerBytes) {
	if (
		compilerBytes.byteLength < 8 ||
		compilerBytes[0] !== 0x00 ||
		compilerBytes[1] !== 0x61 ||
		compilerBytes[2] !== 0x73 ||
		compilerBytes[3] !== 0x6d
	) {
		throw new Error('zig compiler asset at zig_small.wasm is not a valid WebAssembly binary');
	}
}

/** @param {Buffer} archiveBytes */
function repackageStandardLibrary(archiveBytes) {
	if (archiveBytes.byteLength < 4 || archiveBytes[0] !== 0x50 || archiveBytes[1] !== 0x4b) {
		throw new Error('zig standard library asset at std.zip is not a valid ZIP archive');
	}
	let archiveEntries;
	try {
		archiveEntries = unzipSync(archiveBytes);
	} catch (error) {
		throw new Error(
			`zig standard library asset at std.zip could not be repackaged: ${error instanceof Error ? error.message : error}`
		);
	}
	const standardLibraryFiles = Object.entries(archiveEntries)
		.filter(([entryName]) => entryName && !entryName.endsWith('/'))
		.sort(([left], [right]) => left.localeCompare(right, 'en-US'));
	if (
		standardLibraryFiles.length === 0 ||
		standardLibraryFiles.some(([entryName]) => !entryName.startsWith('std/'))
	) {
		throw new Error('zig standard library asset at std.zip must contain files under std/');
	}
	/** @type {Buffer[]} */
	const tarParts = [];
	for (const [entryName, entryBytes] of standardLibraryFiles) {
		const normalizedName = entryName.replaceAll('\\', '/');
		if (
			normalizedName.startsWith('/') ||
			normalizedName.split('/').some((part) => !part || part === '.' || part === '..') ||
			Buffer.byteLength(normalizedName) > 100
		) {
			throw new Error(`zig standard library contains an unsupported path: ${entryName}`);
		}
		const header = Buffer.alloc(512);
		header.write(normalizedName, 0, 100, 'utf8');
		header.write('0000644\0', 100, 8, 'ascii');
		header.write('0000000\0', 108, 8, 'ascii');
		header.write('0000000\0', 116, 8, 'ascii');
		header.write(`${entryBytes.byteLength.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
		header.write('00000000000\0', 136, 12, 'ascii');
		header.fill(0x20, 148, 156);
		header.write('0', 156, 1, 'ascii');
		header.write('ustar\0', 257, 6, 'ascii');
		header.write('00', 263, 2, 'ascii');
		const checksum = header.reduce((total, byte) => total + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
		tarParts.push(header, Buffer.from(entryBytes));
		const padding = (512 - (entryBytes.byteLength % 512)) % 512;
		if (padding > 0) tarParts.push(Buffer.alloc(padding));
	}
	tarParts.push(Buffer.alloc(1024));
	const expandedData = Buffer.concat(tarParts);
	return {
		data: gzipSync(expandedData, { level: 9 }),
		expandedData
	};
}

/** @param {readonly ZigBundleFile[]} files */
function createOutputReceipts(files) {
	/** @type {Record<string, Readonly<ZigAssetReceipt>>} */
	const receipts = {};
	for (const file of files) {
		receipts[file.fileName] = Object.freeze({
			bytes: file.data.byteLength,
			sha256: sha256(file.data),
			...(file.expandedData
				? {
						uncompressedBytes: file.expandedData.byteLength,
						uncompressedSha256: sha256(file.expandedData)
					}
				: {})
		});
	}
	return Object.freeze(receipts);
}

/** @param {string} profileId @param {Readonly<Record<string, Readonly<ZigAssetReceipt>>>} receipts */
function fingerprintReceipts(profileId, receipts) {
	const hash = createHash('sha256');
	hash.update('wasm-zig-execution-asset-receipts-v1\0');
	hash.update(profileId);
	hash.update('\0');
	for (const asset of WASM_ZIG_EXECUTION_ASSET_FILES) {
		const receipt = receipts[asset];
		hash.update(asset);
		hash.update('\0');
		hash.update(String(receipt.bytes));
		hash.update('\0');
		hash.update(receipt.sha256);
		hash.update('\0');
		hash.update(String(receipt.uncompressedBytes || ''));
		hash.update('\0');
		hash.update(receipt.uncompressedSha256 || '');
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

/** @param {string} fingerprint @param {Readonly<Record<string, Readonly<ZigAssetReceipt>>>} receipts */
function renderVersionModule(fingerprint, receipts) {
	const compiler = receipts['zig_small.wasm'];
	const stdlib = receipts['std.tar.gz'];
	return `export const WASM_ZIG_ASSET_VERSION = '${fingerprint}';

export const WASM_ZIG_ASSET_RECEIPTS = Object.freeze({
	'zig_small.wasm': Object.freeze({
		bytes: ${compiler.bytes},
		sha256: '${compiler.sha256}'
	}),
	'std.tar.gz': Object.freeze({
		bytes: ${stdlib.bytes},
		sha256: '${stdlib.sha256}',
		uncompressedBytes: ${stdlib.uncompressedBytes},
		uncompressedSha256: '${stdlib.uncompressedSha256}'
	})
});
`;
}

/** @param {ZigInputLock} lock @param {Readonly<Record<string, Readonly<ZigAssetReceipt>>>} receipts */
function renderRuntimeBuild(lock, receipts) {
	return `${JSON.stringify(
		{
			schemaVersion: 1,
			profileId: lock.profileId,
			fingerprint: fingerprintReceipts(lock.profileId, receipts),
			upstream: {
				releaseBaseUrl: lock.releaseBaseUrl,
				inputs: lock.inputs
			},
			assets: receipts
		},
		null,
		'\t'
	)}\n`;
}

/** @param {string} targetDir @param {Readonly<Record<string, Readonly<ZigAssetReceipt>>>} expectedReceipts */
async function validateInstalledSnapshot(targetDir, expectedReceipts) {
	const entries = (await readdir(targetDir)).sort();
	const expectedEntries = [...WASM_ZIG_EXECUTION_ASSET_FILES, TARGET_RECEIPT_FILE].sort();
	if (
		entries.length !== expectedEntries.length ||
		entries.some((entry, index) => entry !== expectedEntries[index])
	) {
		throw new Error('wasm-zig installed runtime has an unexpected asset set');
	}
	for (const asset of WASM_ZIG_EXECUTION_ASSET_FILES) {
		const filePath = path.join(targetDir, asset);
		if (!(await isRegularFile(filePath))) {
			throw new Error(`wasm-zig installed asset must be a regular file: ${asset}`);
		}
		verifyBytes(await readFile(filePath), expectedReceipts[asset], `installed ${asset}`);
	}
	const runtimeBuild = await readJson(
		path.join(targetDir, TARGET_RECEIPT_FILE),
		'wasm-zig runtime receipt'
	);
	if (!isObject(runtimeBuild) || !isObject(runtimeBuild.assets)) {
		throw new Error('wasm-zig runtime receipt has invalid asset metadata');
	}
	for (const asset of WASM_ZIG_EXECUTION_ASSET_FILES) {
		if (
			JSON.stringify(runtimeBuild.assets[asset]) !== JSON.stringify(expectedReceipts[asset])
		) {
			throw new Error(`wasm-zig runtime receipt drifted for ${asset}`);
		}
	}
	const stdlib = expectedReceipts['std.tar.gz'];
	const expanded = gunzipSync(await readFile(path.join(targetDir, 'std.tar.gz')));
	if (
		expanded.byteLength !== stdlib.uncompressedBytes ||
		sha256(expanded) !== stdlib.uncompressedSha256
	) {
		throw new Error('installed std.tar.gz does not match its uncompressed receipt');
	}
}

/**
 * @param {readonly { current: string; next: string; previous: string }[]} swaps
 * @param {typeof rename} renamePath
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
							'wasm-zig failed to publish and restore an output'
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
				'wasm-zig publication failed and rollback was incomplete'
			);
		}
		throw error;
	}
	for (const swap of published) {
		if (swap.hadCurrent) await rm(swap.previous, { recursive: true, force: true });
	}
}

/** @param {SyncWasmZigOptions} [options] */
export async function syncWasmZigAssets(options = {}) {
	const sourceDir = path.resolve(options.sourceDir || DEFAULT_SOURCE_DIR);
	const targetDir = path.resolve(options.targetDir || DEFAULT_TARGET_DIR);
	const versionModulePath = path.resolve(
		options.versionModulePath ||
			(targetDir === path.resolve(DEFAULT_TARGET_DIR)
				? DEFAULT_VERSION_MODULE_PATH
				: `${targetDir}.version.ts`)
	);
	const lockFilePath = path.resolve(options.lockFilePath || DEFAULT_LOCK_FILE_PATH);
	const fetchImpl = options.fetchImpl || globalThis.fetch;
	const renamePath = options.renamePath || rename;
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (options.sourceDir && !sourceStats?.isDirectory()) {
		throw new Error(`wasm-zig source directory was not found at ${sourceDir}`);
	}
	if (sourceStats && !sourceStats.isDirectory()) {
		throw new Error(`wasm-zig source path is not a directory: ${sourceDir}`);
	}
	const useLocalSource = !!sourceStats;
	if (!useLocalSource && typeof fetchImpl !== 'function') {
		throw new Error('wasm-zig sync requires fetch when the local source directory is absent');
	}
	const [targetStats, versionStats] = await Promise.all([
		lstat(targetDir).catch(() => null),
		lstat(versionModulePath).catch(() => null)
	]);
	if (targetStats && !targetStats.isDirectory()) {
		throw new Error(`wasm-zig runtime target must be a directory: ${targetDir}`);
	}
	if (versionStats && !versionStats.isFile()) {
		throw new Error(`wasm-zig version module must be a regular file: ${versionModulePath}`);
	}

	const [sourceBoundary, targetBoundary, versionBoundary, lockBoundary] = await Promise.all([
		resolveBoundaryPath(sourceDir),
		resolveBoundaryPath(targetDir),
		resolveBoundaryPath(versionModulePath),
		resolveBoundaryPath(lockFilePath)
	]);
	if (pathsOverlap(sourceBoundary, targetBoundary)) {
		throw new Error('wasm-zig source and target directories must not overlap');
	}
	if (pathsOverlap(sourceBoundary, versionBoundary)) {
		throw new Error('wasm-zig version module must be outside the source directory');
	}
	if (pathsOverlap(targetBoundary, versionBoundary)) {
		throw new Error('wasm-zig version module must be outside the runtime target directory');
	}
	if (pathsOverlap(targetBoundary, lockBoundary)) {
		throw new Error('wasm-zig input lock must be outside the runtime target directory');
	}
	if (pathsOverlap(versionBoundary, lockBoundary)) {
		throw new Error('wasm-zig input lock and version module must not overlap');
	}

	const lock = await readInputLock(lockFilePath);
	const releaseBaseUrl = (options.releaseBaseUrl || lock.releaseBaseUrl).replace(/\/$/u, '');
	if (releaseBaseUrl !== lock.releaseBaseUrl) {
		throw new Error('wasm-zig releaseBaseUrl must match the pinned input lock');
	}
	if (useLocalSource) await validateLocalSource(sourceDir);
	const [compilerBytes, stdlibZip] = await Promise.all(
		INPUT_ASSET_NAMES.map((asset) =>
			readInputAsset({
				sourceDir,
				useLocalSource,
				releaseBaseUrl,
				asset,
				receipt: lock.inputs[asset],
				fetchImpl
			})
		)
	);
	validateCompiler(compilerBytes);
	const stdlib = repackageStandardLibrary(stdlibZip);
	/** @type {readonly ZigBundleFile[]} */
	const files = [
		{ fileName: 'zig_small.wasm', data: compilerBytes },
		{ fileName: 'std.tar.gz', data: stdlib.data, expandedData: stdlib.expandedData }
	];
	const receipts = createOutputReceipts(files);
	const fingerprint = fingerprintReceipts(lock.profileId, receipts);

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
		for (const file of files) {
			await writeFile(path.join(nextTargetDir, file.fileName), file.data);
		}
		await writeFile(
			path.join(nextTargetDir, TARGET_RECEIPT_FILE),
			renderRuntimeBuild(lock, receipts),
			'utf8'
		);
		await validateInstalledSnapshot(nextTargetDir, receipts);
		await writeFile(nextVersionModulePath, renderVersionModule(fingerprint, receipts), 'utf8');
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
		sourceDir: useLocalSource ? sourceDir : releaseBaseUrl,
		targetDir,
		fingerprint,
		profileId: lock.profileId,
		receipts,
		versionModulePath
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmZigAssets({
		...(sourceDirArg ? { sourceDir: sourceDirArg } : {}),
		...(targetDirArg ? { targetDir: targetDirArg } : {})
	});

	console.log(`Synced wasm-zig from ${sourceDir} to ${targetDir}`);
}
