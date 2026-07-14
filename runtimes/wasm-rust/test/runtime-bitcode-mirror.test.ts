import { File, wasi } from '@bjorn3/browser_wasi_shim';
import { describe, expect, it } from 'vitest';

import { normalizeRuntimeManifest } from '../src/runtime-manifest.js';
import { buildPreopenedDirectories, readMirroredBitcode } from '../src/rustc-runtime.js';
import { SharedWorkspaceFile } from '../src/shared-workspace.js';
import { createRuntimeManifest } from './helpers.js';

describe('mirrored bitcode file', () => {
	it('shares temporary directories and files between rustc worker filesystems', async () => {
		const sharedBitcodeBuffer = new SharedArrayBuffer(16 + 256);
		const sharedWorkspaceBuffer = new SharedArrayBuffer(8 * 1024 * 1024);
		const manifest = normalizeRuntimeManifest(createRuntimeManifest());
		const mainRuntime = await buildPreopenedDirectories(
			manifest,
			[],
			'fn main() {}',
			sharedBitcodeBuffer,
			sharedWorkspaceBuffer
		);
		const helperRuntime = await buildPreopenedDirectories(
			manifest,
			[],
			'fn main() {}',
			sharedBitcodeBuffer,
			sharedWorkspaceBuffer
		);
		const mainWorkDirectory = mainRuntime.fds[5] as any;
		const helperWorkDirectory = helperRuntime.fds[5] as any;
		const objectBytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);

		expect(mainWorkDirectory.path_create_directory('rmeta-test')).toBe(
			wasi.ERRNO_SUCCESS
		);
		const precreatedObject = mainWorkDirectory.path_open(
			0,
			'main.rcgu.o',
			wasi.OFLAGS_CREAT,
			BigInt(wasi.RIGHTS_FD_WRITE),
			0n,
			0
		);
		expect(precreatedObject.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(helperWorkDirectory.path_filestat_get(0, 'main.rcgu.o').ret).toBe(
			wasi.ERRNO_NOENT
		);
		const helperFile = helperWorkDirectory.path_open(
			0,
			'rmeta-test/full.rmeta',
			wasi.OFLAGS_CREAT,
			BigInt(wasi.RIGHTS_FD_WRITE),
			0n,
			0
		);
		expect(helperFile.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(helperFile.fd_obj.fd_write(objectBytes).ret).toBe(wasi.ERRNO_SUCCESS);

		const mainFile = mainWorkDirectory.path_open(
			0,
			'rmeta-test/full.rmeta',
			0,
			BigInt(wasi.RIGHTS_FD_READ),
			0n,
			0
		);
		expect(mainFile.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(mainFile.fd_obj.fd_read(objectBytes.byteLength).data).toEqual(objectBytes);
	});

	it('appears absent until first write so rustc does not infer read-only POSIX permissions', async () => {
		const sharedBitcodeBuffer = new SharedArrayBuffer(16 + 256);
		const manifest = normalizeRuntimeManifest(createRuntimeManifest());
		const { fds } = await buildPreopenedDirectories(
			manifest,
			[],
			'fn main() {}',
			sharedBitcodeBuffer,
			new SharedArrayBuffer(4 * 1024 * 1024)
		);
		const workDirectory = fds[5] as any;
		const outputPath = manifest.compiler.workerBitcodeFile;

		expect(workDirectory.path_filestat_get(0, outputPath).ret).toBe(wasi.ERRNO_NOENT);
		const opened = workDirectory.path_open(
			0,
			outputPath,
			wasi.OFLAGS_TRUNC,
			BigInt(wasi.RIGHTS_FD_WRITE),
			0n,
			0
		);
		expect(opened.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(opened.fd_obj.fd_write(new Uint8Array([0x00, 0x61, 0x73, 0x6d])).ret).toBe(
			wasi.ERRNO_SUCCESS
		);
		expect(workDirectory.path_filestat_get(0, outputPath).ret).toBe(wasi.ERRNO_SUCCESS);
	});

	it('preserves the shared mirror when rustc renames a temp bitcode file into place', async () => {
		const sharedBitcodeBuffer = new SharedArrayBuffer(16 + 256);
		const manifest = normalizeRuntimeManifest(createRuntimeManifest());
		const { fds } = await buildPreopenedDirectories(
			manifest,
			[],
			'fn main() { println!("hi"); }',
			sharedBitcodeBuffer,
			new SharedArrayBuffer(4 * 1024 * 1024)
		);
		const workDirectory = fds[5] as any;
		const tempFileName = 'rmeta-temp.bc';
		const expectedBitcode = new Uint8Array([0x42, 0x43, 0xc0, 0xde]);

		expect(readMirroredBitcode(sharedBitcodeBuffer).length).toBe(0);
		expect(workDirectory.path_link(tempFileName, new File(expectedBitcode), false)).toBe(
			wasi.ERRNO_SUCCESS
		);

		const tempUnlink = workDirectory.path_unlink(tempFileName);
		expect(tempUnlink.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(tempUnlink.inode_obj).toBeInstanceOf(SharedWorkspaceFile);

		expect(workDirectory.path_unlink_file(manifest.compiler.workerBitcodeFile)).toBe(
			wasi.ERRNO_SUCCESS
		);
		expect(
			workDirectory.path_link(manifest.compiler.workerBitcodeFile, tempUnlink.inode_obj, true)
		).toBe(wasi.ERRNO_SUCCESS);

		const mirrored = readMirroredBitcode(sharedBitcodeBuffer);
		expect(mirrored.overflowed).toBe(false);
		expect(Array.from(mirrored.bytes)).toEqual(Array.from(expectedBitcode));
	});

	it('preserves the shared mirror when the root preopen renames work bitcode into place', async () => {
		const sharedBitcodeBuffer = new SharedArrayBuffer(16 + 256);
		const manifest = normalizeRuntimeManifest(createRuntimeManifest());
		const { fds } = await buildPreopenedDirectories(
			manifest,
			[],
			'fn main() { println!("hi"); }',
			sharedBitcodeBuffer,
			new SharedArrayBuffer(4 * 1024 * 1024)
		);
		const rootDirectory = fds[6] as any;
		const tempFileName = 'work/rmeta-temp.bc';
		const expectedBitcode = new Uint8Array([0x0b, 0x17, 0xc0, 0xde]);

		expect(rootDirectory.path_link(tempFileName, new File(expectedBitcode), false)).toBe(
			wasi.ERRNO_SUCCESS
		);

		const tempUnlink = rootDirectory.path_unlink(tempFileName);
		expect(tempUnlink.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(tempUnlink.inode_obj).toBeInstanceOf(SharedWorkspaceFile);

		expect(rootDirectory.path_unlink_file(`work/${manifest.compiler.workerBitcodeFile}`)).toBe(
			wasi.ERRNO_SUCCESS
		);
		expect(
			rootDirectory.path_link(
				`work/${manifest.compiler.workerBitcodeFile}`,
				tempUnlink.inode_obj,
				true
			)
		).toBe(wasi.ERRNO_SUCCESS);

		const mirrored = readMirroredBitcode(sharedBitcodeBuffer);
		expect(mirrored.overflowed).toBe(false);
		expect(Array.from(mirrored.bytes)).toEqual(Array.from(expectedBitcode));
	});

	it('preserves the shared mirror after reopening /work from the root preopen', async () => {
		const sharedBitcodeBuffer = new SharedArrayBuffer(16 + 256);
		const manifest = normalizeRuntimeManifest(createRuntimeManifest());
		const { fds } = await buildPreopenedDirectories(
			manifest,
			[],
			'fn main() { println!("hi"); }',
			sharedBitcodeBuffer,
			new SharedArrayBuffer(4 * 1024 * 1024)
		);
		const rootDirectory = fds[6] as any;
		const openedWork = rootDirectory.path_open(0, 'work', 0, 0n, 0n, 0);
		const workDirectory = openedWork.fd_obj as any;
		const tempFileName = 'rmeta-opened-dir.bc';
		const expectedBitcode = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

		expect(openedWork.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(workDirectory.path_link(tempFileName, new File(expectedBitcode), false)).toBe(
			wasi.ERRNO_SUCCESS
		);

		const tempUnlink = workDirectory.path_unlink(tempFileName);
		expect(tempUnlink.ret).toBe(wasi.ERRNO_SUCCESS);
		expect(tempUnlink.inode_obj).toBeInstanceOf(SharedWorkspaceFile);

		expect(workDirectory.path_unlink_file(manifest.compiler.workerBitcodeFile)).toBe(
			wasi.ERRNO_SUCCESS
		);
		expect(
			workDirectory.path_link(manifest.compiler.workerBitcodeFile, tempUnlink.inode_obj, true)
		).toBe(wasi.ERRNO_SUCCESS);

		const mirrored = readMirroredBitcode(sharedBitcodeBuffer);
		expect(mirrored.overflowed).toBe(false);
		expect(Array.from(mirrored.bytes)).toEqual(Array.from(expectedBitcode));
	});
});
