import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { readSingleZipEntry } from '../../scripts/llvm-contracts/archive.mjs';

import { syncWasmVAssets } from '../../scripts/sync-wasm-v.mjs';

const tempDirs: string[] = [];
const archiveFiles = ['v.zip', 'vroot.tar.zip', 'c-sysroot.tar.zip'];

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-v-'));
	tempDirs.push(directory);
	return directory;
}

function sha256(contents: Buffer) {
	return createHash('sha256').update(contents).digest('hex');
}

function tar(files: Record<string, string>) {
	const parts: Buffer[] = [];
	for (const [name, contents] of Object.entries(files)) {
		const bytes = Buffer.from(contents);
		const header = Buffer.alloc(512);
		header.write(name, 0, 100);
		header.write('0000644\0', 100, 8);
		header.write('0000000\0', 108, 8);
		header.write('0000000\0', 116, 8);
		header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12);
		header.write('00000000000\0', 136, 12);
		header.fill(32, 148, 156);
		header[156] = 48;
		header.write('ustar\0', 257, 6);
		header.write('00', 263, 2);
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
		parts.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
	}
	return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

async function replaceArchive(sourceDir: string, asset: string, bytes: Buffer) {
	await writeFile(path.join(sourceDir, asset), bytes);
	const file = path.join(sourceDir, 'runtime-build.json');
	const build = JSON.parse(await readFile(file, 'utf8'));
	const metadata = build.assets.find((entry: { asset: string }) => entry.asset === asset);
	metadata.size = bytes.length;
	metadata.sha256 = sha256(bytes);
	build.toolchain.assets[asset] = metadata.sha256;
	await writeFile(file, JSON.stringify(build));
}

