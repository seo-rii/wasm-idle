import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, 'static', 'wasm-cobol');

const ARCHIVE_FILES = ['cobc.zip', 'rootfs.tar.zip', 'c-sysroot.tar.zip'];
const REQUIRED_FILES = ['runtime-manifest.v1.json', ...ARCHIVE_FILES, 'runtime-build.json'];
const DELIVERY_ASSETS = [
	{ source: 'cobc.zip', entry: 'cobc', target: 'cobc.wasm.gz', kind: 'wasm' },
	{ source: 'rootfs.tar.zip', entry: 'rootfs.tar', target: 'rootfs.tar.gz', kind: 'tar' },
	{
		source: 'c-sysroot.tar.zip',
		entry: 'c-sysroot.tar',
		target: 'c-sysroot.tar.gz',
		kind: 'tar'
	}
];
const DELIVERY_FILES = [
	'runtime-manifest.v1.json',
	...DELIVERY_ASSETS.map((asset) => asset.target),
	'runtime-build.json'
];

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} filePath @param {string} label */
async function readJson(filePath, label) {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch (error) {
		throw new Error(
			`wasm-cobol ${label} is not valid JSON: ${error instanceof Error ? error.message : error}`
		);
	}
}

/** @param {string} filePath */
async function sha256File(filePath) {
	return createHash('sha256')
		.update(await readFile(filePath))
		.digest('hex');
}

/** @param {Uint8Array} contents */
function sha256(contents) {
	return createHash('sha256').update(contents).digest('hex');
}

