import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * Verify the committed, source-built runtime before copying to another asset root.
 * @param {{ sourceDir?: string; targetDir?: string }} [options]
 */
export async function syncWasmWrenDist({
	sourceDir = path.join(root, 'static/wasm-wren'),
	targetDir = sourceDir
} = {}) {
	const lockBytes = await readFile(path.join(root, 'scripts/wasm-wren-assets.lock.json'));
	const lock = JSON.parse(lockBytes.toString('utf8'));
	const wasm = await readFile(path.join(sourceDir, 'wren.wasm'));
	const receipt = lock.assets['wren.wasm'];
	if (
		wasm.length !== receipt.bytes ||
		createHash('sha256').update(wasm).digest('hex') !== receipt.sha256
	) {
		throw new Error('Wren runtime asset receipt mismatch');
	}
	const build = await readFile(path.join(sourceDir, 'runtime-build.json'));
	if (!build.equals(lockBytes)) throw new Error('Wren runtime build receipt mismatch');
	const license = await readFile(path.join(root, 'runtimes/wasm-wren/vendor/LICENSE'));
	if (!(await readFile(path.join(sourceDir, 'LICENSE'))).equals(license))
		throw new Error('Wren license mismatch');
	if (path.resolve(sourceDir) !== path.resolve(targetDir)) {
		await mkdir(targetDir, { recursive: true });
		/** @type {[string, Buffer][]} */
		const files = [
			['wren.wasm', wasm],
			['runtime-build.json', build],
			['LICENSE', license]
		];
		for (const [name, bytes] of files) {
			await writeFile(path.join(targetDir, name), bytes);
		}
	}
	return { sourceDir, targetDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await syncWasmWrenDist();
	console.log('Verified upstream Wren 0.4.0 runtime assets');
}
