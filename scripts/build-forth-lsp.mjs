import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const patchPath = fileURLToPath(new URL('./patches/forth-lsp-reactor.patch', import.meta.url));
export const forthLspLock = JSON.parse(
	await readFile(new URL('./forth-lsp.lock.json', import.meta.url), 'utf8')
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function verifyForthLspAsset(bytes, receipt, label) {
	if (bytes.length !== receipt.bytes || sha256(bytes) !== receipt.sha256) {
		throw new Error(`Forth LSP ${label} differs from the pinned producer receipt`);
	}
	return bytes;
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: 'inherit', ...options });
		child.once('error', reject);
		child.once('exit', (code, signal) =>
			code === 0 ? resolve() : reject(new Error(`${command} failed (${code ?? signal})`))
		);
	});
}

/** Download only the pinned upstream source; all lexer, handlers and dictionary files remain unchanged. */
export async function buildForthLsp({
	buildNative = false,
	archivePath,
	outputDirectory = path.join(root, 'static/wasm-forth-lsp')
} = {}) {
	const lock = forthLspLock;
	const patch = await readFile(patchPath);
	if (sha256(patch) !== lock.patchSha256)
		throw new Error('Forth LSP transport patch differs from the lock');
	const cache = path.join(
		root,
		'.cache/forth-lsp',
		`${lock.commit}-${lock.patchSha256.slice(0, 16)}`
	);
	await mkdir(cache, { recursive: true });
	const cachedArchive = path.join(cache, 'source.tar.gz');
	let archive;
	try {
		archive = await readFile(archivePath || cachedArchive);
	} catch {
		const response = await fetch(lock.archive.url, { signal: AbortSignal.timeout(120_000) });
		if (!response.ok)
			throw new Error(`Forth LSP source download failed: HTTP ${response.status}`);
		archive = Buffer.from(await response.arrayBuffer());
	}
	verifyForthLspAsset(archive, lock.archive, 'source archive');
	await writeFile(cachedArchive, archive);
	const source = path.join(cache, 'source');
	const original = path.join(cache, 'native-source');
	try {
		await readFile(path.join(source, '.prepared'));
	} catch {
		const temporary = path.join(cache, `source.preparing-${randomUUID()}`);
		await mkdir(temporary);
		try {
			await run('tar', ['-xzf', cachedArchive, '--strip-components=1', '-C', temporary]);
			if (sha256(await readFile(path.join(temporary, 'Cargo.lock'))) !== lock.cargoLockSha256)
				throw new Error('Forth LSP Cargo.lock differs');
			await cp(temporary, original, { recursive: true });
			await run('patch', ['--batch', '-p1', '-i', patchPath], { cwd: temporary });
			await writeFile(path.join(temporary, '.prepared'), lock.patchSha256);
			await rename(temporary, source);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}
	const wasmPath = path.join(outputDirectory, 'forth_lsp.wasm');
	let wasm;
	try {
		wasm = verifyForthLspAsset(await readFile(wasmPath), lock.wasm, 'WASM');
	} catch {
		// Toolchain installation is a local build prerequisite; no deployment is performed.
		await run('rustup', [
			'toolchain',
			'install',
			lock.rustVersion,
			'--profile',
			'minimal',
			'--target',
			lock.target
		]);
		const cargoRoot = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
		const sysroot = execFileSync('rustc', [`+${lock.rustVersion}`, '--print', 'sysroot'], {
			encoding: 'utf8'
		}).trim();
		const env = {
			...process.env,
			CARGO_TARGET_DIR: path.join(cache, 'wasi-target'),
			CARGO_BUILD_BUILD_DIR: path.join(cache, 'wasi-intermediate'),
			CARGO_BUILD_JOBS: '2',
			SOURCE_DATE_EPOCH: '0',
			CARGO_ENCODED_RUSTFLAGS: [
				`--remap-path-prefix=${source}=/forth-lsp`,
				`--remap-path-prefix=${path.join(cargoRoot, 'registry')}=/cargo/registry`,
				`--remap-path-prefix=${sysroot}=/rust-toolchain`
			].join('\u001f')
		};
		await run(
			'cargo',
			[
				`+${lock.rustVersion}`,
				'build',
				'--locked',
				'--lib',
				'--profile',
				'wasm-release',
				'--target',
				lock.target
			],
			{ cwd: source, env }
		);
		wasm = verifyForthLspAsset(
			await readFile(
				path.join(env.CARGO_TARGET_DIR, lock.target, 'wasm-release/forth_lsp.wasm')
			),
			lock.wasm,
			'WASM'
		);
	}
	const nativeTarget = path.join(cache, 'native-target');
	const nativePath = path.join(
		nativeTarget,
		'release',
		process.platform === 'win32' ? 'forth-lsp.exe' : 'forth-lsp'
	);
	if (buildNative) {
		await run(
			'cargo',
			[`+${lock.rustVersion}`, 'build', '--locked', '--release', '--bin', 'forth-lsp'],
			{
				cwd: original,
				env: {
					...process.env,
					CARGO_TARGET_DIR: nativeTarget,
					CARGO_BUILD_BUILD_DIR: path.join(cache, 'native-intermediate'),
					CARGO_BUILD_JOBS: '2'
				}
			}
		);
	}
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(wasmPath, wasm);
	await cp(path.join(source, 'LICENSE'), path.join(outputDirectory, 'LICENSE'));
	await writeFile(
		path.join(outputDirectory, 'source.json'),
		`${JSON.stringify(lock, null, '\t')}\n`
	);
	return { wasmPath, ...(buildNative ? { nativePath } : {}), ...lock.wasm };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(
		await buildForthLsp({
			buildNative: process.argv.includes('--native'),
			archivePath: process.env.FORTH_LSP_SOURCE_ARCHIVE
		})
	);
}
