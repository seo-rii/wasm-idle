import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface PackageJson {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	name?: string;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	private?: boolean;
	publishConfig?: { access?: string; tag?: string };
	scripts?: Record<string, string>;
	version?: string;
}

async function readRootPackage() {
	return JSON.parse(await readFile('package.json', 'utf8')) as PackageJson;
}

async function readPackageManifest(packagePath: string) {
	return JSON.parse(await readFile(`${packagePath}/package.json`, 'utf8')) as PackageJson;
}

async function readPackageVerifier() {
	return await readFile('scripts/verify-package.mjs', 'utf8');
}

describe('LLVM runtime package scripts', () => {
	it('consumes the local code-only LLVM runtime without depending on the producer repo', async () => {
		const pkg = await readRootPackage();
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');

		expect(pkg.dependencies?.['@seo-rii/wasm-llvm']).toBeUndefined();
		expect(pkg.dependencies?.['@wasm-idle/llvm-core']).toBe('workspace:*');
		expect(pkg.dependencies?.['wasm-clang']).toBeUndefined();
		expect(pkg.dependencies?.['@wasm-idle/clang-common']).toBeUndefined();
		expect(workflow).toContain('pnpm --dir packages/llvm-core test');
		expect(workflow).not.toContain('packages/clang-common');
	});

	it('does not publish language-specific AssemblyScript or PHP wrapper packages', async () => {
		const pkg = await readRootPackage();
		const verifier = await readPackageVerifier();

		expect(pkg.dependencies?.['@wasm-idle/runtime-assemblyscript']).toBeUndefined();
		expect(pkg.dependencies?.['@wasm-idle/runtime-php']).toBeUndefined();
		expect(verifier).not.toContain('runtimes/assemblyscript');
		expect(verifier).not.toContain('runtimes/php');
		expect(verifier).not.toContain('@wasm-idle/runtime-assemblyscript');
		expect(verifier).not.toContain('@wasm-idle/runtime-php');
	});

	it('keeps terminal UI dependencies out of the root runtime package', async () => {
		const root = await readRootPackage();
		const llvmCore = await readPackageManifest('packages/llvm-core');
		const lsp = await readPackageManifest('packages/lsp');
		const terminal = await readPackageManifest('packages/terminal');

		for (const manifest of [root, llvmCore, lsp]) {
			expect(manifest.dependencies?.['@zip.js/zip.js']).toBeUndefined();
			expect(manifest.dependencies?.fflate).toBe('0.8.3');
		}
		expect(root.dependencies?.['@xterm/xterm']).toBeUndefined();
		expect(root.peerDependencies?.svelte).toBeUndefined();
		expect(root.devDependencies?.['@wasm-idle/terminal']).toBe('workspace:*');
		expect(terminal.name).toBe('@wasm-idle/terminal');
		expect(terminal.dependencies?.['@xterm/xterm']).toBe('^6.0.0');
		expect(terminal.peerDependencies?.svelte).toBe('^5.0.0');
	});

	it('keeps editor tooling as separately installed page plugins', async () => {
		const root = await readRootPackage();
		const verifier = await readPackageVerifier();

		expect(root.dependencies?.['@wasm-idle/debug']).toBeUndefined();
		expect(root.dependencies?.['@wasm-idle/lsp']).toBeUndefined();
		expect(root.dependencies?.['vscode-jsonrpc']).toBeUndefined();
		expect(root.devDependencies?.['@wasm-idle/debug']).toBe('workspace:*');
		expect(root.devDependencies?.['@wasm-idle/lsp']).toBe('workspace:*');
		expect(root.scripts?.['package:root']).toContain('scripts/clean-package-output.mjs');
		expect(verifier).toContain("name: '@wasm-idle/debug install'");
		expect(verifier).toContain("name: '@wasm-idle/lsp install'");
		expect(verifier).toContain("name: '@wasm-idle/terminal install'");
		expect(verifier).toContain("'@wasm-idle/terminal'");
	});

	it('runs every runtime synchronization contract in CI', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');

		expect(workflow).toContain(
			'pnpm exec vitest run --no-file-parallelism --testTimeout=15000 src/lib/sync-*.test.ts'
		);
		expect(workflow).toContain('pnpm --dir producers/wasm-php install --frozen-lockfile');
		expect(workflow).toContain('pnpm --dir producers/wasm-php build');
		expect(workflow).toContain('pnpm --dir producers/wasm-php verify');
		expect(workflow).toContain('pnpm run verify:wasm-php');
		expect(workflow).toContain(
			'pnpm --dir packages/lsp exec vitest run test/bundledClangdAssetIntegrity.test.ts'
		);
	});

	it('verifies rebuildable page runtime freshness without mutating checked-in assets', async () => {
		const root = await readRootPackage();

		expect(root.scripts?.['verify:wasm-typescript-freshness']).toBe(
			'pnpm --dir runtimes/wasm-typescript build && node scripts/sync-wasm-typescript.mjs --verify'
		);
		expect(root.scripts?.['verify:wasm-ocaml-freshness']).toBe(
			'pnpm --dir runtimes/wasm-of-js-of-ocaml build && node scripts/sync-wasm-of-js-of-ocaml.mjs --verify-wrapper'
		);
		expect(root.scripts?.['verify:page-runtime-freshness']).toBe(
			'pnpm run verify:wasm-typescript-freshness && pnpm run verify:wasm-ocaml-freshness'
		);
	});

	it('builds Rust source instrumentation as a lazy static asset', async () => {
		const root = await readRootPackage();
		const rustRuntime = await readPackageManifest('runtimes/wasm-rust');

		expect(root.dependencies?.['@lezer/rust']).toBeUndefined();
		expect(rustRuntime.dependencies?.['@lezer/rust']).toBeUndefined();
		expect(rustRuntime.devDependencies?.['@lezer/rust']).toBe('^1.0.2');
		expect(rustRuntime.scripts?.['postbuild:js']).toContain('build-debug-instrumenter.mjs');
	});

	it('keeps the debugger package code-only with explicit host peers', async () => {
		const debug = await readPackageManifest('packages/debug');

		expect(debug.name).toBe('@wasm-idle/debug');
		expect(debug.dependencies?.['@wasm-idle/core']).toBe('workspace:*');
		expect(debug.peerDependencies?.['@wasm-idle/core']).toBe('1.0.0');
		expect(debug.peerDependencies?.svelte).toBe('^5.0.0');
		expect(debug.peerDependencies?.['monaco-editor']).toBe('^0.55.0');
		expect(debug.peerDependenciesMeta?.['monaco-editor']?.optional).toBe(true);
		expect(debug.dependencies?.['monaco-editor']).toBeUndefined();
	});

	it('keeps all public packages aligned for the stable v1 release', async () => {
		const releaseVersion = '1.0.0';
		const root = await readRootPackage();
		const packagePaths = [
			'packages/core',
			'packages/debug',
			'packages/llvm-core',
			'packages/lsp',
			'packages/node',
			'packages/react',
			'packages/svelte',
			'packages/terminal',
			'packages/vue'
		];
		const packages = await Promise.all(packagePaths.map(readPackageManifest));

		expect(root.version).toBe(releaseVersion);
		expect(root.publishConfig).toEqual({ tag: 'latest' });
		for (const manifest of packages) {
			expect(manifest.version, manifest.name).toBe(releaseVersion);
			expect(manifest.publishConfig, manifest.name).toEqual({
				access: 'public',
				tag: 'latest'
			});
		}

		for (const manifest of packages) {
			if (manifest.peerDependencies?.['@wasm-idle/core']) {
				expect(manifest.peerDependencies['@wasm-idle/core'], manifest.name).toBe(
					releaseVersion
				);
			}
		}
	});

	it('keeps every language runtime workspace private', async () => {
		const runtimeEntries = await readdir('runtimes', { withFileTypes: true });

		for (const entry of runtimeEntries) {
			if (!entry.isDirectory()) continue;
			let manifestSource: string;
			try {
				manifestSource = await readFile(`runtimes/${entry.name}/package.json`, 'utf8');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
				throw error;
			}
			const manifest = JSON.parse(manifestSource) as PackageJson;
			expect(manifest.private, manifest.name || entry.name).toBe(true);
		}
	});

	it('keeps normal development and builds independent of runtime asset syncs', async () => {
		const pkg = await readRootPackage();
		const pageBuild = pkg.scripts?.['page:build'] || '';

		expect(pkg.scripts?.['prepare:app']).toBe('pnpm run build:publish-deps');
		expect(pkg.scripts?.['prepare:clang-assets']).toBeUndefined();
		expect(pkg.scripts?.['prepare:cobol-assets']).toBeUndefined();
		for (const scriptName of ['dev', 'build:preview', 'build', 'prepare:app']) {
			expect(pkg.scripts?.[scriptName]).not.toContain('sync:wasm-');
		}

		expect(pkg.scripts?.['sync:wasm-clang']).toBe('node scripts/sync-wasm-clang.mjs');
		expect(pkg.scripts?.['sync:wasm-php']).toBe('node scripts/sync-wasm-php.mjs');
		expect(pkg.scripts?.['sync:wasm-fortran']).toBe(
			'node scripts/sync-runtime.mjs wasm-fortran'
		);
		expect(pkg.scripts?.['sync:wasm-cobol']).toBe('node scripts/sync-runtime.mjs wasm-cobol');
		expect(pkg.scripts?.['sync:wasm-swift']).toBe('node scripts/sync-runtime.mjs wasm-swift');
		expect(pageBuild).not.toContain('sync:wasm-php');
		expect(pageBuild).not.toContain('producers/wasm-php');

		for (const command of Object.values(pkg.scripts || {})) {
			expect(command).not.toContain('runtimes/wasm-clang');
			expect(command).not.toContain('runtimes/wasm-swift');
			expect(command).not.toContain('runtimes/wasm-objectivec');
		}
	});

	it('layers large page assets before applying per-file compression', async () => {
		const pkg = await readRootPackage();
		const pageBuild = pkg.scripts?.['page:build'] || '';

		expect(pkg.scripts?.['layer:static-runtimes']).toBe(
			'node scripts/build-layered-runtime-assets.mjs static'
		);
		expect(pageBuild.indexOf('pnpm run layer:static-runtimes')).toBeGreaterThan(-1);
		expect(pageBuild.indexOf('pnpm run compress:static-runtimes')).toBeGreaterThan(
			pageBuild.indexOf('pnpm run layer:static-runtimes')
		);
	});

	it('prepares the pinned debugger release only on the page deployment path', async () => {
		const pkg = await readRootPackage();
		const pageBuildCommands = (pkg.scripts?.['page:build'] || '').split(' && ');
		const prepareCommand = 'pnpm run prepare:wasm-debug-release';

		expect(pkg.scripts?.['prepare:wasm-debug-release']).toBe(
			'node scripts/prepare-wasm-debug-release.mjs'
		);
		expect(pageBuildCommands).toContain(prepareCommand);
		for (const command of [
			'pnpm run layer:static-runtimes',
			'pnpm run compress:static-runtimes',
			'pnpm run build'
		]) {
			expect(pageBuildCommands.indexOf(command)).toBeGreaterThan(
				pageBuildCommands.indexOf(prepareCommand)
			);
		}

		for (const scriptName of ['dev', 'build:preview', 'build', 'prepare:app']) {
			expect(pkg.scripts?.[scriptName]).not.toContain('prepare:wasm-debug-release');
		}
	});

	it('checks every public workspace package tarball for static assets', async () => {
		const verifier = await readPackageVerifier();

		for (const packagePath of [
			'packages/core',
			'packages/debug',
			'packages/llvm-core',
			'packages/lsp',
			'packages/node',
			'packages/react',
			'packages/svelte',
			'packages/terminal',
			'packages/vue'
		]) {
			expect(verifier).toContain(`'${packagePath}'`);
		}
		expect(verifier).toContain("['wasm-idle', '.']");
	});
});
