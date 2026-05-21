import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const REQUIRED_FILES = ['bundle.avm', 'AtomVM.mjs', 'AtomVM.wasm'];

async function assertFile(filePath, message) {
	const fileStats = await stat(filePath).catch(() => null);
	if (!fileStats?.isFile()) throw new Error(message);
}

async function computeFingerprint(targetDir) {
	const hash = createHash('sha256');
	for (const fileName of REQUIRED_FILES) {
		hash.update(fileName);
		hash.update('\0');
		hash.update(await readFile(path.join(targetDir, fileName)));
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

async function writeVersionModule(versionModulePath, fingerprint) {
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	const moduleSource = `export const WASM_ELIXIR_ASSET_VERSION = ${JSON.stringify(fingerprint)};\n`;
	const current = await readFile(versionModulePath, 'utf8').catch(() => '');
	if (current === moduleSource) return;
	await writeFile(versionModulePath, moduleSource, 'utf8');
}

export async function syncWasmElixirDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR,
	popcornDistDir = DEFAULT_POPCORN_DIST_DIR,
	versionModulePath = DEFAULT_VERSION_MODULE_PATH
} = {}) {
	const bundlePath = path.join(sourceDir, 'bundle.avm');
	await assertFile(
		bundlePath,
		`Elixir AVM bundle was not found at ${bundlePath}. Build it first with "pnpm --dir runtimes/wasm-elixir run bundle".`
	);
	for (const fileName of ['AtomVM.mjs', 'AtomVM.wasm']) {
		await assertFile(
			path.join(popcornDistDir, fileName),
			`Popcorn runtime artifact was not found at ${path.join(popcornDistDir, fileName)}. Run "pnpm install" first.`
		);
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });
	await cp(bundlePath, path.join(targetDir, 'bundle.avm'));
	await cp(path.join(popcornDistDir, 'AtomVM.mjs'), path.join(targetDir, 'AtomVM.mjs'));
	await cp(path.join(popcornDistDir, 'AtomVM.wasm'), path.join(targetDir, 'AtomVM.wasm'));

	const fingerprint = await computeFingerprint(targetDir);
	await writeVersionModule(versionModulePath, fingerprint);

	return { sourceDir, targetDir, popcornDistDir, fingerprint, versionModulePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncWasmElixirDist({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced wasm-elixir from ${sourceDir} to ${targetDir}`);
}
