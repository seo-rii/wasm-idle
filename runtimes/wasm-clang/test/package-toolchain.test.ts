import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter, configure } from '@zip.js/zip.js';
import { afterEach, describe, expect, it } from 'vitest';

configure({ useWebWorkers: false });

const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);
const testDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.resolve(testDir, 'scripts', 'package-toolchain.mjs');
const emptyWasm = Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);

const tempDirs: string[] = [];

async function readZipEntry(filePath: string) {
	const reader = new ZipReader(new Uint8ArrayReader(await fs.readFile(filePath)));
	try {
		const entries = await reader.getEntries();
		const entry = entries.find((candidate) => !candidate.directory && 'getData' in candidate);
		if (!entry) throw new Error(`missing zip entry in ${filePath}`);
		return {
			name: entry.filename,
			bytes: await entry.getData(new Uint8ArrayWriter())
		};
	} finally {
		await reader.close();
	}
}

describe('package-toolchain script', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((directory) => fs.rm(directory, { recursive: true, force: true }))
		);
	});

	it('packages compiler, sysroot, clangd, and metadata assets', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-clang-package-test-'));
		tempDirs.push(tempDir);
		const inputDir = path.join(tempDir, 'input');
		const sysrootDir = path.join(inputDir, 'sysroot');
		const outputDir = path.join(tempDir, 'output');
		await fs.mkdir(path.join(sysrootDir, 'include'), { recursive: true });
		await fs.mkdir(path.join(sysrootDir, 'lib', 'clang', '22.1.8', 'lib', 'wasi'), {
			recursive: true
		});
		await fs.writeFile(path.join(inputDir, 'clang.wasm'), emptyWasm);
		await fs.writeFile(path.join(inputDir, 'lld.wasm'), emptyWasm);
		await fs.writeFile(path.join(inputDir, 'memfs.zip'), 'memfs');
		await fs.writeFile(path.join(inputDir, 'clangd.js'), 'export default async () => ({})');
		await fs.writeFile(path.join(inputDir, 'clangd.wasm'), emptyWasm);
		await fs.writeFile(path.join(sysrootDir, 'include', 'stdio.h'), '');
		await fs.writeFile(
			path.join(
				sysrootDir,
				'lib',
				'clang',
				'22.1.8',
				'lib',
				'wasi',
				'libclang_rt.builtins-wasm32.a'
			),
			''
		);

		await execFileAsync(process.execPath, [
			scriptPath,
			'--clang-wasm',
			path.join(inputDir, 'clang.wasm'),
			'--lld-wasm',
			path.join(inputDir, 'lld.wasm'),
			'--sysroot',
			sysrootDir,
			'--clangd-js',
			path.join(inputDir, 'clangd.js'),
			'--clangd-wasm',
			path.join(inputDir, 'clangd.wasm'),
			'--memfs-zip',
			path.join(inputDir, 'memfs.zip'),
			'--target-dir',
			outputDir,
			'--llvm-version',
			'22.1.8',
			'--wasi-sdk-version',
			'33',
			'--emsdk-version',
			'6.0.0'
		]);

		const clangZip = await readZipEntry(path.join(outputDir, 'clang.zip'));
		const lldZip = await readZipEntry(path.join(outputDir, 'lld.zip'));
		const sysrootZip = await readZipEntry(path.join(outputDir, 'sysroot.tar.zip'));
		expect(clangZip.name).toBe('clang');
		expect(clangZip.bytes).toEqual(emptyWasm);
		expect(lldZip.name).toBe('lld');
		expect(lldZip.bytes).toEqual(emptyWasm);
		expect(sysrootZip.name).toBe('sysroot.tar');
		expect(await fs.readFile(path.join(outputDir, 'memfs.zip'), 'utf8')).toBe('memfs');
		expect(await fs.readFile(path.join(outputDir, 'clangd', 'clangd.js'), 'utf8')).toContain(
			'export default'
		);
		const clangdWasm = await gunzipAsync(
			await fs.readFile(path.join(outputDir, 'clangd', 'clangd.wasm.gz'))
		);
		expect(Uint8Array.from(clangdWasm)).toEqual(emptyWasm);

		const metadata = JSON.parse(
			await fs.readFile(path.join(outputDir, 'toolchain.json'), 'utf8')
		);
		expect(metadata.version).toBe('llvmorg-22.1.8');
		expect(metadata.resourceDir).toBe('/lib/clang/22.1.8');
		expect(metadata.compilerRuntimeLibDir).toBe('lib/clang/22.1.8/lib/wasi');
		expect(metadata.wasiSdkVersion).toBe('33');
		expect(metadata.emsdkVersion).toBe('6.0.0');
		expect(metadata.assets['clang.zip']).toHaveLength(64);
	});
});
