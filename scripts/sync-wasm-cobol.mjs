import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, 'static', 'wasm-cobol');

const ARCHIVE_FILES = ['cobc.zip', 'rootfs.tar.zip', 'c-sysroot.tar.zip'];
const REQUIRED_FILES = ['runtime-manifest.v1.json', ...ARCHIVE_FILES, 'runtime-build.json'];

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
		for (const filename of REQUIRED_FILES) {
			await cp(path.join(resolvedSourceDir, filename), path.join(nextTarget, filename));
		}
		await validateSource(nextTarget);

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
