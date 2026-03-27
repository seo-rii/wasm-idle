import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_SOURCE_DIR = path.resolve(REPO_ROOT, 'node_modules', 'pyodide');
const DEFAULT_TARGET_DIR = path.resolve(REPO_ROOT, 'static', 'pyodide');

const PYODIDE_CORE_ASSETS = [
	'ffi.d.ts',
	'package.json',
	'pyodide-lock.json',
	'pyodide.asm.js',
	'pyodide.asm.wasm',
	'pyodide.d.ts',
	'pyodide.js',
	'pyodide.mjs',
	'python_stdlib.zip'
];

/**
 * @param {{ sourceDir?: string; targetDir?: string }} [options]
 */
export async function syncPyodidePackage({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(`Pyodide package directory was not found at ${sourceDir}.`);
	}

	for (const asset of PYODIDE_CORE_ASSETS) {
		const assetStats = await stat(path.join(sourceDir, asset)).catch(() => null);
		if (!assetStats?.isFile()) {
			throw new Error(`Required Pyodide asset was not found at ${path.join(sourceDir, asset)}.`);
		}
	}

	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });

	for (const asset of PYODIDE_CORE_ASSETS) {
		await cp(path.join(sourceDir, asset), path.join(targetDir, asset));
	}

	return {
		sourceDir,
		targetDir,
		assets: [...PYODIDE_CORE_ASSETS]
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const { sourceDir, targetDir } = await syncPyodidePackage({
		sourceDir: sourceDirArg || DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg || DEFAULT_TARGET_DIR
	});

	console.log(`Synced pyodide from ${sourceDir} to ${targetDir}`);
}
