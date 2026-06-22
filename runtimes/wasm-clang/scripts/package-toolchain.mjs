#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import {
	ZipReader,
	ZipWriter,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	configure
} from '@zip.js/zip.js';

configure({ useWebWorkers: false });

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultTargetDir = path.resolve(repoRoot, 'artifacts', 'runtime-source');

const usage = `Usage:
  node scripts/package-toolchain.mjs \\
    --clang-wasm /path/to/clang.wasm \\
    --lld-wasm /path/to/wasm-ld.wasm \\
    --sysroot /path/to/wasi-sysroot \\
    --clangd-js /path/to/clangd.js \\
    --clangd-wasm /path/to/clangd.wasm[.gz] \\
    --llvm-version 22.1.8 \\
    --wasi-sdk-version 33 \\
    --emsdk-version 6.0.0

Options:
  --target-dir DIR                 Output directory. Defaults to artifacts/runtime-source.
  --memfs-zip FILE                 Existing memfs.zip. Defaults to the current target memfs.zip.
  --version NAME                   Runtime manifest version. Defaults to llvmorg-<llvm-version>.
  --resource-dir PATH              Defaults to /lib/clang/<llvm-version>.
  --compiler-runtime-lib-dir PATH  Defaults to lib/clang/<llvm-version>/lib/wasi.

Notes:
  clang and lld must be raw WASI WebAssembly modules. clangd must be the Emscripten
  JS module plus its wasm module. Existing single-entry zip inputs are accepted for
  clang, lld, and sysroot so this script can repackage the current committed assets.
`;

function parseArgs(argv) {
	const result = new Map();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--') continue;
		if (arg === '--help' || arg === '-h') {
			result.set('help', 'true');
			continue;
		}
		if (!arg.startsWith('--')) {
			throw new Error(`Unexpected argument: ${arg}`);
		}
		const inlineValueOffset = arg.indexOf('=');
		if (inlineValueOffset !== -1) {
			result.set(arg.slice(2, inlineValueOffset), arg.slice(inlineValueOffset + 1));
			continue;
		}
		const key = arg.slice(2);
		const next = argv[index + 1];
		if (!next || next.startsWith('--')) {
			throw new Error(`Missing value for ${arg}`);
		}
		result.set(key, next);
		index += 1;
	}
	return result;
}

function required(args, key) {
	const value = args.get(key);
	if (!value) throw new Error(`Missing required option --${key}`);
	return value;
}

function optionalPath(args, key, fallback) {
	const value = args.get(key);
	return path.resolve(value || fallback);
}

