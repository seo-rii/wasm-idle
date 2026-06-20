import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const RUNTIME_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_DIST_DIR = path.join(RUNTIME_ROOT, 'dist');
const SOURCE_DIR = path.join(RUNTIME_ROOT, 'src');

async function fileExists(filePath) {
	const fileStats = await stat(filePath).catch(() => null);
	return !!fileStats?.isFile();
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd || RUNTIME_ROOT,
		env: { ...process.env, ...options.env },
		encoding: 'utf8',
		stdio: 'pipe'
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`
		);
	}
	return result.stdout.trim();
}

function resolvePas2jsRepoDir(pas2jsRepoDir) {
	const configured = pas2jsRepoDir || process.env.PAS2JS_REPO_DIR || '';
	if (!configured) {
		throw new Error(
			'PAS2JS_REPO_DIR must point to a pas2js source checkout with a built native bin/x86_64-linux/pas2js.'
		);
	}
	return path.resolve(configured);
}

function resolvePas2jsBin(pas2jsRepoDir, pas2jsBin) {
	return path.resolve(
		pas2jsBin ||
			process.env.PAS2JS_BIN ||
			path.join(pas2jsRepoDir, 'bin', 'x86_64-linux', 'pas2js')
	);
}

async function assertPas2jsLayout(pas2jsRepoDir, pas2jsBin) {
	const required = [
		pas2jsBin,
		path.join(pas2jsRepoDir, 'compiler', 'utils', 'pas2js', 'dist', 'rtl.js'),
		path.join(pas2jsRepoDir, 'packages', 'rtl', 'src'),
		path.join(pas2jsRepoDir, 'compiler', 'packages', 'pastojs', 'src')
	];
	for (const filePath of required) {
		const fileStats = await stat(filePath).catch(() => null);
		if (!fileStats) throw new Error(`required pas2js build input was not found: ${filePath}`);
	}
}

function gitCommit(repoDir) {
	const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
		cwd: repoDir,
		encoding: 'utf8',
		stdio: 'pipe'
	});
	return result.status === 0 ? result.stdout.trim() : '';
}

export async function buildWasmPascalRuntime({
	distDir = DEFAULT_DIST_DIR,
	pas2jsRepoDir,
	pas2jsBin
} = {}) {
	const repoDir = resolvePas2jsRepoDir(pas2jsRepoDir);
	const compilerBin = resolvePas2jsBin(repoDir, pas2jsBin);
	await assertPas2jsLayout(repoDir, compilerBin);

	const rtlJs = path.join(repoDir, 'compiler', 'utils', 'pas2js', 'dist', 'rtl.js');
	await rm(distDir, { recursive: true, force: true });
	await mkdir(distDir, { recursive: true });

	const includeDirs = [
		SOURCE_DIR,
		path.join(repoDir, 'packages', 'rtl', 'src'),
		path.join(repoDir, 'packages', 'fcl-base', 'src'),
		path.join(repoDir, 'packages', 'fcl-json', 'src'),
		path.join(repoDir, 'compiler', 'packages', 'fcl-js', 'src'),
		path.join(repoDir, 'compiler', 'packages', 'fcl-passrc', 'src'),
		path.join(repoDir, 'compiler', 'packages', 'pastojs', 'src'),
		path.join(repoDir, 'compiler', 'utils', 'pas2js')
	];
	const args = [
		'-n',
		'-MObjFPC',
		'-Sc',
		'-Tbrowser',
		'-Jc',
		`-Ji${rtlJs}`,
		`-FU${distDir}`,
		...includeDirs.map((includeDir) => `-Fu${includeDir}`),
		`-o${path.join(distDir, 'compiler.js')}`,
		path.join(SOURCE_DIR, 'wasm_idle_pascal_compiler.pas')
	];
	run(compilerBin, args, { cwd: repoDir });

	if (!(await fileExists(path.join(distDir, 'compiler.js')))) {
		throw new Error('pas2js browser compiler output was not created.');
	}
	await cp(path.join(SOURCE_DIR, 'system.pas'), path.join(distDir, 'system.pas'));
	await cp(rtlJs, path.join(distDir, 'rtl.js'));

	const pas2jsVersion = run(compilerBin, ['-iV'], { cwd: repoDir });
	await writeFile(
		path.join(distDir, 'runtime-build.json'),
		`${JSON.stringify(
			{
				format: 'wasm-pascal-runtime-build-v1',
				runtime: 'pas2js',
				pas2jsVersion,
				pas2jsCommit: gitCommit(repoDir)
			},
			null,
			2
		)}\n`,
		'utf8'
	);
	return { distDir, pas2jsVersion };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const result = await buildWasmPascalRuntime();
	console.log(`Built wasm-pascal in ${result.distDir}`);
}
