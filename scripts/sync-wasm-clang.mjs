import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const require = createRequire(import.meta.url);
const DEFAULT_SOURCE_DIR = path.dirname(
	require.resolve('@seo-rii/wasm-llvm/runtime/clang/assets/runtime-manifest.v1.json')
);
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, 'static');

const ASSETS = [
	['runtime-manifest.v1.json', 'clang/runtime-manifest.v1.json'],
	['bin/clang.zip', 'clang/bin/clang.zip'],
	['bin/lld.zip', 'clang/bin/lld.zip'],
	['bin/memfs.zip', 'clang/bin/memfs.zip'],
	['bin/sysroot.tar.zip', 'clang/bin/sysroot.tar.zip'],
	['clangd/clangd.js', 'clangd/clangd.js'],
	['clangd/clangd.wasm.gz', 'clangd/clangd.wasm.gz']
];

export async function syncWasmClangDist({
	sourceDir = DEFAULT_SOURCE_DIR,
	staticDir = DEFAULT_STATIC_DIR
} = {}) {
	for (const [source] of ASSETS) {
		const sourcePath = path.join(sourceDir, source);
		const sourceStats = await stat(sourcePath).catch(() => null);
		if (!sourceStats?.isFile()) {
			throw new Error(
				`wasm-llvm Clang runtime asset was not found at ${sourcePath}. Reinstall @seo-rii/wasm-llvm before syncing.`
			);
		}
	}

	const clangBinDir = path.join(staticDir, 'clang', 'bin');
	const clangManifestPath = path.join(staticDir, 'clang', 'runtime-manifest.v1.json');
	const clangdDir = path.join(staticDir, 'clangd');
	await rm(clangBinDir, { recursive: true, force: true });
	await rm(clangManifestPath, { force: true });
	await rm(clangdDir, { recursive: true, force: true });

	for (const [source, target] of ASSETS) {
		const targetPath = path.join(staticDir, target);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await cp(path.join(sourceDir, source), targetPath);
	}

	return { sourceDir, staticDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const [, , sourceDirArg, staticDirArg] = process.argv;
	const result = await syncWasmClangDist({
		sourceDir: sourceDirArg ? path.resolve(sourceDirArg) : DEFAULT_SOURCE_DIR,
		staticDir: staticDirArg ? path.resolve(staticDirArg) : DEFAULT_STATIC_DIR
	});
	console.log(`Synced wasm-llvm Clang assets from ${result.sourceDir} to ${result.staticDir}`);
}
