import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { WASM_R_ASSET_VERSION } from './wasmRVersion';

type PackageJson = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

type RuntimeManifest = {
	formatVersion: number;
	runtimeModule: string;
	packages: Record<string, string>;
	files: Array<{ path: string; bytes: number }>;
};

const repoRoot = process.cwd();
const staticRoot = path.join(repoRoot, 'static');
const runtimePackages = [
	'@assemblyscript/loader',
	'@duckdb/duckdb-wasm',
	'@php-wasm/universal',
	'@php-wasm/web-8-4',
	'@ruby/3.4-wasm-wasi',
	'@ruby/wasm-wasi',
	'@wasmer/sdk',
	'assemblyscript',
	'pyodide',
	'sql.js',
	'webr'
] as const;

const optionalLspProviders = [
	'graphql',
	'markdown-it',
	'smol-toml',
	'typescript',
	'vscode-css-languageservice',
	'vscode-html-languageservice',
	'vscode-json-languageservice',
	'vscode-languageserver-textdocument',
	'vscode-languageserver-types',
	'wabt',
	'yaml'
] as const;

const staticRuntimeModules = [
	{
		directory: 'wasm-assemblyscript',
		packages: { assemblyscript: '0.28.17', '@assemblyscript/loader': '0.28.17' }
	},
	{
		directory: 'wasm-duckdb',
		packages: { '@duckdb/duckdb-wasm': '1.33.1-dev45.0' }
	},
	{
		directory: 'wasm-php',
		packages: { '@php-wasm/web-8-4': '3.1.34', '@php-wasm/universal': '3.1.34' }
	},
	{
		directory: 'wasm-ruby',
		packages: {
			'@ruby/3.4-wasm-wasi': '2.9.3-2.9.4',
			'@ruby/wasm-wasi': '2.9.3-2.9.4'
		}
	},
	{ directory: 'wasm-sqlite', packages: { 'sql.js': '^1.14.1' } },
	{ directory: 'wasm-bash/sdk', packages: { '@wasmer/sdk': '0.9.0' } }
] as const;

async function readJson<T>(relativePath: string): Promise<T> {
	return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8')) as T;
}

describe('static language runtime assets', () => {
	it('keeps runtime producer packages out of published production dependencies', async () => {
		const rootPackage = await readJson<PackageJson>('package.json');
		const lspPackage = await readJson<PackageJson>('packages/lsp/package.json');

		for (const packageName of runtimePackages) {
			expect(rootPackage.dependencies, packageName).not.toHaveProperty(packageName);
			expect(lspPackage.dependencies, packageName).not.toHaveProperty(packageName);
		}

		expect(rootPackage.devDependencies?.['@php-wasm/web-8-4']).toBe('3.1.34');
		expect(rootPackage.devDependencies?.['@php-wasm/universal']).toBe('3.1.34');
		expect(rootPackage.devDependencies).not.toHaveProperty('@php-wasm/web');
	});

	it('keeps optional LSP provider engines out of the default install graph', async () => {
		const lspPackage = await readJson<PackageJson>('packages/lsp/package.json');

		for (const packageName of optionalLspProviders) {
			expect(lspPackage.dependencies, packageName).not.toHaveProperty(packageName);
			expect(lspPackage.devDependencies?.[packageName]).toBe(
				lspPackage.peerDependencies?.[packageName]
			);
			expect(lspPackage.peerDependenciesMeta?.[packageName]?.optional).toBe(true);
		}
	});

	it('ships generated ESM entry points with reproducible package metadata', async () => {
		for (const runtime of staticRuntimeModules) {
			const manifest = await readJson<RuntimeManifest>(
				`static/${runtime.directory}/runtime-manifest.v1.json`
			);
			expect(manifest.formatVersion).toBe(1);
			expect(manifest.packages).toEqual(runtime.packages);
			expect(
				(await stat(path.join(staticRoot, runtime.directory, manifest.runtimeModule))).size
			).toBeGreaterThan(0);
		}
	});

	it('keeps large generated files compressed under their logical asset URLs', async () => {
		const compressedManifest = await readJson<{
			assets: string[];
			sizes: Record<string, number>;
		}>('static/compressed-runtime-assets.v1.json');

		for (const runtime of staticRuntimeModules) {
			const manifest = await readJson<RuntimeManifest>(
				`static/${runtime.directory}/runtime-manifest.v1.json`
			);
			for (const file of manifest.files.filter(({ bytes }) => bytes >= 1_000_000)) {
				const logicalPath = `${runtime.directory}/${file.path}`;
				expect(compressedManifest.assets).toContain(logicalPath);
				expect(compressedManifest.sizes[logicalPath]).toBe(file.bytes);
				await expect(
					access(path.join(staticRoot, `${logicalPath}.gz`))
				).resolves.toBeUndefined();
				await expect(access(path.join(staticRoot, logicalPath))).rejects.toThrow();
			}
		}
	});

	it('serves Pyodide and WebR loaders from the static runtime trees', async () => {
		await expect(access(path.join(staticRoot, 'pyodide/pyodide.mjs'))).resolves.toBeUndefined();
		await expect(
			access(path.join(staticRoot, `webr/${WASM_R_ASSET_VERSION}/webr.js`))
		).resolves.toBeUndefined();
	});
});
