import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const MANIFEST_FILE = 'runtime-manifest.v1.json';
export const PINNED_PACKAGE_NAMES = ['@php-wasm/web-8-4', '@php-wasm/universal', 'esbuild', 'vite'];
export const RUNTIME_PACKAGE_NAMES = ['@php-wasm/web-8-4', '@php-wasm/universal'];

/** @typedef {{ path: string; bytes: number; sha256: string }} RuntimeManifestFile */

/**
 * @param {string} rootDir
 * @param {string} [currentDir]
 * @returns {Promise<RuntimeManifestFile[]>}
 */
export async function collectRuntimeFiles(rootDir, currentDir = rootDir) {
	/** @type {RuntimeManifestFile[]} */
	const files = [];
	for (const entry of await readdir(currentDir, { withFileTypes: true })) {
		const entryPath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectRuntimeFiles(rootDir, entryPath)));
			continue;
		}
		if (!entry.isFile() || entry.name === MANIFEST_FILE) continue;

		const contents = await readFile(entryPath);
		files.push({
			path: path.relative(rootDir, entryPath).split(path.sep).join('/'),
			bytes: contents.byteLength,
			sha256: createHash('sha256').update(contents).digest('hex')
		});
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

/** @param {string} filePath @returns {Promise<any>} */
export async function readJson(filePath) {
	return JSON.parse(await readFile(filePath, 'utf8'));
}
