import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preparePinnedAssets } from './prepare-pinned-assets.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LOCK_PATH = new URL('./postgresql-lsp-assets.lock.json', import.meta.url);

/** Download the original npm release files without rewriting or bundling the server.
 * @param {{ targetDir?: string; fetchImpl?: typeof fetch }} [options]
 */
export async function syncPostgresqlLsp({
	targetDir = path.join(ROOT, 'static/wasm-postgresql-lsp'),
	fetchImpl = fetch
} = {}) {
	const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'));
	const result = await preparePinnedAssets({
		assets: lock.assets,
		targetRoot: targetDir,
		sourceBaseUrl: lock.sourceBaseUrl,
		label: 'PostgreSQL LSP',
		userAgent: 'wasm-idle-postgresql-lsp',
		fetchImpl
	});
	const licenseUrl = new URL(lock.license.url);
	const license = await preparePinnedAssets({
		assets: [
			{
				sourcePath: path.posix.basename(licenseUrl.pathname),
				targetPath: 'LICENSE',
				size: lock.license.size,
				sha256: lock.license.sha256
			}
		],
		targetRoot: targetDir,
		sourceBaseUrl: new URL('./', licenseUrl).href,
		label: 'PostgreSQL LSP license',
		userAgent: 'wasm-idle-postgresql-lsp',
		fetchImpl
	});
	return {
		version: lock.version,
		downloaded: result.downloaded + license.downloaded,
		reused: result.reused + license.reused
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(await syncPostgresqlLsp());
}
