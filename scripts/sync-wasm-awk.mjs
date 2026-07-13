import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-awk', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-awk');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-awk-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmAwkVersion.ts'
);

const REQUIRED_FILES = ['goawk.wasm', 'runtime-build.json', 'wasm_exec.js'];

async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

async function assertWasmFile(filePath) {
	const data = await readFile(filePath);
	if (
		data.byteLength < 8 ||
		data[0] !== 0x00 ||
		data[1] !== 0x61 ||
		data[2] !== 0x73 ||
		data[3] !== 0x6d
	) {
		throw new Error(`${filePath} is not a valid WebAssembly binary.`);
	}
}

async function buildDefaultSourceDir() {
	const buildModule = await import(
		new URL('../runtimes/wasm-awk/scripts/build.mjs', import.meta.url).href
	);
	await buildModule.buildWasmAwkRuntime();
	return DEFAULT_SOURCE_DIR;
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_AWK_ASSET_VERSION = '${fingerprint}';\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current !== moduleSource) await writeFile(versionModulePath, moduleSource, 'utf8');
}

async function computeFingerprint(targetDir, files) {
	const hash = createHash('sha256');
	for (const fileName of files.sort()) {
		hash.update(fileName);
		hash.update('\0');
		hash.update(await readFile(path.join(targetDir, fileName)));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

async function writeRuntimeManifest(targetDir, sourceDir, fingerprint) {
	const buildInfo = JSON.parse(
		await readFile(path.join(sourceDir, 'runtime-build.json'), 'utf8')
	);
	const manifest = {
		format: 'wasm-awk-runtime-manifest-v1',
		runtime: 'GoAWK',
		goVersion: buildInfo.goVersion,
		goawkVersion: buildInfo.goawkVersion,
		fingerprint,
		files: REQUIRED_FILES
	};
	await writeFile(
		path.join(targetDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

export async function syncWasmAwkAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const resolvedSourceDir = sourceDir || (await buildDefaultSourceDir());
	for (const fileName of REQUIRED_FILES) {
		if (!(await fileExists(path.join(resolvedSourceDir, fileName)))) {
			throw new Error(`wasm-awk asset ${fileName} was not found in ${resolvedSourceDir}.`);
		}
	}
	await assertWasmFile(path.join(resolvedSourceDir, 'goawk.wasm'));
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	const copiedFiles = [];
	for (const fileName of REQUIRED_FILES) {
		await cp(path.join(resolvedSourceDir, fileName), path.join(targetDir, fileName));
		copiedFiles.push(fileName);
	}
	await cp(workerSourcePath, path.join(targetDir, 'runner-worker.js'));
	copiedFiles.push('runner-worker.js');
	const fingerprint = await computeFingerprint(targetDir, copiedFiles);
	await writeRuntimeManifest(targetDir, resolvedSourceDir, fingerprint);
	await writeVersionModule(versionModulePath, fingerprint);
	return { sourceDir: resolvedSourceDir, targetDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmAwkAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-awk from ${sourceDir} to ${targetDir}`);
}
