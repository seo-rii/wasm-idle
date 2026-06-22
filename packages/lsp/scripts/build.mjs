import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const typescriptLibDir = path.resolve(packageRoot, 'node_modules', 'typescript', 'lib');
const typescriptOutputDir = path.resolve(packageRoot, 'dist', 'typescript');
const pythonSourceDir = path.resolve(packageRoot, 'src', 'python', 'package');
const pythonOutputDir = path.resolve(packageRoot, 'dist', 'python', 'package');
const duckdbDistDir = path.resolve(packageRoot, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const sqlOutputDir = path.resolve(packageRoot, 'dist', 'sql');

await mkdir(typescriptOutputDir, { recursive: true });
const libraryFiles = (await readdir(typescriptLibDir))
	.filter((fileName) => /^lib\..+\.d\.ts$/u.test(fileName))
	.sort();
const libraries = Object.fromEntries(
	await Promise.all(
		libraryFiles.map(async (fileName) => [
			fileName,
			await readFile(path.join(typescriptLibDir, fileName), 'utf8')
		])
	)
);
const typescriptLibrariesJson = JSON.stringify(libraries);
await writeFile(
	path.join(typescriptOutputDir, 'typescript-libs.json.gz'),
	gzipSync(typescriptLibrariesJson, { level: 9, mtime: 0 })
);
await rm(path.join(typescriptOutputDir, 'typescript-libs.json'), { force: true });

await mkdir(path.dirname(pythonOutputDir), { recursive: true });
await cp(pythonSourceDir, pythonOutputDir, { recursive: true });

await mkdir(sqlOutputDir, { recursive: true });
await Promise.all(
	['duckdb-mvp.wasm', 'duckdb-browser-mvp.worker.js'].map((fileName) =>
		cp(path.join(duckdbDistDir, fileName), path.join(sqlOutputDir, fileName))
	)
);
