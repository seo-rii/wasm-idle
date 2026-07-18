import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = [
	['core', 'packages/core'],
	['llvm-core', 'packages/llvm-core'],
	['lsp', 'packages/lsp'],
	['node', 'packages/node'],
	['react', 'packages/react'],
	['svelte', 'packages/svelte'],
	['vue', 'packages/vue'],
	['wasm-idle', '.']
];

const scenarios = [
	{
		name: 'wasm-idle root install',
		packageNames: ['wasm-idle', '@wasm-idle/core', '@wasm-idle/llvm-core'],
		absentPackageNames: ['@wasm-idle/lsp'],
		imports: [
			"await import('@wasm-idle/core');",
			"await import('@wasm-idle/llvm-core/core/gcc-compat');",
			"if (!import.meta.resolve('wasm-idle').endsWith('/wasm-idle/dist/index.js')) throw new Error('wasm-idle import export did not resolve');"
		]
	},
	{
		name: '@wasm-idle/lsp install',
		packageNames: ['@wasm-idle/lsp', '@wasm-idle/llvm-core'],
		imports: [
			"await import('@wasm-idle/llvm-core/core/gcc-compat');",
			"await import('@wasm-idle/lsp');",
			"await import('@wasm-idle/lsp/clangd');"
		]
	},
	{
		name: 'all public packages/adapters aggregate',
		packageNames: packages.map(([fileName]) =>
			fileName === 'wasm-idle' ? fileName : `@wasm-idle/${fileName}`
		),
		imports: [
			"await import('@wasm-idle/core');",
			"await import('@wasm-idle/llvm-core/core/gcc-compat');",
			"await import('@wasm-idle/lsp');",
			"await import('@wasm-idle/lsp/clangd');",
			"await import('@wasm-idle/node');",
			"await import('@wasm-idle/react');",
			"await import('@wasm-idle/svelte');",
			"await import('@wasm-idle/vue');",
			"if (!import.meta.resolve('wasm-idle').endsWith('/wasm-idle/dist/index.js')) throw new Error('wasm-idle import export did not resolve');"
		]
	}
];

const TOP_CONTRIBUTOR_COUNT = 5;

