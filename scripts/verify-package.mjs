import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-package-'));
const tarballDir = path.join(tempRoot, 'tarballs');
const installDir = path.join(tempRoot, 'install');

try {
	await run('pnpm', ['run', 'package'], REPO_ROOT);
	await mkdir(tarballDir, { recursive: true });
	await mkdir(installDir, { recursive: true });

	const dependencies = {};
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
		const forbiddenAssets = dryRun.files
			.map(({ path: packedPath }) => packedPath)
			.filter((packedPath) =>
				/(^|\/)(?:assets?|artifacts?|static)(\/|$)|\.(?:a|bc|br|data|gz|o|pack|so|tar|tgz|wasm|zip|zst)$/iu.test(
					packedPath
				)
			);
		if (forbiddenAssets.length > 0) {
			throw new Error(
				`${manifest.name} contains static runtime assets: ${forbiddenAssets.join(', ')}`
			);
		}
		const tarballPath = path.join(tarballDir, `${fileName}.tgz`);
		await run(
			'pnpm',
			['--dir', path.join(REPO_ROOT, packageDir), 'pack', '--out', tarballPath],
			REPO_ROOT,
			{ ...process.env, npm_config_ignore_scripts: 'true' }
		);
		dependencies[manifest.name] = `file:${tarballPath}`;
	}

	await writeFile(
		path.join(installDir, 'package.json'),
		`${JSON.stringify(
			{
				name: 'wasm-idle-install-smoke',
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
		['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'],
		installDir
	);
	await run(
		'node',
		[
			'--input-type=module',
			'--eval',
			[
				"await import('@wasm-idle/core');",
				"await import('@wasm-idle/llvm-core/core/gcc-compat');",
				"await import('@wasm-idle/lsp/clangd');",
				"await import('@wasm-idle/node');",
				"await import('@wasm-idle/react');",
				"await import('@wasm-idle/svelte');",
				"await import('@wasm-idle/vue');",
				"if (!import.meta.resolve('wasm-idle').endsWith('/wasm-idle/dist/index.js')) throw new Error('wasm-idle import export did not resolve');"
			].join('\n')
		],
		installDir
	);
	console.log('Packed packages install and import successfully.');
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}
