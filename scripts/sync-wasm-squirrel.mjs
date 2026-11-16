import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SQUIRREL_PROFILE } from '../src/lib/playground/squirrelProfile.ts';

const root = new URL('../', import.meta.url);

export async function syncWasmSquirrelAssets(options = {}) {
	if (Object.keys(options).length)
		throw new Error(
			'Squirrel verifies committed assets; source and target overrides are unavailable.'
		);
	const lock = JSON.parse(
		await readFile(new URL('scripts/wasm-squirrel-assets.lock.json', root), 'utf8')
	);
	const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
	for (const [file, expected] of [
		[lock.source.path, lock.source.sha256],
		...lock.patches.map((patch) => [patch.path, patch.sha256]),
		['runtimes/wasm-squirrel/runner.cpp', lock.runnerSha256],
		['static/wasm-squirrel/squirrel.wasm', lock.wasm.sha256]
	]) {
		if (digest(await readFile(new URL(file, root))) !== expected) {
			throw new Error(`Squirrel asset mismatch: ${file}. Run build:wasm-squirrel.`);
		}
	}
	if (
		SQUIRREL_PROFILE.sha256 !== lock.wasm.sha256 ||
		SQUIRREL_PROFILE.bytes !== lock.wasm.bytes
	) {
		throw new Error('Squirrel generated profile does not match its runtime receipt.');
	}
	const receipt = JSON.parse(
		await readFile(new URL('static/wasm-squirrel/runtime-build.json', root), 'utf8')
	);
	if (JSON.stringify(receipt) !== JSON.stringify(lock))
		throw new Error('Squirrel build receipt is stale.');
	console.log(
		`Verified Squirrel 3.2 assets in ${fileURLToPath(new URL('static/wasm-squirrel/', root))}`
	);
	return {
		sourceDir: fileURLToPath(new URL('runtimes/wasm-squirrel/', root)),
		targetDir: fileURLToPath(new URL('static/wasm-squirrel/', root))
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await syncWasmSquirrelAssets();
}
