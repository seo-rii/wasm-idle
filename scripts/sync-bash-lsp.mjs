import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Prepare original upstream Bash LSP code and parser assets with a frozen producer lockfile.
 * @param {{ targetDir?: string; install?: boolean }} [options]
 */
export async function syncBashLsp({
	targetDir = path.join(ROOT, 'static/wasm-bash-lsp'),
	install = true
} = {}) {
	if (install) {
		await new Promise((resolve, reject) => {
			const child = spawn('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], {
				cwd: path.join(ROOT, 'producers/bash-language-server'),
				stdio: 'inherit'
			});
			child.once('error', reject);
			child.once('exit', (code) =>
				code === 0
					? resolve(undefined)
					: reject(new Error(`Bash LSP producer install exited ${code}`))
			);
		});
	}
	const { buildBashLanguageServer } = await import('../producers/bash-language-server/build.mjs');
	return await buildBashLanguageServer({ targetDir });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	console.log(await syncBashLsp());
