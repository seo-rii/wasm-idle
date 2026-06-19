import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const RUNTIME_ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const DEFAULT_DIST_DIR = path.join(RUNTIME_ROOT, 'dist');

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: RUNTIME_ROOT,
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

async function assertWasmFile(filePath) {
	const data = await readFile(filePath);
	if (
		data.byteLength < 8 ||
		data[0] !== 0x00 ||
		data[1] !== 0x61 ||
		data[2] !== 0x73 ||
		data[3] !== 0x6d
	) {
		throw new Error(`${filePath} is not a valid WebAssembly binary.`);
	}
}

export async function buildWasmAwkRuntime({ distDir = DEFAULT_DIST_DIR } = {}) {
	const goRoot = run('go', ['env', 'GOROOT']);
	const goVersion = run('go', ['env', 'GOVERSION']);
	const goawkVersion = run('go', [
		'list',
		'-m',
		'-f',
		'{{.Version}}',
		'github.com/benhoyt/goawk'
	]);
	const wasmExecPath = path.join(goRoot, 'lib', 'wasm', 'wasm_exec.js');
	await rm(distDir, { recursive: true, force: true });
	await mkdir(distDir, { recursive: true });
	run(
		'go',
		[
			'build',
			'-trimpath',
			'-ldflags=-s -w -buildid=',
			'-o',
			path.join(distDir, 'goawk.wasm'),
			'./cmd/wasm-awk'
		],
		{
			env: {
				GOOS: 'js',
				GOARCH: 'wasm'
			}
		}
	);
	await assertWasmFile(path.join(distDir, 'goawk.wasm'));
	await cp(wasmExecPath, path.join(distDir, 'wasm_exec.js'));
	await writeFile(
		path.join(distDir, 'runtime-build.json'),
		`${JSON.stringify({ goVersion, goawkVersion }, null, 2)}\n`,
		'utf8'
	);
	return { distDir, goVersion, goawkVersion };
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
	const result = await buildWasmAwkRuntime();
	console.log(`Built wasm-awk in ${result.distDir}`);
}
