import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @type {Array<[string, string]>} */
const packages = [
	['core', 'packages/core'],
	['debug', 'packages/debug'],
	['llvm-core', 'packages/llvm-core'],
	['lsp', 'packages/lsp'],
	['node', 'packages/node'],
	['react', 'packages/react'],
	['svelte', 'packages/svelte'],
	['terminal', 'packages/terminal'],
	['vue', 'packages/vue'],
	['wasm-idle', '.']
];

const MiB = 1024 * 1024;

/**
 * @typedef {{ maxBytes: number; maxFiles: number; maxPackages: number }} InstallBudget
 * @typedef {{ name: string; budget: InstallBudget }} InstallBudgetScenario
 * @typedef {InstallBudgetScenario & {
 *   packageNames: string[];
 *   absentPackageNames?: string[];
 *   imports: string[];
 * }} InstallScenario
 * @typedef {{ bytes: number; files: number }} DirectoryMeasurement
 * @typedef {{ bytes: number; files: number; name: string }} InstallBudgetContributor
 * @typedef {InstallBudgetContributor & {
 *   instances: number;
 *   packageName: string;
 * }} PackageContributor
 * @typedef {{ bytes: number; files: number; packages: number }} InstallMeasurement
 * @typedef {{ path: string }} NpmPackFile
 * @typedef {{ files: NpmPackFile[]; unpackedSize: number }} NpmPackDryRun
 */

/** @type {InstallScenario[]} */
export const scenarios = [
	{
		name: 'wasm-idle root install',
		packageNames: ['wasm-idle', '@wasm-idle/core', '@wasm-idle/llvm-core'],
		budget: { maxBytes: 4.5 * MiB, maxFiles: 700, maxPackages: 6 },
		absentPackageNames: [
			'@lezer/rust',
			'@wasm-idle/debug',
			'@wasm-idle/lsp',
			'@wasm-idle/terminal',
			'@xterm/xterm',
			'monaco-editor',
			'svelte'
		],
		imports: [
			"await import('@wasm-idle/core');",
			"await import('@wasm-idle/llvm-core/core/gcc-compat');",
			"if (!import.meta.resolve('wasm-idle').endsWith('/wasm-idle/dist/index.js')) throw new Error('wasm-idle import export did not resolve');"
		]
	},
	{
		name: '@wasm-idle/terminal install',
		packageNames: ['@wasm-idle/terminal', '@wasm-idle/core'],
		budget: { maxBytes: 16 * MiB, maxFiles: 1_350, maxPackages: 32 },
		absentPackageNames: [
			'@wasm-idle/debug',
			'@wasm-idle/lsp',
			'@wasm-idle/llvm-core',
			'monaco-editor'
		],
		imports: [
			"await import('@wasm-idle/core');",
			"if (!import.meta.resolve('@wasm-idle/terminal').includes('/@wasm-idle/terminal/dist/index.js')) throw new Error('@wasm-idle/terminal export did not resolve');"
		]
	},
	{
		name: '@wasm-idle/debug install',
		packageNames: ['@wasm-idle/debug', '@wasm-idle/core'],
		budget: { maxBytes: 6 * MiB, maxFiles: 1_150, maxPackages: 25 },
		absentPackageNames: [
			'@lezer/rust',
			'@wasm-idle/lsp',
			'@wasm-idle/terminal',
			'@xterm/xterm',
			'monaco-editor'
		],
		imports: [
			"await import('@wasm-idle/core');",
			"await import('@wasm-idle/debug');",
			"await import('@wasm-idle/debug/controller');",
			"await import('@wasm-idle/debug/editor');",
			"await import('@wasm-idle/debug/language');"
		]
	},
	{
		name: '@wasm-idle/lsp install',
		packageNames: ['@wasm-idle/lsp', '@wasm-idle/llvm-core', '@wasm-idle/core'],
		budget: { maxBytes: 4 * MiB, maxFiles: 1_050, maxPackages: 7 },
		absentPackageNames: [
			'@lezer/rust',
			'@wasm-idle/debug',
			'@wasm-idle/terminal',
			'@xterm/xterm',
			'monaco-editor',
			'svelte'
		],
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
		budget: { maxBytes: 38 * MiB, maxFiles: 3_200, maxPackages: 70 },
		imports: [
			"await import('@wasm-idle/core');",
			"await import('@wasm-idle/debug');",
			"await import('@wasm-idle/llvm-core/core/gcc-compat');",
			"await import('@wasm-idle/lsp');",
			"await import('@wasm-idle/lsp/clangd');",
			"await import('@wasm-idle/node');",
			"await import('@wasm-idle/react');",
			"await import('@wasm-idle/svelte');",
			"if (!import.meta.resolve('@wasm-idle/terminal').includes('/@wasm-idle/terminal/dist/index.js')) throw new Error('@wasm-idle/terminal export did not resolve');",
			"await import('@wasm-idle/vue');",
			"if (!import.meta.resolve('wasm-idle').endsWith('/wasm-idle/dist/index.js')) throw new Error('wasm-idle import export did not resolve');"
		]
	}
];

const TOP_CONTRIBUTOR_COUNT = 5;

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<void>}
 */
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

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<string>}
 */
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

/**
 * @param {string} directory
 * @param {boolean} [excludeNodeModules]
 * @returns {Promise<DirectoryMeasurement>}
 */
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

