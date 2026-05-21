import { access, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..');
const workspaceDir = path.resolve(repoDir, '..');
const wasmIdleStaticDir = path.join(workspaceDir, 'wasm-idle', 'static');
const runtimeSourceDir = path.join(repoDir, 'artifacts', 'runtime-source');
const runtimeClangdDir = path.join(runtimeSourceDir, 'clangd');

const runtimeAssets = ['clang.zip', 'lld.zip', 'memfs.zip', 'sysroot.tar.zip'];
const clangdAssets = ['clangd.js', 'clangd.wasm.gz'];

try {
	await access(path.join(wasmIdleStaticDir, 'clang', 'bin'));
	await access(path.join(wasmIdleStaticDir, 'clangd'));
} catch {
	throw new Error(
		`Expected a sibling wasm-idle checkout with static assets at ${wasmIdleStaticDir}. ` +
			'Use the committed artifacts/runtime-source bundle for normal builds, or create ' +
			'the sibling checkout before running npm run bootstrap:assets.'
	);
}

await mkdir(runtimeSourceDir, { recursive: true });
await mkdir(runtimeClangdDir, { recursive: true });

for (const asset of runtimeAssets) {
	await cp(
		path.join(wasmIdleStaticDir, 'clang', 'bin', asset),
		path.join(runtimeSourceDir, asset),
		{ force: true }
	);
}

for (const asset of clangdAssets) {
	await cp(
		path.join(wasmIdleStaticDir, 'clangd', asset),
		path.join(runtimeClangdDir, asset),
		{ force: true }
	);
}

console.log(`Bootstrapped wasm-clang assets from ${wasmIdleStaticDir}`);
