import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { STATIC_RUNTIME_MIN_COMPRESS_BYTES } from './compress-static-runtime-assets.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-elixir', 'dist', 'wasm');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-elixir');
const DEFAULT_POPCORN_DIST_DIR = path.resolve(
	REPO_ROOT,
	'node_modules',
	'@swmansion',
	'popcorn',
	'dist'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmElixirVersion.ts'
);
const DEFAULT_LSP_INTEGRITY_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'lsp',
	'src',
	'bundledElixirRuntimeIntegrity.ts'
);

export const WASM_ELIXIR_ASSET_FILES = ['bundle.avm', 'AtomVM.mjs', 'AtomVM.wasm'];
const RUNTIME_BUILD_FILE = 'runtime-build.json';

/** @typedef {{ bytes: number; sha256: string; uncompressedBytes: number; uncompressedSha256: string }} ElixirAssetReceipt */

/**
 * @typedef {object} SyncWasmElixirOptions
 * @property {string} [sourceDir]
 * @property {string} [targetDir]
 * @property {string} [popcornDistDir]
 * @property {string} [versionModulePath]
 * @property {string} [lspIntegrityModulePath]
 * @property {typeof cp} [copyAsset]
 * @property {typeof rename} [renamePath]
 */

/** @param {string} filePath @param {string} message */
async function assertFile(filePath, message) {
	const fileStats = await stat(filePath).catch(() => null);
	if (!fileStats?.isFile()) throw new Error(message);
}