function sha256(bytes) {
	return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function readSingleZipEntry(filePath) {
	const zipBytes = await fs.readFile(filePath);
	const reader = new ZipReader(new Uint8ArrayReader(zipBytes));
	try {
		const entries = await reader.getEntries();
		const fileEntry = entries.find((entry) => !entry.directory && 'getData' in entry);
		if (!fileEntry) throw new Error(`No file entry found in ${filePath}`);
		return await fileEntry.getData(new Uint8ArrayWriter());
	} finally {
		await reader.close();
	}
}

async function readMaybeZip(filePath) {
	if (filePath.endsWith('.zip')) return await readSingleZipEntry(filePath);
	return await fs.readFile(filePath);
}

async function assertWasm(label, bytes) {
	if (
		bytes.length < 8 ||
		bytes[0] !== 0x00 ||
		bytes[1] !== 0x61 ||
		bytes[2] !== 0x73 ||
		bytes[3] !== 0x6d
	) {
		throw new Error(`${label} is not a WebAssembly module`);
	}
	await WebAssembly.compile(bytes);
}

async function zipSingleFile(targetPath, entryName, bytes) {
	const writer = new ZipWriter(new Uint8ArrayWriter());
	await writer.add(entryName, new Uint8ArrayReader(bytes), {
		lastModDate: new Date(0)
	});
	const zipBytes = await writer.close();
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	await fs.writeFile(targetPath, zipBytes);
	return zipBytes;
}

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: 'inherit' });
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with code ${code}`));
		});
	});
}

async function resolveSysrootTarBytes(sysrootPath, tempDir) {
	const stats = await fs.stat(sysrootPath);
	if (stats.isDirectory()) {
		const entries = (await fs.readdir(sysrootPath)).filter((entry) => entry !== '.DS_Store');
		if (entries.length === 0) throw new Error(`Sysroot directory is empty: ${sysrootPath}`);
		const tarPath = path.join(tempDir, 'sysroot.tar');
		await run('tar', ['-cf', tarPath, '-C', sysrootPath, ...entries]);
		return await fs.readFile(tarPath);
	}
	if (sysrootPath.endsWith('.tar.zip')) return await readSingleZipEntry(sysrootPath);
	if (sysrootPath.endsWith('.tar')) return await fs.readFile(sysrootPath);
	throw new Error(`Unsupported sysroot input. Expected directory, .tar, or .tar.zip: ${sysrootPath}`);
}

async function resolveClangdWasmGzip(filePath) {
	const bytes = await fs.readFile(filePath);
	if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
		await assertWasm('clangd wasm payload', await gunzipAsync(bytes));
		return bytes;
	}
	await assertWasm('clangd wasm', bytes);
	return await gzipAsync(bytes, { level: 9 });
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.has('help')) {
		console.log(usage);
		return;
	}

	const targetDir = optionalPath(args, 'target-dir', defaultTargetDir);
	const clangPath = path.resolve(required(args, 'clang-wasm'));
	const lldPath = path.resolve(required(args, 'lld-wasm'));
	const sysrootPath = path.resolve(required(args, 'sysroot'));
	const clangdJsPath = path.resolve(required(args, 'clangd-js'));
	const clangdWasmPath = path.resolve(required(args, 'clangd-wasm'));
	const memfsPath = optionalPath(args, 'memfs-zip', path.join(targetDir, 'memfs.zip'));

	const llvmVersion = args.get('llvm-version') || 'custom';
	const version = args.get('version') || `llvmorg-${llvmVersion}`;
	const resourceDir = args.get('resource-dir') || `/lib/clang/${llvmVersion}`;
	const compilerRuntimeLibDir =
		args.get('compiler-runtime-lib-dir') || `lib/clang/${llvmVersion}/lib/wasi`;
	const wasiSdkVersion = args.get('wasi-sdk-version');
	const emsdkVersion = args.get('emsdk-version');

	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-clang-toolchain-'));
	try {
		const clangBytes = await readMaybeZip(clangPath);
		const lldBytes = await readMaybeZip(lldPath);
		const sysrootTarBytes = await resolveSysrootTarBytes(sysrootPath, tempDir);
		const memfsBytes = await fs.readFile(memfsPath);
		const clangdJsBytes = await fs.readFile(clangdJsPath);
		const clangdWasmGzipBytes = await resolveClangdWasmGzip(clangdWasmPath);

		await assertWasm('clang', clangBytes);
		await assertWasm('lld', lldBytes);

		await fs.mkdir(path.join(targetDir, 'clangd'), { recursive: true });
		const assetHashes = {
			'clang.zip': sha256(await zipSingleFile(path.join(targetDir, 'clang.zip'), 'clang', clangBytes)),
			'lld.zip': sha256(await zipSingleFile(path.join(targetDir, 'lld.zip'), 'lld', lldBytes)),
			'sysroot.tar.zip': sha256(
				await zipSingleFile(path.join(targetDir, 'sysroot.tar.zip'), 'sysroot.tar', sysrootTarBytes)
			),
			'memfs.zip': sha256(memfsBytes),
			'clangd/clangd.js': sha256(clangdJsBytes),
			'clangd/clangd.wasm.gz': sha256(clangdWasmGzipBytes)
		};

		await fs.writeFile(path.join(targetDir, 'memfs.zip'), memfsBytes);
		await fs.writeFile(path.join(targetDir, 'clangd', 'clangd.js'), clangdJsBytes);
		await fs.writeFile(path.join(targetDir, 'clangd', 'clangd.wasm.gz'), clangdWasmGzipBytes);

		const metadata = {
			version,
			llvmVersion,
			...(wasiSdkVersion ? { wasiSdkVersion } : {}),
			...(emsdkVersion ? { emsdkVersion } : {}),
			resourceDir,
			compilerRuntimeLibDir,
			generatedAt: new Date().toISOString(),
			assets: assetHashes
		};
		await fs.writeFile(path.join(targetDir, 'toolchain.json'), JSON.stringify(metadata, null, 2) + '\n');
		console.log(`Packaged wasm-clang toolchain assets in ${targetDir}`);
		console.log(`Runtime version: ${version}`);
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
