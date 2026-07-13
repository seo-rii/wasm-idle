import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = [
	['clang-common', 'packages/clang-common'],
	['core', 'packages/core'],
	['lsp', 'packages/lsp'],
	['runtime-assemblyscript', 'runtimes/assemblyscript'],
	['runtime-php', 'runtimes/php'],
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

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-package-'));
const tarballDir = path.join(tempRoot, 'tarballs');
const installDir = path.join(tempRoot, 'install');

try {
	await run('pnpm', ['run', 'package'], REPO_ROOT);
	await mkdir(tarballDir, { recursive: true });
	await mkdir(installDir, { recursive: true });

	const dependencies = {};
	for (const [fileName, packageDir] of packages) {
		const manifest = JSON.parse(
			await readFile(path.join(REPO_ROOT, packageDir, 'package.json'), 'utf8')
		);
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
				"await import('@seo-rii/wasm-llvm/runtime/core/gcc-compat');",
				"await import('@wasm-idle/lsp/clangd');",
				"await import('@wasm-idle/runtime-assemblyscript');",
				"await import('@wasm-idle/runtime-php');",
				"if (!import.meta.resolve('wasm-idle').endsWith('/wasm-idle/dist/index.js')) throw new Error('wasm-idle import export did not resolve');"
			].join('\n')
		],
		installDir
	);
	console.log('Packed packages install and import successfully.');
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}
