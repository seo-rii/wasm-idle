import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function syncWasmBashAssets() {
	await execFileAsync(
		process.execPath,
		[path.resolve(repoRoot, 'runtimes/wasm-bash/scripts/sync-runtime.mjs')],
		{ cwd: repoRoot, maxBuffer: 8 * 1024 * 1024 }
	);
	return {
		sourceDir: path.resolve(repoRoot, 'runtimes/wasm-bash'),
		targetDir: path.resolve(repoRoot, 'static/wasm-bash')
	};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	await syncWasmBashAssets();
}