/** @param {string} nodeModulesDirectory @returns {Promise<string[]>} */
async function packageDirectories(nodeModulesDirectory) {
	/** @type {string[]} */
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

/**
 * @param {string} nodeModulesDirectory
 * @returns {Promise<PackageContributor[]>}
 */
async function measurePackageContributors(nodeModulesDirectory) {
	/** @type {Map<string, PackageContributor>} */
	const contributors = new Map();

	/** @param {string} directory */
	async function visit(directory) {
		let directories;
		try {
			directories = await packageDirectories(directory);
		} catch (error) {
			if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
				return;
			}
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
				name: key,
				packageName: manifest.name
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

/** @param {number} bytes */
const formatMiB = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

/** @param {number} value */
const formatCount = (value) => value.toLocaleString('en-US');

/**
 * @param {InstallBudgetScenario} scenario
 * @param {InstallMeasurement} installed
 * @param {InstallBudgetContributor[]} [contributors]
 */
export function assertInstallBudget(scenario, installed, contributors = []) {
	/** @type {string[]} */
	const violations = [];
	if (installed.bytes > scenario.budget.maxBytes) {
		violations.push(
			`size ${formatMiB(installed.bytes)} exceeds ${formatMiB(scenario.budget.maxBytes)} by ${formatMiB(installed.bytes - scenario.budget.maxBytes)}`
		);
	}
	if (installed.files > scenario.budget.maxFiles) {
		violations.push(
			`file count ${formatCount(installed.files)} exceeds ${formatCount(scenario.budget.maxFiles)} by ${formatCount(installed.files - scenario.budget.maxFiles)}`
		);
	}
	if (installed.packages > scenario.budget.maxPackages) {
		violations.push(
			`package count ${formatCount(installed.packages)} exceeds ${formatCount(scenario.budget.maxPackages)} by ${formatCount(installed.packages - scenario.budget.maxPackages)}`
		);
	}
	if (violations.length === 0) return;

	const details = [
		`Install budget exceeded for ${scenario.name}:`,
		...violations.map((violation) => `  - ${violation}`)
	];
	if (contributors.length > 0) {
		details.push('  Largest package contributors:');
		for (const contributor of contributors.slice(0, TOP_CONTRIBUTOR_COUNT)) {
			details.push(
				`    ${contributor.name}: ${formatMiB(contributor.bytes)}, ${formatCount(contributor.files)} files`
			);
		}
	}
	throw new Error(details.join('\n'));
}

/**
 * @param {string} tempRoot
 * @param {Map<string, string>} tarballs
 * @param {InstallScenario} scenario
 * @param {number} index
 */
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
		await run(
			'node',
			['--input-type=module', '--eval', scenario.imports.join('\n')],
			installDir
		);

		const contributors = await measurePackageContributors(nodeModulesDirectory);
		const installedPackageNames = new Set(
			contributors.map((contributor) => contributor.packageName)
		);
		for (const packageName of scenario.absentPackageNames ?? []) {
			if (installedPackageNames.has(packageName)) {
				throw new Error(`${scenario.name} unexpectedly installed ${packageName}`);
			}
		}
		const installed = {
			...(await measureDirectory(nodeModulesDirectory)),
			packages: contributors.reduce((total, contributor) => total + contributor.instances, 0)
		};
		console.log(`\n${scenario.name}:`);
		console.log(
			`  Production install contains ${formatCount(installed.packages)} packages and ${formatCount(installed.files)} files totaling ${formatMiB(installed.bytes)}.`
		);
		console.log(
			`  Budget: ${formatMiB(scenario.budget.maxBytes)}, ${formatCount(scenario.budget.maxFiles)} files, ${formatCount(scenario.budget.maxPackages)} packages.`
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
		assertInstallBudget(scenario, installed, contributors);
		console.log('  Import smoke checks passed.');
	} finally {
		await rm(installDir, { recursive: true, force: true });
	}
}

async function main() {
	const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-package-'));
	const tarballDir = path.join(tempRoot, 'tarballs');

	try {
		await run('pnpm', ['run', 'package'], REPO_ROOT);
		await mkdir(tarballDir, { recursive: true });

		const tarballs = new Map();
		const packedPackages = [];
		for (const [fileName, packageDir] of packages) {
			const packagePath = path.join(REPO_ROOT, packageDir);
			const manifest = JSON.parse(
				await readFile(path.join(packagePath, 'package.json'), 'utf8')
			);
			const dryRun = /** @type {NpmPackDryRun} */ (
				JSON.parse(
					await runCapture(
						'npm',
						['pack', '--dry-run', '--ignore-scripts', '--json'],
						packagePath,
						{ ...process.env, npm_config_ignore_scripts: 'true' }
					)
				)[0]
			);
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
				const legacyPluginFiles = packedPaths.filter(
					(packedPath) =>
						packedPath.startsWith('dist/terminal/') ||
						packedPath.startsWith('dist/debug/') ||
						packedPath.startsWith('dist/lsp/') ||
						packedPath.startsWith('dist/utils/vscodeJsonrpcBrowser')
				);
				if (legacyPluginFiles.length > 0) {
					throw new Error(
						`wasm-idle contains legacy optional-plugin files: ${legacyPluginFiles.join(', ')}`
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
