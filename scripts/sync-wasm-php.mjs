import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	STATIC_RUNTIME_MANIFEST_FILE,
	validateStaticRuntimeManifest
} from './static-runtime-manifest.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_SOURCE_DIR = process.env.WASM_IDLE_WASM_PHP_DIST
	? path.resolve(REPO_ROOT, process.env.WASM_IDLE_WASM_PHP_DIST)
	: path.join(REPO_ROOT, 'producers', 'wasm-php', 'dist');
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, 'static', 'wasm-php');

export const PHP_RUNTIME_PACKAGES = Object.freeze({
	'@php-wasm/web-8-4': '3.1.34',
	'@php-wasm/universal': '3.1.34'
});

/**
 * @param {string} runtimeDir
 * @param {{ allowCompressed?: boolean }} [options]
 */
export function validatePhpRuntimeAssets(runtimeDir, { allowCompressed = false } = {}) {
	return validateStaticRuntimeManifest(runtimeDir, {
		allowCompressed,
		expectedPackages: PHP_RUNTIME_PACKAGES,
		expectedRuntimeModule: 'runtime.mjs'
	});
}

/**
 * @param {{ sourceDir?: string; targetDir?: string }} [options]
 */
export async function syncWasmPhpAssets({
	sourceDir = DEFAULT_SOURCE_DIR,
	targetDir = DEFAULT_TARGET_DIR
} = {}) {
	const sourceStats = await stat(sourceDir).catch(() => null);
	if (!sourceStats?.isDirectory()) {
		throw new Error(
			`wasm-php producer output was not found at ${sourceDir}. Build it with "pnpm --dir producers/wasm-php build" first.`
		);
	}
	const manifest = await validatePhpRuntimeAssets(sourceDir);
	const nextTarget = `${targetDir}.next-${process.pid}`;
	const previousTarget = `${targetDir}.previous-${process.pid}`;
	await mkdir(path.dirname(targetDir), { recursive: true });
	await rm(nextTarget, { recursive: true, force: true });
	await rm(previousTarget, { recursive: true, force: true });
	await mkdir(nextTarget, { recursive: true });

	try {
		await writeFile(
			path.join(nextTarget, STATIC_RUNTIME_MANIFEST_FILE),
			await readFile(path.join(sourceDir, STATIC_RUNTIME_MANIFEST_FILE))
		);
		for (const file of manifest.files) {
			const targetPath = path.join(nextTarget, ...file.path.split('/'));
			await mkdir(path.dirname(targetPath), { recursive: true });
			await cp(path.join(sourceDir, ...file.path.split('/')), targetPath);
		}
		await validatePhpRuntimeAssets(nextTarget);

		let hadPrevious = false;
		try {
			if ((await stat(targetDir).catch(() => null))?.isDirectory()) {
				await rename(targetDir, previousTarget);
				hadPrevious = true;
			}
			await rename(nextTarget, targetDir);
		} catch (error) {
			if (hadPrevious) await rename(previousTarget, targetDir).catch(() => {});
			throw error;
		}
		if (hadPrevious) {
			await rm(previousTarget, { recursive: true, force: true }).catch((error) => {
				console.warn(`Unable to remove the previous wasm-php asset tree: ${error}`);
			});
		}
	} finally {
		await rm(nextTarget, { recursive: true, force: true });
	}

	return { sourceDir, targetDir, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, targetDirArg] = process.argv;
	const result = await syncWasmPhpAssets({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : DEFAULT_SOURCE_DIR,
		targetDir: targetDirArg ? path.resolve(targetDirArg) : DEFAULT_TARGET_DIR
	});
	console.log(`Synced wasm-php from ${result.sourceDir} to ${result.targetDir}`);
}
