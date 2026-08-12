import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import {
	collectRuntimeFiles,
	MANIFEST_FILE,
	PINNED_PACKAGE_NAMES,
	readJson,
	RUNTIME_PACKAGE_NAMES
} from './runtime-manifest.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRODUCER_ROOT = path.resolve(SCRIPT_DIR, '..');
const DIST_DIR = path.join(PRODUCER_ROOT, 'dist');
const ENTRY_PATH = path.join(PRODUCER_ROOT, 'src/entry.ts');
const require = createRequire(import.meta.url);
const packageJson = await readJson(path.join(PRODUCER_ROOT, 'package.json'));
/** @type {Record<string, string>} */
const packageVersions = {};
for (const packageName of PINNED_PACKAGE_NAMES) {
	const declaredVersion =
		packageJson.dependencies?.[packageName] ?? packageJson.devDependencies?.[packageName];
	if (!/^\d+\.\d+\.\d+$/.test(declaredVersion ?? '')) {
		throw new Error(`${packageName} must use an exact semantic version`);
	}
	const installedPackage = await readJson(require.resolve(`${packageName}/package.json`));
	if (installedPackage.version !== declaredVersion) {
		throw new Error(
			`${packageName} resolved to ${installedPackage.version}; expected ${declaredVersion}`
		);
	}
	if (RUNTIME_PACKAGE_NAMES.includes(packageName)) {
		packageVersions[packageName] = installedPackage.version;
	}
}

await rm(DIST_DIR, { recursive: true, force: true });
await build({
	root: PRODUCER_ROOT,
	configFile: false,
	publicDir: false,
	logLevel: 'warn',
	base: './',
	assetsInclude: ['**/*.wasm', '**/*.so', '**/*.dat'],
	build: {
		target: 'es2022',
		outDir: DIST_DIR,
		emptyOutDir: true,
		assetsInlineLimit: 0,
		modulePreload: false,
		minify: 'esbuild',
		rollupOptions: {
			preserveEntrySignatures: 'strict',
			input: ENTRY_PATH,
			output: {
				format: 'es',
				entryFileNames: 'runtime.mjs',
				chunkFileNames: 'chunks/[name]-[hash].mjs',
				assetFileNames: 'assets/[name]-[hash][extname]'
			}
		}
	}
});

const webPackageDir = path.dirname(require.resolve('@php-wasm/web-8-4/package.json'));
await cp(path.join(webPackageDir, 'LICENSE'), path.join(DIST_DIR, 'LICENSE.txt'));

const manifest = {
	formatVersion: 1,
	runtimeModule: 'runtime.mjs',
	packages: packageVersions,
	files: await collectRuntimeFiles(DIST_DIR)
};
await writeFile(
	path.join(DIST_DIR, MANIFEST_FILE),
	`${JSON.stringify(manifest, null, 2)}\n`,
	'utf8'
);

const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
process.stdout.write(
	`Built ${manifest.files.length} PHP runtime files (${totalBytes} uncompressed bytes) in dist/.\n`
);