/** @param {SyncWasmElixirOptions} [options] */
export async function syncWasmElixirDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	popcornDistDir = DEFAULT_POPCORN_DIST_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	lspIntegrityModulePath = DEFAULT_LSP_INTEGRITY_MODULE_PATH,
	copyAsset = cp,
	renamePath = rename
} = {}) {
	const resolvedSourceDir = path.resolve(sourceDir);
	const resolvedTargetDir = path.resolve(targetDir);
	const resolvedPopcornDistDir = path.resolve(popcornDistDir);
	const resolvedVersionModulePath = path.resolve(versionModulePath);
	const resolvedLspIntegrityModulePath = path.resolve(lspIntegrityModulePath);
	const bundlePath = path.join(resolvedSourceDir, 'bundle.avm');
	await assertFile(
		bundlePath,
		`Elixir AVM bundle was not found at ${bundlePath}. Build it first with "pnpm --dir runtimes/wasm-elixir run bundle".`
	);
	for (const fileName of ['AtomVM.mjs', 'AtomVM.wasm']) {
		await assertFile(
			path.join(resolvedPopcornDistDir, fileName),
			`Popcorn runtime artifact was not found at ${path.join(resolvedPopcornDistDir, fileName)}. Run "pnpm install" first.`
		);
	}

	await mkdir(path.dirname(resolvedTargetDir), { recursive: true });
	const suffix = `${process.pid}-${randomUUID()}`;
	const nextTargetDir = `${resolvedTargetDir}.next-${suffix}`;
	const previousTargetDir = `${resolvedTargetDir}.previous-${suffix}`;
	const nextVersionModulePath = `${resolvedVersionModulePath}.next-${suffix}`;
	const previousVersionModulePath = `${resolvedVersionModulePath}.previous-${suffix}`;
	const nextLspIntegrityModulePath = `${resolvedLspIntegrityModulePath}.next-${suffix}`;
	const previousLspIntegrityModulePath = `${resolvedLspIntegrityModulePath}.previous-${suffix}`;
	await mkdir(nextTargetDir, { recursive: true });

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
		},
		{
			current: resolvedLspIntegrityModulePath,
			next: nextLspIntegrityModulePath,
			previous: previousLspIntegrityModulePath,
			recursive: false
		}
	].map((entry) => ({ ...entry, hadPrevious: false, installed: false }));
	let completed = false;
	let fingerprint = '';
	/** @type {Readonly<Record<string, Readonly<ElixirAssetReceipt>>>} */
	let receipts = Object.freeze({});
	try {
		await copyAsset(bundlePath, path.join(nextTargetDir, 'bundle.avm'));
		await copyAsset(
			path.join(resolvedPopcornDistDir, 'AtomVM.mjs'),
			path.join(nextTargetDir, 'AtomVM.mjs')
		);
		await copyAsset(
			path.join(resolvedPopcornDistDir, 'AtomVM.wasm'),
			path.join(nextTargetDir, 'AtomVM.wasm')
		);
		for (const fileName of WASM_ELIXIR_ASSET_FILES) {
			await assertFile(
				path.join(nextTargetDir, fileName),
				`wasm-elixir installed runtime asset is missing: ${fileName}`
			);
		}

		/** @type {Record<string, Readonly<ElixirAssetReceipt>>} */
		const computedReceipts = {};
		for (const fileName of WASM_ELIXIR_ASSET_FILES) {
			const logicalBytes = await readFile(path.join(nextTargetDir, fileName));
			if (logicalBytes.byteLength <= 0) {
				throw new Error(`wasm-elixir runtime asset must be non-empty: ${fileName}`);
			}
			if (logicalBytes.byteLength < STATIC_RUNTIME_MIN_COMPRESS_BYTES) {
				throw new Error(
					`wasm-elixir runtime asset ${fileName} must be at least ${STATIC_RUNTIME_MIN_COMPRESS_BYTES} bytes so its gzip receipt matches the static delivery pipeline`
				);
			}
			const deliveryBytes = gzipSync(logicalBytes, { level: 9 });
			computedReceipts[fileName] = Object.freeze({
				bytes: deliveryBytes.byteLength,
				sha256: createHash('sha256').update(deliveryBytes).digest('hex'),
				uncompressedBytes: logicalBytes.byteLength,
				uncompressedSha256: createHash('sha256').update(logicalBytes).digest('hex')
			});
		}
		receipts = Object.freeze(computedReceipts);
		const fingerprintHash = createHash('sha256');
		fingerprintHash.update('wasm-elixir-asset-receipts-v1\0');
		for (const fileName of WASM_ELIXIR_ASSET_FILES) {
			const receipt = receipts[fileName];
			fingerprintHash.update(fileName);
			fingerprintHash.update('\0');
			fingerprintHash.update(String(receipt.bytes));
			fingerprintHash.update('\0');
			fingerprintHash.update(receipt.sha256);
			fingerprintHash.update('\0');
			fingerprintHash.update(String(receipt.uncompressedBytes));
			fingerprintHash.update('\0');
			fingerprintHash.update(receipt.uncompressedSha256);
			fingerprintHash.update('\n');
		}
		fingerprint = fingerprintHash.digest('hex').slice(0, 16);
		await writeFile(
			path.join(nextTargetDir, RUNTIME_BUILD_FILE),
			`${JSON.stringify({ schemaVersion: 1, fingerprint, assets: receipts }, null, 2)}\n`,
			'utf8'
		);
		const receiptSource = WASM_ELIXIR_ASSET_FILES.map(
			(fileName) => `\t'${fileName}': Object.freeze({
\t\tbytes: ${receipts[fileName].bytes},
\t\tsha256: '${receipts[fileName].sha256}',
\t\tuncompressedBytes: ${receipts[fileName].uncompressedBytes},
\t\tuncompressedSha256: '${receipts[fileName].uncompressedSha256}'
\t})`
		).join(',\n');
		for (const { modulePath, receiptsExport, versionExport } of [
			{
				modulePath: nextVersionModulePath,
				versionExport: 'WASM_ELIXIR_ASSET_VERSION',
				receiptsExport: 'WASM_ELIXIR_ASSET_RECEIPTS'
			},
			{
				modulePath: nextLspIntegrityModulePath,
				versionExport: 'BUNDLED_ELIXIR_ASSET_VERSION',
				receiptsExport: 'BUNDLED_ELIXIR_ASSET_RECEIPTS'
			}
		]) {
			await mkdir(path.dirname(modulePath), { recursive: true });
			await writeFile(
				modulePath,
				`export const ${versionExport} = '${fingerprint}';

export const ${receiptsExport} = Object.freeze({
${receiptSource}
});
`,
				'utf8'
			);
		}

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
				'wasm-elixir sync failed and rollback could not restore the previous installation'
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

	return {
		sourceDir: resolvedSourceDir,
		targetDir: resolvedTargetDir,
		popcornDistDir: resolvedPopcornDistDir,
		fingerprint,
		versionModulePath: resolvedVersionModulePath,
		lspIntegrityModulePath: resolvedLspIntegrityModulePath,
		receipts
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmElixirDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-elixir from ${sourceDir} to ${targetDir}`);
}
