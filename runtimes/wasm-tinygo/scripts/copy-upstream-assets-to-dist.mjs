#!/usr/bin/env node

import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSourceDir = path.join(runtimeRoot, 'public', 'tools', 'upstream');
const defaultTargetDir = path.join(runtimeRoot, 'dist', 'tools', 'upstream');

export async function copyUpstreamAssetsToDist({
	sourceDir = defaultSourceDir,
	targetDir = defaultTargetDir
} = {}) {
	const sourceManifestPath = path.join(sourceDir, 'upstream-toolchain.v2.json');
	const sourceManifest = await stat(sourceManifestPath).catch(() => null);
	if (!sourceManifest?.isFile()) {
		throw new Error(`prepared upstream toolchain manifest was not found at ${sourceManifestPath}`);
	}
	const existingTarget = await stat(targetDir).catch(() => null);
	if (existingTarget) {
		throw new Error(`upstream dist destination already exists at ${targetDir}`);
	}
	await mkdir(path.dirname(targetDir), { recursive: true });
	await cp(sourceDir, targetDir, { recursive: true, force: false, errorOnExist: true });
	return { sourceDir, targetDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	copyUpstreamAssetsToDist()
		.then(({ targetDir }) => {
			process.stdout.write(`Copied verified upstream TinyGo assets to ${targetDir}\n`);
		})
		.catch((error) => {
			console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
			process.exitCode = 1;
		});
}
