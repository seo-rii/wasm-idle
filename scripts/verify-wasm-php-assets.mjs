import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePhpRuntimeAssets } from './sync-wasm-php.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_PRODUCER_DIR = path.join(REPO_ROOT, 'producers', 'wasm-php', 'dist');
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, 'static', 'wasm-php');

/** @param {{ producerDir?: string; staticDir?: string }} [options] */
export async function verifyWasmPhpProducerAssets({
	producerDir = DEFAULT_PRODUCER_DIR,
	staticDir = DEFAULT_STATIC_DIR
} = {}) {
	const [producerManifest, staticManifest] = await Promise.all([
		validatePhpRuntimeAssets(producerDir),
		validatePhpRuntimeAssets(staticDir, { allowCompressed: true })
	]);
	assert.deepEqual(
		staticManifest,
		producerManifest,
		'checked-in wasm-php assets do not match the standalone producer output'
	);
	return { producerDir, staticDir, manifest: producerManifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , producerDirArg, staticDirArg] = process.argv;
	const result = await verifyWasmPhpProducerAssets({
		producerDir: producerDirArg ? path.resolve(producerDirArg) : DEFAULT_PRODUCER_DIR,
		staticDir: staticDirArg ? path.resolve(staticDirArg) : DEFAULT_STATIC_DIR
	});
	console.log(
		`Verified ${result.manifest.files.length} checked-in wasm-php assets against ${result.producerDir}`
	);
}
