import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_SOURCE_DIR = path.join(REPO_ROOT, 'runtimes', 'wasm-bash', 'dist');
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, 'static', 'wasm-bash');
const DEFAULT_VERSION_MODULE_PATH = path.join(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmBashVersion.ts'
);
const REQUIRED_FILES = ['LICENSE.txt', 'bash.webc', 'runtime-build.json'];
const SOURCE_REVISION = 'fc8096485478055f4fcf31402004fdd8ff6b72b7';

/**
 * @typedef {{
 *   package: string;
 *   packageVersion: string;
 *   sourceRevision: string;
 *   webcBytes: number;
 *   webcSha256: string;
 *   licenseSha256: string;
 * }} BashRuntimeMetadata
 */

/**
 * @typedef {{
 *   sourceDir?: string;
 *   targetDir?: string;
 *   versionModulePath?: string;
 *   copyAsset?: typeof cp;
 * }} SyncWasmBashOptions
 */

/** @param {string} filePath */
async function sha256File(filePath) {
	const bytes = await readFile(filePath);
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {string} sourceDir */
async function validateSource(sourceDir) {
	for (const filename of REQUIRED_FILES) {
		const filePath = path.join(sourceDir, filename);
		const fileStats = await stat(filePath).catch(() => null);
		if (!fileStats?.isFile()) {
			throw new Error(`wasm-bash asset ${filename} was not found in ${sourceDir}`);
		}
	}
	const metadata = /** @type {BashRuntimeMetadata} */ (
		JSON.parse(await readFile(path.join(sourceDir, 'runtime-build.json'), 'utf8'))
	);
	if (metadata.sourceRevision !== SOURCE_REVISION) {
		throw new Error(
			`wasm-bash source revision mismatch: expected ${SOURCE_REVISION}, received ${metadata.sourceRevision}`
		);
	}
	const webcPath = path.join(sourceDir, 'bash.webc');
	const webcStats = await stat(webcPath);
	const webcSha256 = await sha256File(webcPath);
	if (metadata.webcSha256 !== webcSha256 || metadata.webcBytes !== webcStats.size) {
		throw new Error('wasm-bash WEBc does not match runtime-build.json');
	}
	const licenseSha256 = await sha256File(path.join(sourceDir, 'LICENSE.txt'));
	if (metadata.licenseSha256 !== licenseSha256) {
		throw new Error('wasm-bash license does not match runtime-build.json');
	}
	return metadata;
}

/** @param {string} directory */
async function computeFingerprint(directory) {
	const hash = createHash('sha256');
	for (const filename of [...REQUIRED_FILES].sort()) {
		hash.update(filename);
		hash.update('\0');
		hash.update(await readFile(path.join(directory, filename)));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

/** @param {SyncWasmBashOptions} [options] */
export async function syncWasmBashAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	copyAsset = cp
} = {}) {
	let resolvedSourceDir = sourceDir;
	if (!resolvedSourceDir) {
		const sourceStats = await stat(DEFAULT_SOURCE_DIR).catch(() => null);
		if (!sourceStats?.isDirectory()) {
			const producerModulePath = '../runtimes/wasm-bash/scripts/prepare-runtime.mjs';
			const { prepareBashRuntime } = await import(producerModulePath);
			await prepareBashRuntime();
		}
		resolvedSourceDir = DEFAULT_SOURCE_DIR;
	}
	await validateSource(resolvedSourceDir);

	const nextTarget = `${targetDir}.next-${process.pid}`;
	const previousTarget = `${targetDir}.previous-${process.pid}`;
	await rm(nextTarget, { recursive: true, force: true });
	await rm(previousTarget, { recursive: true, force: true });
	await mkdir(nextTarget, { recursive: true });
	for (const filename of REQUIRED_FILES) {
		await copyAsset(path.join(resolvedSourceDir, filename), path.join(nextTarget, filename));
	}
	const metadata = await validateSource(nextTarget);
	const fingerprint = await computeFingerprint(nextTarget);
	await writeFile(
		path.join(nextTarget, 'runtime-manifest.v1.json'),
		`${JSON.stringify(
			{
				format: 'wasm-bash-runtime-manifest-v1',
				runtime: 'GNU Bash',
				package: metadata.package,
				packageVersion: metadata.packageVersion,
				sourceRevision: metadata.sourceRevision,
				fingerprint,
				files: REQUIRED_FILES
			},
			null,
			2
		)}\n`,
		'utf8'
	);
	let hadPrevious = false;
	try {
		const targetStats = await stat(targetDir).catch(() => null);
		if (targetStats) {
			await rename(targetDir, previousTarget);
			hadPrevious = true;
		}
		await rename(nextTarget, targetDir);
		await rm(previousTarget, { recursive: true, force: true });
	} catch (error) {
		if (hadPrevious) await rename(previousTarget, targetDir).catch(() => {});
		throw error;
	} finally {
		await rm(nextTarget, { recursive: true, force: true });
	}

	const versionSource = `export const WASM_BASH_ASSET_VERSION = '${fingerprint}';

export const WASM_BASH_WEBC_RECEIPT = Object.freeze({
\tbytes: ${metadata.webcBytes},
\tsha256: '${metadata.webcSha256}'
});
`;
	const currentVersionSource = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (currentVersionSource !== versionSource) {
		await mkdir(path.dirname(versionModulePath), { recursive: true });
		await writeFile(versionModulePath, versionSource, 'utf8');
	}
	return {
		sourceDir: resolvedSourceDir,
		targetDir,
		versionModulePath,
		fingerprint,
		webcReceipt: Object.freeze({
			bytes: metadata.webcBytes,
			sha256: metadata.webcSha256
		})
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmBashAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-bash from ${result.sourceDir} to ${result.targetDir}`);
}
