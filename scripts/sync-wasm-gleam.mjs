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
const DEFAULT_LSP_VERSION_MODULE_PATH = path.resolve(
	REPO_ROOT,
	'packages',
	'lsp',
	'src',
	'bundledGleamRuntime.ts'
);

export const GLEAM_COMPILER_VERSION = 'v1.3.0';
export const GLEAM_MANIFEST_FORMAT = 'wasm-gleam-runtime-manifest-v2';
const COMPILER_FILES = ['gleam_wasm.js', 'gleam_wasm_bg.wasm'];
const FINGERPRINT_DOMAIN = 'wasm-idle:gleam-runtime-manifest:v2';

function compareCodeUnits(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function requireAssetPath(fileName) {
	if (
		typeof fileName !== 'string' ||
		!fileName ||
		fileName.length > 512 ||
		!/^[A-Za-z0-9._/-]+$/u.test(fileName) ||
		fileName.startsWith('/') ||
		fileName
			.split('/')
			.some((part) => !part || part === '.' || part === '..' || part.length > 128)
	) {
		throw new Error(`Gleam runtime asset path is invalid: ${fileName}`);
	}
	return fileName;
}

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
	return files.sort(compareCodeUnits);
}

async function sha256File(filePath) {
	return createHash('sha256')
		.update(await readFile(filePath))
		.digest('hex');
}

async function writeVersionModule(versionModulePath, fingerprint, runnerReceipt) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_GLEAM_ASSET_VERSION =\n\t'${fingerprint}';\nexport const WASM_GLEAM_RUNNER_RECEIPT = {\n\tbytes: ${runnerReceipt.bytes},\n\tsha256: '${runnerReceipt.sha256}'\n} as const;\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current !== moduleSource) await writeFile(versionModulePath, moduleSource, 'utf8');
}

async function createAssetReceipts(targetDir, files) {
	const receipts = [];
	for (const fileName of files.sort(compareCodeUnits)) {
		requireAssetPath(fileName);
		const bytes = await readFile(path.join(targetDir, fileName));
		receipts.push({
			path: fileName,
			size: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex')
		});
	}
	return receipts;
}

function computeFingerprint(receipts) {
	const hash = createHash('sha256');
	hash.update(`${FINGERPRINT_DOMAIN}\n`);
	hash.update(`format\0${GLEAM_MANIFEST_FORMAT}\n`);
	hash.update(`compilerVersion\0${GLEAM_COMPILER_VERSION}\n`);
	for (const receipt of receipts) {
		hash.update(receipt.path);
		hash.update('\0');
		hash.update(String(receipt.size));
		hash.update('\0');
		hash.update(receipt.sha256);
		hash.update('\n');
	}
	return hash.digest('hex');
}

async function writeSourceManifest(
	targetDir,
	stdlibSourceDir,
	stdlibFiles,
	fingerprint,
	javascriptFiles,
	assets
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
		format: GLEAM_MANIFEST_FORMAT,
		compilerVersion: GLEAM_COMPILER_VERSION,
		fingerprint,
		assets,
		files,
		javascriptFiles
	};
	await writeFile(
		path.join(targetDir, 'source-manifest.v2.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf8'
	);
}

export async function syncWasmGleamAssets({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	workerSourcePath = DEFAULT_WORKER_SOURCE_PATH,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH,
	lspVersionModulePath = DEFAULT_LSP_VERSION_MODULE_PATH
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
	const assets = await createAssetReceipts(
		targetDir,
		copiedFiles.filter((fileName) => fileName !== 'runner-worker.js')
	);
	const [runnerReceipt] = await createAssetReceipts(targetDir, ['runner-worker.js']);
	const fingerprint = computeFingerprint(assets);
	await writeSourceManifest(
		targetDir,
		stdlibSourceDir,
		stdlibFiles,
		fingerprint,
		[...precompiledJsFiles, 'gleam_prelude.mjs'].sort(compareCodeUnits),
		assets
	);
	await writeVersionModule(versionModulePath, fingerprint, {
		bytes: runnerReceipt.size,
		sha256: runnerReceipt.sha256
	});
	await mkdir(path.dirname(lspVersionModulePath), { recursive: true });
	const lspModuleSource = `export const BUNDLED_GLEAM_MANIFEST_FINGERPRINT =\n\t'${fingerprint}';\n`;
	const currentLspModule = await readFile(lspVersionModulePath, 'utf8').catch(() => '');
	if (currentLspModule !== lspModuleSource) {
		await writeFile(lspVersionModulePath, lspModuleSource, 'utf8');
	}
	return { sourceDir, targetDir, fingerprint, versionModulePath, lspVersionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmGleamAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-gleam from ${sourceDir} to ${targetDir}`);
}
