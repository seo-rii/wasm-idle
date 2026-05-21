import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(thisFile);
const projectRoot = path.resolve(scriptsDir, '..');
const distDir = path.join(projectRoot, 'dist');
const browserWasiShimSourceDir = path.join(
	projectRoot,
	'node_modules',
	'@bjorn3',
	'browser_wasi_shim',
	'dist'
);
const browserWasiShimTargetDir = path.join(distDir, 'vendor', 'browser_wasi_shim');
const BARE_SPECIFIER = '@bjorn3/browser_wasi_shim';

async function listFilesRecursive(rootDir) {
	const entries = [];

	async function walk(currentDir) {
		for (const entry of await readdir(currentDir, { withFileTypes: true })) {
			const absolutePath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				await walk(absolutePath);
				continue;
			}
			entries.push(absolutePath);
		}
	}

	await walk(rootDir);
	return entries.sort((left, right) => left.localeCompare(right));
}

async function copyBrowserWasiShim() {
	await mkdir(browserWasiShimTargetDir, { recursive: true });
	for (const sourcePath of await listFilesRecursive(browserWasiShimSourceDir)) {
		if (!sourcePath.endsWith('.js')) {
			continue;
		}
		const relativePath = path.relative(browserWasiShimSourceDir, sourcePath);
		const targetPath = path.join(browserWasiShimTargetDir, relativePath);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await cp(sourcePath, targetPath);
	}
}

async function rewriteBareImports() {
	for (const absolutePath of await listFilesRecursive(distDir)) {
		if (!absolutePath.endsWith('.js')) {
			continue;
		}
		const source = await readFile(absolutePath, 'utf8');
		if (!source.includes(BARE_SPECIFIER)) {
			continue;
		}
		const replacementPath = path
			.relative(path.dirname(absolutePath), path.join(browserWasiShimTargetDir, 'index.js'))
			.replace(/\\/g, '/');
		const normalizedReplacement = replacementPath.startsWith('.')
			? replacementPath
			: `./${replacementPath}`;
		const rewritten = source.replaceAll(BARE_SPECIFIER, normalizedReplacement);
		await writeFile(absolutePath, rewritten, 'utf8');
	}
}

await copyBrowserWasiShim();
await rewriteBareImports();