/** @param {string} filePath @param {unknown} value */
async function writeJson(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** @param {string} sourceDir */
async function validateSource(sourceDir) {
	for (const filename of REQUIRED_FILES) {
		const filePath = path.join(sourceDir, filename);
		const fileStats = await stat(filePath).catch(() => null);
		if (!fileStats?.isFile()) {
			throw new Error(
				`wasm-cobol runtime asset ${filename} was not found in ${sourceDir}. Provide a complete source directory before syncing.`
			);
		}
	}

	const manifest = await readJson(
		path.join(sourceDir, 'runtime-manifest.v1.json'),
		'runtime manifest'
	);
	if (!isObject(manifest) || manifest.manifestVersion !== 1) {
		throw new Error('wasm-cobol runtime manifest must declare manifestVersion 1');
	}
	const manifestAssets = [
		manifest.frontend?.asset,
		manifest.rootfs?.asset,
		manifest.cSysroot?.asset
	];
	if (
		manifestAssets.length !== ARCHIVE_FILES.length ||
		manifestAssets.some((asset, index) => asset !== ARCHIVE_FILES[index])
	) {
		throw new Error(`wasm-cobol runtime manifest must reference ${ARCHIVE_FILES.join(', ')}`);
	}
	if (
		manifest.profile?.name !== 'gnucobol-wasi-clang' ||
		manifest.profile?.version !== 1 ||
		manifest.profile?.backend !== 'wasm-llvm-clang'
	) {
		throw new Error('wasm-cobol runtime manifest contains an unsupported compiler profile');
	}

	const buildInfo = await readJson(path.join(sourceDir, 'runtime-build.json'), 'build metadata');
	if (
		!isObject(buildInfo) ||
		!isObject(buildInfo.toolchain) ||
		!Array.isArray(buildInfo.assets)
	) {
		throw new Error('wasm-cobol runtime-build.json is missing toolchain or asset metadata');
	}
	if (
		manifest.version !== buildInfo.toolchain.version ||
		manifest.profile.gnucobolVersion !== buildInfo.toolchain.gnucobolVersion ||
		manifest.profile.gmpVersion !== buildInfo.toolchain.gmpVersion ||
		manifest.profile.frontendTarget !== buildInfo.toolchain.frontendTarget ||
		manifest.profile.backend !== buildInfo.toolchain.backend
	) {
		throw new Error(
			'wasm-cobol runtime manifest does not match runtime-build.json toolchain metadata'
		);
	}

	const buildAssets = new Map();
	for (const entry of buildInfo.assets) {
		if (!isObject(entry) || typeof entry.asset !== 'string' || buildAssets.has(entry.asset)) {
			throw new Error(
				'wasm-cobol runtime-build.json contains invalid or duplicate asset metadata'
			);
		}
		buildAssets.set(entry.asset, entry);
	}
	if (
		buildAssets.size !== ARCHIVE_FILES.length ||
		ARCHIVE_FILES.some((filename) => !buildAssets.has(filename))
	) {
		throw new Error(
			'wasm-cobol runtime-build.json does not describe the complete runtime asset set'
		);
	}

	for (const filename of ARCHIVE_FILES) {
		const filePath = path.join(sourceDir, filename);
		const fileStats = await stat(filePath);
		const metadata = buildAssets.get(filename);
		if (
			typeof metadata.size !== 'number' ||
			typeof metadata.sha256 !== 'string' ||
			metadata.size !== fileStats.size ||
			metadata.sha256 !== (await sha256File(filePath))
		) {
			throw new Error(
				`wasm-cobol runtime asset ${filename} does not match runtime-build.json`
			);
		}
	}

	return { manifest, buildInfo };
}

/** @param {string} sourceDir @param {string} targetDir */
async function writeDeliveryBundle(sourceDir, targetDir) {
	const deliveryAssets = [];
	for (const asset of DELIVERY_ASSETS) {
		let entries;
		try {
			entries = unzipSync(await readFile(path.join(sourceDir, asset.source)));
		} catch (error) {
			throw new Error(
				`wasm-cobol runtime asset ${asset.source} could not be repackaged: ${error instanceof Error ? error.message : error}`
			);
		}
		const files = Object.entries(entries).filter(([entryName]) => !entryName.endsWith('/'));
		if (files.length !== 1 || files[0][0] !== asset.entry) {
			throw new Error(
				`wasm-cobol runtime asset ${asset.source} must contain only ${asset.entry}`
			);
		}
		const compressed = gzipSync(files[0][1], { level: 9, mtime: 0 });
		await writeFile(path.join(targetDir, asset.target), compressed);
		deliveryAssets.push({
			asset: asset.target,
			size: compressed.byteLength,
			sha256: sha256(compressed)
		});
	}

	const sourceManifest = await readJson(
		path.join(sourceDir, 'runtime-manifest.v1.json'),
		'runtime manifest'
	);
	const deliveryManifest = JSON.parse(JSON.stringify(sourceManifest));
	deliveryManifest.frontend.asset = DELIVERY_ASSETS[0].target;
	deliveryManifest.rootfs.asset = DELIVERY_ASSETS[1].target;
	deliveryManifest.cSysroot.asset = DELIVERY_ASSETS[2].target;
	await writeJson(path.join(targetDir, 'runtime-manifest.v1.json'), deliveryManifest);

	const sourceBuildInfo = await readJson(
		path.join(sourceDir, 'runtime-build.json'),
		'build metadata'
	);
	await writeJson(path.join(targetDir, 'runtime-build.json'), {
		...sourceBuildInfo,
		toolchain: {
			...sourceBuildInfo.toolchain,
			assets: Object.fromEntries(deliveryAssets.map((asset) => [asset.asset, asset.sha256]))
		},
		assets: deliveryAssets,
		delivery: {
			format: 'wasm-idle-cobol-native-gzip-v1',
			sourceAssets: sourceBuildInfo.assets
		}
	});
}

/** @param {string} targetDir */
async function validateDelivery(targetDir) {
	for (const filename of DELIVERY_FILES) {
		const fileStats = await stat(path.join(targetDir, filename)).catch(() => null);
		if (!fileStats?.isFile()) {
			throw new Error(`wasm-cobol delivery asset ${filename} was not found in ${targetDir}`);
		}
	}

	const manifest = await readJson(
		path.join(targetDir, 'runtime-manifest.v1.json'),
		'runtime manifest'
	);
	const manifestAssets = [
		manifest.frontend?.asset,
		manifest.rootfs?.asset,
		manifest.cSysroot?.asset
	];
	if (manifestAssets.some((asset, index) => asset !== DELIVERY_ASSETS[index].target)) {
		throw new Error('wasm-cobol delivery manifest does not reference the native gzip assets');
	}

	const buildInfo = await readJson(path.join(targetDir, 'runtime-build.json'), 'build metadata');
	if (
		!isObject(buildInfo) ||
		!isObject(buildInfo.toolchain) ||
		!Array.isArray(buildInfo.assets) ||
		buildInfo.delivery?.format !== 'wasm-idle-cobol-native-gzip-v1' ||
		!Array.isArray(buildInfo.delivery?.sourceAssets)
	) {
		throw new Error('wasm-cobol delivery build metadata is incomplete');
	}
	const buildAssets = new Map(buildInfo.assets.map((entry) => [entry?.asset, entry]));
	if (
		buildAssets.size !== DELIVERY_ASSETS.length ||
		DELIVERY_ASSETS.some((asset) => !buildAssets.has(asset.target))
	) {
		throw new Error('wasm-cobol delivery build metadata has an incomplete asset set');
	}

	for (const asset of DELIVERY_ASSETS) {
		const compressed = await readFile(path.join(targetDir, asset.target));
		const metadata = buildAssets.get(asset.target);
		if (
			!isObject(metadata) ||
			metadata.size !== compressed.byteLength ||
			metadata.sha256 !== sha256(compressed)
		) {
			throw new Error(`wasm-cobol delivery asset ${asset.target} does not match metadata`);
		}
		let contents;
		try {
			contents = gunzipSync(compressed);
		} catch (error) {
			throw new Error(
				`wasm-cobol delivery asset ${asset.target} is not valid gzip: ${error instanceof Error ? error.message : error}`
			);
		}
		if (
			(asset.kind === 'wasm' &&
				(contents.byteLength < 4 ||
					contents.subarray(0, 4).toString('hex') !== '0061736d')) ||
			(asset.kind === 'tar' &&
				(contents.byteLength < 265 ||
					!contents.subarray(257, 265).toString('ascii').startsWith('ustar')))
		) {
			throw new Error(`wasm-cobol delivery asset ${asset.target} has invalid contents`);
		}
	}
}

/** @param {{ sourceDir?: string; targetDir?: string }} [options] */
export async function syncWasmCobolAssets({ sourceDir, targetDir = DEFAULT_TARGET_DIR } = {}) {
	if (!sourceDir) {
		throw new Error('wasm-cobol sync requires an explicit source directory.');
	}
	const resolvedSourceDir = path.resolve(sourceDir);
	const resolvedTargetDir = path.resolve(targetDir);
	await validateSource(resolvedSourceDir);

	await mkdir(path.dirname(resolvedTargetDir), { recursive: true });
	const suffix = `${process.pid}-${randomUUID()}`;
	const nextTarget = `${resolvedTargetDir}.next-${suffix}`;
	const previousTarget = `${resolvedTargetDir}.previous-${suffix}`;
	await mkdir(nextTarget, { recursive: true });

	let hadPrevious = false;
	let installedNext = false;
	try {
		await writeDeliveryBundle(resolvedSourceDir, nextTarget);
		await validateDelivery(nextTarget);

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
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmCobolAssets({
		sourceDir: sourceDirArg,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-cobol from ${result.sourceDir} to ${result.targetDir}`);
}
