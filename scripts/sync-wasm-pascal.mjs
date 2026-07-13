import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'runtimes', 'wasm-pascal', 'dist');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-pascal');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-pascal-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmPascalVersion.ts'
);

const REQUIRED_FILES = ['compiler.js', 'rtl.js', 'runtime-build.json', 'system.pas'];

async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

async function ensureDefaultSourceDir() {
	if (await fileExists(path.join(DEFAULT_SOURCE_DIR, 'compiler.js'))) return DEFAULT_SOURCE_DIR;
	const buildModule = await import(
		new URL('../runtimes/wasm-pascal/scripts/build.mjs', import.meta.url).href
	);
	await buildModule.buildWasmPascalRuntime();
	return DEFAULT_SOURCE_DIR;
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_PASCAL_ASSET_VERSION = '${fingerprint}';\n`;
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
		format: 'wasm-pascal-runtime-manifest-v1',
		runtime: 'pas2js',
		pas2jsVersion: buildInfo.pas2jsVersion,
		pas2jsCommit: buildInfo.pas2jsCommit,
		fingerprint,
		files: REQUIRED_FILES
	};
	await writeFile(
		path.join(targetDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

export async function syncWasmPascalAssets({
	sourceDir,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const resolvedSourceDir = sourceDir ? path.resolve(sourceDir) : await ensureDefaultSourceDir();
	for (const fileName of REQUIRED_FILES) {
		if (!(await fileExists(path.join(resolvedSourceDir, fileName)))) {
			throw new Error(`wasm-pascal asset ${fileName} was not found in ${resolvedSourceDir}.`);
		}
	}
	const compilerSource = await readFile(path.join(resolvedSourceDir, 'compiler.js'), 'utf8');
	if (!compilerSource.includes('__wasmIdlePascalCompiler')) {
		throw new Error('wasm-pascal compiler.js does not expose __wasmIdlePascalCompiler.');
	}
	const systemSource = await readFile(path.join(resolvedSourceDir, 'system.pas'), 'utf8');
	if (!/\bprocedure\s+ReadLn\b/i.test(systemSource)) {
		throw new Error('wasm-pascal system.pas does not provide ReadLn stdin bindings.');
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	const copiedFiles = [];
	for (const fileName of REQUIRED_FILES) {
		const sourcePath = path.join(resolvedSourceDir, fileName);
		const targetPath = path.join(targetDir, fileName);
		if (/\.(?:js|json|pas)$/u.test(fileName)) {
			const source = await readFile(sourcePath, 'utf8');
			await writeFile(
				targetPath,
				source.replace(/[ \t]+$/gmu, '').replace(/\n+$/u, '\n'),
				'utf8'
			);
		} else {
			await cp(sourcePath, targetPath);
		}
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
	const { sourceDir, targetDir } = await syncWasmPascalAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : undefined,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-pascal from ${sourceDir} to ${targetDir}`);
}
