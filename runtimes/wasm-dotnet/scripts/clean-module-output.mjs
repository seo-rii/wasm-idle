import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutputDir = resolve(root, 'dist');

export async function cleanModuleOutput({ outputDir = defaultOutputDir } = {}) {
	await mkdir(outputDir, { recursive: true });
	for (const entry of await readdir(outputDir, { withFileTypes: true })) {
		if (entry.name === 'runtime' && entry.isDirectory()) continue;
		await rm(resolve(outputDir, entry.name), { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await cleanModuleOutput();
}
