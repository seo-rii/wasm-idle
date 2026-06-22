import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.resolve(
	process.env.WASM_CLANG_RUNTIME_SOURCE_DIR ||
		path.resolve(REPO_ROOT, 'artifacts', 'runtime-source')
);
const TARGET_DIR = path.resolve(REPO_ROOT, 'dist', 'runtime');
const TARGET_BIN_DIR = path.resolve(TARGET_DIR, 'bin');
const TARGET_CLANGD_DIR = path.resolve(TARGET_DIR, 'clangd');
const LEGACY_TOOLCHAIN = {
	version: 'legacy-wasm-idle-clang-assets',
	resourceDir: '/lib/clang/8.0.1',
	compilerRuntimeLibDir: 'lib/clang/8.0.1/lib/wasi'
};

const assets = [
	{ source: 'clang.zip', target: ['bin', 'clang.zip'] },
	{ source: 'lld.zip', target: ['bin', 'lld.zip'] },
	{ source: 'memfs.zip', target: ['bin', 'memfs.zip'] },
	{ source: 'sysroot.tar.zip', target: ['bin', 'sysroot.tar.zip'] },
	{ source: 'clangd/clangd.js', target: ['clangd', 'clangd.js'] },
	{ source: 'clangd/clangd.wasm.gz', target: ['clangd', 'clangd.wasm.gz'] }
];

await fs.mkdir(TARGET_BIN_DIR, { recursive: true });
await fs.mkdir(TARGET_CLANGD_DIR, { recursive: true });

const toolchain = await fs
	.readFile(path.resolve(SOURCE_DIR, 'toolchain.json'), 'utf8')
	.then((contents) => JSON.parse(contents))
	.catch((error) => {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			return LEGACY_TOOLCHAIN;
		}
		throw error;
	});

const buildAssets = [];
for (const asset of assets) {
	const sourcePath = path.resolve(SOURCE_DIR, asset.source);
	const targetPath = path.resolve(TARGET_DIR, ...asset.target);
	const bytes = await fs.readFile(sourcePath);
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	await fs.writeFile(targetPath, bytes);
	buildAssets.push({
		asset: asset.source,
		size: bytes.byteLength,
		sha256: crypto.createHash('sha256').update(bytes).digest('hex')
	});
}

const manifest = {
	manifestVersion: 1,
	version: typeof toolchain.version === 'string' ? toolchain.version : LEGACY_TOOLCHAIN.version,
	defaultTarget: 'wasm32-wasi',
	compiler: {
		memfs: {
			asset: 'bin/memfs.zip',
			argv0: 'memfs'
		},
		clang: {
			asset: 'bin/clang.zip',
			argv0: 'clang'
		},
		lld: {
			asset: 'bin/lld.zip',
			argv0: 'wasm-ld'
		},
		sysroot: {
			asset: 'bin/sysroot.tar.zip'
		},
		resourceDir:
			typeof toolchain.resourceDir === 'string'
				? toolchain.resourceDir
				: LEGACY_TOOLCHAIN.resourceDir,
		compilerRuntimeLibDir:
			typeof toolchain.compilerRuntimeLibDir === 'string'
				? toolchain.compilerRuntimeLibDir
				: LEGACY_TOOLCHAIN.compilerRuntimeLibDir
	},
	clangd: {
		js: 'clangd/clangd.js',
		wasm: 'clangd/clangd.wasm.gz'
	},
	targets: {
		'wasm32-wasi': {
			artifactFormat: 'wasi-core-wasm',
			execution: {
				kind: 'wasi-preview1'
			}
		}
	}
};

const buildInfo = {
	generatedAt: new Date().toISOString(),
	source: 'artifacts/runtime-source',
	toolchain,
	assets: buildAssets
};

await fs.writeFile(
	path.resolve(TARGET_DIR, 'runtime-manifest.v1.json'),
	JSON.stringify(manifest, null, 2) + '\n'
);
await fs.writeFile(
	path.resolve(TARGET_DIR, 'runtime-build.json'),
	JSON.stringify(buildInfo, null, 2) + '\n'
);

console.log(`Prepared wasm-clang runtime assets in ${TARGET_DIR}`);
