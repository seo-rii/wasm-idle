import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-clojurescript', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-clojurescript');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-clojurescript-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmClojureScriptVersion.ts'
);
const REQUIRED_FILES = ['compiler.js', 'LICENSE.txt', 'runtime-build.json'];

/** @param {string} filePath */
async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

async function ensureDefaultSourceDir() {
	if (await fileExists(path.join(DEFAULT_SOURCE_DIR, 'compiler.js'))) return DEFAULT_SOURCE_DIR;
	const buildModule = await import(
		new URL('../runtimes/wasm-clojurescript/scripts/prepare-runtime.mjs', import.meta.url).href
	);
	await buildModule.prepareClojureScriptRuntime();
	return DEFAULT_SOURCE_DIR;
}

/**
 * @param {string} targetDir
 * @param {string[]} files
 */
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

/**
 * @param {string} versionModulePath
 * @param {string} fingerprint
 */
async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const source = `export const WASM_CLOJURESCRIPT_ASSET_VERSION = '${fingerprint}';\n`;
	if ((await readFile(versionModulePath, 'utf8').catch(() => '')) !== source) {
		await writeFile(versionModulePath, source, 'utf8');
	}
}

/**
 * @param {string} targetDir
 * @param {string} sourceDir
 * @param {string} fingerprint
 * @param {string[]} files
 */
async function writeRuntimeManifest(targetDir, sourceDir, fingerprint, files) {
	const buildInfo = JSON.parse(
		await readFile(path.join(sourceDir, 'runtime-build.json'), 'utf8')
	);
	const manifest = {
		format: 'wasm-clojurescript-runtime-manifest-v1',
		runtime: 'cljs.js',
		clojureScriptVersion: buildInfo.clojureScriptVersion,
		compilerSha256: buildInfo.compilerSha256,
		fingerprint,
		files
	};
	await writeFile(
		path.join(targetDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

/**
 * @param {{
 *   sourceDir?: string;
 *   targetDir?: string;
 *   workerSourcePath?: string;
 *   versionModulePath?: string;
 * }} [options]
 */
export async function syncWasmClojureScriptAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const resolvedSourceDir = sourceDir ? path.resolve(sourceDir) : await ensureDefaultSourceDir();
	for (const fileName of REQUIRED_FILES) {
		if (!(await fileExists(path.join(resolvedSourceDir, fileName)))) {
			throw new Error(
				`wasm-clojurescript asset ${fileName} was not found in ${resolvedSourceDir}.`
			);
		}
	}
	const compilerSource = await readFile(path.join(resolvedSourceDir, 'compiler.js'), 'utf8');
	if (!compilerSource.includes('wasm_idle.runner.execute')) {
		throw new Error('wasm-clojurescript compiler.js does not export wasm_idle.runner.execute.');
	}
	if (compilerSource.includes('clojure.browser.repl')) {
		throw new Error('wasm-clojurescript compiler.js contains the browser REPL preload.');
	}

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
	await writeRuntimeManifest(targetDir, resolvedSourceDir, fingerprint, copiedFiles);
	await writeVersionModule(versionModulePath, fingerprint);
	return { sourceDir: resolvedSourceDir, targetDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmClojureScriptAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-clojurescript from ${result.sourceDir} to ${result.targetDir}`);
}
