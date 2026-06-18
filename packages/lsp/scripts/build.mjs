import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const typescriptLibDir = path.resolve(packageRoot, 'node_modules', 'typescript', 'lib');
const typescriptOutputDir = path.resolve(packageRoot, 'dist', 'typescript');
const pythonSourceDir = path.resolve(packageRoot, 'src', 'python', 'package');
const pythonOutputDir = path.resolve(packageRoot, 'dist', 'python', 'package');

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
await writeFile(
	path.join(typescriptOutputDir, 'typescript-libs.json'),
	JSON.stringify(libraries)
);

await mkdir(path.dirname(pythonOutputDir), { recursive: true });
await cp(pythonSourceDir, pythonOutputDir, { recursive: true });