function run(command, args, cwd, env = process.env) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: 'inherit', env });
		child.on('error', reject);
		child.on('close', (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(
					`${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with code ${String(code)}`}`
				)
			);
		});
	});
}

function runCapture(command, args, cwd, env = process.env) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], env });
		let stdout = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.on('error', reject);
		child.on('close', (code, signal) => {
			if (code === 0) {
				resolve(stdout);
				return;
			}
			reject(
				new Error(
					`${command} ${args.join(' ')} failed${signal ? ` with signal ${signal}` : ` with code ${String(code)}`}`
				)
			);
		});
	});
}

async function measureDirectory(directory, excludeNodeModules = false) {
	let bytes = 0;
	let files = 0;
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (excludeNodeModules && entry.isDirectory() && entry.name === 'node_modules') continue;
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			const nested = await measureDirectory(entryPath, excludeNodeModules);
			bytes += nested.bytes;
			files += nested.files;
		} else if (entry.isFile()) {
			bytes += (await stat(entryPath)).size;
			files += 1;
		}
	}
	return { bytes, files };
}

async function packageDirectories(nodeModulesDirectory) {
	const directories = [];
	for (const entry of await readdir(nodeModulesDirectory, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		const entryPath = path.join(nodeModulesDirectory, entry.name);
		if (!entry.name.startsWith('@')) {
			directories.push(entryPath);
			continue;
		}
		for (const scopedEntry of await readdir(entryPath, { withFileTypes: true })) {
			if (scopedEntry.isDirectory()) directories.push(path.join(entryPath, scopedEntry.name));
		}
	}
	return directories;
}

async function measurePackageContributors(nodeModulesDirectory) {
	const contributors = new Map();

	async function visit(directory) {
		let directories;
		try {
			directories = await packageDirectories(directory);
		} catch (error) {
			if (error.code === 'ENOENT') return;
			throw error;
		}
		for (const packageDirectory of directories) {
			const manifest = JSON.parse(
				await readFile(path.join(packageDirectory, 'package.json'), 'utf8')
			);
			const key = `${manifest.name}@${manifest.version}`;
			const measured = await measureDirectory(packageDirectory, true);
			const current = contributors.get(key) ?? {
				bytes: 0,
				files: 0,
				instances: 0,
				name: key
			};
			current.bytes += measured.bytes;
			current.files += measured.files;
			current.instances += 1;
			contributors.set(key, current);
			await visit(path.join(packageDirectory, 'node_modules'));
		}
	}

	await visit(nodeModulesDirectory);
	return [...contributors.values()].sort((left, right) => right.bytes - left.bytes);
}

const formatMiB = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

async function verifyScenario(tempRoot, tarballs, scenario, index) {
	const installDir = path.join(tempRoot, `install-${index + 1}`);
	await mkdir(installDir, { recursive: true });
	try {
		const dependencies = Object.fromEntries(
			scenario.packageNames.map((packageName) => {
				const tarballPath = tarballs.get(packageName);
				if (!tarballPath) throw new Error(`Missing packed tarball for ${packageName}`);
				return [packageName, `file:${tarballPath}`];
			})
		);
		await writeFile(
			path.join(installDir, 'package.json'),
			`${JSON.stringify(
				{
					name: `wasm-idle-install-smoke-${index + 1}`,
					private: true,
					type: 'module',
					dependencies
				},
				null,
				2
			)}\n`
		);
		await run(
			'npm',
			[
				'install',
				'--ignore-scripts',
				'--no-audit',
				'--no-fund',
				'--package-lock=false',
				'--omit=dev'
			],
			installDir
		);
		const nodeModulesDirectory = path.join(installDir, 'node_modules');
		for (const packageName of scenario.absentPackageNames ?? []) {
			try {
				await stat(path.join(nodeModulesDirectory, ...packageName.split('/')));
			} catch (error) {
				if (error.code === 'ENOENT') continue;
				throw error;
			}
			throw new Error(`${scenario.name} unexpectedly installed ${packageName}`);
		}
		await run(
			'node',
			['--input-type=module', '--eval', scenario.imports.join('\n')],
			installDir
		);

		const installed = await measureDirectory(nodeModulesDirectory);
		const contributors = await measurePackageContributors(nodeModulesDirectory);
		console.log(`\n${scenario.name}:`);
		console.log(
			`  Production install contains ${installed.files} files totaling ${formatMiB(installed.bytes)}.`
		);
		console.log(
			`  Top ${Math.min(TOP_CONTRIBUTOR_COUNT, contributors.length)} package contributors:`
		);
		for (const contributor of contributors.slice(0, TOP_CONTRIBUTOR_COUNT)) {
			const instanceSuffix =
				contributor.instances > 1 ? ` across ${contributor.instances} installs` : '';
			console.log(
				`    ${contributor.name}: ${formatMiB(contributor.bytes)}, ${contributor.files} files${instanceSuffix}.`
			);
		}
		console.log('  Import smoke checks passed.');
	} finally {
		await rm(installDir, { recursive: true, force: true });
	}
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-package-'));
const tarballDir = path.join(tempRoot, 'tarballs');

try {
	await run('pnpm', ['run', 'package'], REPO_ROOT);
	await mkdir(tarballDir, { recursive: true });

	const tarballs = new Map();
	const packedPackages = [];
	for (const [fileName, packageDir] of packages) {
		const packagePath = path.join(REPO_ROOT, packageDir);
		const manifest = JSON.parse(await readFile(path.join(packagePath, 'package.json'), 'utf8'));
		const dryRun = JSON.parse(
			await runCapture(
				'npm',
				['pack', '--dry-run', '--ignore-scripts', '--json'],
				packagePath,
				{ ...process.env, npm_config_ignore_scripts: 'true' }
			)
		)[0];
		const packedPaths = dryRun.files.map(({ path: packedPath }) => packedPath);
		const forbiddenAssets = packedPaths.filter((packedPath) =>
			/(^|\/)(?:assets?|artifacts?|static)(\/|$)|\.(?:a|bc|br|data|gz|o|pack|so|tar|tgz|wasm|zip|zst)$/iu.test(
				packedPath
			)
		);
		if (forbiddenAssets.length > 0) {
			throw new Error(
				`${manifest.name} contains static runtime assets: ${forbiddenAssets.join(', ')}`
			);
		}
		if (manifest.name === 'wasm-idle') {
			const legacyLspFiles = packedPaths.filter(
				(packedPath) =>
					packedPath.startsWith('dist/lsp/') ||
					packedPath.startsWith('dist/utils/vscodeJsonrpcBrowser')
			);
			if (legacyLspFiles.length > 0) {
				throw new Error(
					`wasm-idle contains legacy LSP files: ${legacyLspFiles.join(', ')}`
				);
			}
		}
		const tarballPath = path.join(tarballDir, `${fileName}.tgz`);
		await run(
			'pnpm',
			['--dir', path.join(REPO_ROOT, packageDir), 'pack', '--out', tarballPath],
			REPO_ROOT,
			{ ...process.env, npm_config_ignore_scripts: 'true' }
		);
		packedPackages.push({
			name: manifest.name,
			packedBytes: (await stat(tarballPath)).size,
			unpackedBytes: dryRun.unpackedSize
		});
		tarballs.set(manifest.name, tarballPath);
	}

	console.log('\nPacked public package tarballs:');
	for (const packageReport of packedPackages) {
		console.log(
			`  ${packageReport.name}: ${formatMiB(packageReport.packedBytes)} packed, ${formatMiB(packageReport.unpackedBytes)} unpacked.`
		);
	}

	for (const [index, scenario] of scenarios.entries()) {
		await verifyScenario(tempRoot, tarballs, scenario, index);
	}
	console.log('\nPacked packages install and import successfully in every scenario.');
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}
