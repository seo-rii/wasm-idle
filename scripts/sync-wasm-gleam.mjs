import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
const DEFAULT_SOURCE_DIR = path.resolve(
	REPO_ROOT,
	'node_modules',
	'@live-codes',
	'gleam-precompiled'
);
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'wasm-gleam');
const DEFAULT_WORKER_SOURCE_PATH = path.resolve(
	REPO_ROOT,
	'scripts',
	'runtime-workers',
	'wasm-gleam-runner-worker.js'
);
const DEFAULT_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'src',
	'lib',
	'playground',
	'wasmGleamVersion.ts'
);

export const GLEAM_COMPILER_VERSION = 'v1.3.0';
const COMPILER_FILES = ['gleam_wasm.js', 'gleam_wasm_bg.wasm'];

function toPosixPath(filePath) {
	return filePath.split(path.sep).join('/');
}

async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

async function listFiles(rootDir, relativeDir = '') {
	const entries = await readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relativePath = path.join(relativeDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(rootDir, relativePath)));
			continue;
		}
		if (entry.isFile()) files.push(toPosixPath(relativePath));
	}
	return files.sort();
}

async function sha256File(filePath) {
	return createHash('sha256')
		.update(await readFile(filePath))
		.digest('hex');
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_GLEAM_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
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

async function writeSourceManifest(
	targetDir,
	stdlibSourceDir,
	stdlibFiles,
	fingerprint,
	javascriptFiles
) {
	const files = [];
	for (const fileName of stdlibFiles) {
		const filePath = path.join(stdlibSourceDir, fileName);
		const fileStats = await stat(filePath);
		files.push({
			path: fileName,
			size: fileStats.size,
			sha256: await sha256File(filePath)
		});
	}
	const manifest = {
		format: 'wasm-gleam-source-manifest-v1',
		compilerVersion: GLEAM_COMPILER_VERSION,
		fingerprint,
		files,
		javascriptFiles
	};
	await writeFile(
		path.join(targetDir, 'source-manifest.v1.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

export async function syncWasmGleamAssets({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const compilerSourceDir = path.join(sourceDir, 'compiler', GLEAM_COMPILER_VERSION);
	const stdlibSourceDir = path.join(sourceDir, 'build', 'packages', 'gleam_stdlib', 'src');
	const preludeSourcePath = path.join(sourceDir, 'build', 'dev', 'javascript', 'prelude.mjs');
	const precompiledStdlibJsDir = path.join(
		sourceDir,
		'build',
		'dev',
		'javascript',
		'gleam_stdlib'
	);
	for (const fileName of COMPILER_FILES) {
		if (!(await fileExists(path.join(compilerSourceDir, fileName)))) {
			throw new Error(
				`Gleam wasm compiler asset ${fileName} was not found in ${compilerSourceDir}. Run pnpm install first.`
			);
		}
	}
	const stdlibFiles = (await listFiles(stdlibSourceDir)).filter(
		(fileName) => fileName.endsWith('.gleam') || fileName.endsWith('.mjs')
	);
	if (!stdlibFiles.length) {
		throw new Error(`Gleam stdlib source files were not found in ${stdlibSourceDir}.`);
	}
	if (!(await fileExists(preludeSourcePath))) {
		throw new Error(`Gleam JavaScript prelude was not found at ${preludeSourcePath}.`);
	}
	const precompiledJsFiles = (await listFiles(precompiledStdlibJsDir)).filter((fileName) =>
		fileName.endsWith('.mjs')
	);
	if (!precompiledJsFiles.length) {
		throw new Error(
			`Gleam precompiled JavaScript files were not found in ${precompiledStdlibJsDir}.`
		);
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(path.join(targetDir, 'compiler'), { recursive: true });
	await mkdir(path.join(targetDir, 'src'), { recursive: true });
	await mkdir(path.join(targetDir, 'javascript'), { recursive: true });
	const copiedFiles = [];
	for (const fileName of COMPILER_FILES) {
		const targetFile = path.join('compiler', fileName);
		await cp(path.join(compilerSourceDir, fileName), path.join(targetDir, targetFile));
		copiedFiles.push(targetFile);
	}
	for (const fileName of stdlibFiles) {
		const targetFile = path.join('src', fileName);
		await mkdir(path.dirname(path.join(targetDir, targetFile)), { recursive: true });
		await cp(path.join(stdlibSourceDir, fileName), path.join(targetDir, targetFile));
		copiedFiles.push(targetFile);
	}
	await cp(preludeSourcePath, path.join(targetDir, 'javascript', 'gleam_prelude.mjs'));
	copiedFiles.push('javascript/gleam_prelude.mjs');
	for (const fileName of precompiledJsFiles) {
		const targetFile = path.join('javascript', fileName);
		await mkdir(path.dirname(path.join(targetDir, targetFile)), { recursive: true });
		await cp(path.join(precompiledStdlibJsDir, fileName), path.join(targetDir, targetFile));
		copiedFiles.push(targetFile);
	}
	await cp(workerSourcePath, path.join(targetDir, 'runner-worker.js'));
	copiedFiles.push('runner-worker.js');
	const fingerprint = await computeFingerprint(targetDir, copiedFiles);
	await writeSourceManifest(
		targetDir,
		stdlibSourceDir,
		stdlibFiles,
		fingerprint,
		[...precompiledJsFiles, 'gleam_prelude.mjs'].sort()
	);
	await writeVersionModule(versionModulePath, fingerprint);
	return { sourceDir, targetDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmGleamAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-gleam from ${sourceDir} to ${targetDir}`);
}