async function writeFixture(sourceDir: string) {
	const rootfsTar = tar({
		'v/vlib/builtin/builtin.v': 'module builtin',
		'v/vlib/os/os.v': 'module os',
		'v/LICENSE': 'MIT'
	});
	const cSysrootTar = tar({
		'include/wasm32-wasi/stdio.h': '/* stdio */',
		'include/v-wasi/v_wasi_compat.h': '/* compat */',
		'lib/wasm32-wasi/libc.a': '!<arch>\n',
		'lib/wasm32-wasi/libvwasi.a': '!<arch>\n',
		'lib/clang/22/lib/wasi/libclang_rt.builtins-wasm32.a': '!<arch>\n'
	});
	const archives = new Map([
		['v.zip', Buffer.from(zipSync({ v: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0) }))],
		['vroot.tar.zip', Buffer.from(zipSync({ 'vroot.tar': rootfsTar }))],
		['c-sysroot.tar.zip', Buffer.from(zipSync({ 'c-sysroot.tar': cSysrootTar }))]
	]);
	for (const [filename, contents] of archives) {
		await writeFile(path.join(sourceDir, filename), contents);
	}
	const toolchain = {
		version: 'v-0.5.2-wasi-preview1-v1',
		vVersion: '0.5.2',
		vCommit: '7647ce1c6fad63b5578bc07883139906de74b2f8',
		frontendTarget: 'wasm32-wasi',
		backend: 'wasm-llvm-clang',
		acceptance: {
			compiler: { bytes: 8, sha256: sha256(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])) },
			fixtures: {
				'fixtures/program.v':
					'9f3a93d3348b5ee71cbbf5063583ae45fcf65c8a18816cfd172cb14aa8cd5108',
				'fixtures/invalid.v':
					'c4121092bac14674c3bbf72afc369183a915b49997586bc8eea7cd0575fbbecd'
			},
			results: {
				rejectedInvalidSource: true,
				translatedSource: true,
				stdinStdout: true,
				generatedC: { bytes: 1, sha256: 'a'.repeat(64) },
				program: { bytes: 1, sha256: 'b'.repeat(64) }
			}
		}
	};
	await writeFile(
		path.join(sourceDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(
			{
				manifestVersion: 1,
				version: toolchain.version,
				frontend: { asset: 'v.zip', argv0: 'v' },
				rootfs: { asset: 'vroot.tar.zip' },
				cSysroot: { asset: 'c-sysroot.tar.zip' },
				profile: {
					name: 'v-wasi-clang',
					version: 1,
					vVersion: toolchain.vVersion,
					vCommit: toolchain.vCommit,
					frontendTarget: toolchain.frontendTarget,
					backend: toolchain.backend
				}
			},
			null,
			2
		)}\n`
	);
	await writeFile(
		path.join(sourceDir, 'runtime-build.json'),
		`${JSON.stringify(
			{
				toolchain: {
					...toolchain,
					assets: Object.fromEntries(
						archiveFiles.map((asset) => [asset, sha256(archives.get(asset)!)])
					)
				},
				assets: archiveFiles.map((asset) => ({
					asset,
					size: archives.get(asset)!.byteLength,
					sha256: sha256(archives.get(asset)!)
				}))
			},
			null,
			2
		)}\n`
	);
}

function corruptTarSize(size: string) {
	const bytes = tar({ 'v/vlib/builtin/builtin.v': 'module builtin' });
	bytes.fill(0, 124, 136);
	bytes.write(size, 124, 12, 'ascii');
	bytes.fill(32, 148, 156);
	bytes.write(
		`${bytes
			.subarray(0, 512)
			.reduce((sum, byte) => sum + byte, 0)
			.toString(8)
			.padStart(6, '0')}\0 `,
		148,
		8
	);
	return bytes;
}

describe('syncWasmVAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('requires an explicit source directory', async () => {
		await expect(syncWasmVAssets()).rejects.toThrow(
			'wasm-v sync requires an explicit source directory'
		);
	});

	it('validates producer ZIPs and atomically installs native gzip delivery assets', async () => {
		const sourceDir = await makeTempDir();
		const targetParent = await makeTempDir();
		const targetDir = path.join(targetParent, 'wasm-v');
		await writeFixture(sourceDir);
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'stale.zip'), 'stale');

		const result = await syncWasmVAssets({ sourceDir, targetDir });

		expect(result).toEqual({ sourceDir, targetDir });
		expect((await readdir(targetDir)).sort()).toEqual(
			[
				'c-sysroot.tar.gz',
				'v.wasm.gz',
				'vroot.tar.gz',
				'runtime-build.json',
				'runtime-manifest.v1.json'
			].sort()
		);
		expect(gunzipSync(await readFile(path.join(targetDir, 'v.wasm.gz')))).toEqual(
			Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
		);
		const deliveryManifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		);
		expect(deliveryManifest).toEqual(
			expect.objectContaining({
				frontend: { asset: 'v.wasm.gz', argv0: 'v' },
				rootfs: { asset: 'vroot.tar.gz' },
				cSysroot: { asset: 'c-sysroot.tar.gz' }
			})
		);
		const deliveryBuild = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-build.json'), 'utf8')
		);
		expect(deliveryBuild.delivery).toEqual(
			expect.objectContaining({
				format: 'wasm-idle-v-native-gzip-v1',
				sourceAssets: expect.arrayContaining([expect.objectContaining({ asset: 'v.zip' })])
			})
		);
		expect((await readdir(targetParent)).filter((name) => name.includes('.next-'))).toEqual([]);
		expect((await readdir(targetParent)).filter((name) => name.includes('.previous-'))).toEqual(
			[]
		);
	});

	it('keeps the existing target when source metadata does not match an archive', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-v');
		await writeFixture(sourceDir);
		await writeFile(path.join(sourceDir, 'v.zip'), 'corrupted');
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'existing.txt'), 'existing');

		await expect(syncWasmVAssets({ sourceDir, targetDir })).rejects.toThrow(
			'v.zip does not match runtime-build.json'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});

	it('rejects a producer bundle for a different V revision', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-v');
		await writeFixture(sourceDir);
		const manifestPath = path.join(sourceDir, 'runtime-manifest.v1.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.profile.vCommit = '0'.repeat(40);
		await writeFile(manifestPath, JSON.stringify(manifest));

		await expect(syncWasmVAssets({ sourceDir, targetDir })).rejects.toThrow(
			'unsupported compiler profile'
		);
	});

	it('keeps the existing target when a required runtime asset is missing', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-v');
		await writeFixture(sourceDir);
		await rm(path.join(sourceDir, 'vroot.tar.zip'));
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'existing.txt'), 'existing');

		await expect(syncWasmVAssets({ sourceDir, targetDir })).rejects.toThrow(
			'vroot.tar.zip was not found'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});
	it.each([
		['negative size', () => corruptTarSize('-1000')],
		['declared payload beyond the archive', () => corruptTarSize('77777777777')],
		[
			'missing terminator',
			() => tar({ 'v/vlib/builtin/builtin.v': 'builtin' }).subarray(0, 1024)
		],
		[
			'checksum mismatch',
			() => {
				const bytes = tar({ 'v/vlib/builtin/builtin.v': 'builtin' });
				bytes[0] ^= 1;
				return bytes;
			}
		],
		['unsafe path', () => tar({ '../builtin.v': 'builtin' })],
		[
			'duplicate path',
			() => {
				const bytes = tar({ 'v/vlib/builtin/builtin.v': 'builtin' });
				return Buffer.concat([bytes.subarray(0, 1024), bytes]);
			}
		],
		['missing required file', () => tar({ 'v/LICENSE': 'MIT' })],
		[
			'empty required file',
			() =>
				tar({
					'v/vlib/builtin/builtin.v': '',
					'v/vlib/os/os.v': 'module os',
					'v/LICENSE': 'MIT'
				})
		]
	] as const)(
		'rejects %s even with matching archive hashes and preserves the output',
		async (_label, contents) => {
			const sourceDir = await makeTempDir();
			const targetDir = path.join(await makeTempDir(), 'wasm-v');
			await writeFixture(sourceDir);
			await mkdir(targetDir);
			await writeFile(path.join(targetDir, 'existing.txt'), 'existing');
			await replaceArchive(
				sourceDir,
				'vroot.tar.zip',
				Buffer.from(zipSync({ 'vroot.tar': contents() }))
			);
			await expect(syncWasmVAssets({ sourceDir, targetDir })).rejects.toThrow(
				/TAR|vroot.tar/
			);
			expect(await readdir(targetDir)).toEqual(['existing.txt']);
			expect(await readFile(path.join(targetDir, 'existing.txt'), 'utf8')).toBe('existing');
		}
	);

	it.each([
		[
			'truthy acceptance result',
			(build: any) => {
				build.toolchain.acceptance.results.translatedSource = 'false';
			}
		],
		[
			'malformed program digest',
			(build: any) => {
				build.toolchain.acceptance.results.program.sha256 = 'abc';
			}
		],
		[
			'fractional program size',
			(build: any) => {
				build.toolchain.acceptance.results.program.bytes = 1.5;
			}
		],
		[
			'compiler from another build',
			(build: any) => {
				build.toolchain.acceptance.compiler.sha256 = 'c'.repeat(64);
			}
		],
		[
			'different acceptance fixture',
			(build: any) => {
				build.toolchain.acceptance.fixtures['fixtures/program.v'] = 'c'.repeat(64);
			}
		]
	] as const)('rejects %s', async (_label, mutate) => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-v');
		await writeFixture(sourceDir);
		const file = path.join(sourceDir, 'runtime-build.json');
		const build = JSON.parse(await readFile(file, 'utf8'));
		mutate(build);
		await writeFile(file, JSON.stringify(build));
		await expect(syncWasmVAssets({ sourceDir, targetDir })).rejects.toThrow(
			'compile/run acceptance'
		);
	});

	it('rejects duplicate ZIP names before object unpacking can hide them', () => {
		const bytes = Buffer.from(zipSync({ v: Uint8Array.of(1), x: Uint8Array.of(2) }));
		for (let offset = 0; offset < bytes.length - 4; offset++) {
			const signature = bytes.readUInt32LE(offset);
			if (signature === 0x04034b50 && bytes[offset + 30] === 120) bytes[offset + 30] = 118;
			if (signature === 0x02014b50 && bytes[offset + 46] === 120) bytes[offset + 46] = 118;
		}
		expect(() => readSingleZipEntry(bytes, 'v')).toThrow('must contain only v');
	});

	it('rejects a ZIP entry marked as a DOS directory', () => {
		const bytes = Buffer.from(zipSync({ v: Uint8Array.of(1, 2, 3) }));
		const directory = bytes.readUInt32LE(bytes.length - 6);
		bytes.writeUInt32LE((bytes.readUInt32LE(directory + 38) | 0x10) >>> 0, directory + 38);
		expect(() => readSingleZipEntry(bytes, 'v')).toThrow('unsupported ZIP entry');
	});

	it('rejects trailing compressed bytes after a valid deflate stream', () => {
		const bytes = Buffer.from(zipSync({ v: Uint8Array.of(1, 2, 3) }, { level: 9 }));
		const directory = bytes.readUInt32LE(bytes.length - 6);
		const revised = Buffer.concat([
			bytes.subarray(0, directory),
			Buffer.from([0]),
			bytes.subarray(directory)
		]);
		revised.writeUInt32LE(bytes.readUInt32LE(18) + 1, 18);
		revised.writeUInt32LE(bytes.readUInt32LE(directory + 20) + 1, directory + 1 + 20);
		revised.writeUInt32LE(directory + 1, revised.length - 6);
		expect(() => readSingleZipEntry(revised, 'v')).toThrow('trailing bytes');
	});

	it('accepts the producer standard deflate option flags', () => {
		const bytes = Buffer.from(zipSync({ v: Uint8Array.of(1, 2, 3) }, { level: 9 }));
		bytes.writeUInt16LE(bytes.readUInt16LE(6) | 2, 6);
		for (let offset = 0; offset < bytes.length - 4; offset++) {
			if (bytes.readUInt32LE(offset) === 0x02014b50) {
				bytes.writeUInt16LE(bytes.readUInt16LE(offset + 8) | 2, offset + 8);
				break;
			}
		}
		expect(readSingleZipEntry(bytes, 'v')).toEqual(Buffer.from([1, 2, 3]));
	});

	it('rejects a CRC mismatch in an otherwise valid ZIP', () => {
		const bytes = Buffer.from(zipSync({ v: Uint8Array.of(1, 2, 3) }, { level: 0 }));
		bytes.writeUInt32LE((bytes.readUInt32LE(14) ^ 1) >>> 0, 14);
		for (let offset = 0; offset < bytes.length - 4; offset++) {
			if (bytes.readUInt32LE(offset) === 0x02014b50) {
				bytes.writeUInt32LE((bytes.readUInt32LE(offset + 16) ^ 1) >>> 0, offset + 16);
				break;
			}
		}
		expect(() => readSingleZipEntry(bytes, 'v')).toThrow('CRC checksum');
	});
});
