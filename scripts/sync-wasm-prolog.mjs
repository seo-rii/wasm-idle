import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'node_modules', 'swipl-wasm', 'dist', 'swipl');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-prolog');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-prolog-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmPrologVersion.ts'
);

const REQUIRED_FILES = ['swipl-web.js', 'swipl-web.wasm', 'swipl-web.data'];

async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_PROLOG_ASSET_VERSION = '${fingerprint}';\n`;
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

export async function syncWasmPrologAssets({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	for (const fileName of REQUIRED_FILES) {
		if (!(await fileExists(path.join(sourceDir, fileName)))) {
			throw new Error(
				`SWI-Prolog wasm asset ${fileName} was not found in ${sourceDir}. Run pnpm install first.`
			);
		}
	}
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	const copiedFiles = [];
	for (const fileName of REQUIRED_FILES) {
		await cp(path.join(sourceDir, fileName), path.join(targetDir, fileName));
		copiedFiles.push(fileName);
	}
	await cp(workerSourcePath, path.join(targetDir, 'runner-worker.js'));
	copiedFiles.push('runner-worker.js');
	const fingerprint = await computeFingerprint(targetDir, copiedFiles);
	await writeVersionModule(versionModulePath, fingerprint);
	return { sourceDir, targetDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmPrologAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-prolog from ${sourceDir} to ${targetDir}`);
}
